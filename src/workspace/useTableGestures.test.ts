import { describe, expect, it } from 'vitest';
import { getDrawerCloseSwipeOffset, getDrawerOpenSwipeOffset, getTableBoundarySearchEdge, shouldKeepDrawerOpen } from './useTableGestures';

describe('drawer swipe geometry', () => {
  it('follows the finger while opening from the table', () => {
    expect(getDrawerOpenSwipeOffset(72, 360)).toBe(72);
    expect(getDrawerOpenSwipeOffset(-20, 360)).toBe(0);
    expect(getDrawerOpenSwipeOffset(420, 360)).toBe(360);
  });

  it('follows the finger while closing from the drawer', () => {
    expect(getDrawerCloseSwipeOffset(-90, 360)).toBe(270);
    expect(getDrawerCloseSwipeOffset(-420, 360)).toBe(0);
    expect(getDrawerCloseSwipeOffset(20, 360)).toBe(360);
  });

  it('keeps the drawer open only after the drag passes the settle threshold', () => {
    expect(shouldKeepDrawerOpen(125, 360)).toBe(false);
    expect(shouldKeepDrawerOpen(126, 360)).toBe(true);
    expect(shouldKeepDrawerOpen(0, 0)).toBe(false);
  });
});

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
