import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStableCallback } from '../hooks/useStableCallback';
import { loadWorkspaceTableWindow } from './db';
import { displayWorkspaceColumnValue, getRowHeaderColumn, parseMultiSelectValues } from './model';
import { workspaceWindowDisplayTable } from './rowPages';
import { getWorkspaceRow } from './rowIndexes';
import type { WorkspaceColumn, WorkspaceNode, WorkspaceRow } from './types';
import { useReadyWorkspaceActions } from './useReadyWorkspaceActions';
import { useTableGestures } from './useTableGestures';
import { useWorkspaceActions } from './useWorkspaceActions';
import { useWorkspaceBackupStatus } from './useWorkspaceBackupStatus';
import { useWorkspaceVirtualKeyboardOpen } from './useWorkspaceBrowserBack';
import { useWorkspaceBulkSelection } from './useWorkspaceBulkSelection';
import { useWorkspaceClipboard } from './useWorkspaceClipboard';
import { useWorkspaceCellFocus } from './useWorkspaceCellFocus';
import { useWorkspaceColumnSizing } from './useWorkspaceColumnSizing';
import { useWorkspaceDialogs } from './useWorkspaceDialogs';
import { useWorkspaceDrawer } from './useWorkspaceDrawer';
import { useWorkspaceFilter } from './useWorkspaceFilter';
import { useWorkspaceHiddenFields } from './useWorkspaceHiddenFields';
import { useWorkspaceHistory } from './useWorkspaceHistory';
import { useWorkspaceLoading } from './useWorkspaceLoading';
import { useWorkspaceModalNavigation } from './useWorkspaceModalNavigation';
import { useWorkspaceStorage } from './useWorkspaceStorage';
import { useWorkspaceTableView } from './useWorkspaceTableView';
import { useWorkspaceTableWindow } from './useWorkspaceTableWindow';
import { loadWorkspaceTableViewState } from './viewState';
import { type WorkspaceBottomNavigationItem } from './WorkspaceBottomNavigation';
import { expandedFoldersStorageKey, findTableNode, hasWorkspaceFilterCriteria, updateTable, useWorkspaceInputModality, type HeaderFilterTarget } from './workspaceShared';

