import { describe, expect, test } from 'vitest';
import {
  ATTRIBUTE_SCORE_MODEL_VERSION,
  ATTRIBUTE_DIRECT_RATING_RD,
  ATTRIBUTE_INITIAL_RD,
  applyComparison,
  applyDirectRating,
  emptyAttributeState,
  initialAttributeState,
  replayAttributeEvents,
  replayAttributeResponses,
  calculateAttributeScores,
  expectedComparisonVarianceReduction,
} from './data/attributeScoring';

const scoreFor = (scores: ReturnType<typeof calculateAttributeScores>, subjectId: string) => {
  const score = scores.find((item) => item.subjectId === subjectId);
  if (!score) throw new Error(`Missing score for ${subjectId}`);
  return score;
};

describe('glicko-rd-v1', () => {
  test.each([0, 5, 9, 10])('initial value %s has zero votes and survives the first direct rating', (score) => {
    const initial = initialAttributeState(score);
    expect(initial).toMatchObject({ score, initialScore: score, evidenceCount: 0, directCount: 0, comparisonCount: 0, ratingDeviation: 3 });
    const rating = score < 5 ? 8 : 2;
    const next = applyDirectRating(initial, rating).next;
    expect(next.score).toBeGreaterThan(Math.min(score, rating));
    expect(next.score).toBeLessThan(Math.max(score, rating));
    expect(next).toMatchObject({ initialScore: score, directSum: rating, directCount: 1, evidenceCount: 1 });
    expect(initial.evidenceCount).toBe(0);
  });

  test('comparison against an initial value counts only the new comparison', () => {
    const result = applyComparison(initialAttributeState(8), initialAttributeState(2), 'SIMILAR');
    expect(result.a.next.score).toBeLessThan(8);
    expect(result.b.next.score).toBeGreaterThan(2);
    expect(result.a.next).toMatchObject({ directCount: 0, comparisonCount: 1, decisiveComparisonCount: 0, evidenceCount: 1, initialScore: 8 });
  });

  test('rebuild starts at retained baselines, excludes absorbed history and deduplicates responses', () => {
    const prior = [{ subjectId: 'a', attributeId: 'win', score: 9, cutoffCreatedAt: 100 }];
    const response = { responseId: 'new', createdAt: 101, attributeId: 'win', subjectAId: 'a', subjectBId: null, ratingA: 2, ratingB: null, comparison: null };
    const old = { ...response, responseId: 'old', createdAt: 100, ratingA: 0 };
    const replay = replayAttributeResponses([response, old, response], undefined, prior);
    expect(replay.get('a\u0000win')).toEqual(applyDirectRating(initialAttributeState(9), 2).next);
    expect(replayAttributeResponses([], undefined, prior).get('a\u0000win')?.score).toBe(9);
    expect(() => replayAttributeResponses([response, { ...response, ratingA: 3 }], undefined, prior)).toThrow('attribute_response_replay_conflict');
  });

  test('subject mapping retains a single baseline and rejects ambiguous merged baselines', () => {
    const initial = { subjectId: 'source', attributeId: 'win', score: 9, cutoffCreatedAt: 100 };
    const mapper = (id: string) => id === 'source' ? 'target' : id;
    expect(replayAttributeResponses([], mapper, [initial]).get('target\u0000win')?.score).toBe(9);
    expect(() => replayAttributeResponses([], mapper, [initial, { ...initial, subjectId: 'target', score: 2 }])).toThrow('attribute_initial_value_conflict');
    expect(() => initialAttributeState(NaN)).toThrow('invalid_attribute_initial_score');
    expect(() => replayAttributeResponses([], undefined, [{ ...initial, cutoffCreatedAt: -1 }])).toThrow('invalid_attribute_initial_cutoff');
  });
  test('initializes the first direct score at the submitted absolute value', () => {
    const result = applyDirectRating(emptyAttributeState(), 8);

    expect(result.next).toMatchObject({ score: 8, ratingDeviation: ATTRIBUTE_DIRECT_RATING_RD, directSum: 8, directCount: 1, evidenceCount: 1 });
  });

  test('uses later direct scores as draws against fixed numeric anchors', () => {
    const first = applyDirectRating(emptyAttributeState(), 8).next;
    const second = applyDirectRating(first, 7).next;

    expect(second.directSum).toBe(15);
    expect(second.directCount).toBe(2);
    expect(second.score).toBeLessThan(8);
    expect(second.score).toBeGreaterThan(7);
  });

  test('moves a higher-rated winner above its current score and the loser below', () => {
    const scores = calculateAttributeScores(
      [
        { subjectId: 'a', attributeId: 'luck', average: 8, count: 1 },
        { subjectId: 'b', attributeId: 'luck', average: 5, count: 1 },
      ],
      [{ subjectAId: 'a', subjectBId: 'b', attributeId: 'luck', result: 'A_HIGHER' }],
    );

    expect(scoreFor(scores, 'a').score).toBeGreaterThan(8);
    expect(scoreFor(scores, 'b').score).toBeLessThan(5);
    expect(scoreFor(scores, 'a')).toMatchObject({ comparisonCount: 1, decisiveComparisonCount: 1, modelVersion: ATTRIBUTE_SCORE_MODEL_VERSION });
  });

  test('moves a similar pair closer together', () => {
    const scores = calculateAttributeScores(
      [
        { subjectId: 'a', attributeId: 'luck', average: 8, count: 1 },
        { subjectId: 'b', attributeId: 'luck', average: 5, count: 1 },
      ],
      [{ subjectAId: 'a', subjectBId: 'b', attributeId: 'luck', result: 'SIMILAR' }],
    );

    expect(scoreFor(scores, 'a').score).toBeLessThan(8);
    expect(scoreFor(scores, 'b').score).toBeGreaterThan(5);
  });

  test('reduces RD after repeated evidence', () => {
    let state = emptyAttributeState();
    for (let index = 0; index < 20; index += 1) state = applyDirectRating(state, 8).next;

    expect(state.ratingDeviation).toBeLessThan(ATTRIBUTE_INITIAL_RD);
    expect(state.ratingDeviation).toBeGreaterThanOrEqual(0.25);
  });

  test('lets a high-RD subject move more against the same direct anchor', () => {
    const lowRdState = { ...emptyAttributeState(), score: 5, ratingDeviation: 0.5, evidenceCount: 10 };
    const highRdState = { ...emptyAttributeState(), score: 5, ratingDeviation: ATTRIBUTE_INITIAL_RD };

    const lowRdUpdate = applyDirectRating(lowRdState, 9).next;
    const highRdUpdate = applyDirectRating(highRdState, 9).next;

    expect(Math.abs(highRdUpdate.score - 5)).toBeGreaterThan(Math.abs(lowRdUpdate.score - 5));
  });

  test('uses the opponent RD when a direct score is the comparison anchor', () => {
    const a = emptyAttributeState();
    const uncertainAnchor = { ...emptyAttributeState(), score: 8, ratingDeviation: ATTRIBUTE_DIRECT_RATING_RD };
    const informativeAnchor = { ...uncertainAnchor, ratingDeviation: 0.5 };
    const informative = applyComparison(a, informativeAnchor, 'A_HIGHER').a.next;
    const uncertain = applyComparison(a, uncertainAnchor, 'A_HIGHER').a.next;

    expect(informative.score - a.score).toBeGreaterThan(uncertain.score - a.score);
  });

  test('predicts more information from similarly rated opponents', () => {
    const close = expectedComparisonVarianceReduction(5, 3, 5.2, 1);
    const far = expectedComparisonVarianceReduction(5, 3, 9, 1);

    expect(close).toBeGreaterThan(far);
  });

  test('predicts more variance reduction when the pair is uncertain', () => {
    const uncertain = expectedComparisonVarianceReduction(5, 3, 5, 3);
    const established = expectedComparisonVarianceReduction(5, 0.5, 5, 0.5);

    expect(uncertain).toBeGreaterThan(established);
  });

  test('keeps all online updates inside the 0 to 10 range', () => {
    let a = emptyAttributeState();
    let b = emptyAttributeState();
    for (let index = 0; index < 100; index += 1) {
      const update = applyComparison(a, b, 'A_HIGHER');
      a = update.a.next;
      b = update.b.next;
    }

    expect(a.score).toBeLessThanOrEqual(10);
    expect(b.score).toBeGreaterThanOrEqual(0);
  });

  test('replays historical events in created_at/id order regardless of input order', () => {
    const events = [
      { id: '2', createdAt: 20, kind: 'comparison' as const, attributeId: 'luck', subjectAId: 'a', subjectBId: 'b', result: 'A_HIGHER' as const },
      { id: '1', createdAt: 10, kind: 'rating' as const, attributeId: 'luck', subjectAId: 'a', value: 8 },
    ];
    const ordered = replayAttributeEvents(events);
    const reversed = replayAttributeEvents([...events].reverse());

    expect([...ordered.entries()]).toEqual([...reversed.entries()]);
  });

  test('replays compact responses after mapping a merged subject into its target', () => {
    const states = replayAttributeResponses([
      {
        responseId: '1', createdAt: 10, attributeId: 'luck', subjectAId: 'source', subjectBId: null,
        ratingA: 8, ratingB: null, comparison: null,
      },
      {
        responseId: '2', createdAt: 20, attributeId: 'luck', subjectAId: 'target', subjectBId: 'opponent',
        ratingA: 5, ratingB: 5, comparison: 'A_HIGHER',
      },
      {
        responseId: '3', createdAt: 30, attributeId: 'luck', subjectAId: 'source', subjectBId: 'opponent',
        ratingA: null, ratingB: null, comparison: 'A_HIGHER',
      },
    ], (subjectId) => subjectId === 'source' ? 'target' : subjectId);

    const target = states.get('target\u0000luck');
    const opponent = states.get('opponent\u0000luck');
    expect(target?.directSum).toBe(13);
    expect(target?.directCount).toBe(2);
    expect(target?.comparisonCount).toBe(2);
    expect(opponent?.comparisonCount).toBe(2);
    expect(target?.score).toBeGreaterThan(opponent?.score ?? 0);
  });
});
