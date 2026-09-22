// @vitest-environment node
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { expect, test } from 'vitest';
import { createDatabase } from '../worker/data/database';
import {
  acquireAttributeMergeLock,
  canonicalizeAttributeMergeVoteSubjects,
  replayAllAttributeScores,
  releaseAttributeMergeLock,
  saveAttributeResponse,
} from '../worker/data/attributes';
import { runCompleteAttributeReplay } from '../worker/workflows/attributeReplay';

const setup = (
  beforeHistoryConversion?: (sqlite: DatabaseSync) => void,
  beforeCleanup?: (sqlite: DatabaseSync) => void,
  maxBoundParameters = Number.POSITIVE_INFINITY,
  beforeExpansionConfigurationCanonicalization?: (sqlite: DatabaseSync) => void,
) => {
  const sqlite = new DatabaseSync(':memory:');
  const executedSql: string[] = [];
  for (const name of readdirSync('migrations').filter((file) => file.endsWith('.sql')).sort()) {
    try {
      if (name === '0090_convert_win_vote_history.sql') beforeHistoryConversion?.(sqlite);
      if (name === '0092_retire_attribute_merge_compatibility.sql') beforeCleanup?.(sqlite);
      if (name === '0109_canonicalize_expansion_attribute_configurations.sql') beforeExpansionConfigurationCanonicalization?.(sqlite);
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
      if (args.length > maxBoundParameters) {
        throw new Error(`too many SQL variables: ${args.length}`);
      }
      executedSql.push(sql);
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
  return { sqlite, gateway, executedSql };
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

test('expansion history becomes one base-plus-expansion subject, including future relations', async () => {
  const timestamp = Date.now();
  const baseGameId = 'game-expansion-config-base';
  const expansionGameId = 'game-expansion-config-expansion';
  const otherGameId = 'game-expansion-config-other';
  const oldExpansionSubjectId = `attribute_subject_game:${expansionGameId}`;
  const configurationSubjectId = `attribute_config_expansion:${expansionGameId}:${baseGameId}`;
  const { sqlite, gateway } = setup(undefined, undefined, Number.POSITIVE_INFINITY, (db) => {
    const insertGame = db.prepare(`
      INSERT INTO games (
        id, slug, display_name, english_name, normalized_name, merged_into_game_id,
        created_by, created_at, updated_at, visibility, review_status, reviewed_at,
        attribute_enabled, bgg_id, entity_kind
      ) VALUES (?, ?, ?, NULL, ?, NULL, NULL, ?, ?, 'public', 'pending', NULL, 1, ?, ?)
    `);
    insertGame.run(baseGameId, 'expansion-config-base', '組合主遊戲', '組合主遊戲', timestamp, timestamp, 930001, 'base');
    insertGame.run(expansionGameId, 'expansion-config-expansion', '組合擴充', '組合擴充', timestamp, timestamp, 930002, 'expansion');
    insertGame.run(otherGameId, 'expansion-config-other', '組合對照', '組合對照', timestamp, timestamp, 930003, 'base');
    db.prepare(`
      INSERT INTO game_entity_relations (id, source_game_id, target_game_id, relation_type, created_at)
      VALUES ('expansion-config-relation', ?, ?, 'expansion_of', ?)
    `).run(expansionGameId, baseGameId, timestamp);
    db.prepare(`
      INSERT INTO attribute_vote_responses
        (response_id, attribute_id, subject_a_id, subject_b_id, rating_a, comparison,
         activity_json, session_id, created_at, updated_at)
      VALUES ('expansion-config-history', 'attribute_win_method', ?, ?, 8, 'A_HIGHER',
        '[{"legacy":true}]', 'expansion-config-history', ?, ?)
    `).run(oldExpansionSubjectId, `attribute_subject_game:${otherGameId}`, timestamp, timestamp);
  });
  try {
    expect(sqlite.prepare('SELECT id FROM attribute_subjects WHERE id = ?').get(oldExpansionSubjectId)).toBeUndefined();
    expect(sqlite.prepare(`
      SELECT component_type, game_id, bgg_id
      FROM attribute_subject_components
      WHERE subject_id = ?
      ORDER BY component_order
    `).all(configurationSubjectId)).toEqual([
      { component_type: 'base', game_id: baseGameId, bgg_id: 930001 },
      { component_type: 'expansion', game_id: expansionGameId, bgg_id: 930002 },
    ]);
    expect(sqlite.prepare(`
      SELECT subject_a_id, subject_b_id, activity_json
      FROM attribute_vote_responses WHERE response_id = 'expansion-config-history'
    `).get()).toEqual({
      subject_a_id: configurationSubjectId,
      subject_b_id: `attribute_subject_game:${otherGameId}`,
      activity_json: '[]',
    });
    expect(sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM catalog_change_outbox
      WHERE catalog = 'attribute-subject'
        AND entity_key IN (?, ?)
    `).get(oldExpansionSubjectId, configurationSubjectId)).toEqual({ count: 0 });

    const replay = await replayAllAttributeScores(gateway, timestamp + 1);
    expect(replay.catalogPayload.subjects.some((subject) => subject.id === configurationSubjectId)).toBe(true);
    expect(replay.catalogPayload.subjects.some((subject) => subject.id === oldExpansionSubjectId)).toBe(false);
    expect(sqlite.prepare(`
      SELECT direct_sum, direct_count, comparison_count
      FROM attribute_score_states
      WHERE subject_id = ? AND attribute_id = 'attribute_win_method'
    `).get(configurationSubjectId)).toEqual({ direct_sum: 8, direct_count: 1, comparison_count: 1 });

    const futureBaseGameId = 'game-future-config-base';
    const futureExpansionGameId = 'game-future-config-expansion';
    sqlite.prepare(`
      INSERT INTO games (
        id, slug, display_name, english_name, normalized_name, created_at, updated_at,
        bgg_id, entity_kind, visibility, review_status, attribute_enabled
      ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 'public', 'pending', 1)
    `).run(futureBaseGameId, 'future-config-base', '未來主遊戲', '未來主遊戲', timestamp + 2, timestamp + 2, 930004, 'base');
    sqlite.prepare(`
      INSERT INTO games (
        id, slug, display_name, english_name, normalized_name, created_at, updated_at,
        bgg_id, entity_kind, visibility, review_status, attribute_enabled
      ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 'public', 'pending', 1)
    `).run(futureExpansionGameId, 'future-config-expansion', '未來擴充', '未來擴充', timestamp + 2, timestamp + 2, 930005, 'expansion');
    sqlite.prepare(`
      INSERT INTO game_entity_relations (id, source_game_id, target_game_id, relation_type, created_at)
      VALUES ('future-config-relation', ?, ?, 'expansion_of', ?)
    `).run(futureExpansionGameId, futureBaseGameId, timestamp + 2);

    expect(sqlite.prepare('SELECT id FROM attribute_subjects WHERE id = ?')
      .get(`attribute_subject_game:${futureExpansionGameId}`)).toBeUndefined();
    expect(sqlite.prepare('SELECT id FROM attribute_subjects WHERE id = ?')
      .get(`attribute_config_expansion:${futureExpansionGameId}:${futureBaseGameId}`)).toEqual({
        id: `attribute_config_expansion:${futureExpansionGameId}:${futureBaseGameId}`,
      });
  } finally { sqlite.close(); }
});

test('complete replay and live responses cannot cross their state writes', async () => {
  const { sqlite, gateway } = setup();
  const timestamp = Date.now();
  try {
    const subjects = sqlite.prepare(`
      SELECT id, game_id FROM attribute_subjects
      WHERE game_id IS NOT NULL
      ORDER BY id
      LIMIT 2
    `).all() as Array<{ id: string; game_id: string }>;
    expect(subjects).toHaveLength(2);
    sqlite.prepare(`
      INSERT INTO attribute_vote_lock (lock_name, token, expires_at)
      VALUES (?, 'in-flight', ?)
    `).run(`attribute-vote:attribute_win_method:${subjects[0].id}`, timestamp + 60_000);

    await expect(runCompleteAttributeReplay(gateway, timestamp)).rejects.toThrow('attribute_replay_busy');
    expect(sqlite.prepare("SELECT lock_name FROM attribute_vote_lock WHERE lock_name = 'attribute-replay'").get()).toBeUndefined();

    sqlite.prepare('DELETE FROM attribute_vote_lock').run();
    sqlite.prepare(`
      INSERT INTO attribute_vote_lock (lock_name, token, expires_at)
      VALUES ('attribute-replay', 'replay-in-progress', ?)
    `).run(timestamp + 60_000);
    await expect(saveAttributeResponse(gateway, {
      subjectAId: subjects[0].id,
      subjectBId: subjects[1].id,
      attributeId: 'attribute_win_method',
      responseId: 'blocked-by-replay',
      sessionId: 'replay-lock-test',
      actorId: null,
      ratingA: 7,
      timestamp,
    })).rejects.toThrow('attribute_response_busy');
    await expect(acquireAttributeMergeLock(
      gateway, subjects[0].game_id, subjects[1].game_id, timestamp,
    )).rejects.toThrow('attribute_response_busy');
    expect(sqlite.prepare(`
      SELECT lock_name
      FROM attribute_vote_lock
      WHERE lock_name = 'attribute-vote:merge-operation'
    `).get()).toBeUndefined();

    sqlite.prepare("DELETE FROM attribute_vote_lock WHERE lock_name = 'attribute-replay'").run();
    const mergeLock = await acquireAttributeMergeLock(
      gateway, subjects[0].game_id, subjects[1].game_id, timestamp,
    );
    expect(mergeLock.names).toContain('attribute-vote:merge-operation');
    await expect(runCompleteAttributeReplay(gateway, timestamp + 1)).rejects.toThrow('attribute_replay_busy');
    await releaseAttributeMergeLock(gateway, mergeLock);
    await runCompleteAttributeReplay(gateway, timestamp + 2);
    expect(sqlite.prepare("SELECT lock_name FROM attribute_vote_lock WHERE lock_name = 'attribute-replay'").get()).toBeUndefined();
  } finally { sqlite.close(); }
});

test('a game merge normalizes raw votes before the complete replay rebuilds results', async () => {
  const { sqlite, gateway } = setup();
  const timestamp = Date.now();
  const sourceGameId = 'game-merge-vote-source';
  const targetGameId = 'game-merge-vote-target';
  const thirdGameId = 'game-merge-vote-third';
  const sourceSubjectId = `attribute_subject_game:${sourceGameId}`;
  const targetSubjectId = `attribute_subject_game:${targetGameId}`;
  const thirdSubjectId = `attribute_subject_game:${thirdGameId}`;
  try {
    const insertGame = sqlite.prepare(`
      INSERT INTO games (
        id, slug, display_name, english_name, normalized_name, merged_into_game_id,
        created_by, created_at, updated_at, visibility, review_status, reviewed_at,
        attribute_enabled, bgg_id, entity_kind
      ) VALUES (?, ?, ?, NULL, ?, NULL, NULL, ?, ?, 'public', 'pending', NULL, 1, ?, 'base')
    `);
    for (const [id, label, bggId] of [
      [sourceGameId, '合併來源測試', 910001],
      [targetGameId, '合併目標測試', 910002],
      [thirdGameId, '合併對照測試', 910003],
    ] as const) {
      insertGame.run(id, id.replace('game-', ''), label, label, timestamp, timestamp, bggId);
    }

    const insertResponse = sqlite.prepare(`
      INSERT INTO attribute_vote_responses
        (response_id, attribute_id, subject_a_id, subject_b_id, rating_a, rating_b,
         comparison, activity_json, session_id, created_at, updated_at)
      VALUES (?, 'attribute_win_method', ?, ?, ?, ?, ?, '[]', 'merge-normalization-test', ?, ?)
    `);
    insertResponse.run('merge-rating-a', sourceSubjectId, thirdSubjectId, 8, null, null, timestamp + 1, timestamp + 1);
    insertResponse.run('merge-rating-b', thirdSubjectId, sourceSubjectId, null, 2, null, timestamp + 2, timestamp + 2);
    insertResponse.run('merge-target-rating', targetSubjectId, thirdSubjectId, 6, null, null, timestamp + 3, timestamp + 3);
    insertResponse.run('merge-comparison', sourceSubjectId, thirdSubjectId, null, null, 'A_HIGHER', timestamp + 4, timestamp + 4);
    insertResponse.run('merge-self-comparison', sourceSubjectId, targetSubjectId, null, null, 'B_HIGHER', timestamp + 5, timestamp + 5);

    const lock = await acquireAttributeMergeLock(gateway, sourceGameId, targetGameId, timestamp + 6);
    try {
      expect(lock).toMatchObject({ sourceSubjectId, targetSubjectId });
      const canonicalizeVotes = canonicalizeAttributeMergeVoteSubjects(gateway, lock.sourceSubjectId, lock.targetSubjectId);
      expect(canonicalizeVotes).not.toBeNull();
      await gateway.batch([
        canonicalizeVotes!,
        gateway.statement('UPDATE games SET merged_into_game_id = ?, updated_at = ? WHERE id = ?')
          .bind(targetGameId, timestamp + 6, sourceGameId),
      ]);
    } finally {
      await releaseAttributeMergeLock(gateway, lock);
    }

    expect(sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM attribute_vote_responses
      WHERE subject_a_id = ? OR subject_b_id = ?
    `).get(sourceSubjectId)).toEqual({ count: 0 });
    expect(sqlite.prepare(`
      SELECT subject_a_id, subject_b_id
      FROM attribute_vote_responses
      WHERE response_id = 'merge-rating-b'
    `).get()).toEqual({ subject_a_id: thirdSubjectId, subject_b_id: targetSubjectId });

    const replay = await replayAllAttributeScores(gateway, timestamp + 7);
    expect(replay.catalogPayload.subjects.some((subject) => subject.id === sourceSubjectId)).toBe(false);
    expect(replay.catalogPayload.values.some((value) => value.subjectId === sourceSubjectId)).toBe(false);
    expect(sqlite.prepare(`
      SELECT direct_sum, direct_count
      FROM attribute_score_states
      WHERE subject_id = ? AND attribute_id = 'attribute_win_method'
    `).get(targetSubjectId)).toEqual({ direct_sum: 16, direct_count: 3 });

    const [firstSubjectId, secondSubjectId] = [targetSubjectId, thirdSubjectId].sort();
    expect(sqlite.prepare(`
      SELECT comparison_count
      FROM attribute_pair_stats
      WHERE subject_a_id = ? AND subject_b_id = ? AND attribute_id = 'attribute_win_method'
    `).get(firstSubjectId, secondSubjectId)).toEqual({ comparison_count: 1 });
    expect(sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM attribute_pair_stats
      WHERE subject_a_id = ? OR subject_b_id = ?
    `).get(sourceSubjectId, sourceSubjectId)).toEqual({ count: 0 });
  } finally { sqlite.close(); }
});

test('canonical vote history survives cleanup, new votes and a complete rebuild', async () => {
  const { sqlite, gateway, executedSql } = setup((db) => {
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
    await runCompleteAttributeReplay(gateway, Date.now() + 100);
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
    expect(read()).toMatchObject({ direct_sum: 34, direct_count: 5, evidence_count: 5 });
    expect(Number(read()?.direct_count)).toBe(Number(before?.direct_count)+1);
    expect(Number(read()?.evidence_count)).toBe(Number(before?.evidence_count)+1);
    // A complete replay produces the same materialized state from raw
    // history. Its comparison checkpoint is
    // private; it must not reconstruct state from the browser snapshot or
    // the public catalog-delta table.
    const writesBeforeReplay = gateway.metrics?.().rowsWritten ?? 0;
    executedSql.length = 0;
    await runCompleteAttributeReplay(gateway, timestamp + 5);
    expect(read()).toMatchObject({ score: 6.8, direct_sum: 34, direct_count: 5, evidence_count: 5 });
    // This fixture carries historical responses that predate its materialized
    // state, so the first authoritative replay can legitimately correct a
    // few hundred rows. This bound still catches a missing checkpoint, which
    // used to rewrite every ~6,000 score row.
    expect((gateway.metrics?.().rowsWritten ?? 0) - writesBeforeReplay).toBeLessThan(500);
    expect(sqlite.prepare('SELECT active_generation, generated_at FROM attribute_catalog_snapshot_state WHERE id = 1').get())
      .toEqual({ active_generation: timestamp + 5, generated_at: timestamp + 5 });
    expect(sqlite.prepare('SELECT active_generation, generated_at, chunk_count FROM attribute_replay_state_snapshot_state WHERE id = 1').get())
      .toMatchObject({ active_generation: timestamp + 5, generated_at: timestamp + 5 });
    expect(executedSql.filter((sql) => /^\s*SELECT[\s\S]*FROM\s+attribute_vote_responses\b/i.test(sql))).toHaveLength(1);
    expect(executedSql.some((sql) => /SELECT[\s\S]*FROM\s+attribute_catalog_snapshot_(?:state|chunks)\b/i.test(sql))).toBe(false);
    expect(executedSql.some((sql) => /SELECT[\s\S]*FROM\s+attribute_catalog_entries\b/i.test(sql))).toBe(false);
    const writesBeforeUnchangedReplay = gateway.metrics?.().rowsWritten ?? 0;
    executedSql.length = 0;
    await runCompleteAttributeReplay(gateway, timestamp + 6);
    // Every complete replay publishes a fresh browser baseline even when its
    // calculated scores are unchanged, so clients can compare generations.
    expect((gateway.metrics?.().rowsWritten ?? 0) - writesBeforeUnchangedReplay).toBeLessThan(100);
    expect(sqlite.prepare('SELECT active_generation, generated_at FROM attribute_catalog_snapshot_state WHERE id = 1').get())
      .toEqual({ active_generation: timestamp + 6, generated_at: timestamp + 6 });
    expect(executedSql.some((sql) => /SELECT[\s\S]*FROM\s+attribute_catalog_snapshot_(?:state|chunks)\b/i.test(sql))).toBe(false);
    expect(executedSql.some((sql) => /SELECT[\s\S]*FROM\s+attribute_catalog_entries\b/i.test(sql))).toBe(false);
    const writesBeforeSettledReplay = gateway.metrics?.().rowsWritten ?? 0;
    executedSql.length = 0;
    await runCompleteAttributeReplay(gateway, timestamp + 7);
    expect((gateway.metrics?.().rowsWritten ?? 0) - writesBeforeSettledReplay).toBeLessThan(100);
    expect(sqlite.prepare('SELECT active_generation, generated_at FROM attribute_catalog_snapshot_state WHERE id = 1').get())
      .toEqual({ active_generation: timestamp + 7, generated_at: timestamp + 7 });
    expect(executedSql.some((sql) => /SELECT[\s\S]*FROM\s+attribute_catalog_snapshot_(?:state|chunks)\b/i.test(sql))).toBe(false);
    expect(executedSql.some((sql) => /SELECT[\s\S]*FROM\s+attribute_catalog_entries\b/i.test(sql))).toBe(false);
  } finally { sqlite.close(); }
});

test('complete replay stays below D1\'s parameter limit with more than one hundred votable subjects', async () => {
  const { sqlite, gateway } = setup(undefined, undefined, 100);
  const timestamp = Date.now();
  try {
    sqlite.exec('INSERT OR IGNORE INTO attribute_catalog_rebuild_mode (id) VALUES (1)');
    const insertGame = sqlite.prepare(`
      INSERT INTO games (
        id, slug, display_name, english_name, normalized_name, merged_into_game_id,
        created_by, created_at, updated_at, visibility, review_status, reviewed_at,
        attribute_enabled, bgg_id, entity_kind
      ) VALUES (?, ?, ?, NULL, ?, NULL, NULL, 1, 1, 'public', 'pending', NULL, 1, ?, 'base')
    `);
    for (let index = 0; index < 101; index += 1) {
      const id = `game-replay-parameter-limit-${index}`;
      insertGame.run(id, `replay-parameter-limit-${index}`, `重播參數測試 ${index}`, `重播參數測試 ${index}`, 900_000 + index);
    }
    expect(sqlite.prepare(`
      SELECT COUNT(*) AS count
      FROM attribute_subjects
      WHERE id LIKE 'attribute_subject_game:game-replay-parameter-limit-%'
    `).get()).toEqual({ count: 101 });

    await expect(runCompleteAttributeReplay(gateway, timestamp)).resolves.toBeUndefined();
    expect(sqlite.prepare('SELECT active_generation, generated_at FROM attribute_catalog_snapshot_state WHERE id = 1').get())
      .toEqual({ active_generation: timestamp, generated_at: timestamp });
  } finally { sqlite.close(); }
});
