// @vitest-environment node
import { type SQLInputValue } from 'node:sqlite';
import { expect, test } from 'vitest';
// @ts-expect-error The migration guard is an intentional JavaScript test helper.
import { buildMigratedSchema } from './check-d1-trigger-fanout.mjs';
import { createDatabase } from '../worker/data/database';
import {
  attributeCatalogPayload,
  queryAttributeCatalogSnapshot,
} from '../worker/data/attributeCatalog';
import { flushCatalogOutbox } from '../worker/data/catalogOutbox';
import { saveAttributeResponse } from '../worker/data/attributes';
import { runCompleteAttributeReplay } from '../worker/workflows/attributeReplay';
import { runWeeklyAttributeRebuild } from '../worker/workflows/attributeWeeklyRebuild';

interface SqliteStatement {
  bind(...values: SQLInputValue[]): SqliteStatement;
  all(): Promise<{ results: unknown[]; meta: { changes: number } }>;
  run(): Promise<{ results: unknown[]; meta: { changes: number } }>;
}

const createHarness = () => {
  const sqlite = buildMigratedSchema();
  sqlite.exec('PRAGMA foreign_keys = ON');
  // A migration fixture may contain delivery work from its seed history. The
  // weekly job starts after the real outbox worker has drained that work.
  sqlite.exec('DELETE FROM catalog_change_outbox');
  const executedSql: string[] = [];
  const prepare = (sql: string, args: SQLInputValue[] = []): SqliteStatement => ({
    bind: (...values: SQLInputValue[]) => prepare(sql, values),
    run: () => prepare(sql, args).all(),
    all: async () => {
      executedSql.push(sql);
      const statement = sqlite.prepare(sql);
      if (statement.columns().length) return { results: statement.all(...args), meta: { changes: 0 } };
      const result = statement.run(...args);
      return { results: [], meta: { changes: Number(result.changes) } };
    },
  });
  const gateway = createDatabase({ DB: {
    prepare,
    batch: async (statements: SqliteStatement[]) => {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.all());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  } } as unknown as Parameters<typeof createDatabase>[0]);
  return { sqlite, gateway, executedSql };
};

type Harness = ReturnType<typeof createHarness>;
type ReplayStatus = { required_revision: number; replayed_revision: number; replayed_model_version: string | null };

const status = (harness: Harness) => harness.sqlite.prepare(`
  SELECT required_revision, replayed_revision, replayed_model_version
  FROM attribute_replay_status WHERE id = 1
`).get() as ReplayStatus;

const subjects = (harness: Harness) => harness.sqlite.prepare(`
  SELECT id, game_id FROM attribute_subjects
  WHERE game_id IS NOT NULL ORDER BY id LIMIT 2
`).all() as Array<{ id: string; game_id: string }>;

const scoreRows = (harness: Harness) => harness.sqlite.prepare(`
  SELECT subject_id, attribute_id, score, rating_deviation, direct_sum, direct_count,
    comparison_count, decisive_comparison_count, evidence_count, model_version
  FROM attribute_score_states ORDER BY subject_id, attribute_id
`).all().map((row: Record<string, unknown>) => {
  const value = row;
  return [
    value.subject_id, value.attribute_id, value.score, value.rating_deviation,
    value.direct_sum, value.direct_count, value.comparison_count,
    value.decisive_comparison_count, value.evidence_count, value.model_version,
  ];
});

const establishBaseline = async () => {
  const harness = createHarness();
  const timestamp = Date.now() + 100_000;
  await runCompleteAttributeReplay(harness.gateway, timestamp);
  harness.executedSql.length = 0;
  return { harness, timestamp };
};

const close = (harness: Harness) => harness.sqlite.close();

test('weekly cache refresh applies comparison deltas without rereading score history', async () => {
  const { harness, timestamp } = await establishBaseline();
  try {
    const [first, second] = subjects(harness);
    const beforeRows = scoreRows(harness);
    const beforeRevision = status(harness).required_revision;
    await saveAttributeResponse(harness.gateway, {
      subjectAId: first.id,
      subjectBId: second.id,
      attributeId: 'attribute_win_method',
      responseId: 'weekly-live-comparison',
      sessionId: 'weekly-test-session',
      actorId: null,
      comparison: 'A_HIGHER',
      timestamp: timestamp + 1,
    });
    expect(status(harness).required_revision).toBe(beforeRevision);
    await flushCatalogOutbox(harness.gateway, timestamp + 2);
    const afterSaveRows = scoreRows(harness);
    expect(afterSaveRows).not.toEqual(beforeRows);

    harness.executedSql.length = 0;
    await expect(runWeeklyAttributeRebuild(harness.gateway, timestamp + 3)).resolves.toBe('cache');
    expect(scoreRows(harness)).toEqual(afterSaveRows);
    expect(harness.executedSql.some((sql) => /\bFROM\s+attribute_vote_responses\b/iu.test(sql))).toBe(false);
    expect(harness.executedSql.some((sql) => /\bFROM\s+attribute_score_states\b/iu.test(sql))).toBe(false);

    const snapshot = attributeCatalogPayload(await queryAttributeCatalogSnapshot(harness.gateway));
    for (const subject of [first.id, second.id]) {
      const state = harness.sqlite.prepare(`
        SELECT score, rating_deviation, direct_count, comparison_count,
          decisive_comparison_count, evidence_count, model_version
        FROM attribute_score_states
        WHERE subject_id = ? AND attribute_id = 'attribute_win_method'
      `).get(subject) as Record<string, unknown>;
      expect(snapshot.values.find((value) => value.subjectId === subject && value.attributeId === 'attribute_win_method'))
        .toMatchObject({
          subjectId: subject,
          attributeId: 'attribute_win_method',
          score: Number(Number(state.score).toFixed(2)),
          ratingDeviation: Number(Number(state.rating_deviation).toFixed(3)),
          directCount: state.direct_count,
          comparisonCount: state.comparison_count,
          decisiveComparisonCount: state.decisive_comparison_count,
          evidenceCount: state.evidence_count,
          modelVersion: state.model_version,
        });
    }

    // The same materialized rows must also be what an explicit raw-history
    // replay would produce after the incremental browser publication.
    await runCompleteAttributeReplay(harness.gateway, timestamp + 4);
    expect(scoreRows(harness)).toEqual(afterSaveRows);
  } finally { close(harness); }
});

