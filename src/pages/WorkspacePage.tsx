import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clearAllWorkspaceHistories, deleteWorkspaceHistories, loadWorkspaceHistories, loadWorkspace, saveWorkspace, saveWorkspaceHistory } from '../workspace/db';
import { applyWorkspaceTableHistoryActionWithNode, createEmptyWorkspaceTableHistory, inferWorkspaceTableMutation, pushWorkspaceTableHistory, type WorkspaceCommitOptions, type WorkspaceTableHistory, type WorkspaceTableMutation } from '../workspace/history';
import { coerceCellValue, displayWorkspaceCellValue, displayWorkspaceColumnValue, getDynamicOptions, getRowHeaderColumn, getTableForNode, parseMultiSelectValues, workspaceCellColor, workspaceOptionColor } from '../workspace/model';
import { calculateWorkspaceTableLayout, ensureWorkspaceCellVisible, ExternalLinkAction, findTableNode, hasWorkspaceFilterCriteria, measureWorkspaceText, NameDialogState, overflowClassName, updateTable, workspaceCellPadding, WorkspaceHeaderContent, WorkspaceIcon, workspaceMinColumnWidth, WorkspaceModal, expandedFoldersStorageKey, type HeaderFilterState, type HeaderFilterTarget } from "../workspace/workspaceShared";
import type { WorkspaceCellValue, WorkspaceColumn, WorkspaceData, WorkspaceNode, WorkspaceRow, WorkspaceTable } from '../workspace/types';
import { MoveNodeDialog, NodeActionsDialog, TableCreateDialog } from "../workspace/workspaceActionDialogs";
import { CellInputDialog, ColumnConfig, ColumnVisibilityDialog, ConfirmDialog, HeaderFilterDialog, HiddenFieldsDialog, LinkInputDialog, NameDialog, WorkspaceSelectionDialog } from "../workspace/workspaceDialogs";
import { Tree } from "../workspace/workspaceSidebar";
import { clampDrawerOffset, getDrawerCloseSwipeOffset, getDrawerOpenSwipeOffset, shouldKeepDrawerOpen, useTableGestures } from "../workspace/useTableGestures";
import { useWorkspaceFilter } from "../workspace/useWorkspaceFilter";
import { useWorkspaceBrowserBack } from "../workspace/useWorkspaceBrowserBack";
import { useWorkspaceActions, type WorkspaceTableImportPreview } from "../workspace/useWorkspaceActions";
import { applyWorkspaceMultiSelectBatch, type WorkspaceBulkSelection } from '../workspace/bulkEdit';
import { WorkspaceBulkEditToolbar, WorkspaceBulkMultiSelectDialog, WorkspaceBulkNumberDialog } from '../workspace/workspaceBulkEdit';
import { WorkspacePasteDialog, WorkspaceTableImportPreviewDialog } from '../workspace/workspaceDataDialogs';
import { applyWorkspaceMatrixPaste, parseWorkspaceClipboard } from '../workspace/workspacePaste';
import { api } from '../lib/api';
import { savePwaLastRoute } from '../lib/pwaNavigation';
import { GoogleDriveBackupDialog } from '../workspace/googleDriveBackup/GoogleDriveBackupDialog';
import { useWorkspaceGoogleDriveBackup } from '../workspace/googleDriveBackup/useWorkspaceGoogleDriveBackup';

const workspaceCellKey = (rowId: string, columnId: string) => `${rowId}:${columnId}`;
const workspaceLineLimitStyle = (column: WorkspaceColumn) => ({ '--workspace-line-limit': column.lineLimit ? String(column.lineLimit) : undefined } as React.CSSProperties);
const workspaceFilterKeyLabel = (key: string) => key === 'empty:'
  ? '空白'
  : key.startsWith('text:')
    ? key.slice(5)
    : key.startsWith('number:')
      ? key.slice(7)
      : key.startsWith('date-month:')
        ? key.slice(11).replace('-', '/')
        : key.startsWith('link:')
          ? key.slice(5).split('\u0000')[0]
          : key;
const workspaceFilterSummary = (state?: HeaderFilterState) => {
  if (!state) return '';
  const parts: string[] = [];
  const query = state.query?.trim();
  if (query) parts.push(`含「${query}」`);
  if (state.min?.trim() || state.max?.trim()) parts.push(`${state.min?.trim() || '-∞'}～${state.max?.trim() || '+∞'}`);
  if (state.includedKeys !== null) {
    const selected = state.includedKeys.map(workspaceFilterKeyLabel);
    parts.push(selected.length ? `${selected.slice(0, 2).join('、')}${selected.length > 2 ? '…' : ''}` : '無結果');
  }
  if (state.sort) parts.push(state.sort === 'asc' ? '升冪' : '降冪');
  return parts.join(' · ');
};
const workspaceLastExportStorageKey = 'board-game-helper-workspace-last-export';
const workspaceBackupReminderMs = 7 * 24 * 60 * 60 * 1000;
const workspaceDrawerWidth = () => Math.min(360, window.innerWidth * 0.88);
const toggleBulkSelectionRow = (selection: WorkspaceBulkSelection, rowId: string): WorkspaceBulkSelection | undefined => {
  const selected = selection.rowIds.includes(rowId);
  const rowIds = selected ? selection.rowIds.filter((id) => id !== rowId) : [...selection.rowIds, rowId];
  if (rowIds.length === 0) return undefined;
  return { ...selection, rowIds };
};

