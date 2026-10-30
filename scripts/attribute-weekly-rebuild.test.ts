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
import { queryAttributeSubjects, saveAttributeResponse } from '../worker/data/attributes';
import { ATTRIBUTE_SCORE_MODEL_VERSION } from '../worker/data/attributeScoring';
import { requireAttributeReplayAfterChange } from '../worker/data/attributeVoteWeights';
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
    expect(after.replayed_model_version).toBe(ATTRIBUTE_SCORE_MODEL_VERSION);
    expect(harness.sqlite.prepare("SELECT lock_name FROM attribute_vote_lock WHERE lock_name = 'attribute-replay'").get()).toBeUndefined();
  } finally { close(harness); }
});

test('role grants and revocations replay existing numeric history, while no-op mutations stay clean', async () => {
  const { harness, timestamp } = await establishBaseline();
  try {
    const [, second] = subjects(harness);
    const gameId = 'game-weight-role-history';
    harness.sqlite.prepare(`
      INSERT INTO games (
        id, slug, display_name, english_name, normalized_name, merged_into_game_id,
        created_by, created_at, updated_at, visibility, review_status, reviewed_at,
        attribute_enabled, bgg_id, entity_kind
      ) VALUES (?, ?, ?, NULL, ?, NULL, NULL, ?, ?, 'public', 'pending', NULL, 1, ?, 'base')
    `).run(gameId, gameId, '權重角色歷史', '權重角色歷史', timestamp + 1, timestamp + 1, 995001);
    const first = { id: `attribute_subject_game:${gameId}` };
    harness.sqlite.prepare(`
      INSERT INTO users (id, google_sub, email, email_normalized, created_at, last_login_at)
      VALUES ('weight-role-user', 'weight-role-sub', 'weight-role@example.test', 'weight-role@example.test', ?, ?)
    `).run(timestamp, timestamp);
    harness.sqlite.prepare(`
      INSERT INTO attribute_vote_responses
        (response_id, attribute_id, subject_a_id, subject_b_id, rating_a,
         activity_json, actor_id, session_id, created_at, updated_at, recorded_online)
      VALUES ('weight-role-history', 'attribute_win_method', ?, ?, 8, '[]',
        'weight-role-user', 'weight-role-session', ?, ?, 0)
    `).run(first.id, second.id, timestamp + 1, timestamp + 1);
    await runCompleteAttributeReplay(harness.gateway, timestamp + 2);
    const beforeGrant = harness.sqlite.prepare(`
      SELECT rating_deviation, direct_sum, direct_count
      FROM attribute_score_states
      WHERE subject_id = ? AND attribute_id = 'attribute_win_method'
    `).get(first.id) as Record<string, number>;
    const revision = status(harness).required_revision;

    await harness.gateway.batch([
      harness.gateway.statement(`
        INSERT INTO user_roles (user_id, role, granted_by, granted_at, revoked_at)
        VALUES (?, 'editor', NULL, ?, NULL)
      `).bind('weight-role-user', timestamp + 3),
      requireAttributeReplayAfterChange(harness.gateway),
    ]);
    expect(status(harness).required_revision).toBe(revision + 1);
    await expect(runWeeklyAttributeRebuild(harness.gateway, timestamp + 4)).resolves.toBe('replay');
    const afterGrant = harness.sqlite.prepare(`
      SELECT rating_deviation, direct_sum, direct_count
      FROM attribute_score_states
      WHERE subject_id = ? AND attribute_id = 'attribute_win_method'
    `).get(first.id) as Record<string, number>;
    expect(afterGrant.direct_sum).toBe(beforeGrant.direct_sum);
    expect(afterGrant.direct_count).toBe(beforeGrant.direct_count);
    expect(afterGrant.rating_deviation).toBeLessThan(beforeGrant.rating_deviation);

    await harness.gateway.batch([
      harness.gateway.statement(`
        UPDATE user_roles SET revoked_at = ?
        WHERE user_id = ? AND role = 'editor' AND revoked_at IS NULL
      `).bind(timestamp + 5, 'weight-role-user'),
      requireAttributeReplayAfterChange(harness.gateway),
    ]);
    expect(status(harness).required_revision).toBe(status(harness).replayed_revision + 1);
    await expect(runWeeklyAttributeRebuild(harness.gateway, timestamp + 6)).resolves.toBe('replay');
    const afterRevoke = harness.sqlite.prepare(`
      SELECT rating_deviation, direct_sum, direct_count
      FROM attribute_score_states
      WHERE subject_id = ? AND attribute_id = 'attribute_win_method'
    `).get(first.id) as Record<string, number>;
    expect(afterRevoke.direct_sum).toBe(beforeGrant.direct_sum);
    expect(afterRevoke.direct_count).toBe(beforeGrant.direct_count);
    expect(afterRevoke.rating_deviation).toBeGreaterThan(afterGrant.rating_deviation);

    const stableRevision = status(harness).required_revision;
    await harness.gateway.batch([
      harness.gateway.statement(`
        UPDATE user_roles SET revoked_at = ?
        WHERE user_id = ? AND role = 'editor' AND revoked_at IS NULL
      `).bind(timestamp + 7, 'weight-role-user'),
      requireAttributeReplayAfterChange(harness.gateway),
    ]);
    expect(status(harness).required_revision).toBe(stableRevision);
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

    // Only an explicit server value of 1 certifies an already applied answer.
    harness.sqlite.prepare(`
      INSERT INTO attribute_vote_responses
        (response_id, attribute_id, subject_a_id, subject_b_id, comparison,
         activity_json, session_id, created_at, updated_at, recorded_online)
      VALUES ('uncertified-comparison', 'attribute_win_method', ?, ?, 'SIMILAR', '[]', 'import-session', ?, ?, 2)
    `).run(first.id, second.id, timestamp + 2, timestamp + 2);
    expect(status(harness).required_revision).toBe(afterEdit.required_revision + 2);
  } finally { close(harness); }
});

