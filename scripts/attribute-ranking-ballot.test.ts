// @vitest-environment node
import { Hono } from 'hono';
import { expandStoredRankingResponse } from '../src/shared/attributeRankingBallot';
import { expect, test, vi } from 'vitest';
import { attributesRoutes } from '../worker/routes/attributes';
import { saveAttributeResponse } from '../worker/data/attributeResponses';
import { canonicalizeAttributeMergeVoteSubjects } from '../worker/data/attributeLocks';
import { applyComparison, emptyAttributeState, type OnlineAttributeState } from '../worker/data/attributeScoring';
import { calculateAttributeReplay } from '../worker/data/attributeReplayCalculation';
import { prepareCaptureReplayHistory, prepareCatchUpOnlineReplay, type ReplayScope } from '../worker/data/attributeReplayWork';
import { runCompleteAttributeReplay } from '../worker/workflows/attributeReplay';
import { flushCatalogOutbox } from '../worker/data/catalogOutbox';
import { runWeeklyAttributeRebuild } from '../worker/workflows/attributeWeeklyRebuild';
import { resumePendingAttributeReplay } from '../worker/workflows/attributeResumableReplay';
import type { AttributeResponseInput } from '../worker/data/attributeQueryShared';
import { createHarness, scoreRows, status } from './attributeReplayTestHarness';

const attributeId = 'attribute_setup_variability';
const setup = () => {
  const harness = createHarness();
  harness.sqlite.exec('DELETE FROM attribute_vote_responses; DELETE FROM attribute_score_states;');
  const subjects = harness.sqlite.prepare(`
    SELECT subject.id FROM attribute_subjects subject
    JOIN attribute_votable_subjects votable ON votable.subject_id = subject.id
    WHERE subject.kind = 'game' ORDER BY subject.id LIMIT 8
  `).all() as Array<{ id: string }>;
  expect(subjects).toHaveLength(8);
  const ids = subjects.slice(0, 6).map(({ id }) => id);
  const references = subjects.slice(6).map(({ id }) => id);
  const input: AttributeResponseInput = {
    attributeId, responseId: 'ranking-test:rank:ballot', sessionId: 'ranking-test-session', actorId: null,
    subjectAId: ids[0], subjectBId: ids[1], timestamp: Date.now(),
    ranking: { version: 1, orderedSubjectIds: [references[0], ...ids.slice(0, 3), references[1], ...ids.slice(3)], referenceSubjectIds: references },
  };
  return { ...harness, ids, references, input };
};

test('the real route stores one raw ballot, keeps the old adjacent scoring and safely retries', async () => {
  const harness = setup();
  try {
    const { gateway, sqlite, input, ids, references } = harness;
    const app = new Hono();
    app.use('*', async (context, next) => { (context as any).set('database', gateway); await next(); });
    app.route('/', attributesRoutes as any);
    const send = (body: unknown) => app.request('https://test.local/api/attributes/responses', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const response = await send(input);
    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved.updatedValues).toHaveLength(6);
    expect(saved.activities).toHaveLength(5);
    const stored = sqlite.prepare('SELECT * FROM attribute_vote_responses').all();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ response_id: input.responseId, subject_a_id: null, subject_b_id: null, comparison: null, rating_a: null, rating_b: null });
    expect(JSON.parse(String(stored[0].ranking_json))).toEqual({ ...input.ranking, highPole: 'high' });
    const expected = new Map<string, OnlineAttributeState>();
    for (const [left, right] of [[2, 3], [1, 2], [3, 4], [0, 1], [4, 5]]) {
      const next = applyComparison(expected.get(ids[left]) ?? emptyAttributeState(), expected.get(ids[right]) ?? emptyAttributeState(), 'A_HIGHER');
      expected.set(ids[left], next.a.next); expected.set(ids[right], next.b.next);
    }
    for (const [id, state] of expected) {
      expect(sqlite.prepare('SELECT score, rating_deviation, comparison_count, direct_count FROM attribute_score_states WHERE subject_id = ? AND attribute_id = ?')
        .get(id, attributeId)).toEqual({ score: state.score, rating_deviation: state.ratingDeviation, comparison_count: state.comparisonCount, direct_count: 0 });
    }
    expect(sqlite.prepare('SELECT subject_id FROM attribute_score_states WHERE subject_id IN (?, ?)').all(...references)).toEqual([]);
    const beforeRetry = scoreRows(harness);
    expect((await send(input)).status).toBe(200);
    expect(scoreRows(harness)).toEqual(beforeRetry);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM attribute_vote_responses').get()).toEqual({ count: 1 });
    for (const ranking of [
      { ...input.ranking!, orderedSubjectIds: [ids[0], ids[0]] },
      { ...input.ranking!, referenceSubjectIds: ['missing'] },
      { ...input.ranking!, referenceSubjectIds: input.ranking!.orderedSubjectIds },
    ]) expect((await send({ ...input, responseId: 'invalid-ranking-ballot', ranking })).status).toBe(400);
    expect((await send({ ...input, responseId: 'mixed-ranking-ballot', ratingA: 8 })).status).toBe(400);
    const feed = await (await app.request('https://test.local/api/attributes/activities')).json();
    expect(feed.activities.map((activity: { responseId: string }) => activity.responseId)).toEqual(
      Array.from({ length: 5 }, (_, index) => `${input.responseId}:${String(4 - index).padStart(6, '0')}`));
    await runCompleteAttributeReplay(gateway);
    expect(scoreRows(harness)).toEqual(beforeRetry);
  } finally { harness.sqlite.close(); }
});

