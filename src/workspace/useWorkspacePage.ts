import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { loadWorkspaceTableWindow } from './db';
import { displayWorkspaceColumnValue, getRowHeaderColumn, parseMultiSelectValues } from './model';
import { initialWorkspaceRowPages, workspaceWindowDisplayTable } from './rowPages';
import type { WorkspaceCellValue, WorkspaceColumn, WorkspaceData, WorkspaceNode, WorkspaceRow } from './types';
import { useReadyWorkspaceActions } from './useReadyWorkspaceActions';
import { useTableGestures } from './useTableGestures';
import { useWorkspaceActions, type WorkspaceTableImportPreview } from './useWorkspaceActions';
import { useWorkspaceBackupStatus } from './useWorkspaceBackupStatus';
import { useWorkspaceVirtualKeyboardOpen } from './useWorkspaceBrowserBack';
import { useWorkspaceBulkSelection } from './useWorkspaceBulkSelection';
import { useWorkspaceClipboard } from './useWorkspaceClipboard';
import { useWorkspaceColumnSizing } from './useWorkspaceColumnSizing';
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
import { ensureWorkspaceCellVisible, expandedFoldersStorageKey, findTableNode, hasWorkspaceFilterCriteria, NameDialogState, updateTable, useWorkspaceInputModality, type HeaderFilterTarget } from './workspaceShared';