test('numeric responses force one full replay and acknowledge the revision', async () => {
  const { harness, timestamp } = await establishBaseline();
  try {
    const [first, second] = subjects(harness);
    const before = status(harness);
    await saveAttributeResponse(harness.gateway, {
      subjectAId: first.id,
      subjectBId: second.id,
      attributeId: 'attribute_win_method',
      responseId: 'weekly-numeric-rating',
      sessionId: 'weekly-test-session',
      actorId: null,
      ratingA: 8,
      timestamp: timestamp + 1,
    });
    await flushCatalogOutbox(harness.gateway, timestamp + 2);
    expect(status(harness)).toMatchObject({
      required_revision: before.required_revision + 1,
      replayed_revision: before.replayed_revision,
    });

    harness.executedSql.length = 0;
    await expect(runWeeklyAttributeRebuild(harness.gateway, timestamp + 3)).resolves.toBe('replay');
    expect(harness.executedSql.filter((sql) => /\bFROM\s+attribute_vote_responses\b/iu.test(sql))).toHaveLength(1);
    const after = status(harness);
    expect(after.required_revision).toBe(after.replayed_revision);
    expect(after.replayed_model_version).toBe('glicko-rd-v1');
    expect(harness.sqlite.prepare("SELECT lock_name FROM attribute_vote_lock WHERE lock_name = 'attribute-replay'").get()).toBeUndefined();
  } finally { close(harness); }
});

test('out-of-order comparison timestamps require a complete replay', async () => {
  const { harness, timestamp } = await establishBaseline();
  try {
    const [first, second] = subjects(harness);
    const before = status(harness);
    await saveAttributeResponse(harness.gateway, {
      subjectAId: first.id,
      subjectBId: second.id,
      attributeId: 'attribute_win_method',
      responseId: 'weekly-comparison-late-first',
      sessionId: 'weekly-order-session',
      actorId: null,
      comparison: 'A_HIGHER',
      timestamp: timestamp + 20,
    });
    await saveAttributeResponse(harness.gateway, {
      subjectAId: first.id,
      subjectBId: second.id,
      attributeId: 'attribute_win_method',
      responseId: 'weekly-comparison-early-second',
      sessionId: 'weekly-order-session',
      actorId: null,
      comparison: 'B_HIGHER',
      timestamp: timestamp + 10,
    });
    const pending = status(harness);
    expect(pending.required_revision).toBe(before.required_revision + 1);
    expect(pending.replayed_revision).toBe(before.replayed_revision);

    await flushCatalogOutbox(harness.gateway, timestamp + 30);
    harness.executedSql.length = 0;
    await expect(runWeeklyAttributeRebuild(harness.gateway, timestamp + 31)).resolves.toBe('replay');
    expect(harness.executedSql.filter((sql) => /\bFROM\s+attribute_vote_responses\b/iu.test(sql))).toHaveLength(1);
  } finally { close(harness); }
});

