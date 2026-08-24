import { describe, expect, test } from 'vitest';
import { ATTRIBUTE_SCORE_MODEL_VERSION, calculateAttributeScores } from './data/attributeScoring';

const scoreFor = (scores: ReturnType<typeof calculateAttributeScores>, subjectId: string) => {
  const score = scores.find((item) => item.subjectId === subjectId);
  if (!score) throw new Error(`Missing score for ${subjectId}`);
  return score;
};

describe('comparison-blend-v1', () => {
  test('blends direct ratings with a conservative pairwise signal', () => {
    const scores = calculateAttributeScores(
      [{ subjectId: 'a', attributeId: 'luck', average: 8, count: 1 }],
      [{ subjectAId: 'a', subjectBId: 'b', attributeId: 'luck', result: 'A_HIGHER' }],
    );

    expect(scoreFor(scores, 'a')).toMatchObject({
      score: 7.25,
      directAverage: 8,
      directCount: 1,
      comparisonCount: 1,
      decisiveComparisonCount: 1,
      comparisonScore: 6,
      modelVersion: ATTRIBUTE_SCORE_MODEL_VERSION,
    });
    expect(scoreFor(scores, 'b')).toMatchObject({ score: 4, comparisonScore: 4, directCount: 0 });
  });

  test('treats the fifth decisive win as the saturation point', () => {
    const scores = calculateAttributeScores([], Array.from({ length: 5 }, () => ({
      subjectAId: 'a', subjectBId: 'b', attributeId: 'planning' as const, result: 'A_HIGHER' as const,
    })));

    expect(scoreFor(scores, 'a')).toMatchObject({ score: 10, comparisonScore: 10, decisiveComparisonCount: 5 });
    expect(scoreFor(scores, 'b')).toMatchObject({ score: 0, comparisonScore: 0, decisiveComparisonCount: 5 });
  });

  test('does not invent an absolute shift from similar-only comparisons', () => {
    const scores = calculateAttributeScores(
      [{ subjectId: 'a', attributeId: 'luck', average: 8, count: 2 }],
      [{ subjectAId: 'a', subjectBId: 'b', attributeId: 'luck', result: 'SIMILAR' }],
    );

    expect(scoreFor(scores, 'a')).toMatchObject({ score: 8, comparisonCount: 1, decisiveComparisonCount: 0 });
    expect(scores.find((item) => item.subjectId === 'b')).toBeUndefined();
  });
});
