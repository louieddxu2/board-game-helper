import { renderHook } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { useTableVirtualization } from './useTableVirtualization';

describe('useTableVirtualization', () => {
  test('disables virtualization for small tables', () => {
    const { result } = renderHook(() => useTableVirtualization({
      totalRows: 20,
      totalCols: 10,
      scrollTop: 0,
      scrollLeft: 0,
      viewportHeight: 600,
      viewportWidth: 800,
    }));

    expect(result.current.isVirtualizing).toBe(false);
    expect(result.current.startRow).toBe(0);
    expect(result.current.endRow).toBe(19);
  });

  test('calculates visible window and paddings for large tables', () => {
    const { result } = renderHook(() => useTableVirtualization({
      totalRows: 500,
      totalCols: 50,
      rowHeight: 40,
      colWidth: 100,
      scrollTop: 400,
      scrollLeft: 300,
      viewportHeight: 400,
      viewportWidth: 500,
      overscanRows: 2,
      overscanCols: 1,
    }));

    expect(result.current.isVirtualizing).toBe(true);
    // scrollTop 400 = row 10, viewport 400 = 10 rows. Buffer 2 => start 8, end 21
    expect(result.current.startRow).toBe(8);
    expect(result.current.endRow).toBe(22);
    expect(result.current.topPadding).toBe(320); // 8 * 40
  });
});
