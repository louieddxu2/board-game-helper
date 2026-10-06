import { describe, expect, it } from 'vitest';
import { SparseWorkspaceRowHeights } from './usePagedWorkspaceRows';

describe('sparse row height estimates', () => {
  it('locates deep rows and retains measured offsets without allocating every row', () => {
    const heights = new SparseWorkspaceRowHeights(10000);
    expect(heights.offset(10000)).toBe(360000);
    expect(heights.indexAt(9000 * 36 + 8)).toBe(9000);
    heights.measure(0, 72); heights.measure(128, 90); heights.measure(9000, 108);
    expect(heights.offset(9000)).toBe(9000 * 36 + 90);
    expect(heights.indexAt(heights.offset(9000) + 107)).toBe(9000);
    expect(heights.indexAt(heights.offset(9001))).toBe(9001);
    heights.measure(128, 36);
    expect(heights.offset(10000)).toBe(360000 + 108);
    expect(heights.measure(128, 0)).toBe(false);
    expect(heights.measure(10000, 72)).toBe(false);
  });
});
