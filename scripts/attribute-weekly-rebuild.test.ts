// @vitest-environment node
import { expect, test, vi } from 'vitest';
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

import { close, createHarness, establishBaseline, scoreRows, status, subjects } from './attributeReplayTestHarness';

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

test.each(['weekly', 'manual'])('%s replay reverts an online comparison deleted after the last replay', async (mode) => {
  const { harness, timestamp } = await establishBaseline();
  try {
    const [first, second] = subjects(harness);
    const before = scoreRows(harness);
    const responseId = 'deleted-online-comparison';
    await saveAttributeResponse(harness.gateway, {
      subjectAId: first.id, subjectBId: second.id, attributeId: 'attribute_win_method',
      responseId, sessionId: 'weekly-test-session', actorId: null,
      comparison: 'A_HIGHER', timestamp: timestamp + 1,
    });
    expect(scoreRows(harness)).not.toEqual(before);
    harness.sqlite.prepare('DELETE FROM attribute_vote_responses WHERE response_id = ?').run(responseId);
    await flushCatalogOutbox(harness.gateway, timestamp + 2);
    if (mode === 'weekly') {
      await expect(runWeeklyAttributeRebuild(harness.gateway, timestamp + 3, { workBudget: {} })).resolves.toBe('replay');
    } else {
      // An older replay could acknowledge the revision while leaving the
      // materialized scores stale. Operator rebuilds reconcile this too.
      harness.sqlite.exec('UPDATE attribute_replay_status SET replayed_revision = required_revision WHERE id = 1');
      await runCompleteAttributeReplay(harness.gateway, timestamp + 3, { compareLiveStates: true });
    }
    expect(scoreRows(harness)).toEqual(before);
    expect(status(harness).replayed_revision).toBe(status(harness).required_revision);
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
    const beforeScores = scoreRows(harness);
    const generation = () => harness.sqlite.prepare('SELECT active_generation FROM attribute_catalog_snapshot_state WHERE id = 1').get();
    const beforeGeneration = generation();
    await expect(runWeeklyAttributeRebuild(harness.gateway, timestamp + 2, { maxChunkBytes: 1 }))
      .rejects.toThrow('attribute_catalog_entry_too_large');
    expect(scoreRows(harness)).toEqual(beforeScores);

    // Fail after the state and snapshot SQL has already run, but before commit.
    harness.sqlite.exec(`
      CREATE TRIGGER fail_replay_acknowledgement BEFORE UPDATE OF replayed_revision ON attribute_replay_status
      BEGIN SELECT RAISE(ABORT, 'injected replay commit failure'); END;
    `);
    await expect(runWeeklyAttributeRebuild(harness.gateway, timestamp + 2)).rejects.toThrow('injected replay commit failure');
    expect(scoreRows(harness)).toEqual(beforeScores);
    expect(generation()).toEqual(beforeGeneration);
    expect(status(harness)).toEqual(before);
    expect(harness.sqlite.prepare('SELECT id FROM attribute_catalog_rebuild_mode').get()).toBeUndefined();
    expect(harness.sqlite.prepare("SELECT lock_name FROM attribute_vote_lock WHERE lock_name = 'attribute-replay'").get()).toBeUndefined();

    harness.sqlite.exec('DROP TRIGGER fail_replay_acknowledgement');
    await expect(runWeeklyAttributeRebuild(harness.gateway, timestamp + 2)).resolves.toBe('replay');
    expect(generation()).toEqual({ active_generation: timestamp + 2 });
    expect(status(harness).replayed_revision).toBe(before.required_revision);
  } finally { close(harness); }
});

test.each([
  ['expired lock', "UPDATE attribute_vote_lock SET expires_at = 0 WHERE lock_name = 'attribute-replay'"],
  ['changed history revision', 'UPDATE attribute_replay_status SET required_revision = required_revision + 1 WHERE id = 1'],
])('rejects a prepared replay when its %s changes before commit', async (_reason, change) => {
  const { harness, timestamp } = await establishBaseline();
  try {
    const [first, second] = subjects(harness);
    await saveAttributeResponse(harness.gateway, {
      subjectAId: first.id, subjectBId: second.id, attributeId: 'attribute_win_method',
      responseId: 'revision-race', sessionId: 'revision-race', actorId: null, ratingA: 8, timestamp: timestamp + 1,
    });
    const before = scoreRows(harness);
    const batch = harness.gateway.batch.bind(harness.gateway);
    vi.spyOn(harness.gateway, 'batch').mockImplementationOnce((statements) => {
      harness.sqlite.exec(change);
      return batch(statements);
    });
    await expect(runWeeklyAttributeRebuild(harness.gateway, timestamp + 2)).rejects.toThrow('attribute_replay_lease_or_revision_changed');
    expect(scoreRows(harness)).toEqual(before);
    expect(status(harness).required_revision).toBeGreaterThan(status(harness).replayed_revision);
  } finally { close(harness); }
});

test('writes and rereads a byte-bounded replay baseline without changing scores on retry', async () => {
  const { harness, timestamp } = await establishBaseline();
  try {
    const catalog = attributeCatalogPayload(await queryAttributeCatalogSnapshot(harness.gateway));
    const [first, ...opponents] = catalog.subjects.slice(0, 25);
    const insert = harness.sqlite.prepare(`
      INSERT INTO attribute_vote_responses
        (response_id, attribute_id, subject_a_id, subject_b_id, comparison, activity_json, session_id, created_at, updated_at)
      VALUES (?, 'attribute_win_method', ?, ?, 'A_HIGHER', '[]', 'chunk-fixture', ?, ?)
    `);
    opponents.forEach((opponent, index) => {
      insert.run(`chunk-fixture-${index}`, first.id, opponent.id, timestamp + 1, timestamp + 1);
    });
    const maxReplayChunkBytes = 1_000;
    await runCompleteAttributeReplay(harness.gateway, timestamp + 2, { maxReplayChunkBytes });
    const chunks = harness.sqlite.prepare(`
      SELECT pairs_json FROM attribute_replay_snapshot_chunks
      WHERE generation = (SELECT active_generation FROM attribute_replay_snapshot_state WHERE id = 1)
      ORDER BY chunk_number
    `).all() as Array<{ pairs_json: string }>;
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every(({ pairs_json }) => Buffer.byteLength(pairs_json) <= maxReplayChunkBytes)).toBe(true);
    expect(chunks.flatMap(({ pairs_json }) => JSON.parse(pairs_json))).toHaveLength(opponents.length);
    const published = await queryAttributeCatalogSnapshot(harness.gateway);
    const scores = scoreRows(harness);
    await runCompleteAttributeReplay(harness.gateway, timestamp + 3, { maxReplayChunkBytes });
    expect(scoreRows(harness)).toEqual(scores);
    expect(attributeCatalogPayload(await queryAttributeCatalogSnapshot(harness.gateway)).values)
      .toEqual(attributeCatalogPayload(published).values);
  } finally { close(harness); }
});
