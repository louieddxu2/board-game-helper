import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { loadWorkspaceTableWindow } from './db';
import type { WorkspaceTableWindow } from './rowPages';
import { isPendingWorkspaceRow, workspaceRowPageAt, workspaceRowPageCount, workspaceRowPageIndex, workspaceRowPageMatchesHead, workspaceRowPageRevision } from './rowPages';
import type { WorkspaceCellValue, WorkspaceColumn, WorkspaceData, WorkspaceRow, WorkspaceTable } from './types';
import { usePagedWorkspaceRows } from './usePagedWorkspaceRows';
import { useWorkspaceRowWindow } from './useWorkspaceRowWindow';
import { loadWorkspaceTableViewState } from './viewState';
import { measureVisibleColumnWidths, preserveColumnScrollPosition } from './visibleColumnWidths';
import { calculateWorkspaceTableLayout, type HeaderFilterState, type HeaderFilterTarget } from './workspaceShared';

interface WorkspaceTableWindowOptions {
  table: WorkspaceTable | undefined;
  hasHiddenColumns: boolean;
  viewportWidth: number;
  columnTextWidths: number[];
  textScale: number;
  displayedColumns: WorkspaceColumn[];
  searchQuery: string;
  headerFilters: Record<string, HeaderFilterState>;
  viewInteractionRef: RefObject<string | undefined>;
  restoredViewTableRef: RefObject<string | undefined>;
  viewportRef: RefObject<HTMLDivElement | null>;
  activeWindow: WorkspaceTableWindow | undefined;
  filteredRows: WorkspaceRow[];
  virtualScrollTop: number;
  viewportHeight: number;
  captureWindowAnchorRef: RefObject<(() => { rowId: string; within: number; } | undefined) | undefined>;
  mountedRef: RefObject<boolean>;
  dataRef: RefObject<WorkspaceData | undefined>;
  setTableWindow: Dispatch<SetStateAction<WorkspaceTableWindow | undefined>>;
  reportReadError: (error: unknown) => void;
  rowHeader: WorkspaceColumn | undefined;
  textWidthCache: { measure(row: WorkspaceRow, column: WorkspaceColumn, value: WorkspaceCellValue, fontWeight?: 400 | 600): number; };
  setMountedTextWidths: Dispatch<SetStateAction<{ tableId: string; widths: number[]; } | undefined>>;
  programmaticTableScrollRef: RefObject<boolean>;
  setVirtualScrollTop: Dispatch<SetStateAction<number>>;
  lastUserScrollAtRef: RefObject<number>;
  focusTarget: { rowId: string; columnId: string; } | undefined;
  searchFilterTargets: HeaderFilterTarget[];
  filterbarRef: RefObject<HTMLDivElement | null>;
  setScrollPosition: Dispatch<SetStateAction<{ left: number; top: number; }>>;
  searchOpen: boolean;
}