test('history corrections mark replay pending while metadata-only and no-op edits stay clean', async () => {
  const { harness, timestamp } = await establishBaseline();
  try {
    const [first, second] = subjects(harness);
    const insert = harness.sqlite.prepare(`
      INSERT INTO attribute_vote_responses
        (response_id, attribute_id, subject_a_id, subject_b_id, comparison,
         activity_json, actor_id, session_id, created_at, updated_at)
      VALUES (?, 'attribute_win_method', ?, ?, 'A_HIGHER', '[]', NULL, ?, ?, ?)
    `);
    insert.run('raw-comparison-import', first.id, second.id, 'import-session', timestamp + 1, timestamp + 1);
    const afterImport = status(harness);
    expect(afterImport.required_revision).toBe(afterImport.replayed_revision + 1);

    harness.sqlite.prepare(`
      UPDATE attribute_vote_responses
      SET actor_id = 'usr_deleted', activity_json = '[{"edited":true}]', session_id = 'metadata-session'
      WHERE response_id = 'raw-comparison-import'
    `).run();
    expect(status(harness).required_revision).toBe(afterImport.required_revision);

    harness.sqlite.prepare(`
      UPDATE attribute_vote_responses
      SET rating_a = rating_a, rating_b = rating_b, comparison = comparison, updated_at = updated_at
      WHERE response_id = 'raw-comparison-import'
    `).run();
    expect(status(harness).required_revision).toBe(afterImport.required_revision);

    harness.sqlite.prepare(`
      UPDATE attribute_vote_responses SET rating_a = 5 WHERE response_id = 'raw-comparison-import'
    `).run();
    const afterEdit = status(harness);
    expect(afterEdit.required_revision).toBe(afterImport.required_revision + 1);

    harness.sqlite.prepare(`DELETE FROM attribute_vote_responses WHERE response_id = 'raw-comparison-import'`).run();
    expect(status(harness).required_revision).toBe(afterEdit.required_revision + 1);
  } finally { close(harness); }
});

test('changed pools and incomplete or malformed snapshots choose full replay', async () => {
  const firstRun = await establishBaseline();
  try {
    const gameId = 'game-weekly-pool-change';
    firstRun.harness.sqlite.prepare(`
      INSERT INTO games (
        id, slug, display_name, english_name, normalized_name, merged_into_game_id,
        created_by, created_at, updated_at, visibility, review_status, reviewed_at,
        attribute_enabled, bgg_id, entity_kind
      ) VALUES (?, ?, ?, NULL, ?, NULL, NULL, ?, ?, 'public', 'pending', NULL, 1, ?, 'base')
    `).run(gameId, 'weekly-pool-change', '每週池變更', '每週池變更', firstRun.timestamp + 1, firstRun.timestamp + 1, 980001);
    await flushCatalogOutbox(firstRun.harness.gateway, firstRun.timestamp + 2);
    firstRun.harness.executedSql.length = 0;
    await expect(runWeeklyAttributeRebuild(firstRun.harness.gateway, firstRun.timestamp + 3)).resolves.toBe('replay');
    expect(firstRun.harness.executedSql.filter((sql) => /\bFROM\s+attribute_vote_responses\b/iu.test(sql))).toHaveLength(1);
  } finally { close(firstRun.harness); }

  const secondRun = await establishBaseline();
  try {
    const snapshot = secondRun.harness.sqlite.prepare('SELECT active_generation FROM attribute_catalog_snapshot_state WHERE id = 1').get() as { active_generation: number };
    secondRun.harness.sqlite.prepare('DELETE FROM attribute_catalog_snapshot_chunks WHERE generation = ? AND chunk_number = 0')
      .run(snapshot.active_generation);
    secondRun.harness.executedSql.length = 0;
    await expect(runWeeklyAttributeRebuild(secondRun.harness.gateway, secondRun.timestamp + 3)).resolves.toBe('replay');
    expect(secondRun.harness.executedSql.filter((sql) => /\bFROM\s+attribute_vote_responses\b/iu.test(sql))).toHaveLength(1);

    const repaired = secondRun.harness.sqlite.prepare('SELECT active_generation, chunk_count FROM attribute_catalog_snapshot_state WHERE id = 1').get() as { active_generation: number; chunk_count: number };
    secondRun.harness.sqlite.prepare('UPDATE attribute_catalog_snapshot_chunks SET entries_json = ? WHERE generation = ? AND chunk_number = 0')
      .run('{}', repaired.active_generation);
    secondRun.harness.executedSql.length = 0;
    await expect(runWeeklyAttributeRebuild(secondRun.harness.gateway, secondRun.timestamp + 4)).resolves.toBe('replay');
    expect(secondRun.harness.executedSql.filter((sql) => /\bFROM\s+attribute_vote_responses\b/iu.test(sql))).toHaveLength(1);
  } finally { close(secondRun.harness); }
});

test('failed full publication leaves the revision pending and releases the replay lock', async () => {
  const { harness, timestamp } = await establishBaseline();
  try {
    const [first, second] = subjects(harness);
    harness.sqlite.prepare(`
      INSERT INTO attribute_vote_responses
        (response_id, attribute_id, subject_a_id, subject_b_id, comparison,
         activity_json, actor_id, session_id, created_at, updated_at)
      VALUES ('publication-failure-import', 'attribute_win_method', ?, ?, 'A_HIGHER', '[]', NULL, 'failure-session', ?, ?)
    `).run(first.id, second.id, timestamp + 1, timestamp + 1);
    const before = status(harness);
    await expect(runWeeklyAttributeRebuild(harness.gateway, timestamp + 2, { maxChunkBytes: 1 }))
      .rejects.toThrow('attribute_catalog_entry_too_large');
    expect(status(harness)).toEqual(before);
    expect(harness.sqlite.prepare("SELECT lock_name FROM attribute_vote_lock WHERE lock_name = 'attribute-replay'").get()).toBeUndefined();
  } finally { close(harness); }
});
