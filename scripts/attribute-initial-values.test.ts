// @vitest-environment node
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { expect, test } from 'vitest';
import { createDatabase } from '../worker/data/database';
import { queryAttributeInitialValues } from '../worker/data/attributeInitialValues';
import { applyDirectRating, initialAttributeState } from '../worker/data/attributeScoring';
import { saveAttributeResponse, processAttributeMergeRebuildJobs, prepareAttributeMergeRebuildJob } from '../worker/data/attributes';

const setup = () => {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of readdirSync('migrations').filter((file) => file.endsWith('.sql')).sort()) {
    try { sqlite.exec(readFileSync(`migrations/${name}`, 'utf8')); }
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

test('converted win data survives a complete rebuild', async () => {
  const { sqlite, gateway } = setup();
  try {
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
    expect(read()).toMatchObject({score:9,evidence_count:1,rating_deviation:3});
    const opponent = sqlite.prepare("SELECT id FROM attribute_subjects WHERE game_id IS NOT NULL AND id <> 'attribute_subject_game:game_attribute_import_the_mind' LIMIT 1").get() as { id: string };
    await saveAttributeResponse(gateway, {
      subjectAId: 'attribute_subject_game:game_attribute_import_the_mind', subjectBId: opponent.id,
      attributeId: 'attribute_win_method', responseId: 'conversion-new-vote', sessionId: 'conversion-test-session',
      actorId: null, ratingA: 7, timestamp: timestamp + 2,
    });
    const afterVote = read();
    sqlite.prepare("UPDATE attribute_merge_rebuild_jobs SET status='pending',reset_completed=0,cursor_created_at=-1,cursor_stream_id='',cutoff_created_at=? WHERE id='conversion-test'").run(timestamp+3);
    for (let i=0;i<100;i++) {
      await processAttributeMergeRebuildJobs(gateway,timestamp+4,1000);
      if (sqlite.prepare("SELECT status FROM attribute_merge_rebuild_jobs WHERE id='conversion-test'").get()?.status === 'completed') break;
    }
    expect(read()).toEqual(afterVote);
    expect(read()).toMatchObject({direct_count:2,evidence_count:2});
  } finally { sqlite.close(); }
});

test('baseline storage survives online votes and actual background rebuild without creating synthetic votes', async () => {
  const { sqlite, gateway } = setup();
  try {
    expect(await queryAttributeInitialValues(gateway, 'attribute_score_race')).toEqual([]);
    expect(sqlite.prepare('SELECT count(*) AS n FROM attribute_initial_value_batches').get()).toMatchObject({ n: 0 });
    sqlite.exec(`
      INSERT INTO attributes(id, key, is_active, sort_order) VALUES('fixture-win', 'fixture-win', 1, 100);
      INSERT INTO attribute_translations(attribute_id, locale, name) VALUES('fixture-win', 'zh-TW', '測試取勝方式');
      INSERT INTO games(id, slug, display_name, normalized_name, created_at, updated_at, bgg_id, attribute_enabled, review_status)
        VALUES('fixture-a','fixture-a','測試甲','測試甲',1,1,900001,1,'pending'), ('fixture-b','fixture-b','測試乙','測試乙',1,1,900002,1,'pending');
      INSERT INTO attribute_initial_value_batches VALUES('fixture-batch','fixture-win','attribute_score_race','attribute_end_condition',8109,'mean-v1',100,101);
      INSERT INTO attribute_initial_values VALUES('fixture-batch','fixture-win','attribute_subject_game:fixture-a',9,'{"score":1}','{"score":9}',NULL);
    `);
    const before = sqlite.prepare('SELECT * FROM attribute_initial_values').all();
    expect(await queryAttributeInitialValues(gateway, 'fixture-win')).toEqual([{ subjectId: 'attribute_subject_game:fixture-a', attributeId: 'fixture-win', score: 9, cutoffCreatedAt: 100 }]);
    const input = { subjectAId: 'attribute_subject_game:fixture-a', subjectBId: 'attribute_subject_game:fixture-b', attributeId: 'fixture-win', responseId: 'fixture-response', sessionId: 'fixture-session', actorId: null, ratingA: 2, timestamp: 101 };
    await saveAttributeResponse(gateway, input);
    const expected = applyDirectRating(initialAttributeState(9), 2).next;
    const readState = () => sqlite.prepare("SELECT score, evidence_count, direct_count FROM attribute_score_states WHERE subject_id='attribute_subject_game:fixture-a' AND attribute_id='fixture-win'").get();
    expect(readState()).toMatchObject({ score: expected.score, evidence_count: 1, direct_count: 1 });
    const catalogValue = sqlite.prepare("SELECT entry_json FROM attribute_catalog_entries WHERE entry_key='value:attribute_subject_game:fixture-a:fixture-win'").get() as { entry_json: string };
    expect(JSON.parse(catalogValue.entry_json)).toMatchObject({ initialValue: true, evidenceCount: 1 });
    await saveAttributeResponse(gateway, input);
    expect(readState()).toMatchObject({ evidence_count: 1 });
    await expect(prepareAttributeMergeRebuildJob(gateway, 'fixture-a', 'fixture-b', 102)).rejects.toThrow('attribute_merge_initial_value_requires_mapping');
    // An absorbed historical record is retained, but must not be applied a second time.
    sqlite.exec(`INSERT INTO attribute_vote_responses
      (response_id, attribute_id, subject_a_id, rating_a, activity_json, session_id, created_at, updated_at)
      VALUES('absorbed','fixture-win','attribute_subject_game:fixture-a',0,'[]','historical',100,100)`);
    sqlite.exec(`INSERT INTO attribute_merge_rebuild_jobs
      (id, source_game_id, target_game_id, source_subject_id, target_subject_id, status, reset_completed, cursor_created_at, cursor_stream_id, cutoff_created_at, created_at, updated_at)
      SELECT 'fixture-job','fixture-b',s.game_id,'attribute_subject_game:fixture-b',s.id,'pending',0,0,'',101,101,101
      FROM attribute_subjects s WHERE s.game_id IS NOT NULL AND s.game_id NOT IN ('fixture-a','fixture-b') LIMIT 1`);
    await processAttributeMergeRebuildJobs(gateway, 102, 1000);
    expect(sqlite.prepare("SELECT status FROM attribute_merge_rebuild_jobs WHERE id='fixture-job'").get()).toMatchObject({ status: 'completed' });
    expect(readState()).toMatchObject({ score: expected.score, evidence_count: 1, direct_count: 1 });
    expect(sqlite.prepare('SELECT * FROM attribute_initial_values').all()).toEqual(before);
    expect(sqlite.prepare("SELECT count(*) AS n FROM attribute_vote_responses WHERE attribute_id='fixture-win'").get()).toMatchObject({ n: 2 });
    expect(() => sqlite.exec("DELETE FROM attribute_subjects WHERE id='attribute_subject_game:fixture-a'")).toThrow();
    expect(() => sqlite.exec("INSERT INTO attribute_initial_values VALUES('fixture-batch','fixture-win','attribute_subject_game:fixture-b',11,'{}',NULL,NULL)")).toThrow();

    sqlite.exec(`INSERT INTO attribute_response_attribute_maps
      (source_attribute_id, target_attribute_id, invert_score, mapping_version, activated_at)
      VALUES('attribute_score_race','fixture-win',1,'fixture-map-v1',200)`);
    await saveAttributeResponse(gateway, {
      subjectAId: 'attribute_subject_game:fixture-a', subjectBId: 'attribute_subject_game:fixture-b',
      attributeId: 'attribute_score_race', responseId: 'mapped-response', sessionId: 'fixture-session-2', actorId: null,
      ratingA: 8, comparison: 'A_HIGHER', timestamp: 201,
    });
    const mapped = sqlite.prepare("SELECT attribute_id, rating_a, comparison FROM attribute_vote_responses WHERE response_id='mapped-response'").get();
    expect(mapped).toMatchObject({ attribute_id: 'fixture-win', rating_a: 2, comparison: 'B_HIGHER' });
    expect(sqlite.prepare("SELECT source_attribute_id, target_attribute_id, invert_score, mapping_version FROM attribute_response_mapping_receipts WHERE response_id='mapped-response'").get()).toMatchObject({
      source_attribute_id: 'attribute_score_race', target_attribute_id: 'fixture-win', invert_score: 1, mapping_version: 'fixture-map-v1',
    });
  } finally { sqlite.close(); }
});