const workspaceCellKey = (rowId: string, columnId: string) => `${rowId}:${columnId}`;
export const useWorkspacePage = () => {
  const inputModality = useWorkspaceInputModality();
  const captureWindowAnchorRef = useRef<(() => { rowId: string; within: number } | undefined) | undefined>(undefined);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editBarOpen, setEditBarOpen] = useState(false);
  const [quickActionsExpanded, setQuickActionsExpanded] = useState(false);
  const [tableActionsOpen, setTableActionsOpen] = useState(false);
  const [notice, setNotice] = useState('');

  const [virtualScrollTop, setVirtualScrollTop] = useState(0);
  const virtualKeyboardOpen = useWorkspaceVirtualKeyboardOpen();

  const viewportRef = useRef<HTMLDivElement>(null);
  const filterbarRef = useRef<HTMLDivElement>(null);
  const workspacePageRef = useRef<HTMLElement>(null);

  const pendingOpenNodeIdRef = useRef<string | undefined>(undefined);
  const lastUserScrollAtRef = useRef(0);
  const programmaticTableScrollRef = useRef(false);
  const viewInteractionRef = useRef<string | undefined>(undefined);
  const restoredViewTableRef = useRef<string | undefined>(undefined);

  const storage = useWorkspaceStorage(setNotice);
  const { data, dataRef, setTableWindow, progressiveRef, mountedRef, allTablesReady, allTablesReadyRef, storageVersion, remainingLoadError, storageConflict, setStorageConflict, loadError, storageUpgradeBlocked, saveState, lastSavedAt, getDynamicOptions, commit } = storage;
  const dialogs = useWorkspaceDialogs(data?.activeNodeId);
  const { editing, focusTarget, selectionEditor, configuring, hiddenFieldsEditor } = dialogs.state;
  const drawer = useWorkspaceDrawer({ allTablesReadyRef, progressiveRef, pendingOpenNodeIdRef });
  const { drawerOpen, setDrawerOpen, closeDrawer, updateDrawerFromOpenSwipe, settleDrawerFromOpenSwipe } = drawer;
  const { fullTable, activeWindow, reportReadError, hydrateWorkspace, readiness, withActiveTable } = useWorkspaceLoading(storage, {
    setNotice, setExpanded, setVirtualScrollTop, viewportRef, programmaticTableScrollRef,
    pendingOpenNodeIdRef, captureWindowAnchorRef,
  });

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const table = useMemo(() => fullTable ?? (activeWindow ? workspaceWindowDisplayTable(activeWindow) : undefined), [fullTable, activeWindow]);
  const tableNode = useMemo(() => table && data ? findTableNode(data, table.id) : undefined, [data, table]);
  const navigationTables = useMemo<WorkspaceBottomNavigationItem[]>(() => data?.nodes.flatMap((node) => {
    if (node.type !== 'table' || !node.tableId) return [];
    const navigationTable = data.tables.find((item) => item.id === node.tableId);
    return navigationTable ? [{ tableId: navigationTable.id, nodeId: node.id, name: navigationTable.name }] : progressiveRef.current ? [{ tableId: node.tableId, nodeId: node.id, name: node.name }] : [];
  }) ?? [], [data]);
  const navigationTableById = useMemo(() => new Map(navigationTables.map((item) => [item.tableId, item])), [navigationTables]);
  const bottomNavigationItems = useMemo(() => (data?.bottomNavigationTableIds ?? []).flatMap((tableId) => navigationTableById.get(tableId) ?? []), [data?.bottomNavigationTableIds, navigationTableById]);
  const rowHeader = useMemo(() => table ? getRowHeaderColumn(table) : undefined, [table?.id, table?.rowHeader, table?.rowHeaderName]);
  const filter = useWorkspaceFilter({ table, rowHeader });

  const { searchQuery, setSearchQuery, searchOpen, setSearchOpen, headerFilters, setFilterTarget, clearFilters, filteredRows, setScrollPosition } = filter;

  const hiddenColumns = useMemo(() => table?.columns.filter((column) => column.hidden) ?? [], [table?.columns]);
  const displayedColumns = useMemo(() => table?.columns.filter((column) => !column.hidden) ?? [], [table?.columns]);
  const searchFilterTargets = useMemo<HeaderFilterTarget[]>(() => {
    if (!table || !rowHeader) return [];
    return [
      { axis: 'column', id: rowHeader.id, label: rowHeader.name || '未命名欄位' },
      ...displayedColumns.map((column) => ({ axis: 'column' as const, id: column.id, label: column.name || '未命名欄位' })),
    ];
  }, [displayedColumns, rowHeader, table]);
  const hasActiveSearchState = Boolean(searchQuery.trim()) || Object.values(headerFilters).some((state) => hasWorkspaceFilterCriteria(state) || Boolean(state.sort));
  const bulk = useWorkspaceBulkSelection({
    table, setNotice, setSearchOpen, setEditBarOpen, setTableActionsOpen, filteredRows, dataRef, commit, dialogs,
  });
  const { bulkTopRowRevealed, setBulkSelection, setBulkEditorOpen, startBulkSelection, sweepBulkSelection, toggleBulkCell, bulkSelection, setBulkTopRowRevealed, closeBulkSelection, bulkColumn, bulkSelectedRowIds } = bulk;

  const topRowRevealActive = searchOpen || bulkTopRowRevealed;
  const clearSearchAndFilters = useCallback(() => {
    setSearchQuery('');
    clearFilters();
    setSearchOpen(false);
  }, [clearFilters, setSearchOpen, setSearchQuery]);
  const hasHiddenColumns = hiddenColumns.length > 0;
  const hiddenOptionsByColumn = useMemo(() => hiddenFieldsEditor ? Object.fromEntries(hiddenColumns.map((column) => [column.id, column.inputType === 'dynamic-select' && table ? getDynamicOptions(table, column.id) : column.options])) : {}, [hiddenColumns, hiddenFieldsEditor, table]);

  const fixedListSuggestions = useMemo(() => {
    if (!configuring || !table || !rowHeader) return [];
    const seen = new Set<string>();
    const options: string[] = [];
    for (const row of table.rows) {
      const value = configuring.isRowHeader ? row.name : row.values[configuring.column.id] ?? null;
      const items = configuring.column.isMultiple && typeof value === 'string' ? parseMultiSelectValues(value) : [displayWorkspaceColumnValue(value, configuring.column)];
      for (const item of items) {
        const option = item.trim();
        const key = option.toLocaleLowerCase();
        if (!option || seen.has(key)) continue;
        seen.add(key);
        options.push(option);
        if (options.length > 10) return [];
      }
    }
    return options;
  }, [configuring, rowHeader, table]);
  const { markExported, driveBackup, backupNeedsAttention, lastExportAt } = useWorkspaceBackupStatus({
    setStorageConflict, dataRef, mountedRef, data, drawerOpen, storageConflict, saveState, setNotice, dialogs,
  });

  useEffect(() => {
    if (searchOpen) setEditBarOpen(false);
  }, [searchOpen]);
  useLayoutEffect(() => {
    setFilterTarget(undefined);
    setEditBarOpen(false);
    setTableActionsOpen(false);
    setBulkSelection(undefined);
    setBulkEditorOpen(false);
    setQuickActionsExpanded(false);
  }, [data?.activeNodeId, setFilterTarget]);

  useLayoutEffect(() => {
    if (!quickActionsExpanded) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [quickActionsExpanded, table?.columns.length, table?.id, table?.rows.length]);

  useEffect(() => {
    if (!data) return;
    window.localStorage.setItem(expandedFoldersStorageKey, JSON.stringify([...expanded]));
  }, [data, expanded]);

  const { localMinTextScale, viewportWidth, columnTextWidths, viewportHeight, textWidthCache, setMountedTextWidths } = useWorkspaceColumnSizing({ table, rowHeader, displayedColumns, viewportRef });

  const openSearchFromGesture = useCallback(() => withActiveTable(() => {
    setSearchOpen(true);
    setEditBarOpen(false);
    setTableActionsOpen(false);
  }), [withActiveTable]);

  const persistWindowTextScale = useCallback((tableId: string, scale: number) => {
    void hydrateWorkspace([tableId]).then(() => {
      const current = dataRef.current;
      const target = current?.tables.find(table => table.id === tableId);
      if (!mountedRef.current || !current || !target || Math.abs((target.textScale ?? 1) - scale) < 0.001) return;
      commit(updateTable(current, tableId, table => ({ ...table, textScale: scale, updatedAt: Date.now() })));
    }).catch(reportReadError);
  }, [commit, hydrateWorkspace, reportReadError]);

  const {
    textScale, panning, tableReorderVisual, consumeSuppressedTableClick,
    applyTextScale,
    beginTableReorder, moveTableReorder, endTableReorder,
    beginTablePan, moveTablePan, endTablePan,
  } = useTableGestures({ table, data, commit, viewportRef, workspacePageRef, setNotice, minTextScale: localMinTextScale, onCellLongPress: startBulkSelection, onCellSweep: sweepBulkSelection, onCellTap: toggleBulkCell, bulkSelectionColumnId: bulkSelection && table?.id === bulkSelection.tableId ? bulkSelection.columnId : undefined, onDrawerSwipeProgress: updateDrawerFromOpenSwipe, onDrawerSwipeEnd: settleDrawerFromOpenSwipe, onOpenSearch: bulkSelection ? undefined : openSearchFromGesture, onRevealTopRow: bulkSelection ? () => setBulkTopRowRevealed(true) : undefined, searchOpen, ensureTableReady: activeWindow ? () => readiness.ensure('active') : undefined, onReadError: reportReadError, onPersistTextScale: persistWindowTextScale });

  const stableBeginTableReorder = useStableCallback(beginTableReorder);
  const stableMoveTableReorder = useStableCallback(moveTableReorder);
  const stableEndTableReorder = useStableCallback(endTableReorder);
  const stableBeginTablePan = useStableCallback(beginTablePan);
  const stableMoveTablePan = useStableCallback(moveTablePan);
  const stableEndTablePan = useStableCallback(endTablePan);
  const stableApplyTextScale = useStableCallback(applyTextScale);

  const rawActions = useWorkspaceActions({
    data, dataRef, table, rowHeader, commit, getDynamicOptions, setNotice, setExpanded, setDrawerOpen,
    setTableActionsOpen, onExported: markExported, dialogs,
  });
  const actions = useReadyWorkspaceActions(rawActions, {
    submitName: () => {
      const dialog = dialogs.state.nameDialog;
      return dialog?.mode === 'table' ? 'all' : dialog?.node?.tableId ? { tableId: dialog.node.tableId, requestKey: dialog } : undefined;
    },
    askDeleteNode: 'all',
    saveCellValue: 'active', updateCell: 'active', openCell: 'active', selectCellValue: 'active', addRow: 'active', askDeleteRow: 'active', addColumn: 'active', askDeleteColumn: 'active', saveColumn: 'active',
    exportCurrent: 'active', exportAll: 'all', finishTableImport: 'all', finishWorkspaceImport: 'all',
  }, readiness);
  const { addTable: stableAddTable, openNode, openCell: stableOpenCell, addRow, addColumn } = actions;

  const openDrawerNode = useCallback((node: WorkspaceNode) => {
    if (node.id === dataRef.current?.activeNodeId) { pendingOpenNodeIdRef.current = undefined; setDrawerOpen(false); return; }
    if (node.type === 'table' && !dataRef.current?.tables.some(table => table.id === node.tableId)) {
      pendingOpenNodeIdRef.current = node.id;
      if (progressiveRef.current && node.tableId) {
        void (async () => {
          const view = loadWorkspaceTableViewState(node.tableId!);
          const needsFullView = Boolean(view?.searchOpen || view?.searchQuery.trim() || Object.values(view?.headerFilters ?? {}).some(filter => hasWorkspaceFilterCriteria(filter) || filter.sort));
          let nextWindow = needsFullView ? undefined : await loadWorkspaceTableWindow(node.tableId!, { scrollTop: view.scrollTop, viewportHeight: window.innerHeight });
          if (!nextWindow || needsFullView) {
            await hydrateWorkspace([node.tableId!]); nextWindow = undefined;
          }
          if (!mountedRef.current || pendingOpenNodeIdRef.current !== node.id) return;
          pendingOpenNodeIdRef.current = undefined;
          if (nextWindow) setTableWindow(nextWindow);
          commit({ ...dataRef.current!, activeNodeId: node.id });
          dialogs.close('editing', 'focusTarget', 'selectionEditor'); setTableActionsOpen(false);
          closeDrawer();
        })().catch(reportReadError);
        return;
      }
      setNotice('正在開啟表格…');
      return;
    }
    openNode(node);
  }, [closeDrawer, commit, hydrateWorkspace, openNode, reportReadError]);

  useEffect(() => {
    if (!data || !pendingOpenNodeIdRef.current) return;
    const node = data.nodes.find((item) => item.id === pendingOpenNodeIdRef.current);
    if (progressiveRef.current || (!allTablesReady && !data.tables.some(table => table.id === node?.tableId))) return;
    pendingOpenNodeIdRef.current = undefined;
    if (node?.type === 'table' && node.tableId && data.tables.some((item) => item.id === node.tableId)) openNode(node);
    else if (node?.type === 'table') setNotice('無法開啟表格，請確認本機資料');
  }, [allTablesReady, data, openNode]);

  const handleDataCellClick = useCallback((row: WorkspaceRow, column: WorkspaceColumn) => {
    if (!bulkSelection) {
      dialogs.set('lastPasteTarget', { rowId: row.id, columnId: column.id });
      stableOpenCell(row, column);
      return;
    }
    toggleBulkCell(row.id, column.id);
  }, [bulkSelection, stableOpenCell, toggleBulkCell]);

  const { handleWorkspacePaste, pasteTarget, pasteTargetLabel, pasteMatrix } = useWorkspaceClipboard({
    table, rowHeader, dataRef, setNotice, commit, readiness, dialogs,
  });

  const { stableOpenHiddenFields, toggleColumnVisibility, saveHiddenFields } = useWorkspaceHiddenFields({
    dataRef, commit, withActiveTable, rowHeader, dialogs,
  });
  const history = useWorkspaceHistory(storage, table, dialogs.closeCellEditors);

  const { currentTableHistory, undoTable, redoTable } = history;

  const readyControls = useReadyWorkspaceActions({
    configure: (column: WorkspaceColumn, isRowHeader: boolean) => dialogs.set('configuring', { column, isRowHeader }),
    filter: (target: HeaderFilterTarget) => setFilterTarget(target),
    search: () => { if (!bulkSelection) closeBulkSelection(); setSearchOpen(open => !open); },
    edit: () => { closeBulkSelection(); setEditBarOpen(open => !open); setTableActionsOpen(false); setSearchOpen(false); },
    settings: () => { closeBulkSelection(); setTableActionsOpen(open => !open); setEditBarOpen(false); setSearchOpen(false); },
    createTable: (parentId: string | null) => dialogs.set('tableCreateParentId', parentId),
    context: (node: WorkspaceNode) => dialogs.set('nodeMenu', node),
    drive: () => { setDrawerOpen(false); driveBackup.open(); },
    bottomNavigation: () => { setDrawerOpen(false); dialogs.set('bottomNavigationDraft', [...(dataRef.current?.bottomNavigationTableIds ?? [])]); },
    quickActions: () => setQuickActionsExpanded(true),
  }, { configure: 'active', filter: 'active', search: 'active', edit: 'history', settings: 'active', quickActions: 'history' }, readiness);

  const { handleTableViewportScroll, renderedTableWidth, renderedColumnWidths, rowWindow, tableRowIndexes, syncFilterbarScroll, filterbarTrackStyle, filterbarSlots } = useWorkspaceTableWindow({ table, hasHiddenColumns, viewportWidth, columnTextWidths, textScale, displayedColumns, searchQuery, headerFilters, viewInteractionRef, restoredViewTableRef, viewportRef, activeWindow, filteredRows, virtualScrollTop, viewportHeight, captureWindowAnchorRef, mountedRef, dataRef, setTableWindow, reportReadError, rowHeader, textWidthCache, setMountedTextWidths, programmaticTableScrollRef, setVirtualScrollTop, lastUserScrollAtRef, focusTarget, searchFilterTargets, filterbarRef, setScrollPosition, searchOpen });

  const activeEditingRow = editing && table ? getWorkspaceRow(table.rows, editing.rowId) : undefined;
  const activeEditingRowIndex = activeEditingRow ? tableRowIndexes.get(activeEditingRow.id) ?? -1 : -1;
  const activeEditingColumn = editing && table ? editing.columnId === rowHeader?.id ? rowHeader : table.columns.find((item) => item.id === editing.columnId) : undefined;
  const activeEditingValue = activeEditingRow && activeEditingColumn ? activeEditingColumn.id === rowHeader?.id ? activeEditingRow.name : activeEditingRow.values[activeEditingColumn.id] : null;
  const hiddenEditorRow = hiddenFieldsEditor && table ? getWorkspaceRow(table.rows, hiddenFieldsEditor.rowId) : undefined;
  const activeCell = editing ?? (selectionEditor ? { rowId: selectionEditor.rowId, columnId: selectionEditor.column.id } : undefined) ?? (bulkSelection?.rowIds[0] ? { rowId: bulkSelection.rowIds[0], columnId: bulkSelection.columnId } : focusTarget);
  const activeCellKey = activeCell ? workspaceCellKey(activeCell.rowId, activeCell.columnId) : undefined;
  const activeCellRowId = activeCell?.rowId;
  const activeCellColumnId = activeCell?.columnId;

  const { requestClose, closeBottomNavigationDialog } = useWorkspaceModalNavigation({ dataRef, commit, setNotice, dialogs, driveBackup, filter, bulk, drawer, editBarOpen, setEditBarOpen, tableActionsOpen, setTableActionsOpen, searchActive: searchOpen || hasActiveSearchState, clearSearchAndFilters });

  const { setActiveCellElement, workspacePageStyle } = useWorkspaceCellFocus(viewportRef, activeCellKey, virtualKeyboardOpen);
  const workspaceToolbarRowCount = Number(Boolean(bulkSelection && bulkColumn)) + Number(searchOpen) + Number(editBarOpen || tableActionsOpen);
  const topRowRevealCount = topRowRevealActive ? Number(Boolean(bulkSelection && bulkColumn)) + Number(searchOpen) : 0;

  // Keep the expensive table subtree out of drawer-only state updates. Real workspaces can
  // contain hundreds of rows; opening the drawer must not block the first click while React
  // reconstructs every cell.
  const { workspaceTableView } = useWorkspaceTableView({ table, tableNode, viewportRef, panning, handleTableViewportScroll, viewInteractionRef, stableBeginTablePan, stableMoveTableReorder, stableMoveTablePan, stableEndTableReorder, stableEndTablePan, consumeSuppressedTableClick, textScale, topRowRevealCount, renderedTableWidth, renderedColumnWidths, rowHeader, configuring, activeCellColumnId, readyControls, displayedColumns, tableReorderVisual, bulkSelection, stableBeginTableReorder, hasHiddenColumns, rowWindow, tableRowIndexes, activeCellRowId, bulkSelectedRowIds, setActiveCellElement, updateDialogs: dialogs.update, stableOpenCell, activeCellKey, handleDataCellClick, stableOpenHiddenFields, quickActionsExpanded, currentTableHistory, setQuickActionsExpanded, addRow, undoTable, redoTable, addColumn, stableApplyTextScale, localMinTextScale });

  return {
    data,
    inputModality,
    requestClose,
    storageUpgradeBlocked,
    loadError,
    workspacePageRef,
    workspacePageStyle,
    handleWorkspacePaste,
    clearSearchAndFilters,
    viewportRef,
    table,
    setVirtualScrollTop,
    tableNode,
    hasActiveSearchState,
    readyControls,
    editBarOpen,
    tableActionsOpen,
    notice,
    storageConflict,
    remainingLoadError,
    workspaceToolbarRowCount,
    filterbarRef,
    syncFilterbarScroll,
    filterbarTrackStyle,
    filterbarSlots,
    pasteTarget,
    stableAddTable,
    workspaceTableView,
    virtualKeyboardOpen,
    bottomNavigationItems,
    setEditBarOpen,
    setTableActionsOpen,
    openDrawerNode,
    allTablesReady,
    progressiveRef,
    expanded,
    setExpanded,
    setNotice,
    saveState,
    lastSavedAt,
    backupNeedsAttention,
    lastExportAt,
    driveBackup,
    storageVersion,
    commit,
    toggleColumnVisibility,
    navigationTables,
    closeBottomNavigationDialog,
    activeEditingRow,
    activeEditingColumn,
    activeEditingValue,
    rowHeader,
    activeEditingRowIndex,
    fixedListSuggestions,
    getDynamicOptions,
    hiddenEditorRow,
    hiddenColumns,
    hiddenOptionsByColumn,
    saveHiddenFields,
    pasteTargetLabel,
    pasteMatrix,
    drawer,
    filter,
    bulk,
    actions,
    history,
    dialogs,
  };
};

export type WorkspacePageViewModel = ReturnType<typeof useWorkspacePage>;
