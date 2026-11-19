// @vitest-environment node
import { expect, test, vi } from 'vitest';
import { createHarness, scoreRows } from './attributeReplayTestHarness';
import { saveAttributeResponse } from '../worker/data/attributeResponses';
import { processAttributeResponses } from '../worker/workflows/attributeOnlineScoring';
import { runCompleteAttributeReplay } from '../worker/workflows/attributeReplay';
import { flushCatalogOutbox } from '../worker/data/catalogOutbox';
import { attributeCatalogChangesPayload, attributeCatalogPayload, queryAttributeCatalogChanges,
  queryAttributeCatalogSnapshot, queryAttributeCatalogSnapshotMeta } from '../worker/data/attributeCatalog';
import { stateToMatrixValue } from '../worker/data/attributeResponseContext';
import { applyAttributeCatalogChanges } from '../src/lib/attributeCatalog';
import type { AttributeCatalogPayload } from '../src/shared/types';

const setup = async () => {
  const h = createHarness();
  h.sqlite.exec(`DELETE FROM attribute_vote_responses; DELETE FROM attribute_score_states;
    DELETE FROM catalog_change_outbox;
    UPDATE attribute_online_progress SET through_rowid = 0, through_response_id = NULL;`);
  const ids = h.sqlite.prepare(`SELECT subject.id FROM attribute_subjects subject
    JOIN attribute_votable_subjects votable ON votable.subject_id = subject.id
    WHERE subject.kind = 'game' ORDER BY subject.id LIMIT 6`).all().map((row: { id: unknown }) => String(row.id));
  const clock = () => Number(h.sqlite.prepare('SELECT current_version FROM attribute_catalog_clock WHERE id = 1').get()!.current_version);
  const cursor = () => Number(h.sqlite.prepare('SELECT through_rowid FROM attribute_online_progress WHERE id = 1').get()!.through_rowid);
  const pending = () => h.sqlite.prepare("SELECT * FROM catalog_change_outbox WHERE catalog LIKE 'attribute-%'").all();
  const initial = { ...attributeCatalogPayload(await queryAttributeCatalogSnapshot(h.gateway)), throughVersion: clock() };
  const pull = async (from = initial) => {
    let cache = from;
    for (let i = 0; i < 100; i++) {
      const delta = attributeCatalogChangesPayload(await queryAttributeCatalogChanges(h.gateway, cache.throughVersion, 2),
        cache.throughVersion, await queryAttributeCatalogSnapshotMeta(h.gateway), 2);
      cache = applyAttributeCatalogChanges(cache, delta.changes, delta.throughVersion);
      if (!delta.hasMore) return cache;
    }
    throw new Error('Catalog did not drain');
  };
  const input = (n: number) => ({ attributeId: 'attribute_setup_variability', subjectAId: ids[0], subjectBId: ids[1],
    responseId: `publication-${n}`, sessionId: `publication-person-${n}`, actorId: null, timestamp: Date.now() + n,
    ranking: { version: 1 as const, orderedSubjectIds: ids, referenceSubjectIds: [] } });
  const expectScores = (cache: AttributeCatalogPayload) => {
    for (const id of ids) {
      const row = h.sqlite.prepare(`SELECT score, rating_deviation AS ratingDeviation, direct_sum AS directSum,
        direct_count AS directCount, comparison_count AS comparisonCount, decisive_comparison_count AS decisiveComparisonCount,
        evidence_count AS evidenceCount FROM attribute_score_states WHERE subject_id = ? AND attribute_id = ?`)
        .get(id, input(0).attributeId);
      expect(cache.values.find((v) => v.subjectId === id && v.attributeId === input(0).attributeId))
        .toEqual(stateToMatrixValue(id, input(0).attributeId, row as Parameters<typeof stateToMatrixValue>[2]));
    }
  };
  return { ...h, ids, clock, cursor, pending, initial, input, pull, expectScores };
};