test('keeps complete game and expansion aliases through replay, metadata deltas and cache-only refresh', async () => {
  const harness = createHarness();
  const timestamp = Date.now() + 100_000;
  const baseId = 'game-alias-base', expansionId = 'game-alias-expansion';
  const subjectId = `attribute_subject_game:${baseId}`;
  const configurationId = `attribute_config_expansion:${expansionId}:${baseId}`;
  try {
    const insertGame = harness.sqlite.prepare(`
      INSERT INTO games (id, slug, display_name, english_name, normalized_name,
        created_at, updated_at, visibility, review_status, attribute_enabled, bgg_id, entity_kind)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'public', 'pending', 1, ?, ?)
    `);
    insertGame.run(baseId, baseId, 'Alias Base', 'Alias Base', 'alias base', timestamp, timestamp, 984001, 'base');
    insertGame.run(expansionId, expansionId, '別名擴充', 'Alias Expansion', '別名擴充', timestamp, timestamp, 984002, 'expansion');
    harness.sqlite.prepare(`INSERT INTO game_entity_relations
      (id, source_game_id, target_game_id, relation_type, created_at)
      VALUES ('alias-expansion-relation', ?, ?, 'expansion_of', ?)
    `).run(expansionId, baseId, timestamp);
    const insertAlias = harness.sqlite.prepare(`INSERT INTO game_aliases
      (id, game_id, alias, normalized_alias, created_at) VALUES (?, ?, ?, ?, ?)`);
    for (const [gameId, aliases] of [[baseId, ['A Base Alias', '主遊戲別名']], [expansionId, ['Expansion Alias', '擴充別名']]] as const) {
      for (const alias of aliases) insertAlias.run(`${gameId}:${alias}`, gameId, alias, alias.toLowerCase(), timestamp);
    }
    const expectedBase = ['A Base Alias', '主遊戲別名'];
    const expectedConfiguration = ['A Base Alias', 'Expansion Alias', '主遊戲別名', '擴充別名'];
    const targeted = await queryAttributeSubjects(harness.gateway, [subjectId, configurationId]);
    expect(targeted.find((subject) => subject.id === subjectId)).toMatchObject({ secondaryName: '主遊戲別名', aliases: expectedBase });
    expect(targeted.find((subject) => subject.id === configurationId)?.aliases).toEqual(expectedConfiguration);
    const metadataSql = harness.executedSql.find((sql) => sql.includes('AS aliases_json'))!;
    const plan = harness.sqlite.prepare(`EXPLAIN QUERY PLAN ${metadataSql}`).all(subjectId, configurationId);
    expect(plan.some((step: { detail: string }) => /SCAN game_aliases\b/iu.test(step.detail)), JSON.stringify(plan)).toBe(false);

    await flushCatalogOutbox(harness.gateway, timestamp + 1);
    harness.executedSql.length = 0;
    await expect(runWeeklyAttributeRebuild(harness.gateway, timestamp + 2)).resolves.toBe('replay');
    expect(harness.executedSql.filter((sql) => /SELECT game_id, alias\s+FROM game_aliases/u.test(sql))).toHaveLength(1);
    const replayed = attributeCatalogPayload(await queryAttributeCatalogSnapshot(harness.gateway));
    expect(replayed.subjects.find((subject) => subject.id === subjectId)?.aliases).toEqual(expectedBase);
    expect(replayed.subjects.find((subject) => subject.id === configurationId)?.aliases).toEqual(expectedConfiguration);

    harness.sqlite.prepare('DELETE FROM game_aliases WHERE game_id = ?').run(baseId);
    await flushCatalogOutbox(harness.gateway, timestamp + 3);
    harness.executedSql.length = 0;
    await expect(runWeeklyAttributeRebuild(harness.gateway, timestamp + 4)).resolves.toBe('cache');
    expect(harness.executedSql.some((sql) => /\bFROM\s+attribute_vote_responses\b/iu.test(sql))).toBe(false);
    const refreshed = attributeCatalogPayload(await queryAttributeCatalogSnapshot(harness.gateway));
    expect(refreshed.subjects.find((subject) => subject.id === subjectId)?.aliases).toEqual([]);
    expect(refreshed.subjects.find((subject) => subject.id === configurationId)?.aliases).toEqual(['Expansion Alias', '擴充別名']);
  } finally { close(harness); }
});

