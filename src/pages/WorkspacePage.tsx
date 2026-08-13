import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clearAllWorkspaceHistories, deleteWorkspaceHistories, loadWorkspaceHistories, loadWorkspace, saveWorkspace, saveWorkspaceHistory } from '../workspace/db';
import { applyWorkspaceTableHistoryActionWithNode, createEmptyWorkspaceTableHistory, inferWorkspaceTableMutation, pushWorkspaceTableHistory, type WorkspaceCommitOptions, type WorkspaceTableHistory, type WorkspaceTableMutation } from '../workspace/history';
import { coerceCellValue, displayWorkspaceCellValue, displayWorkspaceColumnValue, getDynamicOptions, getRowHeaderColumn, getTableForNode, parseMultiSelectValues, workspaceCellColor, workspaceOptionColor } from '../workspace/model';
import { calculateWorkspaceTableLayout, ensureWorkspaceCellVisible, ExternalLinkAction, findTableNode, measureWorkspaceText, NameDialogState, overflowClassName, updateTable, workspaceCellPadding, WorkspaceHeaderContent, WorkspaceIcon, workspaceMinColumnWidth, WorkspaceModal, expandedFoldersStorageKey } from "../workspace/workspaceShared";
import type { WorkspaceCellValue, WorkspaceColumn, WorkspaceData, WorkspaceNode, WorkspaceRow, WorkspaceTable } from '../workspace/types';
import { MoveNodeDialog, NodeActionsDialog, TableCreateDialog } from "../workspace/workspaceActionDialogs";
import { CellInputDialog, ColumnConfig, ColumnVisibilityDialog, ConfirmDialog, HeaderFilterDialog, HiddenFieldsDialog, LinkInputDialog, NameDialog, WorkspaceSelectionDialog } from "../workspace/workspaceDialogs";
import { Tree } from "../workspace/workspaceSidebar";
import { useTableGestures } from "../workspace/useTableGestures";
import { useWorkspaceFilter } from "../workspace/useWorkspaceFilter";
import { useWorkspaceActions } from "../workspace/useWorkspaceActions";
import type { WorkspaceBulkSelection } from '../workspace/bulkEdit';
import { WorkspaceBulkEditToolbar, WorkspaceBulkNumberDialog } from '../workspace/workspaceBulkEdit';

const workspaceCellKey = (rowId: string, columnId: string) => `${rowId}:${columnId}`;
const toggleBulkSelectionRow = (selection: WorkspaceBulkSelection, rowId: string): WorkspaceBulkSelection | undefined => {
  const selected = selection.rowIds.includes(rowId);
  const rowIds = selected ? selection.rowIds.filter((id) => id !== rowId) : [...selection.rowIds, rowId];
  if (rowIds.length === 0) return undefined;
  return selection.distributedValues
    ? { ...selection, rowIds, hasDraft: false, sharedValue: null, distributedValues: undefined }
    : { ...selection, rowIds };
};