test.each(['high', 'low'] as const)('resumable and complete replay agree for a %s ranking after editing an original direct score', async (highPole) => {
  const harness = setup();
  try {
    const { sqlite, gateway, ids } = harness;
    const input = { ...harness.input, attributeId: 'attribute_win_method', highPole };
    sqlite.prepare(`INSERT INTO attribute_vote_responses
      (response_id, attribute_id, subject_a_id, rating_a, activity_json, session_id, created_at, updated_at)
      VALUES ('original-direct', ?, ?, 8, '[]', 'original-session', 1, 1)`).run(input.attributeId, ids[2]);
    await runCompleteAttributeReplay(gateway);
    await saveAttributeResponse(gateway, input);
    sqlite.prepare("UPDATE attribute_vote_responses SET rating_a = 3 WHERE response_id = 'original-direct'").run();
    expect(status(harness).required_revision).toBeGreaterThan(status(harness).replayed_revision);
    await runCompleteAttributeReplay(gateway);
    const expected = scoreRows(harness);
    await flushCatalogOutbox(gateway, Date.now(), 1000);
    sqlite.exec('UPDATE attribute_replay_status SET required_revision = required_revision + 1;');
    const budget = { minimumHistoryRowid: 0, pageSize: 1, maxSteps: 3 };
    let outcome = await runWeeklyAttributeRebuild(gateway, Date.now(), { workBudget: budget });
    for (let step = 0; outcome === 'pending' && step < 100; step++) {
      outcome = await resumePendingAttributeReplay(gateway, Date.now(), budget) ?? 'idle';
    }
    expect(outcome).toBe('replay');
    expect(scoreRows(harness)).toEqual(expected);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM attribute_vote_responses').get()).toEqual({ count: 2 });
  } finally { harness.sqlite.close(); }
});

