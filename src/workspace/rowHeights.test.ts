import { describe, expect, it } from 'vitest';
import { SparseWorkspaceRowHeights } from './rowHeights';

describe('sparse workspace row heights', () => {
  it('keeps the first fractional measurement and ignores later subpixel noise', () => {
    const heights = new SparseWorkspaceRowHeights(2);

    expect(heights.measure(0, 36.1)).toBe(true);
    expect(heights.offset(1)).toBeCloseTo(36.1);
    expect(heights.measure(0, 36.2)).toBe(false);
    expect(heights.offset(1)).toBeCloseTo(36.1);
  });
});
