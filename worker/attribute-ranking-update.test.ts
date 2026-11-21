import { expect, test } from 'vitest';
import { applyCandidate } from '../scripts/ranking-research/order-candidates';
import { rankedAttributeSubjects } from './data/attributeRankedSubjects';
import { applyAttributeRanking } from './data/attributeRankingUpdate';
import { emptyAttributeState } from './data/attributeScoring';

test.each([2, 6, 18, 100])('the linear solver matches the dense research calculation for %i games', (size) => {
  for (const weight of [1, 1.5, 2]) {
    const states = Array.from({ length: size }, (_, i) => ({
      ...emptyAttributeState(), score: (i * 3217 % 1001) / 100, ratingDeviation: 0.25 + (i * 93 % 276) / 100,
    }));
    const expected = [...states];
    applyCandidate(expected, { order: states.map((_, i) => i), lowPole: false, weight },
      { method: 'bidirectional', slopeFactor: 1, evidenceScale: 2, softBounds: true });
    const actual = applyAttributeRanking(states, weight);
    for (const [i, state] of actual.entries()) {
      expect(state.score).toBeCloseTo(expected[i].score, 12);
      expect(state.ratingDeviation).toBeCloseTo(expected[i].ratingDeviation, 12);
      expect(state.comparisonCount).toBe(i === 0 || i === size - 1 ? 1 : 2);
      expect(state.evidenceCount).toBe(state.comparisonCount);
      expect(state.directCount).toBe(0);
    }
  }
});

test('a long ballot keeps every score and deviation finite', () => {
  const states = Array.from({ length: 10_000 }, () => emptyAttributeState());
  const updated = applyAttributeRanking(states, 2);
  expect(updated).toHaveLength(states.length);
  expect(updated.every(({ score, ratingDeviation }) =>
    score >= 0 && score <= 10 && ratingDeviation >= 0.25 && ratingDeviation <= 3)).toBe(true);
  expect(updated[0].score).toBeGreaterThan(updated.at(-1)!.score);
});

test('ranking order uses the canonical pole before collapsing mapped or retired subjects', () => {
  const ranked = { version: 1 as const, orderedSubjectIds: ['a', 'reference', 'b', 'c', 'merged', 'd'],
    referenceSubjectIds: ['reference'], subjectMappings: { merged: 'a' }, highPole: 'high' as const };
  const available = new Set(['a', 'b', 'd', 'reference']);
  expect(rankedAttributeSubjects(ranked, available)).toEqual(['a', 'b', 'd']);
  expect(rankedAttributeSubjects({ ...ranked, orderedSubjectIds: [...ranked.orderedSubjectIds].reverse(), highPole: 'low' }, available))
    .toEqual(['a', 'b', 'd']);
});