const WorkspacePage = () => {
  const [data, setData] = useState<WorkspaceData>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerOffset, setDrawerOffset] = useState(0);
  const [drawerDragging, setDrawerDragging] = useState(false);
  const [drawerQuery, setDrawerQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ rowId: string; columnId: string }>();
  const [focusTarget, setFocusTarget] = useState<{ rowId: string; columnId: string }>();
  const [selectionEditor, setSelectionEditor] = useState<{ rowId: string; column: WorkspaceColumn; value: WorkspaceCellValue; options: string[]; isRowHeader: boolean }>();
  const [configuring, setConfiguring] = useState<{ column: WorkspaceColumn; isRowHeader: boolean }>();
  const [workspaceImport, setWorkspaceImport] = useState<WorkspaceData>();
  const [nodeMenu, setNodeMenu] = useState<WorkspaceNode>();
  const [movingNode, setMovingNode] = useState<WorkspaceNode>();
  const [editBarOpen, setEditBarOpen] = useState(false);
  const [historyByTable, setHistoryByTable] = useState<Map<string, WorkspaceTableHistory>>(new Map());
  const [tableActionsOpen, setTableActionsOpen] = useState(false);
  const [columnVisibilityOpen, setColumnVisibilityOpen] = useState(false);
  const [hiddenFieldsEditor, setHiddenFieldsEditor] = useState<{ rowId: string; title: string }>();
  const [tableCreateParentId, setTableCreateParentId] = useState<string | null | undefined>(undefined);
  const [nameDialog, setNameDialog] = useState<NameDialogState>();
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; onConfirm(): void }>();
  const [notice, setNotice] = useState('');
  const [viewportWidth, setViewportWidth] = useState(0);
  const [visualViewportHeight, setVisualViewportHeight] = useState<number>();
  const [bulkSelection, setBulkSelection] = useState<WorkspaceBulkSelection>();
  const [bulkEditorOpen, setBulkEditorOpen] = useState(false);
  const [pasteDialogOpen, setPasteDialogOpen] = useState(false);
  const [lastPasteTarget, setLastPasteTarget] = useState<{ rowId: string; columnId: string }>();
  const [tableImportPreview, setTableImportPreview] = useState<WorkspaceTableImportPreview>();
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [lastSavedAt, setLastSavedAt] = useState<number>();
  const [lastExportAt, setLastExportAt] = useState<number>(() => Number(window.localStorage.getItem(workspaceLastExportStorageKey)) || 0);
  const [googleDriveClientId, setGoogleDriveClientId] = useState<string | null | undefined>(undefined);

  const viewportRef = useRef<HTMLDivElement>(null);
  const filterbarRef = useRef<HTMLDivElement>(null);
  const workspacePageRef = useRef<HTMLElement>(null);
  const activeCellElementRef = useRef<HTMLElement | null>(null);
  const dataRef = useRef<WorkspaceData | undefined>(undefined);
  const historyRef = useRef(new Map<string, WorkspaceTableHistory>());
  const saveRevisionRef = useRef(0);
  const googleDriveClientIdPromiseRef = useRef<Promise<string | null> | undefined>(undefined);
  const drawerCloseTimerRef = useRef<number | undefined>(undefined);
  const drawerClickResetTimerRef = useRef<number | undefined>(undefined);
  const suppressNextDrawerClickRef = useRef(false);
  const drawerSwipeRef = useRef<{ pointerId: number; startX: number; startY: number; active: boolean; offset: number } | undefined>(undefined);

  const openDrawer = useCallback(() => {
    if (drawerCloseTimerRef.current !== undefined) window.clearTimeout(drawerCloseTimerRef.current);
    drawerCloseTimerRef.current = undefined;
    setDrawerOpen(true);
    setDrawerDragging(false);
    setDrawerOffset(workspaceDrawerWidth());
  }, []);
  const closeDrawer = useCallback(() => {
    setDrawerDragging(false);
    setDrawerOffset(0);
    if (drawerCloseTimerRef.current !== undefined) window.clearTimeout(drawerCloseTimerRef.current);
    drawerCloseTimerRef.current = window.setTimeout(() => {
      setDrawerOpen(false);
      drawerCloseTimerRef.current = undefined;
    }, 180);
  }, []);
  const updateDrawerFromOpenSwipe = useCallback((deltaX: number) => {
    if (drawerCloseTimerRef.current !== undefined) window.clearTimeout(drawerCloseTimerRef.current);
    drawerCloseTimerRef.current = undefined;
    const width = workspaceDrawerWidth();
    setDrawerOpen(true);
    setDrawerDragging(true);
    setDrawerOffset(getDrawerOpenSwipeOffset(deltaX, width));
  }, []);
  const settleDrawerFromOpenSwipe = useCallback((deltaX: number) => {
    const width = workspaceDrawerWidth();
    const offset = getDrawerOpenSwipeOffset(deltaX, width);
    setDrawerDragging(false);
    if (shouldKeepDrawerOpen(offset, width)) {
      setDrawerOpen(true);
      setDrawerOffset(width);
    } else {
      closeDrawer();
    }
  }, [closeDrawer]);
  const beginDrawerSwipe = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    drawerSwipeRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: false, offset: drawerOffset };
  }, [drawerOffset]);
  const moveDrawerSwipe = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const gesture = drawerSwipeRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    if (!gesture.active) {
      if (Math.hypot(deltaX, deltaY) <= 8) return;
      if (deltaX >= -8 || Math.abs(deltaY) >= Math.abs(deltaX)) {
        drawerSwipeRef.current = undefined;
        return;
      }
      gesture.active = true;
      suppressNextDrawerClickRef.current = true;
      setDrawerDragging(true);
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* The pointer may already have been cancelled. */ }
    }
    gesture.offset = getDrawerCloseSwipeOffset(deltaX, workspaceDrawerWidth());
    setDrawerOffset(gesture.offset);
    event.preventDefault();
  }, []);
  const endDrawerSwipe = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const gesture = drawerSwipeRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    drawerSwipeRef.current = undefined;
    if (!gesture.active) return;
    const width = workspaceDrawerWidth();
    const offset = clampDrawerOffset(gesture.offset, width);
    setDrawerDragging(false);
    if (shouldKeepDrawerOpen(offset, width)) setDrawerOffset(width);
    else closeDrawer();
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* The pointer may already have been released. */ }
    event.preventDefault();
    if (drawerClickResetTimerRef.current !== undefined) window.clearTimeout(drawerClickResetTimerRef.current);
    drawerClickResetTimerRef.current = window.setTimeout(() => {
      suppressNextDrawerClickRef.current = false;
      drawerClickResetTimerRef.current = undefined;
    }, 0);
  }, [closeDrawer]);
  const suppressDrawerSwipeClick = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!suppressNextDrawerClickRef.current) return;
    suppressNextDrawerClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  useEffect(() => {
    if (!drawerOpen) {
      setDrawerOffset(0);
      setDrawerDragging(false);
    }
  }, [drawerOpen]);
  useEffect(() => () => {
    if (drawerCloseTimerRef.current !== undefined) window.clearTimeout(drawerCloseTimerRef.current);
    if (drawerClickResetTimerRef.current !== undefined) window.clearTimeout(drawerClickResetTimerRef.current);
  }, []);

  const loadGoogleDriveClientId = useCallback(async () => {
    if (googleDriveClientId !== undefined) return googleDriveClientId;
    if (!googleDriveClientIdPromiseRef.current) {
      googleDriveClientIdPromiseRef.current = api.session().then((session) => {
        const clientId = session.googleDriveClientId ?? null;
        setGoogleDriveClientId(clientId);
        return clientId;
      }).catch(() => {
        setGoogleDriveClientId(null);
        return null;
      }).finally(() => { googleDriveClientIdPromiseRef.current = undefined; });
    }
    return googleDriveClientIdPromiseRef.current;
  }, [googleDriveClientId]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const reload = useCallback(async () => {
    const [loaded, histories] = await Promise.all([loadWorkspace(), loadWorkspaceHistories()]);
    setData(loaded);
    dataRef.current = loaded;
    historyRef.current = histories;
    setHistoryByTable(histories);
    setLastSavedAt(Math.max(0, ...loaded.tables.map((table) => table.updatedAt)) || undefined);
    const folderIds = new Set(loaded.nodes.filter((node) => node.type === 'folder').map((node) => node.id));
    let restored = new Set(folderIds);
    try {
      const stored = window.localStorage.getItem(expandedFoldersStorageKey);
      if (stored !== null) restored = new Set((JSON.parse(stored) as unknown[]).filter((id): id is string => typeof id === 'string' && folderIds.has(id)));
    } catch { /* Ignore damaged UI preferences. */ }
    let current = loaded.nodes.find((node) => node.id === loaded.activeNodeId);
    while (current?.parentId) {
      restored.add(current.parentId);
      current = loaded.nodes.find((node) => node.id === current?.parentId);
    }
    setExpanded(restored);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const commit = useCallback((next: WorkspaceData, explicitMutation?: WorkspaceTableMutation, options?: WorkspaceCommitOptions) => {
    const previous = dataRef.current;
    const mutation = explicitMutation ?? (previous ? inferWorkspaceTableMutation(previous, next) : undefined);
    const meaningfulChange = !previous || JSON.stringify({ nodes: previous.nodes, tables: previous.tables }) !== JSON.stringify({ nodes: next.nodes, tables: next.tables });
    const committed = meaningfulChange ? { ...next, updatedAt: Date.now() } : next;
    const removedTableIds = previous?.tables.filter((table) => !next.tables.some((item) => item.id === table.id)).map((table) => table.id) ?? [];
    setData(committed);
    dataRef.current = committed;
    if (options?.clearAllHistory) {
      historyRef.current = new Map();
      setHistoryByTable(new Map());
      void clearAllWorkspaceHistories();
    } else if (options?.clearTableHistoryIds?.length) {
      const nextHistories = new Map(historyRef.current);
      options.clearTableHistoryIds.forEach((tableId) => nextHistories.delete(tableId));
      historyRef.current = nextHistories;
      setHistoryByTable(nextHistories);
      void deleteWorkspaceHistories(options.clearTableHistoryIds);
    } else if (removedTableIds.length) {
      const nextHistories = new Map(historyRef.current);
      removedTableIds.forEach((tableId) => nextHistories.delete(tableId));
      historyRef.current = nextHistories;
      setHistoryByTable(nextHistories);
      void deleteWorkspaceHistories(removedTableIds);
    }
    if (mutation) {
      const currentHistory = historyRef.current.get(mutation.tableId) ?? createEmptyWorkspaceTableHistory(mutation.tableId);
      const nextHistory = pushWorkspaceTableHistory(currentHistory, mutation);
      const nextHistories = new Map(historyRef.current).set(mutation.tableId, nextHistory);
      historyRef.current = nextHistories;
      setHistoryByTable(nextHistories);
      void saveWorkspaceHistory(nextHistory);
    }
    const saveRevision = ++saveRevisionRef.current;
    setSaveState('saving');
      void saveWorkspace(committed).then(() => {
      if (saveRevision !== saveRevisionRef.current) return;
      setSaveState('saved');
      setLastSavedAt(Date.now());
    }).catch(() => {
      if (saveRevision !== saveRevisionRef.current) return;
      setSaveState('error');
      setNotice('本機儲存失敗，請先匯出資料備份');
    });
  }, []);

  const table = useMemo(() => data ? getTableForNode(data, data.activeNodeId) : undefined, [data]);
  const tableNode = useMemo(() => table && data ? findTableNode(data, table.id) : undefined, [data, table]);
  const rowHeader = useMemo(() => table ? getRowHeaderColumn(table) : undefined, [table]);
  const tableRowsById = useMemo(() => new Map(table?.rows.map((row) => [row.id, row]) ?? []), [table]);

  const {
    searchQuery, setSearchQuery, searchOpen, setSearchOpen,
    headerFilters, filterTarget, setFilterTarget, clearFilters,
    searchedRows, filteredRows, visibleColumns,
    activeFilterState, activeFilterOptions, activeFilterInputType, activeNumericValues,
    setActiveFilterSort, setActiveFilterQuery, setActiveFilterRange, setActiveFilterAggregate, toggleActiveFilterOption,
    updateActiveFilter, isHeaderFilterActive, viewStateReady, scrollPosition, setScrollPosition
  } = useWorkspaceFilter({ table, rowHeader, tableRowsById });

  const hiddenColumns = useMemo(() => table?.columns.filter((column) => column.hidden) ?? [], [table]);
  const displayedColumns = useMemo(() => visibleColumns.filter((column) => !column.hidden), [visibleColumns]);
  const searchFilterTargets = useMemo<HeaderFilterTarget[]>(() => {
    if (!table || !rowHeader) return [];
    if (table.transposed) return table.rows.map((row) => ({ axis: 'row', id: row.id, label: displayWorkspaceColumnValue(row.name, rowHeader) || '未命名物件' }));
    return [
      { axis: 'column', id: rowHeader.id, label: rowHeader.name || '未命名欄位' },
      ...displayedColumns.map((column) => ({ axis: 'column' as const, id: column.id, label: column.name || '未命名欄位' })),
    ];
  }, [displayedColumns, rowHeader, table]);
  const hasActiveSearchState = Boolean(searchQuery.trim()) || Object.values(headerFilters).some((state) => hasWorkspaceFilterCriteria(state) || Boolean(state.sort));
  const clearSearchAndFilters = useCallback(() => {
    setSearchQuery('');
    clearFilters();
    setSearchOpen(false);
  }, [clearFilters, setSearchOpen, setSearchQuery]);
  const hasHiddenColumns = hiddenColumns.length > 0;
  const hiddenOptionsByColumn = useMemo(() => Object.fromEntries(hiddenColumns.map((column) => [column.id, column.inputType === 'dynamic-select' && table ? getDynamicOptions(table, column.id) : column.options])), [hiddenColumns, table]);
  const bulkColumn = useMemo(() => bulkSelection && table?.id === bulkSelection.tableId ? table.columns.find((column) => column.id === bulkSelection.columnId) : undefined, [bulkSelection, table]);
  const bulkSelectedRowIds = useMemo(() => new Set(bulkSelection?.rowIds ?? []), [bulkSelection?.rowIds]);
  const bulkRows = useMemo(() => bulkSelection ? bulkSelection.rowIds.flatMap((rowId) => {
    const row = tableRowsById.get(rowId);
    return row ? [row] : [];
  }) : [], [bulkSelection, tableRowsById]);
  const bulkMultiSelectRows = useMemo(() => bulkColumn ? bulkRows.map((row) => ({ rowId: row.id, value: row.values[bulkColumn.id] ?? null })) : [], [bulkColumn, bulkRows]);
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
  const markExported = useCallback(() => {
    const now = Date.now();
    setLastExportAt(now);
    window.localStorage.setItem(workspaceLastExportStorageKey, String(now));
  }, []);
  const backupNeedsAttention = !lastExportAt || Date.now() - lastExportAt > workspaceBackupReminderMs;

  const driveBackup = useWorkspaceGoogleDriveBackup({
    data,
    loadGoogleClientId: loadGoogleDriveClientId,
    onRestored: (next) => setWorkspaceImport(next),
    setNotice,
  });

  useEffect(() => {
    if (searchOpen) setEditBarOpen(false);
  }, [searchOpen]);
  useEffect(() => {
    setBulkSelection(undefined);
    setBulkEditorOpen(false);
  }, [table?.id]);

  useEffect(() => {
    if (!data) return;
    window.localStorage.setItem(expandedFoldersStorageKey, JSON.stringify([...expanded]));
  }, [data, expanded]);

  const columnTextWidths = useMemo(() => {
    if (!table || !rowHeader) return [];
    const widthFor = (column: WorkspaceColumn, headerValue = column.name, values: WorkspaceCellValue[] = []) => {
      const shouldMeasureValues = column.overflowMode === 'expand' || Boolean(column.widthLimitChars);
      const measuredValues = shouldMeasureValues ? values.map((value) => measureWorkspaceText(displayWorkspaceColumnValue(value, column), 20, 400)) : [];
      const valueWidth = measuredValues.length ? Math.max(...measuredValues) : 0;
      const limitedValueWidth = column.overflowMode !== 'expand' && column.widthLimitChars
        ? Math.min(valueWidth, column.widthLimitChars * 20)
        : column.overflowMode === 'expand' ? valueWidth : 0;
      return Math.max(measureWorkspaceText(headerValue, 20, 600), limitedValueWidth) + (column.inputType === 'link' && column.overflowMode === 'expand' ? 46 : 0);
    };
    const rowHeaderValues = table.rows.map((row) => row.name);
    const rowHeaderWidth = widthFor(rowHeader, rowHeader.name, rowHeaderValues);
    if (!table.transposed) return [rowHeaderWidth, ...displayedColumns.map((column) => widthFor(column, column.name, table.rows.map((row) => row.values[column.id] ?? null)))];
    const properties = [rowHeader, ...displayedColumns];
    const propertyWidth = Math.max(...properties.map((column) => measureWorkspaceText(column.name, 20, 600)));
    const rowWidths = filteredRows.map((row) => Math.max(
      widthFor(rowHeader, displayWorkspaceColumnValue(row.name, rowHeader)),
      ...properties.map((column) => {
        if (column.overflowMode !== 'expand' && !column.widthLimitChars) return 0;
        const measured = measureWorkspaceText(displayWorkspaceColumnValue(column.id === rowHeader.id ? row.name : row.values[column.id] ?? null, column), 20, 400);
        const visibleWidth = column.overflowMode === 'expand' ? measured : column.widthLimitChars ? Math.min(measured, column.widthLimitChars * 20) : 0;
        return visibleWidth + (column.inputType === 'link' && column.overflowMode === 'expand' ? 46 : 0);
      }),
    ));
    return [propertyWidth, ...rowWidths];
  }, [displayedColumns, filteredRows, rowHeader, table]);

  const [localMinTextScale, setLocalMinTextScale] = useState(0.35);

  const startBulkSelection = useCallback((rowId: string, columnId: string) => {
    if (!table || !table.columns.some((column) => column.id === columnId)) return;
    if (bulkSelection) {
      if (bulkSelection.columnId !== columnId) {
        setNotice('批次編輯只能選取同一屬性的格子');
        return;
      }
      setBulkSelection(toggleBulkSelectionRow(bulkSelection, rowId));
      return;
    }
    setEditing(undefined);
    setSelectionEditor(undefined);
    setConfiguring(undefined);
    setSearchOpen(false);
    setEditBarOpen(false);
    setTableActionsOpen(false);
    setBulkSelection({ tableId: table.id, columnId, rowIds: [rowId] });
    setNotice('已進入批次選取');
  }, [bulkSelection, table, setSearchOpen]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === 'undefined') return;
    const update = () => setViewportWidth(viewport.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [table]);

  useEffect(() => {
    if (!columnTextWidths.length || !viewportWidth) return;
    const widthAt = (scale: number) => columnTextWidths.reduce((total, width) => total + Math.max(workspaceMinColumnWidth, width * scale + workspaceCellPadding), 0);
    if (widthAt(1) <= viewportWidth) { setLocalMinTextScale(1); return; }
    if (widthAt(0.1) >= viewportWidth) { setLocalMinTextScale(0.1); return; }
    let low = 0.1;
    let high = 1;
    for (let index = 0; index < 20; index += 1) {
      const middle = (low + high) / 2;
      if (widthAt(middle) <= viewportWidth) low = middle; else high = middle;
    }
    setLocalMinTextScale(low);
  }, [columnTextWidths, viewportWidth]);

  const openSearchFromGesture = useCallback(() => {
    setSearchOpen(true);
    setEditBarOpen(false);
    setTableActionsOpen(false);
  }, []);

  const {
    textScale, panning, tableReorderVisual, ignoreNextTableClick,
    applyTextScale,
    beginTableReorder, moveTableReorder, endTableReorder,
    beginTablePan, moveTablePan, endTablePan,
  } = useTableGestures({ table, data, commit, viewportRef, workspacePageRef, setNotice, minTextScale: localMinTextScale, onCellLongPress: startBulkSelection, onDrawerSwipeProgress: updateDrawerFromOpenSwipe, onDrawerSwipeEnd: settleDrawerFromOpenSwipe, onOpenSearch: openSearchFromGesture, searchOpen });

  const {
    importTableInputRef, importWorkspaceInputRef, importTableParentId,
    openNameDialog, addFolder, addTable, renameNode, submitName,
    askDeleteNode, relocateNode, openNode, saveCellValue, updateCell, openCell,
    selectCellValue, addRow, askDeleteRow, addColumn, askDeleteColumn, saveColumn,
    exportCurrent, exportAll, chooseImport, readImport, finishTableImport, finishWorkspaceImport
  } = useWorkspaceActions({
    data, table, rowHeader, commit, setNotice, setExpanded, setDrawerOpen,
    setEditing, setFocusTarget, setSelectionEditor, setConfiguring, setNodeMenu, setMovingNode,
    setTableActionsOpen, setTableCreateParentId, setNameDialog,
    setConfirmDialog, setWorkspaceImport, setTableImportPreview, onExported: markExported,
    nameDialog, selectionEditor, configuring, workspaceImport
  });

  const handleDataCellClick = useCallback((row: WorkspaceRow, column: WorkspaceColumn) => {
    setLastPasteTarget({ rowId: row.id, columnId: column.id });
    if (!bulkSelection) {
      openCell(row, column);
      return;
    }
    if (bulkSelection.columnId !== column.id) {
      setNotice('批次編輯只能選取同一屬性的格子');
      return;
    }
    setBulkSelection(toggleBulkSelectionRow(bulkSelection, row.id));
  }, [bulkSelection, openCell]);

  const closeBulkSelection = useCallback(() => {
    setBulkSelection(undefined);
    setBulkEditorOpen(false);
  }, []);

  const commitBulkCellUpdates = useCallback((updates: Array<{ rowId: string; value: WorkspaceCellValue }>) => {
    const currentData = dataRef.current;
    if (!currentData || !table || !bulkSelection || !bulkColumn) return;
    const valuesByRowId = new Map(updates.map((update) => [update.rowId, update.value]));
    const changes = table.rows.flatMap((row) => {
      if (!valuesByRowId.has(row.id)) return [];
      const before = row.values[bulkColumn.id] ?? null;
      const after = valuesByRowId.get(row.id)!;
      return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ rowId: row.id, before, after }];
    });
    if (changes.length === 0) {
      setNotice('選取的格子沒有變更');
      closeBulkSelection();
      return;
    }
    const values = new Map(changes.map((change) => [change.rowId, change.after]));
    const next = updateTable(currentData, table.id, (current) => ({
      ...current,
      updatedAt: Date.now(),
      rows: current.rows.map((row) => values.has(row.id) ? { ...row, values: { ...row.values, [bulkColumn.id]: values.get(row.id)! } } : row),
    }));
    commit(next, { tableId: table.id, label: `批次編輯 ${bulkColumn.name}`, action: { type: 'set-cells', columnId: bulkColumn.id, changes } });
    setNotice(`已更新 ${changes.length} 格`);
    closeBulkSelection();
  }, [bulkColumn, bulkSelection, closeBulkSelection, commit, table]);

  const commitBulkSelection = useCallback((draft: { sharedValue: WorkspaceCellValue; distributedValues?: Record<string, number> }) => {
    if (!bulkSelection) return;
    commitBulkCellUpdates(bulkSelection.rowIds.map((rowId) => ({ rowId, value: draft.distributedValues?.[rowId] ?? draft.sharedValue })));
  }, [bulkSelection, commitBulkCellUpdates]);

  const bulkInitialValue = bulkRows[0] && bulkColumn ? bulkRows[0].values[bulkColumn.id] ?? null : null;
  const bulkDraftValue = bulkInitialValue;

  const pasteTarget = useMemo(() => {
    if (!table || !rowHeader || !table.rows.length) return undefined;
    const requested = lastPasteTarget ?? focusTarget;
    const requestedRow = requested && table.rows.some((row) => row.id === requested.rowId) ? requested.rowId : table.rows[0].id;
    const requestedColumn = requested && [rowHeader.id, ...table.columns.map((column) => column.id)].includes(requested.columnId) ? requested.columnId : rowHeader.id;
    return { rowId: requestedRow, columnId: requestedColumn };
  }, [focusTarget, lastPasteTarget, rowHeader, table]);
  const pasteTargetLabel = useMemo(() => {
    if (!table || !rowHeader || !pasteTarget) return '';
    const row = table.rows.find((item) => item.id === pasteTarget.rowId);
    const column = pasteTarget.columnId === rowHeader.id ? rowHeader : table.columns.find((item) => item.id === pasteTarget.columnId);
    return `${row ? displayWorkspaceColumnValue(row.name, rowHeader) || `第 ${table.rows.indexOf(row) + 1} 個物件` : ''}／${column?.name || '未命名屬性'}`;
  }, [pasteTarget, rowHeader, table]);
  const pasteMatrix = useCallback((matrix: string[][]) => {
    const currentData = dataRef.current;
    const currentTable = currentData ? getTableForNode(currentData, currentData.activeNodeId) : undefined;
    if (!currentData || !currentTable || !pasteTarget) return;
    const result = applyWorkspaceMatrixPaste(currentTable, pasteTarget.rowId, pasteTarget.columnId, matrix);
    if (result.invalidCells.length) {
      const first = result.invalidCells[0];
      setNotice(`第 ${first.row} 列第 ${first.column} 欄的「${first.value}」不符合欄位型態`);
      return;
    }
    if (!result.changes.length && !result.addedRows.length && !result.addedColumns.length) {
      setNotice('貼上的內容沒有造成變更');
      setPasteDialogOpen(false);
      return;
    }
    const height = matrix.length;
    const width = Math.max(0, ...matrix.map((row) => row.length));
    commit(updateTable(currentData, currentTable.id, () => result.table), {
      tableId: currentTable.id,
      label: `貼上 ${height} × ${width} 格`,
      action: { type: 'paste-range', changes: result.changes, addedRows: result.addedRows, addedColumns: result.addedColumns },
    });
    setPasteDialogOpen(false);
    setNotice(`已貼上 ${height} × ${width} 格`);
  }, [commit, pasteTarget]);
  const handleWorkspacePaste = useCallback((event: React.ClipboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && !window.matchMedia('(pointer: fine)').matches) return;
    if (target.closest('input, textarea, select, [contenteditable="true"]') || !pasteTarget || (!lastPasteTarget && !focusTarget)) return;
    const text = event.clipboardData.getData('text/plain');
    if (!text) return;
    event.preventDefault();
    pasteMatrix(parseWorkspaceClipboard(text));
  }, [focusTarget, lastPasteTarget, pasteMatrix, pasteTarget]);

  const toggleColumnVisibility = (columnId: string) => {
    const currentData = dataRef.current;
    const currentTable = currentData ? getTableForNode(currentData, currentData.activeNodeId) : undefined;
    if (!currentData || !currentTable) return;
    commit(updateTable(currentData, currentTable.id, (current) => ({
      ...current,
      updatedAt: Date.now(),
      columns: current.columns.map((column) => column.id === columnId ? { ...column, hidden: !column.hidden } : column),
    })));
  };
  const openHiddenFields = (row: WorkspaceRow) => setHiddenFieldsEditor({ rowId: row.id, title: rowHeader ? displayWorkspaceColumnValue(row.name, rowHeader) : '' });
  const saveHiddenFields = (rowId: string, values: Record<string, WorkspaceCellValue>) => {
    let currentData = dataRef.current;
    if (!currentData) return;
    let currentTable = getTableForNode(currentData, currentData.activeNodeId);
    const row = currentTable?.rows.find((item) => item.id === rowId);
    if (!currentTable || !row) return;
    const tableId = currentTable.id;
    for (const column of currentTable.columns.filter((item) => item.hidden)) {
      const before = row.values[column.id] ?? null;
      const after = values[column.id] ?? null;
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      currentData = updateTable(currentData, tableId, (current) => ({
        ...current,
        updatedAt: Date.now(),
        rows: current.rows.map((item) => item.id === rowId ? { ...item, values: { ...item.values, [column.id]: after } } : item),
      }));
      commit(currentData);
      currentTable = getTableForNode(currentData, currentData.activeNodeId);
    }
    setHiddenFieldsEditor(undefined);
  };

  const moveTableHistory = useCallback((direction: 'undo' | 'redo') => {
    if (!data || !table) return;
    const currentHistory = historyRef.current.get(table.id) ?? createEmptyWorkspaceTableHistory(table.id);
    const source = direction === 'undo' ? currentHistory.past : currentHistory.future;
    const entry = source[source.length - 1];
    if (!entry) return;
    const nextData = applyWorkspaceTableHistoryActionWithNode(data, table.id, entry.action, direction);
    const nextHistory: WorkspaceTableHistory = direction === 'undo'
      ? { tableId: table.id, past: currentHistory.past.slice(0, -1), future: [...currentHistory.future, entry] }
      : { tableId: table.id, past: [...currentHistory.past, entry], future: currentHistory.future.slice(0, -1) };
    const nextHistories = new Map(historyRef.current).set(table.id, nextHistory);
    historyRef.current = nextHistories;
    setHistoryByTable(nextHistories);
    setData(nextData);
    dataRef.current = nextData;
    setEditing(undefined);
    setSelectionEditor(undefined);
    const saveRevision = ++saveRevisionRef.current;
    setSaveState('saving');
    void saveWorkspace(nextData).then(() => {
      if (saveRevision !== saveRevisionRef.current) return;
      setSaveState('saved');
      setLastSavedAt(Date.now());
    }).catch(() => {
      if (saveRevision !== saveRevisionRef.current) return;
      setSaveState('error');
      setNotice('本機儲存失敗');
    });
    void saveWorkspaceHistory(nextHistory);
    setNotice(direction === 'undo' ? `已復原：${entry.label}` : `已重做：${entry.label}`);
  }, [data, table]);

  const undoTable = useCallback(() => moveTableHistory('undo'), [moveTableHistory]);
  const redoTable = useCallback(() => moveTableHistory('redo'), [moveTableHistory]);
  const currentTableHistory = table ? historyByTable.get(table.id) : undefined;

  const layoutViewportWidth = table?.transposed || !hasHiddenColumns ? viewportWidth : Math.max(0, viewportWidth - 44);
  const { columnWidths, tableWidth } = useMemo(() => calculateWorkspaceTableLayout(columnTextWidths, textScale, layoutViewportWidth), [columnTextWidths, layoutViewportWidth, textScale]);
  const renderedColumnWidths = table?.transposed || !hasHiddenColumns ? columnWidths : [...columnWidths, 44];
  const renderedTableWidth = table?.transposed || !hasHiddenColumns ? tableWidth : tableWidth + 44;
  const filterbarSlots = useMemo<Array<HeaderFilterTarget | undefined>>(() => {
    if (!table) return [];
    const slots: Array<HeaderFilterTarget | undefined> = table.transposed ? [undefined, ...searchFilterTargets] : [...searchFilterTargets];
    if (!table.transposed && hasHiddenColumns) slots.push(undefined);
    return slots;
  }, [hasHiddenColumns, searchFilterTargets, table]);
  const filterbarTrackStyle = { gridTemplateColumns: renderedColumnWidths.map((width) => `${width}px`).join(' '), width: `${renderedTableWidth}px` };

  const activeEditingRow = editing && table ? table.rows.find((item) => item.id === editing.rowId) : undefined;
  const activeEditingRowIndex = activeEditingRow && table ? table.rows.findIndex((item) => item.id === activeEditingRow.id) : -1;
  const activeEditingColumn = editing && table ? editing.columnId === rowHeader?.id ? rowHeader : table.columns.find((item) => item.id === editing.columnId) : undefined;
  const activeEditingValue = activeEditingRow && activeEditingColumn ? activeEditingColumn.id === rowHeader?.id ? activeEditingRow.name : activeEditingRow.values[activeEditingColumn.id] : null;
  const hiddenEditorRow = hiddenFieldsEditor && table ? table.rows.find((row) => row.id === hiddenFieldsEditor.rowId) : undefined;
  const activeCell = editing ?? (selectionEditor ? { rowId: selectionEditor.rowId, columnId: selectionEditor.column.id } : undefined) ?? (bulkSelection?.rowIds[0] ? { rowId: bulkSelection.rowIds[0], columnId: bulkSelection.columnId } : focusTarget);
  const activeCellKey = activeCell ? workspaceCellKey(activeCell.rowId, activeCell.columnId) : undefined;

  const browserBackLayer = driveBackup.dialogOpen
    ? 'google-drive'
    : confirmDialog
      ? 'confirm'
      : workspaceImport
        ? 'workspace-import'
        : tableImportPreview
          ? 'table-import'
          : pasteDialogOpen
            ? 'paste'
            : hiddenFieldsEditor
              ? 'hidden-fields'
              : bulkEditorOpen
                ? 'bulk-editor'
                : filterTarget
                  ? 'filter'
                  : configuring
                    ? 'column-config'
                    : selectionEditor
                      ? 'selection-editor'
                      : editing
                        ? 'cell-editor'
                        : movingNode
                          ? 'move-node'
                          : nodeMenu
                            ? 'node-menu'
                            : tableCreateParentId !== undefined
                              ? 'table-create'
                              : nameDialog
                                ? 'name-editor'
                                : columnVisibilityOpen
                                  ? 'column-visibility'
                                  : tableActionsOpen
                                    ? 'table-actions'
                                    : drawerOpen
                                      ? 'drawer'
                                      : bulkSelection
                                        ? 'bulk-selection'
                                        : editBarOpen
                                          ? 'edit-bar'
                                          : searchOpen || hasActiveSearchState
                                            ? 'search'
                                            : undefined;

  const dismissBrowserLayer = useCallback(() => {
    switch (browserBackLayer) {
      case 'google-drive': driveBackup.close(); break;
      case 'confirm': setConfirmDialog(undefined); break;
      case 'workspace-import': setWorkspaceImport(undefined); break;
      case 'table-import': setTableImportPreview(undefined); break;
      case 'paste': setPasteDialogOpen(false); break;
      case 'hidden-fields': setHiddenFieldsEditor(undefined); break;
      case 'bulk-editor': setBulkEditorOpen(false); break;
      case 'filter': setFilterTarget(undefined); break;
      case 'column-config': setConfiguring(undefined); break;
      case 'selection-editor': setSelectionEditor(undefined); break;
      case 'cell-editor': setEditing(undefined); break;
      case 'move-node': setMovingNode(undefined); break;
      case 'node-menu': setNodeMenu(undefined); break;
      case 'table-create': setTableCreateParentId(undefined); break;
      case 'name-editor': setNameDialog(undefined); break;
      case 'column-visibility': setColumnVisibilityOpen(false); break;
      case 'table-actions': setTableActionsOpen(false); break;
      case 'drawer': closeDrawer(); break;
      case 'bulk-selection': closeBulkSelection(); break;
      case 'edit-bar': setEditBarOpen(false); break;
      case 'search': clearSearchAndFilters(); break;
      default: break;
    }
  }, [browserBackLayer, clearSearchAndFilters, closeBulkSelection, closeDrawer, driveBackup]);

  useWorkspaceBrowserBack({ active: Boolean(browserBackLayer), onBack: dismissBrowserLayer });

  useEffect(() => {
    if (!focusTarget) return;
    const timer = window.setTimeout(() => setFocusTarget(undefined), 3000);
    return () => window.clearTimeout(timer);
  }, [focusTarget]);

  const keepActiveCellVisible = useCallback(() => {
    const element = activeCellElementRef.current;
    const viewport = viewportRef.current;
    if (element && viewport) ensureWorkspaceCellVisible(element, viewport);
  }, []);
  const setActiveCellElement = useCallback((element: HTMLElement | null) => {
    activeCellElementRef.current = element;
  }, []);
  const syncFilterbarScroll = useCallback((source: HTMLDivElement) => {
    const viewport = viewportRef.current;
    const filterbar = filterbarRef.current;
    if (!viewport || !filterbar) return;
    if (source === viewport) filterbar.scrollLeft = viewport.scrollLeft;
    else viewport.scrollLeft = filterbar.scrollLeft;
  }, []);

  const scrollSaveTimerRef = useRef<number | undefined>(undefined);
  const handleTableViewportScroll = useCallback((source: HTMLDivElement) => {
    syncFilterbarScroll(source);
    if (scrollSaveTimerRef.current !== undefined) window.clearTimeout(scrollSaveTimerRef.current);
    scrollSaveTimerRef.current = window.setTimeout(() => {
      scrollSaveTimerRef.current = undefined;
      setScrollPosition({ left: source.scrollLeft, top: source.scrollTop });
    }, 120);
  }, [setScrollPosition, syncFilterbarScroll]);

  useEffect(() => () => {
    if (scrollSaveTimerRef.current !== undefined) window.clearTimeout(scrollSaveTimerRef.current);
  }, []);

  useEffect(() => {
    if (!table?.id || !viewStateReady) return;
    const frame = window.requestAnimationFrame(() => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      viewport.scrollLeft = scrollPosition.left;
      viewport.scrollTop = scrollPosition.top;
      syncFilterbarScroll(viewport);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [syncFilterbarScroll, table?.id, viewStateReady]);

  useEffect(() => {
    if (!searchOpen || !filterbarRef.current || !viewportRef.current) return;
    filterbarRef.current.scrollLeft = viewportRef.current.scrollLeft;
  }, [renderedTableWidth, searchOpen]);

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

  const workspacePageStyle = activeCellKey && visualViewportHeight ? {
    height: `${visualViewportHeight}px`,
    minHeight: `${visualViewportHeight}px`,
    maxHeight: `${visualViewportHeight}px`,
  } as React.CSSProperties : undefined;
  const workspaceToolbarRowCount = Number(Boolean(bulkSelection && bulkColumn)) + Number(searchOpen) + Number(editBarOpen || tableActionsOpen);

  if (!data) return <section className="workspace-page workspace-loading"><p>正在開啟本地 Workspace…</p></section>;

  return <section ref={workspacePageRef} className="workspace-page" style={workspacePageStyle} onPaste={handleWorkspacePaste}>
    <h1 className="sr-only">動態表格</h1>
    <header className="workspace-appbar">
      <div className="workspace-appbar-leading">
        <button type="button" className="workspace-appbar-button workspace-menu-button" aria-label={searchOpen ? '清除搜尋與篩選' : '開啟目錄'} onClick={searchOpen ? clearSearchAndFilters : openDrawer} disabled={!table}><WorkspaceIcon name={searchOpen ? 'filter-off' : 'menu'} size={29} /></button>
        {searchOpen ? <div className="workspace-appbar-search" role="search"><input type="text" role="searchbox" aria-label={bulkSelection ? '搜尋後繼續選取' : '搜尋此表'} placeholder={bulkSelection ? '搜尋後繼續選取' : '搜尋此表'} inputMode="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} autoFocus /><span className="workspace-appbar-search-count">{filteredRows.length} / {table?.rows.length ?? 0}</span></div> : <button type="button" className={`workspace-appbar-title ${nameDialog?.node?.id === tableNode?.id ? 'is-editing' : ''}`} onClick={() => tableNode && renameNode(tableNode)} disabled={!tableNode} aria-label="重新命名表格"><span>{table?.name ?? '動態表格'}</span></button>}
      </div>
      <div className="workspace-appbar-actions">
        <button type="button" className={`workspace-appbar-button ${searchOpen ? 'active' : ''} ${hasActiveSearchState ? 'has-active-filter' : ''}`} aria-label={bulkSelection ? '搜尋並繼續批次選取' : '搜尋'} onClick={() => { if (!bulkSelection) closeBulkSelection(); setSearchOpen((open) => !open); }} disabled={!table}><WorkspaceIcon name="search" size={29} /></button>
        <button type="button" className={`workspace-appbar-button ${editBarOpen ? 'active' : ''}`} aria-label="編輯" onClick={() => { closeBulkSelection(); setEditBarOpen((open) => !open); setTableActionsOpen(false); setSearchOpen(false); }} disabled={!table}><WorkspaceIcon name="edit" size={29} /></button>
        <button type="button" className={`workspace-appbar-button ${tableActionsOpen ? 'active' : ''}`} aria-label="設定" onClick={() => { closeBulkSelection(); setTableActionsOpen((open) => !open); setEditBarOpen(false); setSearchOpen(false); }} disabled={!table}><WorkspaceIcon name="settings" size={29} /></button>
      </div>
      {notice && <div className="workspace-notice workspace-appbar-notice" role="status">{notice}</div>}
    </header>
    <div className="workspace-toolbar-layer" style={{ '--workspace-toolbar-row-count': workspaceToolbarRowCount } as React.CSSProperties}>
    {bulkSelection && bulkColumn && <WorkspaceBulkEditToolbar column={bulkColumn} count={bulkSelection.rowIds.length} onCancel={closeBulkSelection} onOpenEditor={() => setBulkEditorOpen(true)} />}
    {searchOpen && table && <div ref={filterbarRef} className={`workspace-filterbar${bulkSelection && bulkColumn ? ' has-bulk-toolbar' : ''}`} aria-label="欄位篩選工具列" onScroll={(event) => syncFilterbarScroll(event.currentTarget)}><div className="workspace-filterbar-scroll" style={filterbarTrackStyle}>{filterbarSlots.map((target, index) => target ? (() => { const state = headerFilters[`${target.axis}:${target.id}`]; const active = isHeaderFilterActive(target.axis, target.id); const summary = workspaceFilterSummary(state); return <button key={`${target.axis}:${target.id}`} type="button" className={`workspace-filterbar-button ${index === 0 ? 'is-frozen' : ''} ${active ? 'is-filtered' : ''}`} aria-label={`篩選 ${target.label}`} aria-pressed={active} onClick={() => setFilterTarget(target)}><WorkspaceIcon name="filter" size={15} />{summary && <small>{summary}</small>}</button>; })() : <span key={`filterbar-spacer-${index}`} className={`workspace-filterbar-spacer ${index === 0 ? 'is-frozen' : ''}`} aria-hidden="true" />)}</div></div>}
    {editBarOpen && table && <div className="workspace-editbar" aria-label="編輯工具列">
      <div className="workspace-editbar-group workspace-editbar-history">
        <button type="button" className="workspace-editbar-button" aria-label="復原" title={currentTableHistory?.past.at(-1) ? `復原：${currentTableHistory.past.at(-1)!.label}` : '沒有可復原的操作'} onClick={undoTable} disabled={!currentTableHistory?.past.length}><WorkspaceIcon name="undo" size={22} /></button>
        <button type="button" className="workspace-editbar-button" aria-label="重做" title={currentTableHistory?.future.at(-1) ? `重做：${currentTableHistory.future.at(-1)!.label}` : '沒有可重做的操作'} onClick={redoTable} disabled={!currentTableHistory?.future.length}><WorkspaceIcon name="redo" size={22} /></button>
        <button type="button" className="workspace-editbar-button workspace-paste-button" aria-label="貼上多格" onClick={() => setPasteDialogOpen(true)} disabled={!pasteTarget}><WorkspaceIcon name="clipboard" size={21} /></button>
      </div>
      <div className="workspace-editbar-group workspace-editbar-add">
        <button type="button" className="workspace-editbar-button" aria-label="新增物件" onClick={addRow}><WorkspaceIcon name="rows-plus" size={24} /></button>
        <button type="button" className="workspace-editbar-button" aria-label="新增屬性" onClick={addColumn}><WorkspaceIcon name="columns-plus" size={24} /></button>
      </div>
    </div>}
    {tableActionsOpen && table && <div className="workspace-editbar workspace-table-toolsbar" aria-label="表格工具列">
      <div className="workspace-editbar-group"><button type="button" className="workspace-editbar-button" aria-label="匯出此表" onClick={exportCurrent}><WorkspaceIcon name="download" size={22} /></button></div>
      <div className="workspace-editbar-group"><button type="button" className="workspace-editbar-button" aria-label="欄位顯示設定" onClick={() => setColumnVisibilityOpen(true)}><WorkspaceIcon name="visibility" size={23} /></button></div>
    </div>}
    <div className={`workspace-body ${drawerOpen ? 'drawer-is-open' : ''}`}>
      <main className="workspace-main">
        {!table || !tableNode ? <div className="workspace-empty"><div className="workspace-empty-icon"><WorkspaceIcon name="table" size={34} /></div><h2>建立你的第一張表格</h2><p>資料只會儲存在這個瀏覽器。你可以建立桌遊收藏，也可以建立任何自己的資料表。</p><button type="button" className="workspace-dialog-button primary" onClick={() => addTable(null)}>建立表格</button></div> : <>
          <div ref={viewportRef} className={`workspace-table-viewport ${panning ? 'is-panning' : ''}`} onScroll={(event) => handleTableViewportScroll(event.currentTarget)} onPointerDown={beginTablePan} onPointerMove={(event) => { if (!moveTableReorder(event)) moveTablePan(event); }} onPointerUp={(event) => { if (!endTableReorder(event)) endTablePan(event); }} onPointerCancel={(event) => { if (!endTableReorder(event)) endTablePan(event); }} onClickCapture={(event) => { if (ignoreNextTableClick.current) { event.preventDefault(); event.stopPropagation(); ignoreNextTableClick.current = false; } }}>
            <table className={`workspace-table ${table.transposed ? 'is-transposed' : ''}`} style={{ '--workspace-text-scale': textScale, width: `${renderedTableWidth}px` } as React.CSSProperties}>
              <colgroup>{renderedColumnWidths.map((width, index) => <col key={index} style={{ width: `${width}px` }} />)}</colgroup>
              {!table.transposed ? <><thead><tr>
                {rowHeader && <th className={`workspace-row-corner ${overflowClassName(rowHeader)} ${configuring?.isRowHeader ? 'is-editing' : ''}${activeCell?.columnId === rowHeader.id ? ' workspace-context-active' : ''}`} style={{ textAlign: 'center', ...workspaceLineLimitStyle(rowHeader) }} onClick={() => setConfiguring({ column: rowHeader, isRowHeader: true })}><WorkspaceHeaderContent label={rowHeader.name} nameClass="workspace-row-axis-name" filterActive={isHeaderFilterActive('column', rowHeader.id)} onFilter={() => setFilterTarget({ axis: 'column', id: rowHeader.id, label: rowHeader.name })} /></th>}
                 {displayedColumns.map((column) => {
                  const isSource = tableReorderVisual?.kind === 'column' && tableReorderVisual.sourceId === column.id;
                  const isTarget = tableReorderVisual?.kind === 'column' && tableReorderVisual.targetId === column.id;
                  return <th key={column.id} data-column-id={column.id} className={`${overflowClassName(column)} ${configuring?.column.id === column.id && !configuring.isRowHeader ? 'is-editing ' : ''}${activeCell?.columnId === column.id ? 'workspace-context-active ' : ''}${isSource ? 'is-reorder-source ' : ''}${isTarget ? tableReorderVisual.after ? 'is-drop-after' : 'is-drop-before' : ''}`} style={{ textAlign: 'center', ...workspaceLineLimitStyle(column) }} onPointerDown={(event) => beginTableReorder('column', column.id, event)} onClick={() => setConfiguring({ column, isRowHeader: false })} onContextMenu={(event) => { event.preventDefault(); }}><WorkspaceHeaderContent label={column.name} nameClass="workspace-column-name" filterActive={isHeaderFilterActive('column', column.id)} onFilter={() => setFilterTarget({ axis: 'column', id: column.id, label: column.name })} /></th>;
                 })}
                 {hasHiddenColumns && <th className="workspace-hidden-columns-heading" aria-label="隱藏欄位"><WorkspaceIcon name="eye-off" size={17} /></th>}
               </tr></thead>
              <tbody>{filteredRows.map((row) => {
                const originalIndex = table.rows.findIndex((item) => item.id === row.id);
                const rowLabel = displayWorkspaceColumnValue(row.name, rowHeader!);
                const rowAccessibleLabel = rowLabel || `第 ${originalIndex + 1} 個物件`;
                const isSource = tableReorderVisual?.kind === 'row' && tableReorderVisual.sourceId === row.id;
                const isTarget = tableReorderVisual?.kind === 'row' && tableReorderVisual.targetId === row.id;
                const isRowHeaderActive = activeCell?.rowId === row.id && activeCell.columnId === rowHeader?.id;
                 const isActiveRow = activeCell?.rowId === row.id || bulkSelectedRowIds.has(row.id);
                return <tr key={row.id}>
                  {rowHeader && <th scope="row" data-row-id={row.id} data-cell-id={workspaceCellKey(row.id, rowHeader.id)} ref={isRowHeaderActive ? setActiveCellElement : undefined} className={`workspace-row-heading ${overflowClassName(rowHeader)} ${isRowHeaderActive ? 'is-editing ' : ''}${isActiveRow ? 'workspace-context-active ' : ''}${isSource ? 'is-reorder-source ' : ''}${isTarget ? tableReorderVisual.after ? 'is-drop-after' : 'is-drop-before' : ''}`} style={{ textAlign: rowHeader.alignment ?? 'left', ...workspaceLineLimitStyle(rowHeader) }} onPointerDown={(event) => beginTableReorder('row', row.id, event)} onClick={() => { setLastPasteTarget({ rowId: row.id, columnId: rowHeader.id }); openCell(row, rowHeader); }} onContextMenu={(event) => { event.preventDefault(); }}><div className="workspace-cell-layout"><button type="button" className="workspace-row-name" aria-label={`編輯物件 ${rowAccessibleLabel}`}><span className="workspace-cell-value" style={{ color: workspaceCellColor(rowHeader, row.name) }}>{rowLabel}</span></button><ExternalLinkAction value={row.name} pushWidth={rowHeader.inputType === 'link' && rowHeader.overflowMode === 'expand'} /></div></th>}
                   {displayedColumns.map((column) => {
                    const value = row.values[column.id] ?? null;
                    const displayValue = displayWorkspaceColumnValue(value, column);
                    const isActive = activeCellKey === workspaceCellKey(row.id, column.id);
                    const multiChips = column.isMultiple && typeof value === 'string' ? parseMultiSelectValues(value) : [];
                     const isBulkSelected = bulkSelection?.columnId === column.id && bulkSelectedRowIds.has(row.id);
                     return <td key={column.id} data-bulk-row-id={row.id} data-bulk-column-id={column.id} data-cell-id={workspaceCellKey(row.id, column.id)} ref={isActive ? setActiveCellElement : undefined} className={`${overflowClassName(column)} ${isActive ? 'is-editing ' : ''}${isBulkSelected ? 'is-bulk-selected' : ''}`} style={{ textAlign: column.alignment ?? 'left', ...workspaceLineLimitStyle(column) }} aria-label={`${rowAccessibleLabel}，${column.name || '未命名屬性'}：${displayValue || '空白'}`} aria-selected={isBulkSelected} onClick={() => handleDataCellClick(row, column)}>
                      <div className="workspace-cell-layout">
                          {multiChips.length > 0 ? (
                          <div className="workspace-multi-chip-list workspace-cell-value">
                             {multiChips.map((chip, idx) => <span key={idx} className="workspace-multi-chip" style={{ color: workspaceOptionColor(column, chip) }}>{chip}</span>)}
                          </div>
                        ) : (
                           <span className={`workspace-cell-value ${displayValue ? '' : 'workspace-empty-cell'}`} style={{ color: workspaceCellColor(column, value) }}>{displayValue}</span>
                        )}
                        <ExternalLinkAction value={value} pushWidth={column.inputType === 'link' && column.overflowMode === 'expand'} />
                      </div>
                    </td>;
                   })}
                   {hasHiddenColumns && <td className="workspace-hidden-columns-cell"><button type="button" className="workspace-hidden-fields-trigger" aria-label={`編輯 ${rowAccessibleLabel} 的隱藏欄位`} onClick={(event) => { event.stopPropagation(); openHiddenFields(row); }}><WorkspaceIcon name="chevron" size={20} /></button></td>}
                 </tr>;
              })}</tbody></> : <><thead><tr>
                {rowHeader && <th className={`workspace-row-corner ${overflowClassName(rowHeader)} ${configuring?.isRowHeader ? 'is-editing' : ''}${activeCell?.columnId === rowHeader.id ? ' workspace-context-active' : ''}`} style={{ textAlign: 'center', ...workspaceLineLimitStyle(rowHeader) }} onClick={() => setConfiguring({ column: rowHeader, isRowHeader: true })}><WorkspaceHeaderContent label={rowHeader.name} nameClass="workspace-row-axis-name" filterActive={isHeaderFilterActive('column', rowHeader.id)} onFilter={() => setFilterTarget({ axis: 'column', id: rowHeader.id, label: rowHeader.name })} /></th>}
                {filteredRows.map((row) => {
                  const originalIndex = table.rows.findIndex((item) => item.id === row.id);
                  const rowLabel = displayWorkspaceColumnValue(row.name, rowHeader!);
                  const rowAccessibleLabel = rowLabel || `第 ${originalIndex + 1} 個物件`;
                  const isSource = tableReorderVisual?.kind === 'row' && tableReorderVisual.sourceId === row.id;
                  const isTarget = tableReorderVisual?.kind === 'row' && tableReorderVisual.targetId === row.id;
                  const isActive = activeCell?.rowId === row.id && activeCell.columnId === rowHeader?.id;
                     return <th key={row.id} data-row-id={row.id} data-cell-id={workspaceCellKey(row.id, rowHeader!.id)} ref={isActive ? setActiveCellElement : undefined} className={`${overflowClassName(rowHeader!)} ${isActive ? 'is-editing ' : ''}${activeCell?.rowId === row.id || bulkSelectedRowIds.has(row.id) ? 'workspace-context-active ' : ''}${isSource ? 'is-reorder-source ' : ''}${isTarget ? tableReorderVisual.after ? 'is-drop-after' : 'is-drop-before' : ''}`} onPointerDown={(event) => beginTableReorder('row', row.id, event)} onClick={() => { if (rowHeader) { setLastPasteTarget({ rowId: row.id, columnId: rowHeader.id }); openCell(row, rowHeader); } }} onContextMenu={(event) => { event.preventDefault(); }}><div className="workspace-transposed-object-heading"><WorkspaceHeaderContent label={rowLabel} labelColor={workspaceCellColor(rowHeader, row.name)} accessibleLabel={rowAccessibleLabel} nameClass="workspace-column-name" editLabel={`編輯物件 ${rowAccessibleLabel}`} filterActive={isHeaderFilterActive('row', row.id)} onFilter={() => setFilterTarget({ axis: 'row', id: row.id, label: rowLabel })} />{hasHiddenColumns && <button type="button" className="workspace-hidden-fields-trigger" aria-label={`編輯 ${rowAccessibleLabel} 的隱藏欄位`} onClick={(event) => { event.stopPropagation(); openHiddenFields(row); }}><WorkspaceIcon name="chevron" size={18} /></button>}</div></th>;
                })}
              </tr></thead><tbody>
                 {displayedColumns.map((column) => {
                  const isSource = tableReorderVisual?.kind === 'column' && tableReorderVisual.sourceId === column.id;
                  const isTarget = tableReorderVisual?.kind === 'column' && tableReorderVisual.targetId === column.id;
                  return <tr key={column.id}>
                    <th scope="row" data-column-id={column.id} className={`workspace-row-heading ${overflowClassName(column)} ${configuring?.column.id === column.id && !configuring.isRowHeader ? 'is-editing ' : ''}${activeCell?.columnId === column.id ? 'workspace-context-active ' : ''}${isSource ? 'is-reorder-source ' : ''}${isTarget ? tableReorderVisual.after ? 'is-drop-after' : 'is-drop-before' : ''}`} style={{ textAlign: 'center', ...workspaceLineLimitStyle(column) }} onPointerDown={(event) => beginTableReorder('column', column.id, event)} onClick={() => setConfiguring({ column, isRowHeader: false })} onContextMenu={(event) => { event.preventDefault(); }}><button type="button" className="workspace-row-name">{column.name}</button></th>
                    {filteredRows.map((row) => {
                      const rowLabel = displayWorkspaceColumnValue(row.name, rowHeader!);
                      const rowAccessibleLabel = rowLabel || `第 ${filteredRows.findIndex((item) => item.id === row.id) + 1} 個物件`;
                      const value = row.values[column.id] ?? null;
                      const displayValue = displayWorkspaceColumnValue(value, column);
                      const isActive = activeCellKey === workspaceCellKey(row.id, column.id);
                      const multiChips = column.isMultiple && typeof value === 'string' ? parseMultiSelectValues(value) : [];
                       const isBulkSelected = bulkSelection?.columnId === column.id && bulkSelectedRowIds.has(row.id);
                       return <td key={row.id} data-bulk-row-id={row.id} data-bulk-column-id={column.id} data-cell-id={workspaceCellKey(row.id, column.id)} ref={isActive ? setActiveCellElement : undefined} className={`${overflowClassName(column)} ${isActive ? 'is-editing ' : ''}${isBulkSelected ? 'is-bulk-selected' : ''}`} style={{ textAlign: column.alignment ?? 'left', ...workspaceLineLimitStyle(column) }} aria-label={`${rowAccessibleLabel}，${column.name || '未命名屬性'}：${displayValue || '空白'}`} aria-selected={isBulkSelected} onClick={() => handleDataCellClick(row, column)}>
                        <div className="workspace-cell-layout">
                          {multiChips.length > 0 ? (
                            <div className="workspace-multi-chip-list workspace-cell-value">
                               {multiChips.map((chip, idx) => <span key={idx} className="workspace-multi-chip" style={{ color: workspaceOptionColor(column, chip) }}>{chip}</span>)}
                            </div>
                          ) : (
                             <span className={`workspace-cell-value ${displayValue ? '' : 'workspace-empty-cell'}`} style={{ color: workspaceCellColor(column, value) }}>{displayValue}</span>
                          )}
                          <ExternalLinkAction value={value} pushWidth={column.inputType === 'link' && column.overflowMode === 'expand'} />
                        </div>
                      </td>;
                    })}
                  </tr>;
                })}
              </tbody></>}
            </table>
          </div>
          <div className="workspace-zoom-indicator"><button type="button" onClick={() => applyTextScale(textScale - 0.1)} aria-label="縮小文字">−</button><span>{Math.round(textScale * 100)}%</span><button type="button" onClick={() => applyTextScale(textScale + 0.1)} aria-label="放大文字">＋</button><button type="button" onClick={() => applyTextScale(localMinTextScale)} aria-label="縮到可完整顯示屬性">適合寬度</button></div>
        </>}
      </main>
    </div>
    </div>
    {drawerOpen && <><button type="button" className="workspace-drawer-backdrop" aria-label="關閉目錄" onClick={closeDrawer} style={{ opacity: Math.min(1, drawerOffset / Math.max(1, workspaceDrawerWidth())) }} /><aside className={`workspace-drawer${drawerDragging ? ' is-dragging' : ''}`} aria-label="Workspace 目錄" style={{ '--workspace-drawer-offset': `${drawerOffset}px` } as React.CSSProperties} onPointerDownCapture={beginDrawerSwipe} onPointerMove={moveDrawerSwipe} onPointerUp={endDrawerSwipe} onPointerCancel={endDrawerSwipe} onClickCapture={suppressDrawerSwipeClick}><header className="workspace-drawer-heading"><strong>目錄</strong><div><button type="button" className="workspace-drawer-create" onClick={() => addFolder(null)} aria-label="新增資料夾"><WorkspaceIcon name="folder-plus" size={21} /><span>資料夾</span></button><button type="button" className="workspace-drawer-create" onClick={() => setTableCreateParentId(null)} aria-label="新增表格"><WorkspaceIcon name="table-plus" size={21} /><span>表格</span></button><button type="button" onClick={closeDrawer} aria-label="關閉目錄"><WorkspaceIcon name="close" size={22} /></button></div></header><label className="workspace-drawer-search"><WorkspaceIcon name="search" size={18} /><span className="sr-only">搜尋表格與資料夾</span><input type="search" aria-label="搜尋表格與資料夾" placeholder="搜尋表格或資料夾" value={drawerQuery} onChange={(event) => setDrawerQuery(event.target.value)} /><button type="button" onClick={() => setDrawerQuery('')} aria-label="清除目錄搜尋" disabled={!drawerQuery}><WorkspaceIcon name="close" size={16} /></button></label><Tree data={data} expanded={expanded} filterQuery={drawerQuery} onToggle={(id) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} onOpen={openNode} onContext={setNodeMenu} onMove={relocateNode} /><footer className="workspace-drawer-footer"><div className={`workspace-storage-status ${saveState === 'error' ? 'is-error' : ''}`} role="status"><span>{saveState === 'saving' ? '正在儲存於此裝置…' : saveState === 'error' ? '本機儲存失敗' : `已儲存於此裝置${lastSavedAt ? ` · ${new Date(lastSavedAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })}` : ''}`}</span><span className={backupNeedsAttention ? 'needs-attention' : ''}>{lastExportAt ? `上次備份：${new Date(lastExportAt).toLocaleDateString('zh-TW')}` : '尚未匯出備份'}</span></div><div className={`workspace-storage-status workspace-drive-storage-status ${driveBackup.status === 'dirty' ? 'needs-attention' : ''}`} role="status"><span>{driveBackup.status === 'offline' ? 'Google Drive · 目前離線' : driveBackup.status === 'dirty' ? 'Google Drive · 有未備份變更' : driveBackup.status === 'saved' ? `Google Drive · 已備份${driveBackup.record.lastBackupAt ? ` · ${new Date(driveBackup.record.lastBackupAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })}` : ''}` : 'Google Drive · 尚未備份'}</span><span>{driveBackup.record.fileName ?? '點按設定備份'}</span></div><button type="button" className="workspace-drawer-backup-action" onClick={() => { setDrawerOpen(false); driveBackup.open(); }}><WorkspaceIcon name="upload" size={19} />Google Drive 備份</button><div className="workspace-drawer-data-actions"><button type="button" onClick={() => void exportAll()}><WorkspaceIcon name="download" size={19} />匯出全部資料</button><button type="button" onClick={() => chooseImport('workspace')}><WorkspaceIcon name="upload" size={19} />匯入整個資料庫</button></div><a href="/" onClick={() => savePwaLastRoute({ pathname: '/' })}><WorkspaceIcon name="home" size={19} />返回網站</a></footer></aside></>}
    <input ref={importTableInputRef} id="workspace-import-table" className="sr-only" tabIndex={-1} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readImport(file, 'table'); event.currentTarget.value = ''; }} />
    <input ref={importWorkspaceInputRef} id="workspace-import-workspace" className="sr-only" tabIndex={-1} type="file" accept=".zip,application/zip,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readImport(file, 'workspace'); event.currentTarget.value = ''; }} />
    {nodeMenu && <NodeActionsDialog node={nodeMenu} onClose={() => setNodeMenu(undefined)} onRename={() => { setNodeMenu(undefined); renameNode(nodeMenu); }} onDelete={() => askDeleteNode(nodeMenu)} onAddFolder={() => { setNodeMenu(undefined); addFolder(nodeMenu.id); }} onAddTable={() => { setNodeMenu(undefined); setTableCreateParentId(nodeMenu.id); }} onMove={() => { setMovingNode(nodeMenu); setNodeMenu(undefined); }} />}
    {movingNode && <MoveNodeDialog node={movingNode} data={data} onClose={() => setMovingNode(undefined)} onMove={(parentId) => relocateNode(movingNode, parentId)} />}
     {columnVisibilityOpen && table && <ColumnVisibilityDialog columns={table.columns} onClose={() => setColumnVisibilityOpen(false)} onToggle={toggleColumnVisibility} />}
    {filterTarget && <HeaderFilterDialog label={filterTarget.label} inputType={activeFilterInputType} options={activeFilterOptions} numericValues={activeNumericValues} state={activeFilterState} onClose={() => setFilterTarget(undefined)} onSort={setActiveFilterSort} onToggle={toggleActiveFilterOption} onSelectAll={() => updateActiveFilter((state) => ({ ...state, includedKeys: null }))} onClearAll={() => updateActiveFilter((state) => ({ ...state, includedKeys: [] }))} onQuery={setActiveFilterQuery} onRange={setActiveFilterRange} onAggregate={setActiveFilterAggregate} />}
    {tableCreateParentId !== undefined && <TableCreateDialog onClose={() => setTableCreateParentId(undefined)} onCreate={() => { const parentId = tableCreateParentId; setTableCreateParentId(undefined); addTable(parentId); }} onImport={() => { importTableParentId.current = tableCreateParentId; chooseImport('table'); }} />}
    {nameDialog && <NameDialog state={nameDialog} onClose={() => setNameDialog(undefined)} onSubmit={submitName} onDelete={nameDialog.row ? () => { const row = nameDialog.row!; setNameDialog(undefined); askDeleteRow(row, table?.rows.findIndex((item) => item.id === row.id) ?? 0); } : undefined} />}
    {confirmDialog && <ConfirmDialog title={confirmDialog.title} message={confirmDialog.message} onClose={() => setConfirmDialog(undefined)} onConfirm={confirmDialog.onConfirm} />}
    {activeEditingRow && activeEditingColumn && (activeEditingColumn.inputType === 'link'
      ? <LinkInputDialog column={activeEditingColumn} value={activeEditingValue} onDelete={activeEditingColumn.id === rowHeader?.id ? () => { setEditing(undefined); askDeleteRow(activeEditingRow, activeEditingRowIndex); } : undefined} onSave={(next) => saveCellValue(activeEditingRow.id, activeEditingColumn, next)} />
      : <CellInputDialog column={activeEditingColumn} value={activeEditingValue} inputLabel={activeEditingColumn.id === rowHeader?.id ? '物件名稱' : undefined} onDelete={activeEditingColumn.id === rowHeader?.id ? () => { setEditing(undefined); askDeleteRow(activeEditingRow, activeEditingRowIndex); } : undefined} onDismiss={() => setEditing(undefined)} onSave={(next) => updateCell(activeEditingRow.id, activeEditingColumn, next)} />)}
     {configuring && <ColumnConfig column={configuring.column} suggestedOptions={fixedListSuggestions} onSave={saveColumn} onDelete={configuring.isRowHeader ? undefined : () => { askDeleteColumn(configuring.column); setConfiguring(undefined); }} />}
     {selectionEditor && <WorkspaceSelectionDialog column={selectionEditor.column} value={selectionEditor.value} options={selectionEditor.options} onClose={() => setSelectionEditor(undefined)} onSelect={selectCellValue} onChange={selectionEditor.column.isMultiple ? selectCellValue : undefined} />}
     {bulkEditorOpen && bulkColumn && (bulkColumn.inputType === 'number'
       ? <WorkspaceBulkNumberDialog column={bulkColumn} rows={bulkRows.map((row, index) => ({ rowId: row.id, label: (rowHeader ? displayWorkspaceColumnValue(row.name, rowHeader) : displayWorkspaceCellValue(row.name)) || `第 ${index + 1} 個物件` }))} initialTotal={typeof bulkDraftValue === 'number' ? bulkDraftValue : null} onClose={() => setBulkEditorOpen(false)} onConfirm={(result) => { setBulkEditorOpen(false); if (result) commitBulkSelection({ sharedValue: result.total, distributedValues: result.values }); }} />
       : bulkColumn.inputType === 'link'
       ? <LinkInputDialog column={bulkColumn} value={bulkDraftValue} showConfirm onDismiss={() => setBulkEditorOpen(false)} onSave={(value) => commitBulkSelection({ sharedValue: value })} />
       : bulkColumn.inputType === 'select' || bulkColumn.inputType === 'dynamic-select'
       ? bulkColumn.isMultiple
         ? <WorkspaceBulkMultiSelectDialog column={bulkColumn} rows={bulkMultiSelectRows} options={bulkColumn.inputType === 'dynamic-select' && table ? getDynamicOptions(table, bulkColumn.id) : bulkColumn.options} onClose={() => setBulkEditorOpen(false)} onConfirm={(intents) => { setBulkEditorOpen(false); commitBulkCellUpdates(applyWorkspaceMultiSelectBatch(bulkMultiSelectRows, intents)); }} />
         : <WorkspaceSelectionDialog column={bulkColumn} value={bulkDraftValue} options={bulkColumn.inputType === 'dynamic-select' && table ? getDynamicOptions(table, bulkColumn.id) : bulkColumn.options} onClose={() => setBulkEditorOpen(false)} onConfirm={(value) => commitBulkSelection({ sharedValue: coerceCellValue(bulkColumn, value) })} />
       : <CellInputDialog column={bulkColumn} value={bulkDraftValue} inputLabel={`${bulkColumn.name}批次輸入`} showConfirm onDismiss={() => setBulkEditorOpen(false)} onSave={(value) => commitBulkSelection({ sharedValue: coerceCellValue(bulkColumn, value) })} />)}
     {hiddenFieldsEditor && hiddenEditorRow && <HiddenFieldsDialog title={hiddenFieldsEditor.title} row={hiddenEditorRow} columns={hiddenColumns} optionsByColumn={hiddenOptionsByColumn} onSave={(values) => saveHiddenFields(hiddenFieldsEditor.rowId, values)} />}
    {pasteDialogOpen && pasteTarget && <WorkspacePasteDialog targetLabel={pasteTargetLabel} onClose={() => setPasteDialogOpen(false)} onApply={pasteMatrix} />}
    {tableImportPreview && <WorkspaceTableImportPreviewDialog table={tableImportPreview.table} source={tableImportPreview.source} onClose={() => setTableImportPreview(undefined)} onImport={finishTableImport} />}
    {workspaceImport && <WorkspaceModal title="匯入整個資料庫" onClose={() => setWorkspaceImport(undefined)} className="workspace-import-preview-dialog"><div className="workspace-import-summary"><strong>{workspaceImport.tables.length} 張表格 · {workspaceImport.nodes.filter((node) => node.type === 'folder').length} 個資料夾</strong><span>{workspaceImport.tables.reduce((total, item) => total + item.rows.length, 0)} 個物件</span></div><div className="workspace-import-table-names">{workspaceImport.tables.map((item) => <span key={item.id}>{item.name}</span>)}</div><div className="workspace-import-actions"><button type="button" className="workspace-dialog-button secondary" onClick={() => finishWorkspaceImport('merge')}>合併</button><button type="button" className="workspace-dialog-button danger" onClick={() => finishWorkspaceImport('replace')}>取代</button></div></WorkspaceModal>}
    {driveBackup.dialogOpen && <GoogleDriveBackupDialog status={driveBackup.status} busy={driveBackup.busy} message={driveBackup.message} error={driveBackup.error} record={driveBackup.record} remoteFile={driveBackup.remoteFile} authorized={driveBackup.authorized} onClose={driveBackup.close} onConnect={() => void driveBackup.connect()} onBackup={() => void driveBackup.backup()} onFindRemote={() => void driveBackup.findRemote()} onRestore={() => void driveBackup.restore()} onDisconnect={() => void driveBackup.disconnect()} />}
  </section>;
};

export { WorkspacePage };