const WorkspacePage = () => {
  const [data, setData] = useState<WorkspaceData>();
  const [drawerOpen, setDrawerOpen] = useState(false);
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

  const viewportRef = useRef<HTMLDivElement>(null);
  const workspacePageRef = useRef<HTMLElement>(null);
  const activeCellElementRef = useRef<HTMLElement | null>(null);
  const dataRef = useRef<WorkspaceData | undefined>(undefined);
  const historyRef = useRef(new Map<string, WorkspaceTableHistory>());

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
    const removedTableIds = previous?.tables.filter((table) => !next.tables.some((item) => item.id === table.id)).map((table) => table.id) ?? [];
    setData(next);
    dataRef.current = next;
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
    void saveWorkspace(next).catch(() => setNotice('本機儲存失敗，請先匯出資料備份'));
  }, []);

  const table = useMemo(() => data ? getTableForNode(data, data.activeNodeId) : undefined, [data]);
  const tableNode = useMemo(() => table && data ? findTableNode(data, table.id) : undefined, [data, table]);
  const rowHeader = useMemo(() => table ? getRowHeaderColumn(table) : undefined, [table]);
  const tableRowsById = useMemo(() => new Map(table?.rows.map((row) => [row.id, row]) ?? []), [table]);

  const {
    searchQuery, setSearchQuery, searchOpen, setSearchOpen,
    filterTarget, setFilterTarget, clearFilters,
    searchedRows, filteredRows, visibleColumns,
    activeFilterState, activeFilterOptions, activeFilterInputType, activeNumericValues,
    setActiveFilterSort, setActiveFilterQuery, setActiveFilterRange, setActiveFilterAggregate, toggleActiveFilterOption,
    updateActiveFilter, isHeaderFilterActive
  } = useWorkspaceFilter({ table, rowHeader, tableRowsById });

  const hiddenColumns = useMemo(() => table?.columns.filter((column) => column.hidden) ?? [], [table]);
  const displayedColumns = useMemo(() => visibleColumns.filter((column) => !column.hidden), [visibleColumns]);
  const hasHiddenColumns = hiddenColumns.length > 0;
  const hiddenOptionsByColumn = useMemo(() => Object.fromEntries(hiddenColumns.map((column) => [column.id, column.inputType === 'dynamic-select' && table ? getDynamicOptions(table, column.id) : column.options])), [hiddenColumns, table]);
  const bulkColumn = useMemo(() => bulkSelection && table?.id === bulkSelection.tableId ? table.columns.find((column) => column.id === bulkSelection.columnId) : undefined, [bulkSelection, table]);
  const bulkSelectedRowIds = useMemo(() => new Set(bulkSelection?.rowIds ?? []), [bulkSelection?.rowIds]);
  const bulkRows = useMemo(() => bulkSelection ? bulkSelection.rowIds.flatMap((rowId) => {
    const row = tableRowsById.get(rowId);
    return row ? [row] : [];
  }) : [], [bulkSelection, tableRowsById]);
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

  useEffect(() => {
    if (searchOpen) setEditBarOpen(false);
  }, [searchOpen]);
  useEffect(() => { clearFilters(); }, [table?.id]);
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
      return Math.max(measureWorkspaceText(headerValue, 20, 600), limitedValueWidth) + (column.inputType === 'link' ? 46 : 0);
    };
    const rowHeaderValues = table.rows.map((row) => row.name);
    const rowHeaderWidth = widthFor(rowHeader, rowHeader.name, rowHeaderValues);
    if (!table.transposed) return [rowHeaderWidth, ...displayedColumns.map((column) => widthFor(column, column.name, table.rows.map((row) => row.values[column.id] ?? null)))];
    const properties = [rowHeader, ...displayedColumns];
    const propertyWidth = Math.max(...properties.map((column) => measureWorkspaceText(column.name, 20, 600)));
    const rowWidths = filteredRows.map((row) => Math.max(
      widthFor(rowHeader, displayWorkspaceColumnValue(row.name, rowHeader)),
      ...properties.map((column) => {
        if (column.overflowMode !== 'expand' && !column.widthLimitChars) return column.inputType === 'link' ? 46 : 0;
        const measured = measureWorkspaceText(displayWorkspaceColumnValue(column.id === rowHeader.id ? row.name : row.values[column.id] ?? null, column), 20, 400);
        const visibleWidth = column.overflowMode === 'expand' ? measured : column.widthLimitChars ? Math.min(measured, column.widthLimitChars * 20) : 0;
        return visibleWidth + (column.inputType === 'link' ? 46 : 0);
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
      if (bulkSelection.distributedValues) setNotice('選取已變更，請重新設定比例');
      setBulkSelection(toggleBulkSelectionRow(bulkSelection, rowId));
      return;
    }
    setEditing(undefined);
    setSelectionEditor(undefined);
    setConfiguring(undefined);
    setSearchOpen(false);
    setEditBarOpen(false);
    setTableActionsOpen(false);
    setBulkSelection({ tableId: table.id, columnId, rowIds: [rowId], hasDraft: false, sharedValue: null });
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

  const {
    textScale, panning, tableReorderVisual, ignoreNextTableClick,
    applyTextScale,
    beginTableReorder, moveTableReorder, endTableReorder,
    beginTablePan, moveTablePan, endTablePan,
  } = useTableGestures({ table, data, commit, viewportRef, workspacePageRef, setNotice, minTextScale: localMinTextScale, onCellLongPress: startBulkSelection });

  const {
    importTableInputRef, importWorkspaceInputRef, importTableParentId,
    openNameDialog, addFolder, addTable, renameNode, submitName,
    askDeleteNode, relocateNode, openNode, saveCellValue, updateCell, openCell,
    selectCellValue, addRow, askDeleteRow, addColumn, askDeleteColumn, saveColumn,
    exportCurrent, exportAll, chooseImport, readImport, finishWorkspaceImport
  } = useWorkspaceActions({
    data, table, rowHeader, commit, setNotice, setExpanded, setDrawerOpen,
    setEditing, setFocusTarget, setSelectionEditor, setConfiguring, setNodeMenu, setMovingNode,
    setTableActionsOpen, setTableCreateParentId, setNameDialog,
    setConfirmDialog, setWorkspaceImport, nameDialog, selectionEditor, configuring, workspaceImport
  });

  const handleDataCellClick = useCallback((row: WorkspaceRow, column: WorkspaceColumn) => {
    if (!bulkSelection) {
      openCell(row, column);
      return;
    }
    if (bulkSelection.columnId !== column.id) {
      setNotice('批次編輯只能選取同一屬性的格子');
      return;
    }
    if (bulkSelection.distributedValues) setNotice('選取已變更，請重新設定比例');
    setBulkSelection(toggleBulkSelectionRow(bulkSelection, row.id));
  }, [bulkSelection, openCell]);

  const closeBulkSelection = useCallback(() => {
    setBulkSelection(undefined);
    setBulkEditorOpen(false);
  }, []);

  const setBulkSharedValue = useCallback((value: WorkspaceCellValue) => {
    setBulkSelection((current) => current ? { ...current, hasDraft: true, sharedValue: value, distributedValues: undefined } : current);
    setBulkEditorOpen(false);
  }, []);

  const commitBulkSelection = useCallback(() => {
    const currentData = dataRef.current;
    if (!currentData || !table || !bulkSelection || !bulkColumn || !bulkSelection.hasDraft) return;
    const selectedIds = new Set(bulkSelection.rowIds);
    const changes = table.rows.flatMap((row) => {
      if (!selectedIds.has(row.id)) return [];
      const before = row.values[bulkColumn.id] ?? null;
      const after = bulkSelection.distributedValues?.[row.id] ?? bulkSelection.sharedValue;
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

  const bulkInitialValue = bulkRows[0] && bulkColumn ? bulkRows[0].values[bulkColumn.id] ?? null : null;
  const bulkDraftValue = bulkSelection?.hasDraft ? bulkSelection.sharedValue : bulkInitialValue;
  const bulkSummary = bulkSelection?.distributedValues
    ? `比例分配：${displayWorkspaceCellValue(bulkSelection.sharedValue, 'number')}`
    : bulkColumn && bulkSelection?.hasDraft
      ? displayWorkspaceColumnValue(bulkSelection.sharedValue, bulkColumn)
      : '';

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
    void saveWorkspace(nextData).catch(() => setNotice('本機儲存失敗'));
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

  const activeEditingRow = editing && table ? table.rows.find((item) => item.id === editing.rowId) : undefined;
  const activeEditingRowIndex = activeEditingRow && table ? table.rows.findIndex((item) => item.id === activeEditingRow.id) : -1;
  const activeEditingColumn = editing && table ? editing.columnId === rowHeader?.id ? rowHeader : table.columns.find((item) => item.id === editing.columnId) : undefined;
  const activeEditingValue = activeEditingRow && activeEditingColumn ? activeEditingColumn.id === rowHeader?.id ? activeEditingRow.name : activeEditingRow.values[activeEditingColumn.id] : null;
  const hiddenEditorRow = hiddenFieldsEditor && table ? table.rows.find((row) => row.id === hiddenFieldsEditor.rowId) : undefined;
  const activeCell = editing ?? (selectionEditor ? { rowId: selectionEditor.rowId, columnId: selectionEditor.column.id } : undefined) ?? (bulkSelection?.rowIds[0] ? { rowId: bulkSelection.rowIds[0], columnId: bulkSelection.columnId } : focusTarget);
  const activeCellKey = activeCell ? workspaceCellKey(activeCell.rowId, activeCell.columnId) : undefined;

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

  if (!data) return <section className="workspace-page workspace-loading"><p>正在開啟本地 Workspace…</p></section>;

  return <section ref={workspacePageRef} className="workspace-page" style={workspacePageStyle}>
    <h1 className="sr-only">動態表格</h1>
    <header className="workspace-appbar">
      <div className="workspace-appbar-leading"><button type="button" className="workspace-appbar-button workspace-menu-button" aria-label="開啟目錄" onClick={() => setDrawerOpen(true)}><WorkspaceIcon name="menu" size={29} /></button><button type="button" className={`workspace-appbar-title ${nameDialog?.node?.id === tableNode?.id ? 'is-editing' : ''}`} onClick={() => tableNode && renameNode(tableNode)} disabled={!tableNode} aria-label="重新命名表格"><span>{table?.name ?? '動態表格'}</span></button></div>
      <div className="workspace-appbar-actions">
        <button type="button" className={`workspace-appbar-button ${searchOpen ? 'active' : ''}`} aria-label="搜尋" onClick={() => { closeBulkSelection(); setSearchOpen((open) => !open); }} disabled={!table}><WorkspaceIcon name="search" size={29} /></button>
        <button type="button" className={`workspace-appbar-button ${editBarOpen ? 'active' : ''}`} aria-label="編輯" onClick={() => { closeBulkSelection(); setEditBarOpen((open) => !open); setTableActionsOpen(false); setSearchOpen(false); }} disabled={!table}><WorkspaceIcon name="edit" size={29} /></button>
        <button type="button" className={`workspace-appbar-button ${tableActionsOpen ? 'active' : ''}`} aria-label="設定" onClick={() => { closeBulkSelection(); setTableActionsOpen((open) => !open); setEditBarOpen(false); setSearchOpen(false); }} disabled={!table}><WorkspaceIcon name="settings" size={29} /></button>
      </div>
    </header>
    {bulkSelection && bulkColumn && <WorkspaceBulkEditToolbar column={bulkColumn} count={bulkSelection.rowIds.length} summary={bulkSummary} hasDraft={bulkSelection.hasDraft} onCancel={closeBulkSelection} onOpenEditor={() => setBulkEditorOpen(true)} onConfirm={commitBulkSelection} />}
    {searchOpen && table && <div className="workspace-searchbar" role="search"><WorkspaceIcon name="search" size={21} /><input type="search" aria-label="搜尋此表" placeholder="搜尋此表" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} autoFocus /><span className="workspace-search-count">顯示 {filteredRows.length} / {table.rows.length} 項</span><button type="button" aria-label="關閉搜尋" onClick={() => { setSearchOpen(false); setSearchQuery(''); }}><WorkspaceIcon name="close" size={20} /></button></div>}
    {editBarOpen && table && <div className="workspace-editbar" aria-label="編輯工具列">
      <div className="workspace-editbar-group workspace-editbar-history">
        <button type="button" className="workspace-editbar-button" aria-label="復原" onClick={undoTable} disabled={!currentTableHistory?.past.length}><WorkspaceIcon name="undo" size={22} /></button>
        <button type="button" className="workspace-editbar-button" aria-label="重做" onClick={redoTable} disabled={!currentTableHistory?.future.length}><WorkspaceIcon name="redo" size={22} /></button>
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
    {notice && <div className="workspace-notice" role="status">{notice}</div>}
    <div className={`workspace-body ${drawerOpen ? 'drawer-is-open' : ''}`}>
      <main className="workspace-main">
        {!table || !tableNode ? <div className="workspace-empty"><div className="workspace-empty-icon"><WorkspaceIcon name="table" size={34} /></div><h2>建立你的第一張表格</h2><p>資料只會儲存在這個瀏覽器。你可以建立桌遊收藏，也可以建立任何自己的資料表。</p><button type="button" className="workspace-dialog-button primary" onClick={() => addTable(null)}>建立表格</button></div> : <>
          <div ref={viewportRef} className={`workspace-table-viewport ${panning ? 'is-panning' : ''}`} onPointerDown={beginTablePan} onPointerMove={(event) => { if (!moveTableReorder(event)) moveTablePan(event); }} onPointerUp={(event) => { if (!endTableReorder(event)) endTablePan(event); }} onPointerCancel={(event) => { if (!endTableReorder(event)) endTablePan(event); }} onClickCapture={(event) => { if (ignoreNextTableClick.current) { event.preventDefault(); event.stopPropagation(); ignoreNextTableClick.current = false; } }}>
            <table className={`workspace-table ${table.transposed ? 'is-transposed' : ''}`} style={{ '--workspace-text-scale': textScale, width: `${renderedTableWidth}px` } as React.CSSProperties}>
              <colgroup>{renderedColumnWidths.map((width, index) => <col key={index} style={{ width: `${width}px` }} />)}</colgroup>
              {!table.transposed ? <><thead><tr>
                {rowHeader && <th className={`workspace-row-corner ${overflowClassName(rowHeader)} ${configuring?.isRowHeader ? 'is-editing' : ''}${activeCell?.columnId === rowHeader.id ? ' workspace-context-active' : ''}`} style={{ textAlign: 'center' }} onClick={() => setConfiguring({ column: rowHeader, isRowHeader: true })}><WorkspaceHeaderContent label={rowHeader.name} nameClass="workspace-row-axis-name" filterActive={isHeaderFilterActive('column', rowHeader.id)} onFilter={() => setFilterTarget({ axis: 'column', id: rowHeader.id, label: rowHeader.name })} /></th>}
                 {displayedColumns.map((column) => {
                  const isSource = tableReorderVisual?.kind === 'column' && tableReorderVisual.sourceId === column.id;
                  const isTarget = tableReorderVisual?.kind === 'column' && tableReorderVisual.targetId === column.id;
                  return <th key={column.id} data-column-id={column.id} className={`${overflowClassName(column)} ${configuring?.column.id === column.id && !configuring.isRowHeader ? 'is-editing ' : ''}${activeCell?.columnId === column.id ? 'workspace-context-active ' : ''}${isSource ? 'is-reorder-source ' : ''}${isTarget ? tableReorderVisual.after ? 'is-drop-after' : 'is-drop-before' : ''}`} style={{ textAlign: 'center' }} onPointerDown={(event) => beginTableReorder('column', column.id, event)} onClick={() => setConfiguring({ column, isRowHeader: false })} onContextMenu={(event) => { event.preventDefault(); }}><WorkspaceHeaderContent label={column.name} nameClass="workspace-column-name" filterActive={isHeaderFilterActive('column', column.id)} onFilter={() => setFilterTarget({ axis: 'column', id: column.id, label: column.name })} /></th>;
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
                  {rowHeader && <th scope="row" data-row-id={row.id} data-cell-id={workspaceCellKey(row.id, rowHeader.id)} ref={isRowHeaderActive ? setActiveCellElement : undefined} className={`workspace-row-heading ${overflowClassName(rowHeader)} ${isRowHeaderActive ? 'is-editing ' : ''}${isActiveRow ? 'workspace-context-active ' : ''}${isSource ? 'is-reorder-source ' : ''}${isTarget ? tableReorderVisual.after ? 'is-drop-after' : 'is-drop-before' : ''}`} style={{ textAlign: rowHeader.alignment ?? 'left' }} onPointerDown={(event) => beginTableReorder('row', row.id, event)} onClick={() => openCell(row, rowHeader)} onContextMenu={(event) => { event.preventDefault(); }}><div className="workspace-cell-layout"><button type="button" className="workspace-row-name" aria-label={`編輯物件 ${rowAccessibleLabel}`}><span className="workspace-cell-value" style={{ color: workspaceCellColor(rowHeader, row.name) }}>{rowLabel}</span></button><ExternalLinkAction value={row.name} /></div></th>}
                   {displayedColumns.map((column) => {
                    const value = row.values[column.id] ?? null;
                    const displayValue = displayWorkspaceColumnValue(value, column);
                    const isActive = activeCellKey === workspaceCellKey(row.id, column.id);
                    const multiChips = column.isMultiple && typeof value === 'string' ? parseMultiSelectValues(value) : [];
                     const isBulkSelected = bulkSelection?.columnId === column.id && bulkSelectedRowIds.has(row.id);
                     return <td key={column.id} data-bulk-row-id={row.id} data-bulk-column-id={column.id} data-cell-id={workspaceCellKey(row.id, column.id)} ref={isActive ? setActiveCellElement : undefined} className={`${overflowClassName(column)} ${isActive ? 'is-editing ' : ''}${isBulkSelected ? 'is-bulk-selected' : ''}`} style={{ textAlign: column.alignment ?? 'left' }} aria-label={`${rowAccessibleLabel}，${column.name || '未命名屬性'}：${displayValue || '空白'}`} aria-selected={isBulkSelected} onClick={() => handleDataCellClick(row, column)}>
                      <div className="workspace-cell-layout">
                        {multiChips.length > 0 ? (
                          <div className="workspace-multi-chip-list">
                             {multiChips.map((chip, idx) => <span key={idx} className="workspace-multi-chip" style={{ color: workspaceOptionColor(column, chip) }}>{chip}</span>)}
                          </div>
                        ) : (
                           <span className={`workspace-cell-value ${displayValue ? '' : 'workspace-empty-cell'}`} style={{ color: workspaceCellColor(column, value) }}>{displayValue}</span>
                        )}
                        <ExternalLinkAction value={value} />
                      </div>
                    </td>;
                   })}
                   {hasHiddenColumns && <td className="workspace-hidden-columns-cell"><button type="button" className="workspace-hidden-fields-trigger" aria-label={`編輯 ${rowAccessibleLabel} 的隱藏欄位`} onClick={(event) => { event.stopPropagation(); openHiddenFields(row); }}><WorkspaceIcon name="chevron" size={20} /></button></td>}
                 </tr>;
              })}</tbody></> : <><thead><tr>
                {rowHeader && <th className={`workspace-row-corner ${overflowClassName(rowHeader)} ${configuring?.isRowHeader ? 'is-editing' : ''}${activeCell?.columnId === rowHeader.id ? ' workspace-context-active' : ''}`} style={{ textAlign: 'center' }} onClick={() => setConfiguring({ column: rowHeader, isRowHeader: true })}><WorkspaceHeaderContent label={rowHeader.name} nameClass="workspace-row-axis-name" filterActive={isHeaderFilterActive('column', rowHeader.id)} onFilter={() => setFilterTarget({ axis: 'column', id: rowHeader.id, label: rowHeader.name })} /></th>}
                {filteredRows.map((row) => {
                  const originalIndex = table.rows.findIndex((item) => item.id === row.id);
                  const rowLabel = displayWorkspaceColumnValue(row.name, rowHeader!);
                  const rowAccessibleLabel = rowLabel || `第 ${originalIndex + 1} 個物件`;
                  const isSource = tableReorderVisual?.kind === 'row' && tableReorderVisual.sourceId === row.id;
                  const isTarget = tableReorderVisual?.kind === 'row' && tableReorderVisual.targetId === row.id;
                  const isActive = activeCell?.rowId === row.id && activeCell.columnId === rowHeader?.id;
                     return <th key={row.id} data-row-id={row.id} data-cell-id={workspaceCellKey(row.id, rowHeader!.id)} ref={isActive ? setActiveCellElement : undefined} className={`${overflowClassName(rowHeader!)} ${isActive ? 'is-editing ' : ''}${activeCell?.rowId === row.id || bulkSelectedRowIds.has(row.id) ? 'workspace-context-active ' : ''}${isSource ? 'is-reorder-source ' : ''}${isTarget ? tableReorderVisual.after ? 'is-drop-after' : 'is-drop-before' : ''}`} onPointerDown={(event) => beginTableReorder('row', row.id, event)} onClick={() => rowHeader && openCell(row, rowHeader)} onContextMenu={(event) => { event.preventDefault(); }}><div className="workspace-transposed-object-heading"><WorkspaceHeaderContent label={rowLabel} labelColor={workspaceCellColor(rowHeader, row.name)} accessibleLabel={rowAccessibleLabel} nameClass="workspace-column-name" editLabel={`編輯物件 ${rowAccessibleLabel}`} filterActive={isHeaderFilterActive('row', row.id)} onFilter={() => setFilterTarget({ axis: 'row', id: row.id, label: rowLabel })} />{hasHiddenColumns && <button type="button" className="workspace-hidden-fields-trigger" aria-label={`編輯 ${rowAccessibleLabel} 的隱藏欄位`} onClick={(event) => { event.stopPropagation(); openHiddenFields(row); }}><WorkspaceIcon name="chevron" size={18} /></button>}</div></th>;
                })}
              </tr></thead><tbody>
                 {displayedColumns.map((column) => {
                  const isSource = tableReorderVisual?.kind === 'column' && tableReorderVisual.sourceId === column.id;
                  const isTarget = tableReorderVisual?.kind === 'column' && tableReorderVisual.targetId === column.id;
                  return <tr key={column.id}>
                    <th scope="row" data-column-id={column.id} className={`workspace-row-heading ${overflowClassName(column)} ${configuring?.column.id === column.id && !configuring.isRowHeader ? 'is-editing ' : ''}${activeCell?.columnId === column.id ? 'workspace-context-active ' : ''}${isSource ? 'is-reorder-source ' : ''}${isTarget ? tableReorderVisual.after ? 'is-drop-after' : 'is-drop-before' : ''}`} style={{ textAlign: 'center' }} onPointerDown={(event) => beginTableReorder('column', column.id, event)} onClick={() => setConfiguring({ column, isRowHeader: false })} onContextMenu={(event) => { event.preventDefault(); }}><button type="button" className="workspace-row-name">{column.name}</button></th>
                    {filteredRows.map((row) => {
                      const rowLabel = displayWorkspaceColumnValue(row.name, rowHeader!);
                      const rowAccessibleLabel = rowLabel || `第 ${filteredRows.findIndex((item) => item.id === row.id) + 1} 個物件`;
                      const value = row.values[column.id] ?? null;
                      const displayValue = displayWorkspaceColumnValue(value, column);
                      const isActive = activeCellKey === workspaceCellKey(row.id, column.id);
                      const multiChips = column.isMultiple && typeof value === 'string' ? parseMultiSelectValues(value) : [];
                       const isBulkSelected = bulkSelection?.columnId === column.id && bulkSelectedRowIds.has(row.id);
                       return <td key={row.id} data-bulk-row-id={row.id} data-bulk-column-id={column.id} data-cell-id={workspaceCellKey(row.id, column.id)} ref={isActive ? setActiveCellElement : undefined} className={`${overflowClassName(column)} ${isActive ? 'is-editing ' : ''}${isBulkSelected ? 'is-bulk-selected' : ''}`} style={{ textAlign: column.alignment ?? 'left' }} aria-label={`${rowAccessibleLabel}，${column.name || '未命名屬性'}：${displayValue || '空白'}`} aria-selected={isBulkSelected} onClick={() => handleDataCellClick(row, column)}>
                        <div className="workspace-cell-layout">
                          {multiChips.length > 0 ? (
                            <div className="workspace-multi-chip-list">
                               {multiChips.map((chip, idx) => <span key={idx} className="workspace-multi-chip" style={{ color: workspaceOptionColor(column, chip) }}>{chip}</span>)}
                            </div>
                          ) : (
                             <span className={`workspace-cell-value ${displayValue ? '' : 'workspace-empty-cell'}`} style={{ color: workspaceCellColor(column, value) }}>{displayValue}</span>
                          )}
                          <ExternalLinkAction value={value} />
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
    {drawerOpen && <><button type="button" className="workspace-drawer-backdrop" aria-label="關閉目錄" onClick={() => setDrawerOpen(false)} /><aside className="workspace-drawer" aria-label="Workspace 目錄"><header className="workspace-drawer-heading"><strong>目錄</strong><div><button type="button" className="workspace-drawer-create" onClick={() => addFolder(null)} aria-label="新增資料夾"><WorkspaceIcon name="folder-plus" size={21} /><span>資料夾</span></button><button type="button" className="workspace-drawer-create" onClick={() => setTableCreateParentId(null)} aria-label="新增表格"><WorkspaceIcon name="table-plus" size={21} /><span>表格</span></button><button type="button" onClick={() => setDrawerOpen(false)} aria-label="關閉目錄"><WorkspaceIcon name="close" size={22} /></button></div></header><Tree data={data} expanded={expanded} onToggle={(id) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; })} onOpen={openNode} onContext={setNodeMenu} onMove={relocateNode} /><footer className="workspace-drawer-footer"><div className="workspace-drawer-data-actions"><button type="button" onClick={exportAll}><WorkspaceIcon name="download" size={19} />匯出全部資料</button><button type="button" onClick={() => chooseImport('workspace')}><WorkspaceIcon name="upload" size={19} />匯入整個資料庫</button></div><a href="/"><WorkspaceIcon name="home" size={19} />返回網站</a></footer></aside></>}
    <input ref={importTableInputRef} id="workspace-import-table" className="sr-only" tabIndex={-1} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readImport(file, 'table'); event.currentTarget.value = ''; }} />
    <input ref={importWorkspaceInputRef} id="workspace-import-workspace" className="sr-only" tabIndex={-1} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readImport(file, 'workspace'); event.currentTarget.value = ''; }} />
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
     {selectionEditor && <WorkspaceSelectionDialog column={selectionEditor.column} value={selectionEditor.value} options={selectionEditor.options} onClose={() => setSelectionEditor(undefined)} onSelect={selectCellValue} />}
     {bulkEditorOpen && bulkColumn && (bulkColumn.inputType === 'number'
       ? <WorkspaceBulkNumberDialog column={bulkColumn} rows={bulkRows.map((row, index) => ({ rowId: row.id, label: (rowHeader ? displayWorkspaceColumnValue(row.name, rowHeader) : displayWorkspaceCellValue(row.name)) || `第 ${index + 1} 個物件` }))} initialValues={bulkSelection?.distributedValues} initialTotal={typeof bulkDraftValue === 'number' ? bulkDraftValue : null} onClose={(result) => { if (result) setBulkSelection((current) => current ? { ...current, hasDraft: true, sharedValue: result.total, distributedValues: result.values } : current); setBulkEditorOpen(false); }} />
       : bulkColumn.inputType === 'link'
       ? <LinkInputDialog column={bulkColumn} value={bulkDraftValue} onSave={setBulkSharedValue} />
       : bulkColumn.inputType === 'select' || bulkColumn.inputType === 'dynamic-select'
         ? <WorkspaceSelectionDialog column={bulkColumn} value={bulkDraftValue} options={bulkColumn.inputType === 'dynamic-select' && table ? getDynamicOptions(table, bulkColumn.id) : bulkColumn.options} onClose={() => setBulkEditorOpen(false)} onSelect={(value) => setBulkSharedValue(coerceCellValue(bulkColumn, value))} />
         : <CellInputDialog column={bulkColumn} value={bulkDraftValue} inputLabel={`${bulkColumn.name}批次輸入`} onDismiss={() => setBulkEditorOpen(false)} onSave={(value) => setBulkSharedValue(coerceCellValue(bulkColumn, value))} />)}
     {hiddenFieldsEditor && hiddenEditorRow && <HiddenFieldsDialog title={hiddenFieldsEditor.title} row={hiddenEditorRow} columns={hiddenColumns} optionsByColumn={hiddenOptionsByColumn} onSave={(values) => saveHiddenFields(hiddenFieldsEditor.rowId, values)} />}
    {workspaceImport && <WorkspaceModal title="匯入整個資料庫" onClose={() => setWorkspaceImport(undefined)}><div className="workspace-import-actions"><button type="button" className="workspace-dialog-button secondary" onClick={() => finishWorkspaceImport('merge')}>合併</button><button type="button" className="workspace-dialog-button danger" onClick={() => finishWorkspaceImport('replace')}>取代</button></div></WorkspaceModal>}
  </section>;
};

export { WorkspacePage };
