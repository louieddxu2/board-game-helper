import { describe, expect, test } from 'vitest';
import {
  attributeQuestionCandidateWeight,
  chooseAttributeQuestionOpponent,
  type AttributeQuestionOpponentCandidate,
} from './data/attributeQuestionSelection';

const seed = { subjectId: 'seed', score: 5, ratingDeviation: 3 };
const candidate = (
  subjectId: string,
  score: number,
  ratingDeviation: number,
  comparisonCount = 0,
  isRandomCandidate = false,
): AttributeQuestionOpponentCandidate => ({ subjectId, score, ratingDeviation, comparisonCount, isRandomCandidate });

describe('attribute question opponent selection', () => {
  test('prefers a close, informative candidate over a distant candidate', () => {
    const close = candidate('close', 5.2, 1);
    const far = candidate('far', 9, 1);

    expect(attributeQuestionCandidateWeight(seed, close)).toBeGreaterThan(attributeQuestionCandidateWeight(seed, far));
  });

  test('penalizes a pair that has already been compared repeatedly', () => {
    const fresh = candidate('fresh', 5, 1, 0);
    const repeated = candidate('repeated', 5, 1, 9);

    expect(attributeQuestionCandidateWeight(seed, fresh)).toBeGreaterThan(attributeQuestionCandidateWeight(seed, repeated));
  });

  test('limits exploration to candidates supplied by the random index', () => {
    const near = candidate('near', 5, 1);
    const random = candidate('random', 8, 1, 0, true);

    expect(chooseAttributeQuestionOpponent(seed, [near, random], 0.1, 0)?.subjectId).toBe('random');
  });
});