test('changed pools choose full replay', async () => {
  const { harness, timestamp } = await establishBaseline();
  try {
    const gameId = 'game-weekly-pool-change';
    harness.sqlite.prepare(`
      INSERT INTO games (
        id, slug, display_name, english_name, normalized_name, merged_into_game_id,
        created_by, created_at, updated_at, visibility, review_status, reviewed_at,
        attribute_enabled, bgg_id, entity_kind
      ) VALUES (?, ?, ?, NULL, ?, NULL, NULL, ?, ?, 'public', 'pending', NULL, 1, ?, 'base')
    `).run(gameId, 'weekly-pool-change', '每週池變更', '每週池變更', timestamp + 1, timestamp + 1, 980001);
    await flushCatalogOutbox(harness.gateway, timestamp + 2);
    harness.executedSql.length = 0;
    await expect(runWeeklyAttributeRebuild(harness.gateway, timestamp + 3)).resolves.toBe('replay');
    expect(harness.executedSql.filter((sql) => /\bFROM\s+attribute_vote_responses\b/iu.test(sql))).toHaveLength(1);
  } finally { close(harness); }
});

test('incomplete snapshots choose full replay and repair the snapshot', async () => {
  const { harness, timestamp } = await establishBaseline();
  try {
    const snapshot = harness.sqlite.prepare('SELECT active_generation FROM attribute_catalog_snapshot_state WHERE id = 1').get() as { active_generation: number };
    harness.sqlite.prepare('DELETE FROM attribute_catalog_snapshot_chunks WHERE generation = ? AND chunk_number = 0')
      .run(snapshot.active_generation);
    harness.executedSql.length = 0;
    await expect(runWeeklyAttributeRebuild(harness.gateway, timestamp + 3)).resolves.toBe('replay');
    expect(harness.executedSql.filter((sql) => /\bFROM\s+attribute_vote_responses\b/iu.test(sql))).toHaveLength(1);

    const repaired = attributeCatalogPayload(await queryAttributeCatalogSnapshot(harness.gateway));
    expect(repaired.values.length).toBeGreaterThan(0);
  } finally { close(harness); }
});

test('malformed snapshots choose full replay and repair the snapshot', async () => {
  const { harness, timestamp } = await establishBaseline();
  try {
    const snapshot = harness.sqlite.prepare('SELECT active_generation FROM attribute_catalog_snapshot_state WHERE id = 1').get() as { active_generation: number };
    harness.sqlite.prepare('UPDATE attribute_catalog_snapshot_chunks SET entries_json = ? WHERE generation = ? AND chunk_number = 0')
      .run('{}', snapshot.active_generation);
    harness.executedSql.length = 0;
    await expect(runWeeklyAttributeRebuild(harness.gateway, timestamp + 3)).resolves.toBe('replay');
    expect(harness.executedSql.filter((sql) => /\bFROM\s+attribute_vote_responses\b/iu.test(sql))).toHaveLength(1);

    const repaired = attributeCatalogPayload(await queryAttributeCatalogSnapshot(harness.gateway));
    expect(repaired.values.length).toBeGreaterThan(0);
  } finally { close(harness); }
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
