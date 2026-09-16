// @vitest-environment node
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { expect, test } from 'vitest';
import { createDatabase } from '../worker/data/database';
import { saveAttributeResponse, processAttributeMergeRebuildJobs } from '../worker/data/attributes';
import { runCompleteAttributeReplay } from '../worker/workflows/attributeReplay';

const setup = (beforeHistoryConversion?: (sqlite: DatabaseSync) => void, beforeCleanup?: (sqlite: DatabaseSync) => void) => {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of readdirSync('migrations').filter((file) => file.endsWith('.sql')).sort()) {
    try {
      if (name === '0090_convert_win_vote_history.sql') beforeHistoryConversion?.(sqlite);
      if (name === '0092_retire_attribute_merge_compatibility.sql') beforeCleanup?.(sqlite);
      sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'));
    }
    catch (error) { sqlite.close(); throw new Error(`Migration ${name}: ${String(error)}`); }
  }
  sqlite.exec('PRAGMA foreign_keys = ON');
  interface SqliteStatement {
    bind(...values: SQLInputValue[]): SqliteStatement;
    all(): Promise<{ results: unknown[]; meta: { changes: number } }>;
    run(): Promise<{ results: unknown[]; meta: { changes: number } }>;
  }
  const prepare = (sql: string, args: SQLInputValue[] = []): SqliteStatement => ({
    bind: (...values: SQLInputValue[]) => prepare(sql, values),
    run: () => prepare(sql, args).all(),
    all: async () => {
      const statement = sqlite.prepare(sql);
      if (statement.columns().length) return { results: statement.all(...args), meta: { changes: 0 } };
      const result = statement.run(...args);
      return { results: [], meta: { changes: Number(result.changes) } };
    },
  });
  const gateway = createDatabase({ DB: {
    prepare,
    batch: async (statements: ReturnType<typeof prepare>[]) => {
      sqlite.exec('BEGIN');
      try { const result = []; for (const statement of statements) result.push(await statement.all()); sqlite.exec('COMMIT'); return result; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  } } as unknown as Parameters<typeof createDatabase>[0]);
  return { sqlite, gateway };
};

test('compatibility cleanup preserves votes and refuses to drop nonempty tables', () => {
  let before: Array<Record<string, unknown>> = [];
  const { sqlite } = setup(undefined, (db) => {
    before = db.prepare('SELECT * FROM attribute_vote_responses ORDER BY response_id').all() as Array<Record<string, unknown>>;
  });
  try {
    const expected = before.map((row) => row.session_id === 'attribute-import:attribute_candidate:49'
      ? { ...row, subject_a_id: 'attribute_subject_game:game_bgg_40628' }
      : row);
    expect(sqlite.prepare('SELECT * FROM attribute_vote_responses ORDER BY response_id').all()).toEqual(expected);
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('attribute_initial_values','attribute_initial_value_batches','attribute_response_attribute_maps','attribute_response_mapping_receipts')").all()).toEqual([]);
  } finally { sqlite.close(); }
  expect(() => setup(undefined, (db) => {
    db.exec("INSERT INTO attribute_response_attribute_maps VALUES('attribute_score_race','attribute_win_method',1,'guard-test',0)");
  })).toThrow(/CHECK constraint failed/);
});

test('bulk catalog mode creates initial states without per-state catalog deltas', () => {
  const { sqlite } = setup();
  try {
    const beforeClock = sqlite.prepare('SELECT current_version FROM attribute_catalog_clock WHERE id = 1').get() as { current_version: number };
    const beforePairs = sqlite.prepare('SELECT COUNT(*) AS count FROM attribute_pair_stats').get() as { count: number };
    sqlite.exec('INSERT INTO attribute_catalog_rebuild_mode (id) VALUES (1)');
    sqlite.prepare(`INSERT INTO games (
      id, slug, display_name, english_name, normalized_name, merged_into_game_id,
      created_by, created_at, updated_at, visibility, review_status, reviewed_at,
      attribute_enabled, bgg_id, entity_kind
    ) VALUES (?, ?, ?, NULL, ?, NULL, NULL, 1, 1, 'public', 'pending', NULL, 1, ?, 'base')`)
      .run('game_bulk-mode-test', 'bulk-mode-test', '批次快取測試', '批次快取測試', 987654321);

    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM attribute_score_states WHERE subject_id = ?').get('attribute_subject_game:game_bulk-mode-test')).toMatchObject({ count: 25 });
    expect(sqlite.prepare('SELECT current_version FROM attribute_catalog_clock WHERE id = 1').get()).toEqual(beforeClock);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM attribute_catalog_entries WHERE entry_key LIKE 'subject:attribute_subject_game:game_bulk-mode-test' OR entry_key LIKE 'value:attribute_subject_game:game_bulk-mode-test:%'").get()).toMatchObject({ count: 0 });
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='attribute_vote_events'").all()).toEqual([]);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM attribute_pair_stats').get()).toEqual(beforePairs);
  } finally { sqlite.close(); }
});

test('canonical vote history survives cleanup, new votes and a complete rebuild', async () => {
  const { sqlite, gateway } = setup((db) => {
    const subject = 'attribute_subject_game:game_attribute_import_the_mind';
    const activities = JSON.stringify([
      { id: 'history-rating', kind: 'rating', attributeId: 'attribute_score_race', attributeName: '得分取勝', subject: { id: subject }, value: 8 },
      { id: 'history-comparison', kind: 'comparison', attributeId: 'attribute_score_race', attributeName: '得分取勝', result: 'A_HIGHER', ratingA: 8, ratingB: 3 },
    ]);
    db.prepare(`INSERT INTO attribute_vote_responses
      (response_id,attribute_id,subject_a_id,rating_a,rating_b,comparison,activity_json,session_id,created_at,updated_at)
      VALUES('history-score','attribute_score_race',?,8,3,'A_HIGHER',?,'test',1,1)`).run(subject, activities);
    db.prepare(`INSERT INTO attribute_vote_events
      (id,response_id,event_key,kind,attribute_id,subject_a_id,value,session_id,created_at,updated_at)
      VALUES('history-event','history-score','rating','rating','attribute_score_race',?,8,'test',1,1)`).run(subject);
    db.prepare(`INSERT INTO attribute_vote_responses
      (response_id,attribute_id,subject_a_id,rating_a,comparison,activity_json,session_id,created_at,updated_at)
      VALUES('history-condition','attribute_end_condition',?,7,'B_HIGHER','[]','test',2,2)`).run(subject);
    const comparisonSubjects = db.prepare(`
      SELECT id FROM attribute_subjects
      WHERE id <> ? AND game_id IS NOT NULL
      ORDER BY id LIMIT 2
    `).all(subject) as Array<{ id: string }>;
    for (let index = 0; index < 200; index += 1) {
      db.prepare(`INSERT INTO attribute_vote_responses
        (response_id,attribute_id,subject_a_id,subject_b_id,comparison,activity_json,session_id,created_at,updated_at)
        VALUES(?, 'attribute_win_method', ?, ?, 'A_HIGHER', '[]', 'write-budget', ?, ?)`)
        .run(`memory-only-comparison-${index}`, comparisonSubjects[0].id, comparisonSubjects[1].id, index + 10, index + 10);
    }
  });
  try {
    const history = sqlite.prepare("SELECT * FROM attribute_vote_responses WHERE response_id='history-score'").get()!;
    expect(history).toMatchObject({attribute_id:'attribute_win_method',rating_a:2,rating_b:7,comparison:'B_HIGHER',question_high_pole:'low',created_at:1});
    expect(JSON.parse(String(history.activity_json))[0]).toMatchObject({attributeId:'attribute_win_method',attributeName:'取勝方式',value:2,attributePoles:{low:'得分取勝',high:'條件取勝'}});
    expect(JSON.parse(String(history.activity_json))[1]).toMatchObject({result:'B_HIGHER',ratingA:2,ratingB:7});
    expect(sqlite.prepare("SELECT * FROM attribute_vote_responses WHERE response_id='history-condition'").get()).toMatchObject({attribute_id:'attribute_win_method',rating_a:7,rating_b:null,comparison:'B_HIGHER',question_high_pole:'high'});
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='attribute_vote_events'").all()).toEqual([]);
    await processAttributeMergeRebuildJobs(gateway, Date.now()+100, 1000);
    expect(sqlite.prepare("SELECT status FROM attribute_merge_rebuild_jobs WHERE id='win-history-replay-v1'").get()).toMatchObject({status:'completed'});
    // 200 comparisons affect calculation only. The replay writes each final
    // state once, rather than writing the two states and pair stats per vote.
    expect(gateway.metrics?.().rowsWritten).toBeLessThan(6000);
    expect(sqlite.prepare("SELECT subject_id FROM attribute_import_candidates WHERE id='attribute_candidate:49'").get()).toMatchObject({
      subject_id: 'attribute_subject_game:game_bgg_40628',
    });
    expect(sqlite.prepare("SELECT display_name,english_name FROM games WHERE id='game_attribute_import_juicy_fruits'").get()).toMatchObject({
      display_name: '神奇果汁', english_name: 'Juicy Fruits',
    });
    const read = () => sqlite.prepare("SELECT score,rating_deviation,direct_sum,direct_count,evidence_count FROM attribute_score_states WHERE subject_id='attribute_subject_game:game_attribute_import_the_mind' AND attribute_id='attribute_win_method'").get();
    const before = read();
    const timestamp = Date.now() + 1000;
    sqlite.prepare(`INSERT INTO attribute_merge_rebuild_jobs
      (id,source_game_id,target_game_id,source_subject_id,target_subject_id,status,reset_completed,cursor_created_at,cursor_stream_id,cutoff_created_at,created_at,updated_at)
      SELECT 'conversion-test',a.game_id,b.game_id,a.id,b.id,'pending',0,-1,'',?,?,?
      FROM attribute_subjects a JOIN attribute_subjects b ON a.id < b.id
      WHERE a.game_id IS NOT NULL AND b.game_id IS NOT NULL
        AND a.id <> 'attribute_subject_game:game_attribute_import_the_mind'
        AND b.id <> 'attribute_subject_game:game_attribute_import_the_mind' LIMIT 1`).run(timestamp,timestamp,timestamp);
    for (let i=0;i<100;i++) {
      await processAttributeMergeRebuildJobs(gateway,timestamp+1,1000);
      if (sqlite.prepare("SELECT status FROM attribute_merge_rebuild_jobs WHERE id='conversion-test'").get()?.status === 'completed') break;
    }
    expect(sqlite.prepare("SELECT status FROM attribute_merge_rebuild_jobs WHERE id='conversion-test'").get()).toMatchObject({status:'completed'});
    expect(read()).toEqual(before);
    expect(Number(before?.evidence_count)).toBeGreaterThan(1);
    const opponent = sqlite.prepare("SELECT id FROM attribute_subjects WHERE game_id IS NOT NULL AND id <> 'attribute_subject_game:game_attribute_import_the_mind' LIMIT 1").get() as { id: string };
    await saveAttributeResponse(gateway, {
      subjectAId: 'attribute_subject_game:game_attribute_import_the_mind', subjectBId: opponent.id,
      attributeId: 'attribute_win_method', responseId: 'conversion-new-vote', sessionId: 'conversion-test-session',
      actorId: null, ratingA: 7, timestamp: timestamp + 2,
    });
    const afterVote = read();
    await expect(saveAttributeResponse(gateway, {
      subjectAId: 'attribute_subject_game:game_attribute_import_the_mind', subjectBId: opponent.id,
      attributeId: 'attribute_score_race', responseId: 'retired-attribute-answer', sessionId: 'conversion-test-session',
      actorId: null, ratingA: 7, timestamp: timestamp + 2,
    })).rejects.toThrow('attribute_subject_not_found');
    expect(read()).toEqual(afterVote);
    sqlite.prepare("UPDATE attribute_merge_rebuild_jobs SET status='pending',reset_completed=0,cursor_created_at=-1,cursor_stream_id='',cutoff_created_at=? WHERE id='conversion-test'").run(timestamp+3);
    for (let i=0;i<100;i++) {
      await processAttributeMergeRebuildJobs(gateway,timestamp+4,1000);
      if (sqlite.prepare("SELECT status FROM attribute_merge_rebuild_jobs WHERE id='conversion-test'").get()?.status === 'completed') break;
    }
    expect(read()).toMatchObject({ score: 6.8, direct_sum: 34, direct_count: 5, evidence_count: 5 });
    expect(Number(read()?.rating_deviation)).toBeCloseTo(1.5 / Math.sqrt(5));
    expect(Number(read()?.direct_count)).toBe(Number(before?.direct_count)+1);
    expect(Number(read()?.evidence_count)).toBe(Number(before?.evidence_count)+1);
    // A complete replay is independent of merge-job rows and produces the
    // same materialized state from raw history. With no divergence, it does
    // not rewrite every state or pair-stat row.
    const writesBeforeReplay = gateway.metrics?.().rowsWritten ?? 0;
    await runCompleteAttributeReplay(gateway, timestamp + 5);
    expect(read()).toMatchObject({ score: 6.8, direct_sum: 34, direct_count: 5, evidence_count: 5 });
    expect((gateway.metrics?.().rowsWritten ?? 0) - writesBeforeReplay).toBeLessThan(100);
    const writesBeforeUnchangedReplay = gateway.metrics?.().rowsWritten ?? 0;
    await runCompleteAttributeReplay(gateway, timestamp + 6);
    // An old snapshot can include entries whose eligibility was corrected by
    // the first replay. A further unchanged replay must then write nothing.
    expect((gateway.metrics?.().rowsWritten ?? 0) - writesBeforeUnchangedReplay).toBeLessThan(100);
    const writesBeforeSettledReplay = gateway.metrics?.().rowsWritten ?? 0;
    await runCompleteAttributeReplay(gateway, timestamp + 7);
    expect((gateway.metrics?.().rowsWritten ?? 0) - writesBeforeSettledReplay).toBeLessThan(5);
  } finally { sqlite.close(); }
});
