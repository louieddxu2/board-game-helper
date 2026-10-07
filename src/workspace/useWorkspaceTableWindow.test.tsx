import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePagedWorkspaceRows } from './usePagedWorkspaceRows';
import { useWorkspaceRowWindow } from './useWorkspaceRowWindow';
import { useWorkspaceTableWindow } from './useWorkspaceTableWindow';
import type { WorkspaceTableWindow } from './rowPages';
import type { WorkspaceColumn, WorkspaceTable } from './types';

vi.mock('./usePagedWorkspaceRows', () => ({ usePagedWorkspaceRows: vi.fn() }));
vi.mock('./useWorkspaceRowWindow', () => ({ useWorkspaceRowWindow: vi.fn() }));

type RowWindow = ReturnType<typeof useWorkspaceRowWindow>;
type PagedRowWindow = ReturnType<typeof usePagedWorkspaceRows>;
type TableWindowOptions = Parameters<typeof useWorkspaceTableWindow>[0];

const column: WorkspaceColumn = { id: 'column-1', name: '欄位', inputType: 'text', options: [] };
const rowHeader: WorkspaceColumn = { id: 'row-header-table-1', name: '項目', inputType: 'text', options: [] };
const table: WorkspaceTable = {
  id: 'table-1', name: '測試表', rowHeaderName: rowHeader.name, rowHeader,
  columns: [column], rows: [
    { id: 'row-a', name: '甲', values: {} },
    { id: 'row-b', name: '乙', values: {} },
    { id: 'row-c', name: '丙', values: {} },
  ], updatedAt: 1,
};

const makeRowWindow = (pendingScrollTop: number | undefined, overrides: Partial<RowWindow> = {}): RowWindow => ({
  virtual: true, first: 0, last: 0, visibleRows: [], topPadding: 0, bottomPadding: 0,
  indexes: new Map(), measureRow: vi.fn(), offsetForRow: vi.fn(), pendingScrollTop, pendingStickToBottom: false,
  consumePendingScrollTop: vi.fn(),
  ...overrides,
});

const makePagedRowWindow = (overrides: Partial<PagedRowWindow> = {}): PagedRowWindow => ({
  ...makeRowWindow(undefined),
  visibleRows: [],
  ...overrides,
});

const makeOptions = (): TableWindowOptions => {
  const viewportRef = { current: document.createElement('div') } as React.RefObject<HTMLDivElement | null>;
  const filterbarRef = { current: document.createElement('div') } as React.RefObject<HTMLDivElement | null>;
  return {
    table, hasHiddenColumns: false, viewportWidth: 400, columnTextWidths: [100], textScale: 1,
    displayedColumns: [column], searchQuery: '', headerFilters: {},
    viewInteractionRef: { current: table.id }, restoredViewTableRef: { current: undefined }, viewportRef,
    activeWindow: undefined, filteredRows: [], virtualScrollTop: 0, viewportHeight: 600,
    captureWindowAnchorRef: { current: undefined }, mountedRef: { current: true }, dataRef: { current: undefined },
    setTableWindow: vi.fn(), reportReadError: vi.fn(), rowHeader, textWidthCache: { measure: () => 0 },
    setMountedTextWidths: vi.fn(), programmaticTableScrollRef: { current: false }, setVirtualScrollTop: vi.fn(),
    lastUserScrollAtRef: { current: -Infinity }, focusTarget: undefined,
    searchFilterTargets: [], filterbarRef, setScrollPosition: vi.fn(), searchOpen: false,
  };
};

const configureWindows = (rowWindow: RowWindow, pagedWindow = makePagedRowWindow()) => {
  vi.mocked(useWorkspaceRowWindow).mockReturnValue(rowWindow);
  vi.mocked(usePagedWorkspaceRows).mockReturnValue(pagedWindow);
};

