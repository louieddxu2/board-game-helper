import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SparseWorkspaceRowHeights } from './usePagedWorkspaceRows';
import { usePagedWorkspaceRows } from './usePagedWorkspaceRows';
import type { WorkspaceTableWindow } from './rowPages';

const pageRows = (page: number, count: number) => Array.from({ length: count }, (_, slot) => ({
  id: `row-${page * 128 + slot}`, name: `物件 ${page * 128 + slot}`, values: {},
}));

const windowOf = (rowCount: number, pageRevisions = Array.from({ length: Math.ceil(rowCount / 128) }, () => 'layout-1')): WorkspaceTableWindow => ({
  head: {
    format: 'row-pages-v1', pageSize: 128, rowCount, layoutRevision: 'layout-1', pageRevisions,
    updatedAt: 1, definition: { id: 'table-1', name: '表格', rowHeaderName: '物件', columns: [] },
  },
  pages: Array.from({ length: Math.ceil(rowCount / 128) }, (_, page) => ({
    tableId: 'table-1', index: page, layoutRevision: pageRevisions[page], rows: pageRows(page, Math.min(128, rowCount - page * 128)),
  })),
});

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

describe('paged row window validation', () => {
  it('filters a page whose content version no longer matches the head', () => {
    const window = windowOf(256, ['layout-1', 'layout-2']);
    window.pages[1].layoutRevision = 'stale-layout';
    const view = renderHook(() => usePagedWorkspaceRows(window, 'measure-1', 0, 600, false));

    expect(view.result.current.indexes.has('row-0')).toBe(true);
    expect(view.result.current.indexes.has('row-128')).toBe(false);
    expect(view.result.current.visibleRows.some(row => row.id === 'row-128')).toBe(false);
  });

  it('resets sparse height state when row count changes under the same layout revision', () => {
    const initial = windowOf(100);
    const view = renderHook(({ current }) => usePagedWorkspaceRows(current, 'measure-1', 0, 600, false), { initialProps: { current: initial } });
    expect(view.result.current.indexes.size).toBe(100);
    const expanded = windowOf(200);
    view.rerender({ current: expanded });

    expect(view.result.current.indexes.size).toBe(200);
    expect(view.result.current.indexes.get('row-199')).toBe(199);
    expect(view.result.current.bottomPadding).toBeGreaterThan(0);
  });
});
