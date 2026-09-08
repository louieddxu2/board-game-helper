import { expect, test } from 'vitest';
import { attributeDisplayEndpoints, chooseAttributeHighPole, canonicalAttributeAnswer, orientAttributeComparison, orientAttributeScore } from './attributeScale';

test('new bipolar questions choose either end with an equal boundary; retained and legacy directions stay stable', () => {
  const attribute = { id: 'win', key: 'win', name: '取勝方式', minValue: 0, maxValue: 10, sortOrder: 0, scaleType: 'bipolar' as const,
    endpoints: { low: { label: '得分取勝', question: '得分？' }, high: { label: '條件取勝', question: '條件？' } } };
  expect(chooseAttributeHighPole(attribute, undefined, () => 0.4999)).toBe('low');
  expect(chooseAttributeHighPole(attribute, undefined, () => 0.5)).toBe('high');
  expect(chooseAttributeHighPole(attribute, 'low', () => 1)).toBe('low');
  expect(chooseAttributeHighPole({ ...attribute, scaleType: undefined }, 'low')).toBe('high');
  expect(attributeDisplayEndpoints(attribute, 'low')).toEqual({ low: attribute.endpoints.high, high: attribute.endpoints.low });
  expect(attributeDisplayEndpoints(attribute)?.high).toBe(attribute.endpoints.high);
});

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