const workspaceCellKey = (rowId: string, columnId: string) => `${rowId}:${columnId}`;
export const useWorkspacePage = () => {
  const inputModality = useWorkspaceInputModality();
  const captureWindowAnchorRef = useRef<(() => { rowId: string; within: number } | undefined) | undefined>(undefined);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ rowId: string; columnId: string }>();
  const [focusTarget, setFocusTarget] = useState<{ rowId: string; columnId: string }>();
  const [selectionEditor, setSelectionEditor] = useState<{ rowId: string; column: WorkspaceColumn; value: WorkspaceCellValue; options: string[]; isRowHeader: boolean }>();
  const [configuring, setConfiguring] = useState<{ column: WorkspaceColumn; isRowHeader: boolean }>();
  const [workspaceImport, setWorkspaceImport] = useState<WorkspaceData>();
  const [nodeMenu, setNodeMenu] = useState<WorkspaceNode>();
  const [movingNode, setMovingNode] = useState<WorkspaceNode>();
  const [editBarOpen, setEditBarOpen] = useState(false);
  const [quickActionsExpanded, setQuickActionsExpanded] = useState(false);
  const [tableActionsOpen, setTableActionsOpen] = useState(false);
  const [columnVisibilityOpen, setColumnVisibilityOpen] = useState(false);
  const [bottomNavigationDraft, setBottomNavigationDraft] = useState<string[]>();
  const [hiddenFieldsEditor, setHiddenFieldsEditor] = useState<{ rowId: string; title: string }>();
  const [tableCreateParentId, setTableCreateParentId] = useState<string | null | undefined>(undefined);
  const [nameDialog, setNameDialog] = useState<NameDialogState>();
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; onConfirm(): void }>();
  const [notice, setNotice] = useState('');

  const [virtualScrollTop, setVirtualScrollTop] = useState(0);
  const [virtualScrollLeft, setVirtualScrollLeft] = useState(0);
  const [visualViewportHeight, setVisualViewportHeight] = useState<number>();

  const [pasteDialogOpen, setPasteDialogOpen] = useState(false);
  const [lastPasteTarget, setLastPasteTarget] = useState<{ rowId: string; columnId: string }>();
  const [tableImportPreview, setTableImportPreview] = useState<WorkspaceTableImportPreview>();

  const virtualKeyboardOpen = useWorkspaceVirtualKeyboardOpen();

  const viewportRef = useRef<HTMLDivElement>(null);
  const filterbarRef = useRef<HTMLDivElement>(null);
  const workspacePageRef = useRef<HTMLElement>(null);
  const activeCellElementRef = useRef<HTMLElement | null>(null);

  const pendingOpenNodeIdRef = useRef<string | undefined>(undefined);
  const lastUserScrollAtRef = useRef(0);
  const programmaticTableScrollRef = useRef(false);
  const viewInteractionRef = useRef<string | undefined>(undefined);
  const restoredViewTableRef = useRef<string | undefined>(undefined);

  const storage = useWorkspaceStorage(setNotice);
  const {
    data, setData, dataRef, setTableWindow, progressiveRef, mountedRef,
    historyByTable, setHistoryByTable, historyRef, historyReady, historyReadyRef,
    allTablesReady, allTablesReadyRef, storageVersion, remainingLoadError, storageConflict, setStorageConflict,
    loadError, storageUpgradeBlocked, pendingHistoryResetRef, saveState, setSaveState,
    lastSavedAt, setLastSavedAt, saveRevisionRef, dynamicOptionsCacheRef, getDynamicOptions, reportSaveError, commit,
  } = storage;
  const {
    drawerOpen, setDrawerOpen, drawerOffset, drawerDragging, drawerQuery, setDrawerQuery, drawerElementRef,
    openDrawer, closeDrawer, updateDrawerFromOpenSwipe, settleDrawerFromOpenSwipe,
    beginDrawerSwipe, moveDrawerSwipe, endDrawerSwipe, suppressDrawerSwipeClick, handleDrawerItemDragStateChange,
  } = useWorkspaceDrawer({ allTablesReadyRef, progressiveRef, pendingOpenNodeIdRef });
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
  const tableRowsById = useMemo(() => new Map(table?.rows.map((row) => [row.id, row]) ?? []), [table?.rows]);
  const tableRowIndexes = useMemo(() => activeWindow
    ? new Map(activeWindow.pages.flatMap(page => page.rows.map((row, slot) => [row.id, page.index * activeWindow.head.pageSize + slot] as const)))
    : new Map(table?.rows.map((row, index) => [row.id, index]) ?? []), [activeWindow, table?.rows]);

  const {
    searchQuery, setSearchQuery, searchOpen, setSearchOpen,
    headerFilters, filterTarget, setFilterTarget, clearFilters,
    searchedRows, filteredRows, visibleColumns,
    activeFilterState, activeFilterOptions, activeFilterInputType, activeNumericValues,
    setActiveFilterSort, setActiveFilterQuery, setActiveFilterRange, setActiveDateRange, clearActiveDateRange, setActiveFilterAggregate, toggleActiveFilterOption,
    updateActiveFilter, isHeaderFilterActive, setScrollPosition
  } = useWorkspaceFilter({ table, rowHeader, tableRowsById });

  const hiddenColumns = useMemo(() => table?.columns.filter((column) => column.hidden) ?? [], [table?.columns]);
  const displayedColumns = useMemo(() => visibleColumns.filter((column) => !column.hidden), [visibleColumns]);
  const filteredRowIndexes = useMemo(() => new Map(filteredRows.map((row, index) => [row.id, index])), [filteredRows]);
  const searchFilterTargets = useMemo<HeaderFilterTarget[]>(() => {
    if (!table || !rowHeader) return [];
    if (table.transposed) return [];
    return [
      { axis: 'column', id: rowHeader.id, label: rowHeader.name || '未命名欄位' },
      ...displayedColumns.map((column) => ({ axis: 'column' as const, id: column.id, label: column.name || '未命名欄位' })),
    ];
  }, [displayedColumns, rowHeader, table]);
  const hasActiveSearchState = Boolean(searchQuery.trim()) || Object.values(headerFilters).some((state) => hasWorkspaceFilterCriteria(state) || Boolean(state.sort));
  const { bulkTopRowRevealed, setBulkSelection, setBulkEditorOpen, startBulkSelection, sweepBulkSelection, toggleBulkCell, bulkSelection, setBulkTopRowRevealed, closeBulkSelection, bulkEditorOpen, bulkColumn, bulkSelectedRowIds, bulkNumericValues, bulkRows, bulkDraftValue, commitBulkSelection, bulkMultiSelectRows, commitBulkCellUpdates } = useWorkspaceBulkSelection({ table, tableRowsById, setNotice, setEditing, setSelectionEditor, setConfiguring, setSearchOpen, setEditBarOpen, setTableActionsOpen, filteredRows, setLastPasteTarget, dataRef, commit });

  const topRowRevealActive = searchOpen || bulkTopRowRevealed;
  const clearSearchAndFilters = useCallback(() => {
    setSearchQuery('');
    clearFilters();
    setSearchOpen(false);
  }, [clearFilters, setSearchOpen, setSearchQuery]);
  const activeHeaderFilterKeys = useMemo(() => new Set(
    Object.entries(headerFilters)
      .filter(([, state]) => hasWorkspaceFilterCriteria(state) || Boolean(state.sort))
      .map(([key]) => key),
  ), [headerFilters]);
  const hasHiddenColumns = hiddenColumns.length > 0;
  const hiddenOptionsByColumn = useMemo(() => hiddenFieldsEditor ? Object.fromEntries(hiddenColumns.map((column) => [column.id, column.inputType === 'dynamic-select' && table ? getDynamicOptions(table, column.id) : column.options])) : {}, [hiddenColumns, hiddenFieldsEditor, table]);

  const fixedListSuggestions = useMemo(() => {
    if (!configuring || !table || !rowHeader) return [];
    const values = table.rows.map((row) => configuring.isRowHeader ? row.name : row.values[configuring.column.id] ?? null);
    const seen = new Set<string>();
    const options: string[] = [];
    for (const value of values) {
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
  const { markExported, driveBackup, backupNeedsAttention, lastExportAt } = useWorkspaceBackupStatus({ setStorageConflict, dataRef, allTablesReady, data, drawerOpen, storageConflict, saveState, setWorkspaceImport, setNotice });

  useEffect(() => {
    if (searchOpen) setEditBarOpen(false);
  }, [searchOpen]);
  useLayoutEffect(() => {
    setEditing(undefined);
    setFocusTarget(undefined);
    setSelectionEditor(undefined);
    setConfiguring(undefined);
    setFilterTarget(undefined);
    setColumnVisibilityOpen(false);
    setHiddenFieldsEditor(undefined);
    setPasteDialogOpen(false);
    setLastPasteTarget(undefined);
    setConfirmDialog(undefined);
    setNameDialog(undefined);
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
  }, [quickActionsExpanded, table?.columns.length, table?.id, table?.rows.length, table?.transposed]);

  useEffect(() => {
    if (!data) return;
    window.localStorage.setItem(expandedFoldersStorageKey, JSON.stringify([...expanded]));
  }, [data, expanded]);

  const { localMinTextScale, viewportWidth, columnTextWidths, viewportHeight, textWidthCache, setMountedTextWidths } = useWorkspaceColumnSizing({ table, rowHeader, displayedColumns, filteredRows, viewportRef });

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

  const tableGestureHandlersRef = useRef({
    beginTableReorder, moveTableReorder, endTableReorder,
    beginTablePan, moveTablePan, endTablePan,
  });
  tableGestureHandlersRef.current = {
    beginTableReorder, moveTableReorder, endTableReorder,
    beginTablePan, moveTablePan, endTablePan,
  };
  const stableBeginTableReorder = useCallback((...args: Parameters<typeof beginTableReorder>) => tableGestureHandlersRef.current.beginTableReorder(...args), []);
  const stableMoveTableReorder = useCallback((...args: Parameters<typeof moveTableReorder>) => tableGestureHandlersRef.current.moveTableReorder(...args), []);
  const stableEndTableReorder = useCallback((...args: Parameters<typeof endTableReorder>) => tableGestureHandlersRef.current.endTableReorder(...args), []);
  const stableBeginTablePan = useCallback((...args: Parameters<typeof beginTablePan>) => tableGestureHandlersRef.current.beginTablePan(...args), []);
  const stableMoveTablePan = useCallback((...args: Parameters<typeof moveTablePan>) => tableGestureHandlersRef.current.moveTablePan(...args), []);
  const stableEndTablePan = useCallback((...args: Parameters<typeof endTablePan>) => tableGestureHandlersRef.current.endTablePan(...args), []);
  const applyTextScaleRef = useRef(applyTextScale);
  applyTextScaleRef.current = applyTextScale;
  const stableApplyTextScale = useCallback((scale: number, persist?: boolean) => applyTextScaleRef.current(scale, persist), []);

  const rawActions = useWorkspaceActions({
    data, table, rowHeader, commit, getDynamicOptions, setNotice, setExpanded, setDrawerOpen,
    setEditing, setFocusTarget, setSelectionEditor, setConfiguring, setNodeMenu, setMovingNode,
    setTableActionsOpen, setTableCreateParentId, setNameDialog,
    setConfirmDialog, setWorkspaceImport, setTableImportPreview, onExported: markExported,
    nameDialog, selectionEditor, configuring, workspaceImport
  });
  const {
    importTableInputRef, importWorkspaceInputRef, importTableParentId,
    openNameDialog, addFolder, addTable, renameNode, submitName,
    askDeleteNode, relocateNode, openNode, saveCellValue, updateCell, openCell,
    selectCellValue, addRow, askDeleteRow, addColumn, askDeleteColumn, saveColumn,
    exportCurrent, exportAll, chooseImport, readImport, finishTableImport, finishWorkspaceImport
  } = useReadyWorkspaceActions(rawActions, {
    openNameDialog: 'all', addFolder: 'all', addTable: 'all', renameNode: 'all', submitName: 'all', askDeleteNode: 'all', relocateNode: 'all',
    saveCellValue: 'active', updateCell: 'active', openCell: 'active', selectCellValue: 'active', addRow: 'active', askDeleteRow: 'active', addColumn: 'active', askDeleteColumn: 'active', saveColumn: 'active',
    exportCurrent: 'active', exportAll: 'all', finishTableImport: 'all', finishWorkspaceImport: 'all',
  }, readiness);

  const openDrawerNode = useCallback((node: WorkspaceNode) => {
    if (node.id === dataRef.current?.activeNodeId) { pendingOpenNodeIdRef.current = undefined; setDrawerOpen(false); return; }
    if (node.type === 'table' && !dataRef.current?.tables.some(table => table.id === node.tableId)) {
      pendingOpenNodeIdRef.current = node.id;
      if (progressiveRef.current && node.tableId) {
        void (async () => {
          const view = loadWorkspaceTableViewState(node.tableId!);
          const first = Math.max(0, Math.floor((view?.scrollTop ?? 0) / 36) - 6);
          const last = first + Math.ceil(window.innerHeight / 36) + 13;
          let nextWindow = await loadWorkspaceTableWindow(node.tableId!, [Math.floor(first / 128), Math.floor(last / 128)]);
          if (nextWindow) {
            const indices = initialWorkspaceRowPages(nextWindow.head, view.scrollTop, window.innerHeight);
            if (indices.some(index => !nextWindow!.pages.some(page => page.index === index))) nextWindow = await loadWorkspaceTableWindow(node.tableId!, indices);
          }
          const needsFullView = Boolean(view?.searchOpen || view?.searchQuery.trim() || Object.values(view?.headerFilters ?? {}).some(filter => hasWorkspaceFilterCriteria(filter) || filter.sort));
          if (!nextWindow || nextWindow.head.definition.transposed || needsFullView) {
            await hydrateWorkspace([node.tableId!]); nextWindow = undefined;
          }
          if (!mountedRef.current || pendingOpenNodeIdRef.current !== node.id) return;
          pendingOpenNodeIdRef.current = undefined;
          if (nextWindow) setTableWindow(nextWindow);
          commit({ ...dataRef.current!, activeNodeId: node.id });
          setEditing(undefined); setFocusTarget(undefined); setSelectionEditor(undefined); setTableActionsOpen(false);
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

  const openCellRef = useRef(openCell);
  openCellRef.current = openCell;
  const stableOpenCell = useCallback((row: WorkspaceRow, column: WorkspaceColumn) => openCellRef.current(row, column), []);
  const addTableRef = useRef(addTable);
  addTableRef.current = addTable;
  const stableAddTable = useCallback((parentId: string | null) => addTableRef.current(parentId), []);

  const handleDataCellClick = useCallback((row: WorkspaceRow, column: WorkspaceColumn) => {
    if (!bulkSelection) {
      setLastPasteTarget({ rowId: row.id, columnId: column.id });
      stableOpenCell(row, column);
      return;
    }
    toggleBulkCell(row.id, column.id);
  }, [bulkSelection, stableOpenCell, toggleBulkCell]);

  const { handleWorkspacePaste, pasteTarget, pasteTargetLabel, pasteMatrix } = useWorkspaceClipboard({ table, rowHeader, lastPasteTarget, focusTarget, dataRef, setNotice, setPasteDialogOpen, commit, readiness });

  const { stableOpenHiddenFields, toggleColumnVisibility, saveHiddenFields } = useWorkspaceHiddenFields({ dataRef, commit, withActiveTable, setHiddenFieldsEditor, rowHeader });

  const { currentTableHistory, undoTable, redoTable } = useWorkspaceHistory({ data, table, historyReadyRef, historyRef, dynamicOptionsCacheRef, setHistoryByTable, setData, dataRef, setEditing, setSelectionEditor, saveRevisionRef, setSaveState, pendingHistoryResetRef, allTablesReadyRef, setLastSavedAt, reportSaveError, setNotice, historyReady, historyByTable });

  const readyControls = useReadyWorkspaceActions({
    configure: (column: WorkspaceColumn, isRowHeader: boolean) => setConfiguring({ column, isRowHeader }),
    filter: (target: HeaderFilterTarget) => setFilterTarget(target),
    search: () => { if (!bulkSelection) closeBulkSelection(); setSearchOpen(open => !open); },
    edit: () => { closeBulkSelection(); setEditBarOpen(open => !open); setTableActionsOpen(false); setSearchOpen(false); },
    settings: () => { closeBulkSelection(); setTableActionsOpen(open => !open); setEditBarOpen(false); setSearchOpen(false); },
    createTable: (parentId: string | null) => setTableCreateParentId(parentId),
    context: (node: WorkspaceNode) => setNodeMenu(node),
    drive: () => { setDrawerOpen(false); driveBackup.open(); },
    bottomNavigation: () => { setDrawerOpen(false); setBottomNavigationDraft([...(dataRef.current?.bottomNavigationTableIds ?? [])]); },
    quickActions: () => setQuickActionsExpanded(true),
  }, { configure: 'active', filter: 'active', search: 'active', edit: 'history', settings: 'active', createTable: 'all', context: 'all', drive: 'all', bottomNavigation: 'all', quickActions: 'history' }, readiness);

  const { handleTableViewportScroll, renderedTableWidth, columnWindow, renderedColumnWidths, rowWindow, syncFilterbarScroll, filterbarTrackStyle, transposedFilterTargets, filterbarSlots } = useWorkspaceTableWindow({ table, hasHiddenColumns, viewportWidth, columnTextWidths, textScale, displayedColumns, searchQuery, headerFilters, viewInteractionRef, restoredViewTableRef, viewportRef, activeWindow, filteredRows, virtualScrollTop, viewportHeight, captureWindowAnchorRef, mountedRef, dataRef, setTableWindow, reportReadError, virtualScrollLeft, rowHeader, textWidthCache, setMountedTextWidths, programmaticTableScrollRef, setVirtualScrollLeft, setVirtualScrollTop, lastUserScrollAtRef, focusTarget, filteredRowIndexes, searchFilterTargets, filterbarRef, setScrollPosition, searchOpen });

  const activeEditingRow = editing && table ? table.rows.find((item) => item.id === editing.rowId) : undefined;
  const activeEditingRowIndex = activeEditingRow && table ? table.rows.findIndex((item) => item.id === activeEditingRow.id) : -1;
  const activeEditingColumn = editing && table ? editing.columnId === rowHeader?.id ? rowHeader : table.columns.find((item) => item.id === editing.columnId) : undefined;
  const activeEditingValue = activeEditingRow && activeEditingColumn ? activeEditingColumn.id === rowHeader?.id ? activeEditingRow.name : activeEditingRow.values[activeEditingColumn.id] : null;
  const hiddenEditorRow = hiddenFieldsEditor && table ? table.rows.find((row) => row.id === hiddenFieldsEditor.rowId) : undefined;
  const activeCell = editing ?? (selectionEditor ? { rowId: selectionEditor.rowId, columnId: selectionEditor.column.id } : undefined) ?? (bulkSelection?.rowIds[0] ? { rowId: bulkSelection.rowIds[0], columnId: bulkSelection.columnId } : focusTarget);
  const activeCellKey = activeCell ? workspaceCellKey(activeCell.rowId, activeCell.columnId) : undefined;
  const activeCellRowId = activeCell?.rowId;
  const activeCellColumnId = activeCell?.columnId;

  const { requestClose, closeBottomNavigationDialog } = useWorkspaceModalNavigation({ data, bottomNavigationDraft, commit, setNotice, setBottomNavigationDraft, driveBackup, confirmDialog, workspaceImport, tableImportPreview, pasteDialogOpen, hiddenFieldsEditor, bulkEditorOpen, filterTarget, configuring, selectionEditor, editing, movingNode, nodeMenu, tableCreateParentId, nameDialog, columnVisibilityOpen, tableActionsOpen, drawerOpen, bulkSelection, editBarOpen, searchOpen, hasActiveSearchState, setConfirmDialog, setWorkspaceImport, setTableImportPreview, setPasteDialogOpen, setHiddenFieldsEditor, setBulkEditorOpen, setFilterTarget, setConfiguring, setSelectionEditor, setEditing, setMovingNode, setNodeMenu, setTableCreateParentId, setNameDialog, setColumnVisibilityOpen, setTableActionsOpen, closeDrawer, closeBulkSelection, setEditBarOpen, clearSearchAndFilters, focusTarget, setFocusTarget });

  const keepActiveCellVisible = useCallback(() => {
    const element = activeCellElementRef.current;
    const viewport = viewportRef.current;
    if (element && viewport) ensureWorkspaceCellVisible(element, viewport);
  }, []);
  const setActiveCellElement = useCallback((element: HTMLElement | null) => {
    activeCellElementRef.current = element;
  }, []);

  useEffect(() => {
    if (!activeCellKey) return;
    let animationFrame: number | undefined;
    let delayedFrame: number | undefined;
    const visualViewport = window.visualViewport;
    const updateVisualViewportHeight = () => {
      if (visualViewport && Number.isFinite(visualViewport.height) && visualViewport.height > 0) setVisualViewportHeight(visualViewport.height);
    };
    const schedule = () => {
      updateVisualViewportHeight();
      if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame);
      if (delayedFrame !== undefined) window.clearTimeout(delayedFrame);
      animationFrame = window.requestAnimationFrame(() => {
        keepActiveCellVisible();
        delayedFrame = window.setTimeout(keepActiveCellVisible, 160);
      });
    };
    schedule();
    visualViewport?.addEventListener('resize', schedule);
    visualViewport?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    return () => {
      if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame);
      if (delayedFrame !== undefined) window.clearTimeout(delayedFrame);
      visualViewport?.removeEventListener('resize', schedule);
      visualViewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [activeCellKey, keepActiveCellVisible]);

  useEffect(() => {
    if (!activeCellKey) return;
    const frame = window.requestAnimationFrame(keepActiveCellVisible);
    const timer = window.setTimeout(keepActiveCellVisible, 160);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [activeCellKey, keepActiveCellVisible, virtualKeyboardOpen]);

  const workspacePageStyle = activeCellKey && visualViewportHeight ? {
    height: `${visualViewportHeight}px`,
    minHeight: `${visualViewportHeight}px`,
    maxHeight: `${visualViewportHeight}px`,
  } as React.CSSProperties : undefined;
  const workspaceToolbarRowCount = Number(Boolean(bulkSelection && bulkColumn)) + Number(searchOpen) + Number(editBarOpen || tableActionsOpen);
  const topRowRevealCount = topRowRevealActive ? Number(Boolean(bulkSelection && bulkColumn)) + Number(searchOpen) : 0;

  // Keep the expensive table subtree out of drawer-only state updates. Real workspaces can
  // contain hundreds of rows; opening the drawer must not block the first click while React
  // reconstructs every cell.
  const { workspaceTableView } = useWorkspaceTableView({ table, tableNode, viewportRef, panning, handleTableViewportScroll, viewInteractionRef, stableBeginTablePan, stableMoveTableReorder, stableMoveTablePan, stableEndTableReorder, stableEndTablePan, consumeSuppressedTableClick, textScale, topRowRevealCount, renderedTableWidth, columnWindow, renderedColumnWidths, rowHeader, configuring, activeCellColumnId, readyControls, activeHeaderFilterKeys, displayedColumns, tableReorderVisual, bulkSelection, stableBeginTableReorder, hasHiddenColumns, rowWindow, tableRowIndexes, activeCellRowId, bulkSelectedRowIds, setActiveCellElement, setLastPasteTarget, stableOpenCell, activeCellKey, handleDataCellClick, stableOpenHiddenFields, filteredRowIndexes, quickActionsExpanded, currentTableHistory, setQuickActionsExpanded, addRow, undoTable, redoTable, addColumn, stableApplyTextScale, localMinTextScale, filteredRows, stableAddTable });

  return {
    data,
    inputModality,
    requestClose,
    storageUpgradeBlocked,
    loadError,
    workspacePageRef,
    workspacePageStyle,
    handleWorkspacePaste,
    searchOpen,
    clearSearchAndFilters,
    openDrawer,
    bulkSelection,
    searchQuery,
    viewportRef,
    table,
    setVirtualScrollTop,
    setVirtualScrollLeft,
    setSearchQuery,
    filteredRows,
    nameDialog,
    tableNode,
    renameNode,
    hasActiveSearchState,
    readyControls,
    editBarOpen,
    tableActionsOpen,
    notice,
    storageConflict,
    exportCurrent,
    remainingLoadError,
    workspaceToolbarRowCount,
    bulkColumn,
    bulkNumericValues,
    closeBulkSelection,
    setBulkEditorOpen,
    filterbarRef,
    syncFilterbarScroll,
    filterbarTrackStyle,
    columnWindow,
    transposedFilterTargets,
    headerFilters,
    isHeaderFilterActive,
    filterbarSlots,
    currentTableHistory,
    undoTable,
    redoTable,
    setPasteDialogOpen,
    pasteTarget,
    addRow,
    addColumn,
    setColumnVisibilityOpen,
    drawerOpen,
    stableAddTable,
    workspaceTableView,
    virtualKeyboardOpen,
    bottomNavigationItems,
    setSearchOpen,
    setEditBarOpen,
    setTableActionsOpen,
    openDrawerNode,
    closeDrawer,
    drawerOffset,
    drawerElementRef,
    drawerDragging,
    beginDrawerSwipe,
    moveDrawerSwipe,
    endDrawerSwipe,
    suppressDrawerSwipeClick,
    allTablesReady,
    progressiveRef,
    addFolder,
    drawerQuery,
    setDrawerQuery,
    expanded,
    setExpanded,
    setNotice,
    relocateNode,
    handleDrawerItemDragStateChange,
    saveState,
    lastSavedAt,
    backupNeedsAttention,
    lastExportAt,
    driveBackup,
    exportAll,
    chooseImport,
    storageVersion,
    importTableInputRef,
    readImport,
    importWorkspaceInputRef,
    nodeMenu,
    setNodeMenu,
    askDeleteNode,
    setTableCreateParentId,
    setMovingNode,
    commit,
    movingNode,
    columnVisibilityOpen,
    toggleColumnVisibility,
    bottomNavigationDraft,
    navigationTables,
    setBottomNavigationDraft,
    closeBottomNavigationDialog,
    filterTarget,
    activeFilterInputType,
    activeFilterOptions,
    activeNumericValues,
    activeFilterState,
    setFilterTarget,
    setActiveFilterSort,
    toggleActiveFilterOption,
    updateActiveFilter,
    setActiveFilterQuery,
    setActiveFilterRange,
    setActiveDateRange,
    clearActiveDateRange,
    setActiveFilterAggregate,
    tableCreateParentId,
    addTable,
    importTableParentId,
    setNameDialog,
    submitName,
    askDeleteRow,
    confirmDialog,
    setConfirmDialog,
    activeEditingRow,
    activeEditingColumn,
    activeEditingValue,
    rowHeader,
    setEditing,
    activeEditingRowIndex,
    saveCellValue,
    updateCell,
    configuring,
    fixedListSuggestions,
    saveColumn,
    askDeleteColumn,
    setConfiguring,
    selectionEditor,
    setSelectionEditor,
    selectCellValue,
    bulkEditorOpen,
    bulkRows,
    bulkDraftValue,
    commitBulkSelection,
    bulkMultiSelectRows,
    getDynamicOptions,
    commitBulkCellUpdates,
    hiddenFieldsEditor,
    hiddenEditorRow,
    hiddenColumns,
    hiddenOptionsByColumn,
    saveHiddenFields,
    pasteDialogOpen,
    pasteTargetLabel,
    pasteMatrix,
    tableImportPreview,
    setTableImportPreview,
    finishTableImport,
    workspaceImport,
    setWorkspaceImport,
    finishWorkspaceImport,
  };
};

export type WorkspacePageViewModel = ReturnType<typeof useWorkspacePage>;
