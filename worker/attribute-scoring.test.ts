import { describe, expect, test } from 'vitest';
import {
  ATTRIBUTE_SCORE_MODEL_VERSION,
  ATTRIBUTE_DIRECT_RATING_RD,
  ATTRIBUTE_INITIAL_RD,
  applyComparison,
  applyDirectRating,
  emptyAttributeState,
  replayAttributeEvents,
  calculateAttributeScores,
} from './data/attributeScoring';

const scoreFor = (scores: ReturnType<typeof calculateAttributeScores>, subjectId: string) => {
  const score = scores.find((item) => item.subjectId === subjectId);
  if (!score) throw new Error(`Missing score for ${subjectId}`);
  return score;
};

describe('glicko-rd-v1', () => {
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
});
