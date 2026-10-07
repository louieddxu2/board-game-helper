import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePagedWorkspaceRows } from './usePagedWorkspaceRows';
import { useWorkspaceRowWindow } from './useWorkspaceRowWindow';
import { useWorkspaceTableWindow } from './useWorkspaceTableWindow';
import type { WorkspaceColumn, WorkspaceTable } from './types';

vi.mock('./usePagedWorkspaceRows', () => ({ usePagedWorkspaceRows: vi.fn() }));
vi.mock('./useWorkspaceRowWindow', () => ({ useWorkspaceRowWindow: vi.fn() }));

type RowWindow = ReturnType<typeof useWorkspaceRowWindow>;
type TableWindowOptions = Parameters<typeof useWorkspaceTableWindow>[0];

const column: WorkspaceColumn = { id: 'column-1', name: '欄位', inputType: 'text', options: [] };
const rowHeader: WorkspaceColumn = { id: 'row-header-table-1', name: '項目', inputType: 'text', options: [] };
const table: WorkspaceTable = {
  id: 'table-1', name: '測試表', rowHeaderName: rowHeader.name, rowHeader,
  columns: [column], rows: [], updatedAt: 1,
};

const makeRowWindow = (pendingScrollTop: number | undefined): RowWindow => ({
  virtual: true, first: 0, last: 0, visibleRows: [], topPadding: 0, bottomPadding: 0,
  measureRow: vi.fn(), offsetForRow: vi.fn(), pendingScrollTop, pendingStickToBottom: false,
  consumePendingScrollTop: vi.fn(),
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
    lastUserScrollAtRef: { current: -Infinity }, focusTarget: undefined, filteredRowIndexes: new Map(),
    searchFilterTargets: [], filterbarRef, setScrollPosition: vi.fn(), searchOpen: false,
  };
};

const configureWindows = (rowWindow: RowWindow) => {
  vi.mocked(useWorkspaceRowWindow).mockReturnValue(rowWindow);
  vi.mocked(usePagedWorkspaceRows).mockReturnValue({ ...makeRowWindow(undefined), visibleRows: [], indexes: new Map() });
};

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