const makePagedWindow = (): WorkspaceTableWindow => ({
  head: {
    format: 'row-pages-v1',
    definition: { id: table.id, name: table.name, rowHeaderName: table.rowHeaderName, rowHeader: table.rowHeader, columns: table.columns },
    rowCount: 1024,
    pageSize: 128,
    layoutRevision: 'layout-1',
    updatedAt: 1,
  },
  pages: [2, 3].map((index) => ({ tableId: table.id, index, layoutRevision: 'layout-1', rows: [] })),
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('workspace table scroll anchor application', () => {
  it('keeps a newer full-table DOM scroll instead of applying a stale measurement anchor', () => {
    const options = makeOptions();
    const viewport = options.viewportRef.current!;
    configureWindows(makeRowWindow(undefined));
    const view = renderHook(() => useWorkspaceTableWindow(options));

    options.viewInteractionRef.current = table.id;
    viewport.scrollTop = 5000;
    const staleWindow = makeRowWindow(0);
    configureWindows(staleWindow);
    view.rerender();

    expect(viewport.scrollTop).toBe(5000);
    expect(options.setVirtualScrollTop).toHaveBeenLastCalledWith(5000);
    expect(staleWindow.consumePendingScrollTop).not.toHaveBeenCalled();
  });

  it('applies a pending anchor when the full-table DOM still matches the virtual scroll position', () => {
    const options = makeOptions();
    const viewport = options.viewportRef.current!;
    configureWindows(makeRowWindow(undefined));
    const view = renderHook(() => useWorkspaceTableWindow(options));

    options.viewInteractionRef.current = table.id;
    viewport.scrollTop = 0;
    const pendingWindow = makeRowWindow(500);
    configureWindows(pendingWindow);
    view.rerender();

    expect(viewport.scrollTop).toBe(500);
    expect(options.setVirtualScrollTop).toHaveBeenLastCalledWith(500);
    expect(pendingWindow.consumePendingScrollTop).toHaveBeenCalledTimes(1);
  });
});

describe('workspace table row indexes', () => {
  it('keeps source row positions when a filtered order rerenders', () => {
    const options = makeOptions();
    options.filteredRows = table.rows;
    configureWindows(makeRowWindow(undefined));
    const view = renderHook(() => useWorkspaceTableWindow(options));
    const originalIndexes = view.result.current.tableRowIndexes;

    expect([...originalIndexes.entries()]).toEqual([['row-a', 0], ['row-b', 1], ['row-c', 2]]);
    expect(vi.mocked(useWorkspaceRowWindow).mock.calls.at(-1)?.[9]).toBe(originalIndexes);

    options.filteredRows = [table.rows[2], table.rows[0]];
    view.rerender();

    expect(view.result.current.tableRowIndexes).toBe(originalIndexes);
    expect([...view.result.current.tableRowIndexes.entries()]).toEqual([['row-a', 0], ['row-b', 1], ['row-c', 2]]);
  });
});

describe('workspace table focus scrolling', () => {
  it('uses the filtered full-table index and only scrolls when the row is outside the window', () => {
    const options = makeOptions();
    const viewport = options.viewportRef.current!;
    const offsetForRow = vi.fn((rowId: string) => rowId === 'row-outside' ? 700 : undefined);
    const rowWindow = makeRowWindow(undefined, {
      first: 2,
      last: 5,
      indexes: new Map([['row-visible', 3], ['row-outside', 7]]),
      offsetForRow,
    });
    configureWindows(rowWindow);
    const view = renderHook(() => useWorkspaceTableWindow(options));
    vi.clearAllMocks();

    options.focusTarget = { rowId: 'row-visible', columnId: column.id };
    view.rerender();
    expect(viewport.scrollTop).toBe(0);
    expect(options.setVirtualScrollTop).not.toHaveBeenCalled();

    options.focusTarget = { rowId: 'row-outside', columnId: column.id };
    view.rerender();
    expect(offsetForRow).toHaveBeenCalledWith('row-outside');
    expect(viewport.scrollTop).toBe(700);
    expect(options.setVirtualScrollTop).toHaveBeenLastCalledWith(700);
  });

  it('uses an absolute paged index for focus scrolling', () => {
    const options = makeOptions();
    options.activeWindow = makePagedWindow();
    const viewport = options.viewportRef.current!;
    const offsetForRow = vi.fn((rowId: string) => rowId === 'row-outside' ? 1234 : undefined);
    const pagedRowWindow = makePagedRowWindow({
      first: 256,
      last: 384,
      indexes: new Map([['row-visible', 300], ['row-outside', 900]]),
      offsetForRow,
    });
    configureWindows(makeRowWindow(undefined), pagedRowWindow);
    const view = renderHook(() => useWorkspaceTableWindow(options));
    vi.clearAllMocks();

    options.focusTarget = { rowId: 'row-visible', columnId: column.id };
    view.rerender();
    expect(viewport.scrollTop).toBe(0);
    expect(options.setVirtualScrollTop).not.toHaveBeenCalled();

    options.focusTarget = { rowId: 'row-outside', columnId: column.id };
    view.rerender();
    expect(offsetForRow).toHaveBeenCalledWith('row-outside');
    expect(viewport.scrollTop).toBe(1234);
    expect(options.setVirtualScrollTop).toHaveBeenLastCalledWith(1234);
  });
});