export const useWorkspaceTableWindow = ({ table, hasHiddenColumns, viewportWidth, columnTextWidths, textScale, displayedColumns, searchQuery, headerFilters, viewInteractionRef, restoredViewTableRef, viewportRef, activeWindow, filteredRows, virtualScrollTop, viewportHeight, captureWindowAnchorRef, mountedRef, dataRef, setTableWindow, reportReadError, rowHeader, textWidthCache, setMountedTextWidths, programmaticTableScrollRef, setVirtualScrollTop, lastUserScrollAtRef, focusTarget, searchFilterTargets, filterbarRef, setScrollPosition, searchOpen }: WorkspaceTableWindowOptions) => {
  const layoutViewportWidth = !hasHiddenColumns ? viewportWidth : Math.max(0, viewportWidth - 44);

  const { columnWidths, tableWidth } = useMemo(() => calculateWorkspaceTableLayout(columnTextWidths, textScale, layoutViewportWidth), [columnTextWidths, layoutViewportWidth, textScale]);

  const renderedColumnWidths = useMemo(() => !hasHiddenColumns ? columnWidths : [...columnWidths, 44], [columnWidths, hasHiddenColumns]);

  const renderedTableWidth = useMemo(() => !hasHiddenColumns ? tableWidth : tableWidth + 44, [hasHiddenColumns, tableWidth]);

  const rowMeasurementKey = useMemo(() => `${table?.id ?? ''}:${textScale}:${renderedColumnWidths.join(',')}:${displayedColumns.map((column) => `${column.id}:${column.lineLimit ?? ''}:${column.overflowMode}`).join(',')}`,
  [displayedColumns, renderedColumnWidths, table?.id, textScale]);

  const rowWindowOrderKey = useMemo(() => `${searchQuery}\u0000${Object.entries(headerFilters)
    .filter(([key]) => key.startsWith('column:'))
    .map(([key, state]) => JSON.stringify([key, state.includedKeys, state.query, state.min, state.max, state.datePrecision, state.sort]))
    .join('\u0001')}`, [headerFilters, searchQuery]);

  const renderedRowScopeRef = useRef(table?.id);

  useLayoutEffect(() => { renderedRowScopeRef.current = table?.id; viewInteractionRef.current = undefined; restoredViewTableRef.current = undefined; }, [table?.id]);

  const rowWindowAtBottom = Boolean(renderedRowScopeRef.current === table?.id && viewportRef.current && viewportRef.current.scrollTop >= viewportRef.current.scrollHeight - viewportRef.current.clientHeight - 2);

  const pagedRowWindow = usePagedWorkspaceRows(activeWindow, rowMeasurementKey, virtualScrollTop, viewportHeight, rowWindowAtBottom);

  const tableRowIndexes = useMemo(() => activeWindow ? pagedRowWindow.indexes
    : new Map(table?.rows.map((row, index) => [row.id, index]) ?? []), [activeWindow, pagedRowWindow.indexes, table?.rows]);
  const fullRowWindow = useWorkspaceRowWindow(activeWindow ? [] : filteredRows, rowMeasurementKey, virtualScrollTop, viewportHeight, Boolean(table), table?.id ?? '', rowWindowOrderKey, rowWindowAtBottom, true, filteredRows === table?.rows ? tableRowIndexes : undefined);

  const rowWindow = activeWindow ? pagedRowWindow : fullRowWindow;

  const pageDirection = useRef({ top: virtualScrollTop, direction: 1 });

  const pageRequest = useRef<{ key: string; promise: ReturnType<typeof loadWorkspaceTableWindow> } | undefined>(undefined);

  captureWindowAnchorRef.current = () => {
    if (!activeWindow) return undefined;
    const row = rowWindow.visibleRows.find(row => !isPendingWorkspaceRow(row) && (rowWindow.offsetForRow(row.id) ?? Infinity) >= virtualScrollTop - 36)
      ?? rowWindow.visibleRows.find(row => !isPendingWorkspaceRow(row));
    const offset = row && rowWindow.offsetForRow(row.id);
    return row && offset !== undefined ? { rowId: row.id, within: virtualScrollTop - offset } : undefined;
  };

  useEffect(() => {
    if (!activeWindow || !activeWindow.head.rowCount) return;
    const { head } = activeWindow;
    const first = workspaceRowPageAt(head, rowWindow.first);
    const last = workspaceRowPageAt(head, Math.max(rowWindow.first, rowWindow.last - 1));
    if (virtualScrollTop !== pageDirection.current.top) pageDirection.current.direction = virtualScrollTop < pageDirection.current.top ? -1 : 1;
    pageDirection.current.top = virtualScrollTop;
    const next = pageDirection.current.direction > 0 ? Math.min(workspaceRowPageCount(head) - 1, last + 1) : Math.max(0, first - 1);
    const needed = Array.from({ length: last - first + 1 }, (_, offset) => first + offset);
    if (!needed.includes(next)) needed.push(next);
    const cached = new Map(activeWindow.pages.map(page => [workspaceRowPageIndex(head, page), page] as const).filter(([index, page]) => workspaceRowPageMatchesHead(head, index, page)));
    const missing = needed.filter(index => !cached.has(index));
    if (!missing.length) return;
    const key = `${head.definition.id}:${head.layoutRevision}:${head.changeRevision ?? ''}:${missing.map(index => `${index}:${workspaceRowPageRevision(head, index)}`).join(',')}`;
    const request = pageRequest.current?.key === key ? pageRequest.current.promise : loadWorkspaceTableWindow(head.definition.id, missing);
    pageRequest.current = { key, promise: request };
    let cancelled = false;
    void request.then(loaded => {
      if (cancelled || !mountedRef.current || !loaded || loaded.head.layoutRevision !== head.layoutRevision
        || loaded.head.changeRevision !== head.changeRevision
        || missing.some(index => workspaceRowPageRevision(loaded.head, index) !== workspaceRowPageRevision(head, index))) return;
      const activeId = dataRef.current?.nodes.find(node => node.id === dataRef.current?.activeNodeId)?.tableId;
      if (activeId !== head.definition.id || dataRef.current?.tables.some(table => table.id === activeId)) return;
      loaded.pages.forEach(page => cached.set(workspaceRowPageIndex(loaded.head, page), page));
      const pages = [...cached].filter(([index, page]) => workspaceRowPageMatchesHead(loaded.head, index, page))
        .sort(([a], [b]) => Math.abs(a - first) - Math.abs(b - first)).slice(0, Math.max(4, needed.length)).map(([, page]) => page);
      const nextWindow = { head: loaded.head, pages };
      setTableWindow(nextWindow);
    }).catch(error => { if (!cancelled) reportReadError(error); }).finally(() => {
      if (pageRequest.current?.promise === request) pageRequest.current = undefined;
    });
    return () => { cancelled = true; };
  }, [activeWindow, rowWindow.first, rowWindow.last, reportReadError, virtualScrollTop]);

  useLayoutEffect(() => {
    if (!table || !rowHeader) return;
    const widths = measureVisibleColumnWidths(rowWindow.visibleRows, rowHeader, displayedColumns, textWidthCache);
    setMountedTextWidths(previous => previous?.tableId === table.id && previous.widths.length === widths.length && previous.widths.every((width, index) => width === widths[index]) ? previous : { tableId: table.id, widths });
  }, [table?.id, rowHeader, displayedColumns, rowWindow.visibleRows, textWidthCache]);

  const horizontalLayoutRef = useRef<{ tableId?: string; widths: number[]; textWidths: number[]; left: number }>({ widths: [], textWidths: [], left: 0 });

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const previous = horizontalLayoutRef.current;
    const changed = previous.textWidths.length === columnTextWidths.length && previous.textWidths.some((width, index) => width !== columnTextWidths[index]);
    if (viewport && previous.tableId === table?.id && previous.widths.length && changed) {
      const left = preserveColumnScrollPosition(previous.widths, renderedColumnWidths, previous.left);
      if (Math.abs(viewport.scrollLeft - left) > 0.5) {
        programmaticTableScrollRef.current = true;
        viewport.scrollLeft = left;
        requestAnimationFrame(() => { programmaticTableScrollRef.current = false; });
      }
    }
    horizontalLayoutRef.current = { tableId: table?.id, widths: renderedColumnWidths, textWidths: columnTextWidths, left: viewport?.scrollLeft ?? 0 };
  }, [columnTextWidths, renderedColumnWidths, table?.id]);

  const appliedRowWindowOrderKeyRef = useRef({ scope: table?.id ?? '', key: rowWindowOrderKey });

  useLayoutEffect(() => {
    const scope = table?.id ?? '';
    if (appliedRowWindowOrderKeyRef.current.scope !== scope) {
      appliedRowWindowOrderKeyRef.current = { scope, key: rowWindowOrderKey };
      return;
    }
    if (appliedRowWindowOrderKeyRef.current.key === rowWindowOrderKey) return;
    appliedRowWindowOrderKeyRef.current = { scope, key: rowWindowOrderKey };
    const viewport = viewportRef.current;
    if (!viewport) return;
    programmaticTableScrollRef.current = true;
    viewport.scrollTop = 0;
    setVirtualScrollTop(0);
    window.requestAnimationFrame(() => { programmaticTableScrollRef.current = false; });
  }, [rowWindowOrderKey, table?.id]);

  useLayoutEffect(() => {
    if (!rowWindow.virtual || typeof ResizeObserver === 'undefined') return;
    const elements = viewportRef.current?.querySelectorAll<HTMLTableRowElement>('tbody tr[data-virtual-row-id]');
    if (!elements?.length) return;
    const update = () => elements.forEach((element) => rowWindow.measureRow(element.dataset.virtualRowId!, element.getBoundingClientRect().height));
    update();
    const observer = new ResizeObserver(update);
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [rowMeasurementKey, rowWindow.first, rowWindow.last, rowWindow.measureRow, rowWindow.virtual, rowWindow.visibleRows]);

  const rowAnchorRetryRef = useRef<number | undefined>(undefined);

  const [rowAnchorRetry, setRowAnchorRetry] = useState(0);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const pendingTop = rowWindow.pendingScrollTop;
    if (pendingTop === undefined || !viewport) return;
    if (activeWindow && restoredViewTableRef.current !== table?.id) return;
    // The native scroll event may arrive after a measurement frame. Respect a new
    // DOM position before applying the anchor captured for the previous window.
    if (Math.abs(viewport.scrollTop - virtualScrollTop) >= 1) {
      lastUserScrollAtRef.current = performance.now();
      setVirtualScrollTop(viewport.scrollTop);
      return;
    }
    const targetTop = rowWindow.pendingStickToBottom
      ? Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      : pendingTop;
    const waitForUserScroll = Math.max(0, 120 - (performance.now() - lastUserScrollAtRef.current));
    if (waitForUserScroll > 0) {
      if (rowAnchorRetryRef.current !== undefined) window.clearTimeout(rowAnchorRetryRef.current);
      rowAnchorRetryRef.current = window.setTimeout(() => {
        rowAnchorRetryRef.current = undefined;
        setRowAnchorRetry((value) => value + 1);
      }, waitForUserScroll);
      return;
    }
    rowWindow.consumePendingScrollTop();
    if (Math.abs(viewport.scrollTop - targetTop) < 0.5) return;
    programmaticTableScrollRef.current = true;
    viewport.scrollTop = targetTop;
    setVirtualScrollTop(viewport.scrollTop);
    window.requestAnimationFrame(() => { programmaticTableScrollRef.current = false; });
  }, [activeWindow, virtualScrollTop, rowAnchorRetry, rowWindow.consumePendingScrollTop, rowWindow.pendingScrollTop, rowWindow.pendingStickToBottom]);

  useEffect(() => () => {
    if (rowAnchorRetryRef.current !== undefined) window.clearTimeout(rowAnchorRetryRef.current);
  }, []);

  const focusScrollHandledRef = useRef('');

  useEffect(() => {
    const focusKey = `${table?.id ?? ''}:${focusTarget?.rowId ?? ''}`;
    if (focusKey === focusScrollHandledRef.current) return;
    focusScrollHandledRef.current = focusKey;
    if (!focusTarget) return;
    const index = rowWindow.indexes.get(focusTarget.rowId) ?? -1;
    if (rowWindow.virtual && (index < rowWindow.first || index >= rowWindow.last)) {
      const offset = rowWindow.offsetForRow(focusTarget.rowId);
      const viewport = viewportRef.current;
      if (offset !== undefined && viewport) {
        viewport.scrollTop = offset;
        setVirtualScrollTop(viewport.scrollTop);
      }
    }
  }, [focusTarget, rowWindow, table?.id]);

  const filterbarSlots = useMemo<Array<HeaderFilterTarget | undefined>>(() => {
    if (!table) return [];
    return hasHiddenColumns ? [...searchFilterTargets, undefined] : searchFilterTargets;
  }, [hasHiddenColumns, searchFilterTargets, table?.id]);

  const filterbarTrackStyle = useMemo(() => ({
    gridTemplateColumns: renderedColumnWidths.map((width) => `${width}px`).join(' '), width: `${renderedTableWidth}px`,
  }), [renderedColumnWidths, renderedTableWidth]);

  const syncFilterbarScroll = useCallback((source: HTMLDivElement) => {
    const viewport = viewportRef.current;
    const filterbar = filterbarRef.current;
    if (!viewport || !filterbar) return;
    if (source === viewport) {
      if (Math.abs(filterbar.scrollLeft - viewport.scrollLeft) >= 0.5) filterbar.scrollLeft = viewport.scrollLeft;
    } else if (Math.abs(viewport.scrollLeft - filterbar.scrollLeft) >= 0.5) {
      viewport.scrollLeft = filterbar.scrollLeft;
    }
  }, []);

  const scrollSaveTimerRef = useRef<number | undefined>(undefined);

  const virtualScrollFrameRef = useRef<number | undefined>(undefined);

  const handleTableViewportScroll = useCallback((source: HTMLDivElement) => {
    horizontalLayoutRef.current.left = source.scrollLeft;
    syncFilterbarScroll(source);
    if (!programmaticTableScrollRef.current) lastUserScrollAtRef.current = performance.now();
    if (virtualScrollFrameRef.current === undefined) virtualScrollFrameRef.current = window.requestAnimationFrame(() => {
      virtualScrollFrameRef.current = undefined;
      setVirtualScrollTop(source.scrollTop);
    });
    if (scrollSaveTimerRef.current !== undefined) window.clearTimeout(scrollSaveTimerRef.current);
    scrollSaveTimerRef.current = window.setTimeout(() => {
      scrollSaveTimerRef.current = undefined;
      setScrollPosition({ left: source.scrollLeft, top: source.scrollTop });
    }, 120);
  }, [setScrollPosition, syncFilterbarScroll]);

  useEffect(() => () => {
    if (scrollSaveTimerRef.current !== undefined) window.clearTimeout(scrollSaveTimerRef.current);
    if (virtualScrollFrameRef.current !== undefined) window.cancelAnimationFrame(virtualScrollFrameRef.current);
  }, []);

  useLayoutEffect(() => {
    if (!table?.id) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    // Restore before paint; a deep saved window must already be in the viewport.
    if (viewInteractionRef.current !== table.id) {
      const saved = loadWorkspaceTableViewState(table.id);
      programmaticTableScrollRef.current = true;
      viewport.scrollLeft = saved.scrollLeft; viewport.scrollTop = saved.scrollTop;
      setVirtualScrollTop(viewport.scrollTop);
      requestAnimationFrame(() => { programmaticTableScrollRef.current = false; });
    }
    restoredViewTableRef.current = table.id;
    syncFilterbarScroll(viewport);
    setRowAnchorRetry(value => value + 1);
  }, [syncFilterbarScroll, table?.id]);

  useEffect(() => {
    if (!searchOpen || !filterbarRef.current || !viewportRef.current) return;
    filterbarRef.current.scrollLeft = viewportRef.current.scrollLeft;
  }, [renderedTableWidth, searchOpen]);

  return { handleTableViewportScroll, renderedTableWidth, renderedColumnWidths, rowWindow, tableRowIndexes, syncFilterbarScroll, filterbarTrackStyle, filterbarSlots };
};