test.each([
  ['expired', true], ['replaced', true], ['expired', false], ['replaced', false],
] as const)('the write transaction rejects a %s lease (ranking %s) and preserves a newer state', async (failure, ranking) => {
  const harness = setup();
  try {
    const { gateway, sqlite, input, ids } = harness;
    const batch = gateway.batch.bind(gateway);
    let calls = 0;
    vi.spyOn(gateway, 'batch').mockImplementation(async (statements) => {
      if (++calls === 2) {
        sqlite.exec(failure === 'expired'
          ? 'UPDATE attribute_vote_lock SET expires_at = 0;'
          : "UPDATE attribute_vote_lock SET token = 'new-owner';");
        sqlite.prepare(`INSERT INTO attribute_score_states
          (subject_id, attribute_id, score, rating_deviation, direct_sum, direct_count, comparison_count,
           decisive_comparison_count, evidence_count, model_version, updated_at, random_key, question_slot)
          VALUES (?, ?, 9, 1, 0, 0, 1, 1, 1, 'glicko-rd-v2', 1, 'new-state', 1)`).run(ids[0], input.attributeId);
      }
      return batch(statements);
    });
    await expect(saveAttributeResponse(gateway, ranking ? input : { ...input, ranking: undefined, comparison: 'A_HIGHER' }))
      .rejects.toThrow('attribute_response_busy');
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM attribute_vote_responses').get()).toEqual({ count: 0 });
    expect(sqlite.prepare('SELECT subject_id, score FROM attribute_score_states').all()).toEqual([{ subject_id: ids[0], score: 9 }]);
    if (failure === 'replaced') expect(sqlite.prepare('SELECT DISTINCT token FROM attribute_vote_lock').all()).toEqual([{ token: 'new-owner' }]);
  } finally { vi.restoreAllMocks(); harness.sqlite.close(); }
});

test('a ballot insert failure rolls back every score and releases the acquired locks', async () => {
  const harness = setup();
  try {
    harness.sqlite.exec(`CREATE TRIGGER reject_ranking BEFORE INSERT ON attribute_vote_responses
      WHEN NEW.ranking_json IS NOT NULL BEGIN SELECT RAISE(ABORT, 'injected ranking failure'); END;`);
    await expect(saveAttributeResponse(harness.gateway, harness.input)).rejects.toThrow('injected ranking failure');
    expect(scoreRows(harness)).toEqual([]);
    expect(harness.sqlite.prepare('SELECT COUNT(*) AS count FROM attribute_vote_responses').get()).toEqual({ count: 0 });
    expect(harness.sqlite.prepare('SELECT COUNT(*) AS count FROM attribute_vote_lock').get()).toEqual({ count: 0 });
  } finally { harness.sqlite.close(); }
});

test('editing and deleting an original ranking invalidate captured replay history', async () => {
  const harness = setup();
  try {
    const { sqlite, gateway, input, ids } = harness;
    await saveAttributeResponse(gateway, input);
    const before = sqlite.prepare('SELECT history_revision FROM attribute_replay_status').get()!.history_revision;
    const ranking = { ...input.ranking, orderedSubjectIds: [...input.ranking!.orderedSubjectIds].reverse(), highPole: 'high' };
    sqlite.prepare('UPDATE attribute_vote_responses SET ranking_json = ? WHERE response_id = ?').run(JSON.stringify(ranking), input.responseId);
    expect(sqlite.prepare('SELECT history_revision FROM attribute_replay_status').get()!.history_revision).toBe(Number(before) + 1);
    await runCompleteAttributeReplay(gateway);
    const first = sqlite.prepare('SELECT score FROM attribute_score_states WHERE subject_id = ? AND attribute_id = ?').get(ids[0], attributeId)!;
    const last = sqlite.prepare('SELECT score FROM attribute_score_states WHERE subject_id = ? AND attribute_id = ?').get(ids[5], attributeId)!;
    expect(first.score).toBeLessThan(Number(last.score));
    sqlite.prepare('DELETE FROM attribute_vote_responses WHERE response_id = ?').run(input.responseId);
    expect(sqlite.prepare('SELECT history_revision FROM attribute_replay_status').get()!.history_revision).toBe(Number(before) + 2);
    await runCompleteAttributeReplay(gateway);
    expect(scoreRows(harness)).toEqual([]);
  } finally { harness.sqlite.close(); }
});

