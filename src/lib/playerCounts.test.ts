import { describe, expect, test } from 'vitest';
import { formatPlayerCounts, normalizePlayerCounts } from './playerCounts';

describe('player counts', () => {
  test('formats continuous and discrete counts', () => {
    expect(formatPlayerCounts([3, 4])).toBe('3~4人');
    expect(formatPlayerCounts([2, 4])).toBe('2人、4人');
    expect(formatPlayerCounts([1, 3, 4])).toBe('1人、3~4人');
  });

  test('normalizes duplicates, ordering, and unsupported values', () => {
    expect(normalizePlayerCounts([4, 2, 4, 0, 9, 3.5])).toEqual([2, 4]);
  });
});