test('score deltas reach the actual frontend cache without reading bundles or replacing metadata', async () => {
  const h = await setup();
  try {
    h.executedSql.length = 0;
    const result = await saveAttributeResponse(h.gateway, h.input(0));
    expect(result.scoreStatus).toBe('applied');
    expect(h.pending()).toEqual([]);
    expect(h.executedSql.some((sql) => /FROM attribute_score_states state/.test(sql))).toBe(false);
    const cache = await h.pull();
    h.expectScores(cache);
    expect(cache.subjects).toEqual(h.initial.subjects);
    expect(cache.attributes).toEqual(h.initial.attributes);
    expect(await flushCatalogOutbox(h.gateway)).toEqual({ processed: {} });
    const before = h.clock();
    await saveAttributeResponse(h.gateway, h.input(0));
    expect(h.clock()).toBe(before);
  } finally { h.sqlite.close(); }
});

test('failed delta publication rolls back scores, clock, cursor and suppression while retaining the receipt', async () => {
  const h = await setup();
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const before = { clock: h.clock(), cursor: h.cursor(), scores: scoreRows(h) };
    h.sqlite.exec(`CREATE TRIGGER fail_delta BEFORE INSERT ON attribute_catalog_entries
      WHEN NEW.entry_key LIKE 'value:%' BEGIN SELECT RAISE(ABORT, 'delta failure'); END;`);
    expect(await saveAttributeResponse(h.gateway, h.input(0))).toMatchObject({ scoreStatus: 'pending', updatedValues: [] });
    expect({ clock: h.clock(), cursor: h.cursor(), scores: scoreRows(h) }).toEqual(before);
    expect(h.sqlite.prepare('SELECT * FROM attribute_catalog_rebuild_mode').all()).toEqual([]);
    expect(h.sqlite.prepare('SELECT response_id FROM attribute_vote_responses').all()).toEqual([{ response_id: 'publication-0' }]);
    h.sqlite.exec('DROP TRIGGER fail_delta');
    await processAttributeResponses(h.gateway);
    expect(h.cursor()).toBe(1); h.expectScores(await h.pull());
  } finally { error.mockRestore(); h.sqlite.close(); }
});

test.each(['score', 'revision', 'snapshot', 'other-publisher'] as const)(
  'the real metadata publisher rejects stale %s work and recovers from a fresh read', async (conflict) => {
    const h = await setup();
    try {
      await saveAttributeResponse(h.gateway, h.input(0));
      h.sqlite.prepare("UPDATE attribute_subjects SET display_name = '新名稱' WHERE id = ?").run(h.ids[0]);
      const batch = h.gateway.batch.bind(h.gateway);
      const clock = h.clock();
      vi.spyOn(h.gateway, 'batch').mockImplementationOnce(async (statements) => {
        if (conflict === 'score') await saveAttributeResponse(h.gateway, h.input(1));
        if (conflict === 'revision') h.sqlite.prepare("UPDATE attribute_subjects SET display_name = '最新名稱' WHERE id = ?").run(h.ids[0]);
        if (conflict === 'snapshot') {
          await runCompleteAttributeReplay(h.gateway, Date.now() + 100_000);
          expect(h.clock()).toBe(clock);
        }
        if (conflict === 'other-publisher') expect((await flushCatalogOutbox(h.gateway)).processed['attribute-subject']).toBe(1);
        return batch(statements);
      });
      expect(await flushCatalogOutbox(h.gateway)).toEqual({ processed: {} });
      if (conflict !== 'other-publisher') expect(h.pending()).toHaveLength(1);
      if (conflict === 'revision' || conflict === 'snapshot') expect(h.clock()).toBe(clock);
      await flushCatalogOutbox(h.gateway);
      expect(h.pending()).toEqual([]);
      const baseline = conflict === 'snapshot' ? attributeCatalogPayload(await queryAttributeCatalogSnapshot(h.gateway)) : h.initial;
      const cache = await h.pull(baseline);
      h.expectScores(cache);
      expect(cache.subjects.find((s) => s.id === h.ids[0])?.displayName).toBe(conflict === 'revision' ? '最新名稱' : '新名稱');
    } finally { vi.restoreAllMocks(); h.sqlite.close(); }
  });

