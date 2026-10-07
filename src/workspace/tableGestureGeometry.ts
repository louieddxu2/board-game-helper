import { TablePanAxis } from './useMomentumScroll';

export const TABLE_BOUNDARY_SEARCH_HOLD_MS = 500;

export const TABLE_BOUNDARY_SCROLL_TOLERANCE = 2;

export const CELL_SWEEP_INTENT_DISTANCE = 20;

export const CELL_SWEEP_DIRECTION_RATIO = 3;

export const CELL_SWEEP_CROSS_AXIS_DISTANCE = 10;

export const cellSweepGuardSize = (extent: number) => Math.max(0, Math.min(12, extent * 0.15, (extent - 32) / 2));

export const isInCellSweepLane = (rect: DOMRect, x: number, y: number, transposed: boolean) => {
  const extent = transposed ? rect.height : rect.width;
  if (extent < 32) return false;
  const inset = cellSweepGuardSize(extent);
  const coordinate = transposed ? y : x;
  const start = transposed ? rect.top : rect.left;
  return coordinate >= start + inset && coordinate <= start + extent - inset;
};

export const isCellSweepDirection = (deltaX: number, deltaY: number, transposed: boolean) => {
  const primary = Math.abs(transposed ? deltaX : deltaY);
  const cross = Math.abs(transposed ? deltaY : deltaX);
  return primary >= CELL_SWEEP_INTENT_DISTANCE && primary >= CELL_SWEEP_DIRECTION_RATIO * cross;
};

export const getTableBoundarySearchEdge = (startScrollTop: number, targetScrollTop: number, maxTop: number, deltaY: number, axis?: TablePanAxis): 'top' | 'bottom' | undefined => {
  if (axis !== 'y' || maxTop <= 0) return undefined;
  if (startScrollTop <= TABLE_BOUNDARY_SCROLL_TOLERANCE && targetScrollTop < 0 && deltaY > 0) return 'top';
  if (startScrollTop >= maxTop - TABLE_BOUNDARY_SCROLL_TOLERANCE && targetScrollTop > maxTop && deltaY < 0) return 'bottom';
  return undefined;
};

export const clampDrawerOffset = (offset: number, width: number) => Math.max(0, Math.min(Math.max(0, width), offset));

export const getDrawerOpenSwipeOffset = (deltaX: number, width: number) => clampDrawerOffset(deltaX, width);

export const getDrawerCloseSwipeOffset = (deltaX: number, width: number) => clampDrawerOffset(width + deltaX, width);

export const shouldOpenDrawer = (offset: number, width: number) => width > 0 && offset >= width * 0.35;

export const shouldKeepDrawerOpen = (offset: number, width: number) => width > 0 && offset / width > 0.7;

export const isWorkspaceStandaloneMode = () => typeof document !== 'undefined' && document.documentElement.getAttribute('data-standalone') === 'true';

export const canInitiateDrawerSwipe = (clientX: number, isStandalone = isWorkspaceStandaloneMode()) => isStandalone || clientX > 20;
