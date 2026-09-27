import { describe, expect, it } from 'vitest';
import { canInitiateDrawerSwipe, cellSweepGuardSize, getDrawerCloseSwipeOffset, getDrawerOpenSwipeOffset, getTableBoundarySearchEdge, isCellSweepDirection, isInCellSweepLane, shouldKeepDrawerOpen, shouldOpenDrawer } from './useTableGestures';

describe('cell sweep intent', () => {
  it('requires a deliberate three-to-one stroke instead of the ordinary vertical pan angle', () => {
    expect(isCellSweepDirection(6, 20, false)).toBe(true);
    expect(isCellSweepDirection(7, 20, false)).toBe(false);
    expect(isCellSweepDirection(0, 10, false)).toBe(false);
    expect(isCellSweepDirection(20, 6, true)).toBe(true);
    expect(isCellSweepDirection(20, 7, true)).toBe(false);
  });

  it('keeps a usable middle lane when a column is at the minimum width', () => {
    const rect = { left: 100, right: 140, top: 20, bottom: 80, width: 40, height: 60 } as DOMRect;
    expect(cellSweepGuardSize(rect.width)).toBe(4);
    expect(isInCellSweepLane(rect, 104, 40, false)).toBe(true);
    expect(isInCellSweepLane(rect, 103, 40, false)).toBe(false);
    expect(isInCellSweepLane(rect, 136, 40, false)).toBe(true);
    expect(isInCellSweepLane(rect, 137, 40, false)).toBe(false);
    expect(isInCellSweepLane(rect, 120, 28, true)).toBe(false);
    expect(isInCellSweepLane(rect, 120, 50, true)).toBe(true);
  });
});

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

  it('closes after a left drag passes thirty percent of the drawer width', () => {
    expect(shouldKeepDrawerOpen(253, 360)).toBe(true);
    expect(shouldKeepDrawerOpen(252, 360)).toBe(false);
    expect(shouldKeepDrawerOpen(0, 0)).toBe(false);
  });

  it('opens after a right drag passes thirty-five percent of the drawer width', () => {
    expect(shouldOpenDrawer(125, 360)).toBe(false);
    expect(shouldOpenDrawer(126, 360)).toBe(true);
    expect(shouldOpenDrawer(0, 0)).toBe(false);
  });

  it('arbitrates drawer swipe starting edge based on standalone mode', () => {
    // In standalone mode, edge-to-edge gestures are allowed
    expect(canInitiateDrawerSwipe(10, true)).toBe(true);
    expect(canInitiateDrawerSwipe(0, true)).toBe(true);
    // In browser tab mode, extreme edge (<=20px) is ceded to system swipe-to-navigate
    expect(canInitiateDrawerSwipe(15, false)).toBe(false);
    expect(canInitiateDrawerSwipe(20, false)).toBe(false);
    expect(canInitiateDrawerSwipe(25, false)).toBe(true);
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
