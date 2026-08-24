import { describe, expect, test } from 'vitest';
import {
  ATTRIBUTE_SCORE_MODEL_VERSION,
  applyComparison,
  applyDirectRating,
  emptyAttributeState,
  kFactorForEvidenceCount,
  calculateAttributeScores,
} from './data/attributeScoring';

const scoreFor = (scores: ReturnType<typeof calculateAttributeScores>, subjectId: string) => {
  const score = scores.find((item) => item.subjectId === subjectId);
  if (!score) throw new Error(`Missing score for ${subjectId}`);
  return score;
};

describe('bounded-k-elo-v1', () => {
  test('initializes the first direct score at the submitted absolute value', () => {
    const result = applyDirectRating(emptyAttributeState(), 8);

    expect(result.next).toMatchObject({ score: 8, directSum: 8, directCount: 1, evidenceCount: 1 });
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

  test('reduces K after twenty pieces of evidence', () => {
    expect(kFactorForEvidenceCount(0)).toBe(1);
    expect(kFactorForEvidenceCount(19)).toBe(0.12);
    expect(kFactorForEvidenceCount(20)).toBe(0.05);
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
});
