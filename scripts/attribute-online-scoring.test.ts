// @vitest-environment node
import { expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { attributesRoutes } from '../worker/routes/attributes';
import { saveAttributeResponse } from '../worker/data/attributeResponses';
import { ATTRIBUTE_SCORE_MODEL_VERSION, emptyAttributeState, type OnlineAttributeState } from '../worker/data/attributeScoring';
import type { StoredAttributeRankingBallot } from '../src/shared/attributeRankingBallot';
import { rankedAttributeSubjects } from '../worker/data/attributeRankedSubjects';
import { applyAttributeRanking } from '../worker/data/attributeRankingUpdate';
import { hasPendingAttributeResponses, processAttributeResponses } from '../worker/workflows/attributeOnlineScoring';
import { runCompleteAttributeReplay } from '../worker/workflows/attributeReplay';
import { scheduled } from '../worker';
import type { AttributeResponseInput } from '../worker/data/attributeQueryShared';
import { createHarness, scoreRows } from './attributeReplayTestHarness';

const setup = () => {
  const harness = createHarness();
  harness.sqlite.exec(`DELETE FROM attribute_vote_responses; DELETE FROM attribute_score_states;
    UPDATE attribute_online_progress SET through_rowid = 0, through_response_id = NULL;`);
  const ids: string[] = harness.sqlite.prepare(`SELECT subject.id FROM attribute_subjects subject
    JOIN attribute_votable_subjects votable ON votable.subject_id = subject.id
    WHERE subject.kind = 'game' ORDER BY subject.id LIMIT 6`).all().map((row: { id: unknown }) => String(row.id));
  expect(ids).toHaveLength(6);
  const input = (index: number): AttributeResponseInput => ({
    subjectAId: ids[0], subjectBId: ids[1], attributeId: 'attribute_setup_variability',
    responseId: `online-ballot-${index}`, sessionId: `person-${index}`, actorId: null, timestamp: Date.now() + index,
    ranking: { version: 1, orderedSubjectIds: ids, referenceSubjectIds: [] },
  });
  const hold = () => harness.sqlite.prepare(`INSERT INTO attribute_vote_lock VALUES ('attribute-replay', 'hold', ?)`)
    .run(Date.now() + 60_000);
  const release = () => harness.sqlite.exec("DELETE FROM attribute_vote_lock WHERE token = 'hold'");
  const cursor = () => harness.sqlite.prepare('SELECT through_rowid FROM attribute_online_progress WHERE id = 1').get()!.through_rowid;
  return { ...harness, ids, input, hold, release, cursor };
};

const expectScoredOnce = (h: ReturnType<typeof setup>, ballots: number, scoreTolerance = 0) => {
  const raw = h.sqlite.prepare('SELECT ranking_json, online_weight FROM attribute_vote_responses ORDER BY rowid')
    .all() as Array<{ ranking_json: string; online_weight: number }>;
  expect(raw).toHaveLength(ballots);
  const expected = new Map<string, OnlineAttributeState>(h.ids.map((id) => [id, emptyAttributeState()]));
  for (const row of raw) {
    const ids = rankedAttributeSubjects(JSON.parse(row.ranking_json) as StoredAttributeRankingBallot);
    const next = applyAttributeRanking(ids.map((id) => expected.get(id)!), row.online_weight);
    ids.forEach((id, i) => expected.set(id, next[i]));
  }
  for (const [id, state] of expected) {
    const actual = h.sqlite.prepare(`SELECT score, rating_deviation, comparison_count,
      evidence_count FROM attribute_score_states WHERE subject_id = ? AND attribute_id = ?`).get(id, h.input(0).attributeId)!;
    expect(Math.abs(Number(actual.score) - state.score)).toBeLessThanOrEqual(scoreTolerance);
    expect(actual).toMatchObject({ rating_deviation: state.ratingDeviation,
      comparison_count: state.comparisonCount, evidence_count: state.evidenceCount });
  }
};

test('the daily job activates a new scoring model while uploads keep their original receipts', async () => {
  const h = setup();
  try {
    const first = { ...h.input(0), timestamp: 100 };
    const second = { ...h.input(1), timestamp: 200 };
    await expect(saveAttributeResponse(h.gateway, first)).resolves.toMatchObject({ scoreStatus: 'applied' });
    h.sqlite.exec(`UPDATE attribute_online_progress SET model_version = 'glicko-rd-v2';
      UPDATE attribute_replay_status SET replayed_model_version = 'glicko-rd-v2';
      UPDATE attribute_score_states SET score = 5, model_version = 'glicko-rd-v2';
      DELETE FROM catalog_change_outbox;`);
    await expect(saveAttributeResponse(h.gateway, second)).resolves.toMatchObject({ scoreStatus: 'pending' });
    expect(h.cursor()).toBe(1);
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM attribute_vote_responses').get()).toEqual({ n: 2 });
    await scheduled({ scheduledTime: Date.parse('2026-11-17T01:00:00Z') }, h.env);
    expect(h.sqlite.prepare('SELECT model_version, through_rowid FROM attribute_online_progress').get())
      .toEqual({ model_version: ATTRIBUTE_SCORE_MODEL_VERSION, through_rowid: 2 });
    expect(h.sqlite.prepare('SELECT score_model_version FROM attribute_catalog_snapshot_state').get())
      .toEqual({ score_model_version: ATTRIBUTE_SCORE_MODEL_VERSION });
    expectScoredOnce(h, 2);
    const scores = scoreRows(h);
    await expect(saveAttributeResponse(h.gateway, second)).resolves.toMatchObject({ scoreStatus: 'applied' });
    expect(scoreRows(h)).toEqual(scores);
  } finally { h.sqlite.close(); }
});

test('ten accepted uploads during a busy lease do not read scores; one owner scores the entire batch once', async () => {
  const h = setup();
  try {
    h.hold(); h.executedSql.length = 0;
    const app = new Hono();
    app.use('*', async (c, next) => { (c as any).set('database', h.gateway); await next(); });
    app.route('/', attributesRoutes as any);
    for (let i = 0; i < 10; i++) {
      const response = await app.request('https://test.local/api/attributes/responses', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(h.input(i)),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true, scoreStatus: 'pending', updatedValues: [] });
    }
    expect(h.executedSql.some((sql) => /\b(?:FROM|JOIN)\s+attribute_score_states\b/iu.test(sql))).toBe(false);
    expect(h.executedSql.some((sql) => /WHERE rowid > \?/u.test(sql))).toBe(false);
    expect(scoreRows(h)).toEqual([]); expect(h.cursor()).toBe(0);
    h.release(); h.executedSql.length = 0;
    const result = await processAttributeResponses(h.gateway);
    expect(result).toMatchObject({ status: 'processed', batches: 1, throughRowid: 10 });
    expect(result.updatedValues).toHaveLength(6);
    expect(h.executedSql.filter((sql) => /INSERT INTO attribute_score_states/iu.test(sql))).toHaveLength(1);
    expect(h.executedSql.filter((sql) => /UPDATE attribute_online_progress/iu.test(sql))).toHaveLength(1);
    expectScoredOnce(h, 10);
    const beforeRetry = scoreRows(h);
    await saveAttributeResponse(h.gateway, h.input(0));
    expect(scoreRows(h)).toEqual(beforeRetry);
    expect(h.cursor()).toBe(10);
  } finally { h.sqlite.close(); }
});