test('metadata insertion failure cannot reserve a visible version or acknowledge pending work', async () => {
  const h = await setup();
  try {
    h.sqlite.prepare("UPDATE attribute_subjects SET display_name = '待發布名稱' WHERE id = ?").run(h.ids[0]);
    const before = h.clock();
    h.sqlite.exec(`CREATE TRIGGER fail_bundle BEFORE INSERT ON attribute_catalog_entries
      WHEN NEW.entry_key LIKE 'subject:%' BEGIN SELECT RAISE(ABORT, 'bundle failure'); END;`);
    await expect(flushCatalogOutbox(h.gateway)).rejects.toThrow('bundle failure');
    expect(h.clock()).toBe(before); expect(h.pending()).toHaveLength(1);
    h.sqlite.exec('DROP TRIGGER fail_bundle');
    await flushCatalogOutbox(h.gateway); expect(h.pending()).toEqual([]);
    expect((await h.pull()).subjects.find((s) => s.id === h.ids[0])?.displayName).toBe('待發布名稱');
  } finally { h.sqlite.close(); }
});

test('new game bundles, attribute deletion and subject deletion remain authoritative after value deltas', async () => {
  const h = await setup();
  try {
    h.sqlite.exec(`INSERT INTO games(id, slug, display_name, normalized_name, created_at, updated_at, entity_kind, bgg_id, review_status)
      VALUES ('publication-new', 'publication-new', '新遊戲', 'publication new', 1, 1, 'base', 99999991, 'pending');`);
    await flushCatalogOutbox(h.gateway);
    let cache = await h.pull();
    expect(cache.subjects.some((s) => s.gameId === 'publication-new')).toBe(true);
    await saveAttributeResponse(h.gateway, h.input(0));
    cache = await h.pull(cache); h.expectScores(cache);
    h.sqlite.prepare('UPDATE attributes SET is_active = 0 WHERE id = ?').run(h.input(0).attributeId);
    await flushCatalogOutbox(h.gateway);
    cache = await h.pull(cache);
    expect(cache.attributes.some((a) => a.id === h.input(0).attributeId)).toBe(false);
    expect(cache.values.some((v) => v.attributeId === h.input(0).attributeId)).toBe(false);
    h.sqlite.prepare('DELETE FROM attribute_subjects WHERE id = ?').run(h.ids[0]);
    await flushCatalogOutbox(h.gateway);
    cache = await h.pull(cache);
    expect(cache.subjects.some((s) => s.id === h.ids[0])).toBe(false);
    expect(cache.values.some((v) => v.subjectId === h.ids[0])).toBe(false);
  } finally { h.sqlite.close(); }
});

test('index migration preserves indexed score lookups in both foreign-key directions', () => {
  const h = createHarness();
  try {
    const plan = (sql: string) => h.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((row: { detail: unknown }) => row.detail).join('\n');
    expect(plan("SELECT * FROM attribute_score_states WHERE subject_id = 'subject' AND attribute_id = 'attribute'"))
      .toMatch(/USING INDEX sqlite_autoindex_attribute_score_states/);
    expect(plan("SELECT subject_id FROM attribute_score_states WHERE attribute_id = 'attribute'"))
      .toMatch(/USING (?:COVERING )?INDEX idx_attribute_score_states_random/);
    expect(h.sqlite.prepare('PRAGMA foreign_key_check(attribute_score_states)').all()).toEqual([]);
    const indexes = h.sqlite.prepare('PRAGMA index_list(attribute_score_states)').all().map((row: { name: unknown }) => row.name);
    expect(indexes).not.toContain('idx_attribute_score_states_question_slot');
    expect(indexes).not.toContain('idx_attribute_score_states_question_slot_global');
    expect(indexes).not.toContain('idx_attribute_score_states_attribute_score');
  } finally { h.sqlite.close(); }
});
