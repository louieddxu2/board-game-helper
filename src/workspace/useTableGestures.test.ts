import { describe, expect, it } from 'vitest';
import { getTableBoundarySearchEdge } from './useTableGestures';

describe('table boundary search gesture', () => {
  it('recognizes a sustained pull beyond the top edge', () => {
    expect(getTableBoundarySearchEdge(0, -24, 240, 24, 'y')).toBe('top');
  });

  it('recognizes a sustained pull beyond the bottom edge', () => {
    expect(getTableBoundarySearchEdge(240, 264, 240, -24, 'y')).toBe('bottom');
    expect(getTableBoundarySearchEdge(238, 264, 240, -26, 'y')).toBe('bottom');
  });

  it('does not recognize a boundary gesture from the wrong axis or an interior scroll', () => {
    expect(getTableBoundarySearchEdge(12, -24, 240, 36, 'y')).toBeUndefined();
    expect(getTableBoundarySearchEdge(0, -24, 240, 24, 'x')).toBeUndefined();
    expect(getTableBoundarySearchEdge(0, -24, 0, 24, 'y')).toBeUndefined();
  });
});