test('a score commit failure returns a durable receipt and a later server run resumes without the phone', async () => {
  const h = setup();
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    h.sqlite.exec(`CREATE TRIGGER fail_cursor BEFORE UPDATE ON attribute_online_progress
      BEGIN SELECT RAISE(ABORT, 'injected cursor failure'); END;`);
    expect(await saveAttributeResponse(h.gateway, h.input(0))).toMatchObject({ scoreStatus: 'pending', updatedValues: [] });
    expect(scoreRows(h)).toEqual([]); expect(h.cursor()).toBe(0);
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM attribute_vote_responses').get()).toEqual({ n: 1 });
    h.sqlite.exec('DROP TRIGGER fail_cursor');
    expect(await hasPendingAttributeResponses(h.gateway)).toBe(true);
    // Tuesday recovery uses the existing daily event, with no browser/request.
    await scheduled({ scheduledTime: Date.parse('2026-11-17T01:00:00Z') }, h.env);
    expect(h.cursor()).toBe(1);
    expectScoredOnce(h, 1);
    expect(await hasPendingAttributeResponses(h.gateway)).toBe(false);
  } finally { error.mockRestore(); h.sqlite.close(); }
});

test('a receipt arriving during the final transaction keeps the same owner draining', async () => {
  const h = setup();
  try {
    h.hold(); await saveAttributeResponse(h.gateway, h.input(0)); h.release();
    const batch = h.gateway.batch.bind(h.gateway);
    let injected = false;
    vi.spyOn(h.gateway, 'batch').mockImplementation(async (statements) => {
      if (!injected) {
        injected = true;
        h.sqlite.prepare(`INSERT INTO attribute_vote_responses (response_id, attribute_id, ranking_json,
          activity_json, session_id, created_at, updated_at, recorded_online, online_weight)
          VALUES (?, ?, ?, '[]', 'late-person', ?, ?, 1, 1)`)
          .run('late-ballot', h.input(1).attributeId, JSON.stringify(h.input(1).ranking), Date.now() + 1, Date.now() + 1);
      }
      return batch(statements);
    });
    expect(await processAttributeResponses(h.gateway)).toMatchObject({ status: 'processed', batches: 2, throughRowid: 2 });
    expectScoredOnce(h, 2);
    expect(h.sqlite.prepare('SELECT * FROM attribute_vote_lock').all()).toEqual([]);
  } finally { vi.restoreAllMocks(); h.sqlite.close(); }
});

