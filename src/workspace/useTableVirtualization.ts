import { useMemo } from 'react';

export interface VirtualizationOptions {
  totalRows: number;
  totalCols: number;
  rowHeight?: number;
  colWidth?: number;
  scrollTop: number;
  scrollLeft: number;
  viewportHeight: number;
  viewportWidth: number;
  overscanRows?: number;
  overscanCols?: number;
}

export interface VirtualizationResult {
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
  topPadding: number;
  bottomPadding: number;
  leftPadding: number;
  rightPadding: number;
  isVirtualizing: boolean;
}

export function useTableVirtualization(options: VirtualizationOptions): VirtualizationResult {
  const {
    totalRows,
    totalCols,
    rowHeight = 36,
    colWidth = 140,
    scrollTop,
    scrollLeft,
    viewportHeight,
    viewportWidth,
    overscanRows = 4,
    overscanCols = 2,
  } = options;

  return useMemo(() => {
    // Only enable virtualization for large datasets to avoid unnecessary overhead for small tables
    const isVirtualizing = totalRows > 80 || totalCols > 25;

    if (!isVirtualizing || viewportHeight === 0 || viewportWidth === 0) {
      return {
        startRow: 0,
        endRow: Math.max(0, totalRows - 1),
        startCol: 0,
        endCol: Math.max(0, totalCols - 1),
        topPadding: 0,
        bottomPadding: 0,
        leftPadding: 0,
        rightPadding: 0,
        isVirtualizing: false,
      };
    }

    const calculatedStartRow = Math.floor(scrollTop / rowHeight);
    const calculatedEndRow = Math.ceil((scrollTop + viewportHeight) / rowHeight);
    const startRow = Math.max(0, calculatedStartRow - overscanRows);
    const endRow = Math.min(totalRows - 1, calculatedEndRow + overscanRows);

    const calculatedStartCol = Math.floor(scrollLeft / colWidth);
    const calculatedEndCol = Math.ceil((scrollLeft + viewportWidth) / colWidth);
    const startCol = Math.max(0, calculatedStartCol - overscanCols);
    const endCol = Math.min(totalCols - 1, calculatedEndCol + overscanCols);

    const topPadding = startRow * rowHeight;
    const bottomPadding = Math.max(0, (totalRows - 1 - endRow) * rowHeight);
    const leftPadding = startCol * colWidth;
    const rightPadding = Math.max(0, (totalCols - 1 - endCol) * colWidth);

    return {
      startRow,
      endRow,
      startCol,
      endCol,
      topPadding,
      bottomPadding,
      leftPadding,
      rightPadding,
      isVirtualizing: true,
    };
  }, [totalRows, totalCols, rowHeight, colWidth, scrollTop, scrollLeft, viewportHeight, viewportWidth, overscanRows, overscanCols]);
}