test('game merges preserve original positions and map the expanded pair history without changing its meaning', async () => {
  const harness = setup();
  try {
    const { gateway, sqlite, ids, input } = harness;
    await saveAttributeResponse(gateway, input);
    const original = sqlite.prepare('SELECT * FROM attribute_vote_responses').get()!;
    const expanded = calculateAttributeReplay(new Set(ids), new Set([attributeId]), [{
      response_id: input.responseId, attribute_id: attributeId, subject_a_id: '', subject_b_id: null,
      rating_a: null, rating_b: null, comparison: null, created_at: input.timestamp, weight: 1,
      ranking_json: String(original.ranking_json),
    }]);
    expect(expanded.states.size).toBe(6);
    await canonicalizeAttributeMergeVoteSubjects(gateway, ids[0], ids[2])!.run();
    const stored = JSON.parse(String(sqlite.prepare('SELECT ranking_json FROM attribute_vote_responses').get()!.ranking_json));
    expect(stored.orderedSubjectIds).toEqual(input.ranking!.orderedSubjectIds);
    expect(stored.referenceSubjectIds).toEqual(input.ranking!.referenceSubjectIds);
    expect(stored.subjectMappings).toEqual({ [ids[0]]: ids[2] });
    await canonicalizeAttributeMergeVoteSubjects(gateway, ids[2], ids[4])!.run();
    const mapped = JSON.parse(String(sqlite.prepare('SELECT ranking_json FROM attribute_vote_responses').get()!.ranking_json));
    expect(mapped.subjectMappings).toEqual({ [ids[0]]: ids[4], [ids[2]]: ids[4] });
    const raw = { response_id: input.responseId, attribute_id: attributeId, subject_a_id: '', subject_b_id: null,
      rating_a: null, rating_b: null, comparison: null, created_at: input.timestamp, weight: 1,
      ranking_json: String(original.ranking_json) };
    const legacy = expandStoredRankingResponse(raw).map((row) => ({ ...row,
      subject_a_id: mapped.subjectMappings[row.subject_a_id] ?? row.subject_a_id,
      subject_b_id: mapped.subjectMappings[row.subject_b_id!] ?? row.subject_b_id,
    }));
    const actual = calculateAttributeReplay(new Set(ids), new Set([attributeId]), [{ ...raw, ranking_json: JSON.stringify(mapped) }]);
    const expected = calculateAttributeReplay(new Set(ids), new Set([attributeId]), legacy);
    expect([...actual.states]).toEqual([...expected.states]);
    expect([...actual.pairCounts]).toEqual([...expected.pairCounts]);
  } finally { harness.sqlite.close(); }
});

test.each(['append', 'catchup'] as const)('a new ranking survives the %s path of an already staged replay', async (path) => {
  const harness = setup();
  try {
    const { gateway, sqlite, input, ids } = harness;
    await saveAttributeResponse(gateway, input);
    const head = sqlite.prepare('SELECT rowid FROM attribute_vote_responses').get()!.rowid as number;
    const scope: ReplayScope = [ids, [attributeId]];
    sqlite.prepare(`INSERT INTO attribute_replay_work_chunks (kind, attribute_id, page, chunk_number, payload)
      VALUES ('states', ?, 0, 0, '[]')`).run(attributeId);
    sqlite.prepare('INSERT INTO attribute_replay_calculation (attribute_id, cursor_json) VALUES (?, ?)')
      .run(attributeId, JSON.stringify({ phase: 'complete', lastEventAt: 0 }));
    const prepared = path === 'catchup'
      ? await prepareCatchUpOnlineReplay(gateway, scope, 0, head, 1)
      : await prepareCaptureReplayHistory(gateway, {
        history_revision: 0, input_revision: 0, model_version: 'glicko-rd-v2', scope_json: JSON.stringify(scope),
        target_rowid: head, target_response_id: input.responseId, scanned_rowid: 0, online_rowid: null, online_response_id: null,
      }, scope, new Set([attributeId]), 1);
    await gateway.batch(prepared.statements);
    const chunks = sqlite.prepare(`SELECT payload FROM attribute_replay_work_chunks
      WHERE kind = 'states' AND attribute_id = ? AND page = 0 ORDER BY chunk_number`).all(attributeId);
    const states = new Map<string, OnlineAttributeState>(chunks.flatMap((row: { payload: string }) => JSON.parse(row.payload)));
    expect(states.size).toBe(6);
    for (const id of ids) {
      const actual = sqlite.prepare('SELECT score, comparison_count FROM attribute_score_states WHERE subject_id = ? AND attribute_id = ?')
        .get(id, attributeId)!;
      expect(states.get(`${id}\u0000${attributeId}`)).toMatchObject({ score: actual.score, comparisonCount: actual.comparison_count });
    }
  } finally { harness.sqlite.close(); }
});