test('bounded processing leaves the rest durable and resumes from its committed cursor', async () => {
  const h = setup();
  try {
    h.hold(); for (let i = 0; i < 10; i++) await saveAttributeResponse(h.gateway, h.input(i)); h.release();
    expect(await processAttributeResponses(h.gateway, { pageSize: 3, maxBatches: 1 }))
      .toMatchObject({ status: 'pending', throughRowid: 3, batches: 1 });
    expect(await hasPendingAttributeResponses(h.gateway)).toBe(true);
    expect(await processAttributeResponses(h.gateway)).toMatchObject({ status: 'processed', throughRowid: 10 });
    expectScoredOnce(h, 10);
  } finally { h.sqlite.close(); }
});

test('full replay consumes pending receipts and advances the cursor so the live scorer cannot double count', async () => {
  const h = setup();
  try {
    h.hold(); await saveAttributeResponse(h.gateway, h.input(0)); h.release();
    await runCompleteAttributeReplay(h.gateway);
    expect(h.cursor()).toBe(1);
    const before = scoreRows(h);
    expect(await processAttributeResponses(h.gateway)).toMatchObject({ status: 'idle' });
    expect(scoreRows(h)).toEqual(before);
    h.sqlite.prepare('UPDATE attribute_vote_responses SET ranking_json = ? WHERE response_id = ?')
      .run(JSON.stringify({ ...h.input(0).ranking, orderedSubjectIds: [...h.ids].reverse() }), h.input(0).responseId);
    await runCompleteAttributeReplay(h.gateway);
    // Full replay retains existing states within its established display-rounding tolerance.
    expectScoredOnce(h, 1, 0.0051);
  } finally { h.sqlite.close(); }
});

test('deleting the scored tail cannot make the next accepted receipt reuse a processed rowid', async () => {
  const h = setup();
  try {
    await saveAttributeResponse(h.gateway, h.input(0));
    expect(h.cursor()).toBe(1);
    h.sqlite.prepare('DELETE FROM attribute_vote_responses WHERE response_id = ?').run(h.input(0).responseId);
    expect(await saveAttributeResponse(h.gateway, h.input(1))).toMatchObject({ scoreStatus: 'pending' });
    expect(h.sqlite.prepare('SELECT rowid FROM attribute_vote_responses').get()).toEqual({ rowid: 2 });
    await runCompleteAttributeReplay(h.gateway);
    expect(h.cursor()).toBe(2); expectScoredOnce(h, 1);
  } finally { h.sqlite.close(); }
});

test('a receipt accepted during final replay publication survives the rejected stale snapshot', async () => {
  const h = setup();
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const batch = h.gateway.batch.bind(h.gateway);
    let injected = false;
    vi.spyOn(h.gateway, 'batch').mockImplementation(async (statements) => {
      if (!injected) {
        injected = true;
        expect(await saveAttributeResponse(h.gateway, h.input(0))).toMatchObject({ scoreStatus: 'pending' });
      }
      return batch(statements);
    });
    await expect(runCompleteAttributeReplay(h.gateway)).rejects.toThrow('attribute_replay_history_head_changed');
    expect(scoreRows(h)).toEqual([]); expect(h.cursor()).toBe(0);
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM attribute_vote_responses').get()).toEqual({ n: 1 });
    await runCompleteAttributeReplay(h.gateway);
    expect(h.cursor()).toBe(1); expectScoredOnce(h, 1);
    expect(await hasPendingAttributeResponses(h.gateway)).toBe(false);
  } finally { vi.restoreAllMocks(); error.mockRestore(); h.sqlite.close(); }
});

test.each([false, true])('eligibility changed after metadata is rejected by the receipt transaction (ranking %s)', async (ranking) => {
  const h = setup();
  try {
    const batch = h.gateway.batch.bind(h.gateway);
    vi.spyOn(h.gateway, 'batch').mockImplementationOnce(async (statements) => {
      h.sqlite.prepare(`UPDATE games SET visibility = 'hidden' WHERE id =
        (SELECT game_id FROM attribute_subjects WHERE id = ?)`).run(h.ids[0]);
      return batch(statements);
    });
    const app = new Hono();
    app.use('*', async (c, next) => { (c as any).set('database', h.gateway); await next(); });
    app.route('/', attributesRoutes as any);
    const input = h.input(0);
    const response = await app.request('https://test.local/api/attributes/responses', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ranking ? input : { ...input, ranking: undefined, comparison: 'A_HIGHER' }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'attribute_subject_not_found' });
    expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM attribute_vote_responses').get()).toEqual({ n: 0 });
    expect(scoreRows(h)).toEqual([]); expect(h.cursor()).toBe(0);
  } finally { vi.restoreAllMocks(); h.sqlite.close(); }
});
