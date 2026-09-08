import { expect, test } from 'vitest';
import { canonicalAttributeAnswer, orientAttributeComparison, orientAttributeScore } from './attributeScale';

test.each([0, 2, 5, 8, 10])('score %s survives a display/canonical round trip', (score) => {
  expect(orientAttributeScore(orientAttributeScore(score, 'low'), 'low')).toBe(score);
  expect(orientAttributeScore(score)).toBe(score);
});

test('comparison reverses only decisive answers', () => {
  expect(orientAttributeComparison('A_HIGHER', 'low')).toBe('B_HIGHER');
  expect(orientAttributeComparison('B_HIGHER', 'low')).toBe('A_HIGHER');
  expect(orientAttributeComparison('SIMILAR', 'low')).toBe('SIMILAR');
  expect(orientAttributeComparison(null, 'low')).toBeNull();
});

test('queued display answers survive serialization and repeated conversion without mutation', () => {
  const queued = { highPole: 'low' as const, ratingA: 0, ratingB: null, comparison: 'A_HIGHER' as const };
  const retried = JSON.parse(JSON.stringify(queued));
  expect(canonicalAttributeAnswer(retried)).toEqual({ highPole: 'low', ratingA: 10, ratingB: null, comparison: 'B_HIGHER' });
  expect(canonicalAttributeAnswer(retried)).toEqual(canonicalAttributeAnswer(queued));
  expect(retried).toEqual(queued);
  expect(canonicalAttributeAnswer({ ratingA: 8 }).ratingA).toBe(8);
});
