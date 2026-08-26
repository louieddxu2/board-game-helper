import { describe, expect, test } from 'vitest';
import { suggestedComparisonForRatings } from './attributeRatingSuggestion';

describe('suggestedComparisonForRatings', () => {
  test('waits until both games have explicit ratings', () => {
    expect(suggestedComparisonForRatings('8', '')).toBeNull();
    expect(suggestedComparisonForRatings('', '5')).toBeNull();
  });

  test('maps the two ratings to the consistent comparison', () => {
    expect(suggestedComparisonForRatings('8', '5')).toBe('A_HIGHER');
    expect(suggestedComparisonForRatings('3', '7')).toBe('B_HIGHER');
    expect(suggestedComparisonForRatings('6', '6')).toBe('SIMILAR');
  });
});
