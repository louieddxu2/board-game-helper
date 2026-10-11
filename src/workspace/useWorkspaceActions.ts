import { useEffect, useRef } from 'react';
import { applyWorkspaceCellChanges, captureWorkspaceColumnValues, getWorkspaceCellValue } from './cellChanges';
import { applyWorkspaceTableHistoryAction, type WorkspaceCommitOptions, type WorkspaceTableHistoryAction, type WorkspaceTableMutation } from './history';
import { createColumn, createNode, createRow, createTable, displayWorkspaceCellValue, displayWorkspaceColumnValue, getChildren, MAX_BOTTOM_NAVIGATION_TABLES, moveNode, normalizeWorkspaceDateTime, removeNodeAndDescendants, resolveActiveTableNodeId, sameWorkspaceCellValue } from './model';
import { getWorkspaceRow } from './rowIndexes';
import { cloneImportedWorkspace, exportWorkspaceArchive, exportWorkspaceXlsxAsync, importWorkspaceArchive, importWorkspaceXlsx, WORKSPACE_ARCHIVE_FILE_NAME, type WorkspaceImportSource } from './spreadsheet';
import type { WorkspaceCellValue, WorkspaceColumn, WorkspaceData, WorkspaceNode, WorkspaceRow, WorkspaceTable } from './types';
import type { WorkspaceDialogController } from './useWorkspaceDialogs';
import { useWorkspaceColumnSave } from './useWorkspaceColumnSave';
import type { NameDialogState } from './workspaceShared';
import { download, fileBaseName, updateTable } from './workspaceShared';

interface UseWorkspaceActionsProps {
  data: WorkspaceData | undefined;
  dataRef: React.RefObject<WorkspaceData | undefined>;
  table: WorkspaceTable | undefined;
  rowHeader: WorkspaceColumn | undefined;
  commit: (next: WorkspaceData, mutation?: WorkspaceTableMutation, options?: WorkspaceCommitOptions) => void;
  getDynamicOptions: (table: WorkspaceTable, columnId: string) => string[];
  setNotice: (msg: string) => void;
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
  setDrawerOpen: (open: boolean) => void;
  setTableActionsOpen: (open: boolean) => void;
  onExported: () => void;
  dialogs: WorkspaceDialogController;
}

export type WorkspaceTableImportPreview = {
  table: WorkspaceTable;
  source: WorkspaceImportSource;
  parentId: string | null;
};

export function useWorkspaceActions({ data, dataRef, table, rowHeader, commit, getDynamicOptions, setNotice, setExpanded, setDrawerOpen, setTableActionsOpen, onExported, dialogs }: UseWorkspaceActionsProps) {
  const { nameDialog, selectionEditor, workspaceImport } = dialogs.state;

  const importTableInputRef = useRef<HTMLInputElement>(null);
  const importWorkspaceInputRef = useRef<HTMLInputElement>(null);
  const importTableParentId = useRef<string | null>(null);
  const importGeneration = useRef(0);
  const exportGeneration = useRef(0);
  const ownerMounted = useRef(false);

  useEffect(() => {
    ownerMounted.current = true;
    return () => {
      ownerMounted.current = false;
      importGeneration.current += 1;
      exportGeneration.current += 1;
    };
  }, []);

  const openNameDialog = (mode: NameDialogState['mode'], initialValue: string, parentId?: string | null, node?: WorkspaceNode) => dialogs.set('nameDialog', { mode, initialValue, parentId, node });
  const addFolder = (parentId: string | null) => openNameDialog('folder', '', parentId);
  const addTable = (parentId: string | null) => openNameDialog('table', '', parentId);
  const renameNode = (node: WorkspaceNode) => openNameDialog('rename', node.name, undefined, node);

  const submitName = (name: string) => {
    const currentData = dataRef.current;
    if (!currentData || !nameDialog) return;
    if (nameDialog.mode === 'folder' || nameDialog.mode === 'table') {
      const parentId = nameDialog.parentId ?? null;
      if (nameDialog.mode === 'folder') {
        const node = createNode('folder', name, parentId, getChildren(currentData, parentId).length);
        commit({ ...currentData, nodes: [...currentData.nodes, node] });
        setExpanded((current) => { const next = new Set(current); if (parentId) next.add(parentId); else next.add(node.id); return next; });
      } else {
        const currentTable = createTable(name);
        const node = createNode('table', currentTable.name, parentId, getChildren(currentData, parentId).length, currentTable.id);
        commit({ ...currentData, tables: [...currentData.tables, currentTable], nodes: [...currentData.nodes, node], activeNodeId: node.id });
        if (parentId) setExpanded((current) => new Set(current).add(parentId));
        setDrawerOpen(false);
      }
    } else if (nameDialog.node) {
      const node = currentData.nodes.find(item => item.id === nameDialog.node?.id);
      if (!node || (node.tableId && !currentData.tables.some(item => item.id === node.tableId))) return;
      const next = { ...currentData, nodes: currentData.nodes.map((item) => item.id === node.id ? { ...item, name } : item), tables: node.tableId ? currentData.tables.map((item) => item.id === node.tableId ? { ...item, name, updatedAt: Date.now() } : item) : currentData.tables };
      commit(next);
    }
    dialogs.close('nameDialog');
  };

  const askDeleteNode = (node: WorkspaceNode) => {
    dialogs.close('nodeMenu');
    dialogs.set('confirmDialog', { title: '確認刪除', message: `確定要刪除「${node.name}」嗎？${node.type === 'folder' ? '資料夾內的內容也會一併刪除。' : ''}`, onConfirm: () => { if (data) commit(removeNodeAndDescendants(data, node.id)); dialogs.close('confirmDialog'); } });
  };

  const relocateNode = (node: WorkspaceNode, parentId: string | null) => {
    const currentData = dataRef.current;
    if (!currentData) return;
    const next = moveNode(currentData, node.id, parentId);
    if (next !== currentData) {
      commit(next);
      if (parentId) setExpanded((current) => new Set(current).add(parentId));
      setNotice(`已移動「${node.name}」`);
    }
    dialogs.close('movingNode');
    dialogs.close('nodeMenu');
  };

  const openNode = (node: WorkspaceNode) => {
    if (!data) return;
    if (node.type === 'folder') {
      setExpanded((current) => { const next = new Set(current); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; });
      return;
    }
    commit({ ...data, activeNodeId: node.id });
    dialogs.close('editing', 'focusTarget', 'selectionEditor');
    setDrawerOpen(false);
    dialogs.close('nodeMenu');
  };

  const saveCellValue = (rowId: string, column: WorkspaceColumn, value: WorkspaceCellValue) => {
    if (!data || !table) return;
    const isRowHeader = rowHeader?.id === column.id;
    const row = getWorkspaceRow(table.rows, rowId);
    if (!row) { dialogs.close('editing'); return; }
    const before = getWorkspaceCellValue(row, column.id, rowHeader?.id);
    if (sameWorkspaceCellValue(before, value)) { dialogs.close('editing'); return; }
    const change = { rowId, columnId: column.id, before, after: value };
    commit(updateTable(data, table.id, (current) => ({
      ...current,
      updatedAt: Date.now(),
      rows: applyWorkspaceCellChanges(current.rows, rowHeader?.id, [change]),
    })), {
      tableId: table.id,
      label: isRowHeader ? '編輯物件' : '編輯儲存格',
      action: { type: 'set-cell', ...change },
    });
    dialogs.close('editing');
  };

  const updateCell = (rowId: string, column: WorkspaceColumn, raw: string) => {
    if (column.inputType === 'number' && raw.trim() && !Number.isFinite(Number(raw))) { setNotice('請輸入有效數字'); return; }
    const value: WorkspaceCellValue = column.inputType === 'datetime'
      ? normalizeWorkspaceDateTime(raw)
      : !raw.trim() ? null : column.inputType === 'number' ? Number(raw) : raw;
    if (column.inputType === 'datetime' && raw.trim() && !value) { setNotice('請輸入有效時間'); return; }
    saveCellValue(rowId, column, value);
  };

  const openCell = (row: WorkspaceRow, column: WorkspaceColumn) => {
    if (!table) return;
    dialogs.close('focusTarget');
    const isRowHeader = rowHeader?.id === column.id;
    const value = isRowHeader ? row.name : row.values[column.id];
    if (column.inputType === 'select' || column.inputType === 'dynamic-select') {
      dialogs.close('editing');
      dialogs.set('selectionEditor', { rowId: row.id, column, value, options: column.inputType === 'dynamic-select' ? getDynamicOptions(table, column.id) : column.options, isRowHeader });
      return;
    }
    dialogs.set('editing', { rowId: row.id, columnId: column.id });
  };

  const selectCellValue = (value: string) => {
    if (!selectionEditor) return;
    updateCell(selectionEditor.rowId, selectionEditor.column, value);
    if (!selectionEditor.column.isMultiple) dialogs.close('selectionEditor');
  };

  const ownerTableId = table?.id;
  const ownerNodeId = data?.activeNodeId;
  const getCurrentTable = () => {
    const currentData = dataRef.current;
    if (!ownerTableId || !currentData || currentData.activeNodeId !== ownerNodeId) return;
    const currentTable = currentData.tables.find(item => item.id === ownerTableId);
    return currentTable ? { data: currentData, table: currentTable } : undefined;
  };
  const commitTableAction = (current: { data: WorkspaceData; table: WorkspaceTable }, label: string, action: WorkspaceTableHistoryAction) => {
    commit(applyWorkspaceTableHistoryAction(current.data, current.table.id, action, 'redo'), { tableId: current.table.id, label, action });
  };
  const addRow = () => {
    const current = getCurrentTable();
    if (!current || !rowHeader) return;
    const row = createRow(current.table.columns, `物件 ${current.table.rows.length + 1}`);
    commitTableAction(current, '新增物件', { type: 'add-row', row, index: current.table.rows.length });
    dialogs.set('focusTarget', { rowId: row.id, columnId: rowHeader.id });
    setNotice('已新增物件');
  };
  const askDeleteRow = (row: WorkspaceRow, rowIndex: number) => dialogs.set('confirmDialog', {
    title: '刪除物件', message: `確定要刪除「${(rowHeader ? displayWorkspaceColumnValue(row.name, rowHeader) : displayWorkspaceCellValue(row.name)) || `第 ${rowIndex + 1} 個物件`}」嗎？`,
    onConfirm: () => {
      const current = getCurrentTable();
      const index = current?.table.rows.findIndex(item => item.id === row.id) ?? -1;
      if (current && index >= 0) commitTableAction(current, '刪除物件', { type: 'remove-row', row: current.table.rows[index], index });
      dialogs.close('confirmDialog');
    },
  });
  const addColumn = () => {
    const current = getCurrentTable();
    if (!current || !current.table.rows.length) return;
    const column = createColumn(`屬性 ${current.table.columns.length + 1}`);
    commitTableAction(current, '新增屬性', { type: 'add-column', column, index: current.table.columns.length });
    dialogs.set('focusTarget', { rowId: current.table.rows[0].id, columnId: column.id });
    setNotice('已新增屬性');
  };
  const askDeleteColumn = (column: WorkspaceColumn) => dialogs.set('confirmDialog', {
    title: '刪除屬性', message: `確定要刪除屬性「${column.name}」嗎？此屬性的資料也會一併刪除。`,
    onConfirm: () => {
      const current = getCurrentTable();
      const index = current?.table.columns.findIndex(item => item.id === column.id) ?? -1;
      if (current && index >= 0) commitTableAction(current, '刪除屬性', {
        type: 'remove-column', column: current.table.columns[index], index,
        values: captureWorkspaceColumnValues(current.table.rows, column.id),
      });
      dialogs.close('confirmDialog');
    },
  });
  
  const saveColumn = useWorkspaceColumnSave({ dataRef, table, dialogs, commit });

  const exportSnapshot = async (prepare: (isCurrent: () => boolean) => Promise<Blob>, name: string, completeMessage: string) => {
    const generation = ++exportGeneration.current;
    const isCurrent = () => ownerMounted.current && exportGeneration.current === generation;
    try {
      const blob = await prepare(isCurrent);
      if (!isCurrent()) return;
      download(blob, name); onExported(); setNotice(completeMessage);
    } catch (error) {
      if (!isCurrent() || (error instanceof Error && error.name === 'AbortError')) return;
      setNotice(error instanceof Error ? `匯出失敗：${error.message}` : '匯出失敗');
    }
  };
  const exportCurrent = () => {
    if (!data || !table) return;
    setNotice('正在準備目前表格…'); setTableActionsOpen(false);
    return exportSnapshot(isCurrent => exportWorkspaceXlsxAsync(data, table, { isCurrent }), `${fileBaseName(table.name)}.xlsx`, '已匯出目前表格');
  };
  const exportAll = () => {
    if (!data) return;
    setNotice('正在準備整個資料庫備份…'); setDrawerOpen(false);
    return exportSnapshot(isCurrent => exportWorkspaceArchive(data, { isCurrent }), WORKSPACE_ARCHIVE_FILE_NAME, '已匯出整個資料庫備份');
  };
  
  const chooseImport = (kind: 'table' | 'workspace') => {
    const input = kind === 'table' ? importTableInputRef.current : importWorkspaceInputRef.current;
    if (!input) { setNotice('無法開啟檔案選擇器'); return; }
    try {
      if (typeof input.showPicker === 'function') input.showPicker();
      else input.click();
      setTableActionsOpen(false);
      dialogs.close('tableCreateParentId');
      if (kind === 'workspace') setDrawerOpen(false);
    } catch {
      input.click();
      setTableActionsOpen(false);
      dialogs.close('tableCreateParentId');
      if (kind === 'workspace') setDrawerOpen(false);
    }
  };

  const readImport = async (file: File, kind: 'table' | 'workspace') => {
    // Both file inputs feed the same import workflow. Only an actual new file
    // replaces the current request; opening and cancelling a picker does not.
    const generation = ++importGeneration.current;
    const parentId = importTableParentId.current;
    const isCurrentImport = () => ownerMounted.current && importGeneration.current === generation;
    setNotice(`正在匯入「${file.name}」…`);
    try {
      const imported = kind === 'workspace' && (/\.zip$/i.test(file.name) || file.type === 'application/zip')
        ? await importWorkspaceArchive(file)
        : await importWorkspaceXlsx(file);
      if (!isCurrentImport()) return;
      if (kind === 'table') {
        if (imported.isWorkspace || !imported.table || !data) throw new Error('請選擇單張表格檔案');
        dialogs.set('tableImportPreview', { table: imported.table, source: imported.source, parentId });
        setNotice('檔案已讀取，請檢查匯入內容');
      } else {
        if (!imported.isWorkspace || !imported.data || !data) throw new Error('請選擇整個資料庫檔案');
        dialogs.set('workspaceImport', imported.data);
      }
    } catch (error) {
      if (!isCurrentImport()) return;
      console.error('[workspace-import] failed', { kind, fileName: file.name, fileSize: file.size, error });
      setNotice(error instanceof Error ? `匯入失敗：${error.message}` : '匯入失敗');
    }
  };

  const finishTableImport = (tableCopy: WorkspaceTable, parentId: string | null) => {
    if (!data) return;
    const node = createNode('table', tableCopy.name, parentId, getChildren(data, parentId).length, tableCopy.id);
    commit({ ...data, tables: [...data.tables, tableCopy], nodes: [...data.nodes, node], activeNodeId: node.id }, undefined, { importedTableIds: [tableCopy.id] });
    dialogs.close('tableImportPreview');
    setDrawerOpen(false);
    setNotice(`已匯入「${tableCopy.name}」`);
  };

  const finishWorkspaceImport = (mode: 'replace' | 'merge') => {
    if (!data || !workspaceImport) return;
    const next = mode === 'replace'
      ? { ...workspaceImport, activeNodeId: resolveActiveTableNodeId(workspaceImport) }
      : (() => {
        const copy = cloneImportedWorkspace(workspaceImport);
        const merged = {
          ...data,
          nodes: [...data.nodes, ...copy.nodes],
          tables: [...data.tables, ...copy.tables],
          bottomNavigationTableIds: [...new Set([...(data.bottomNavigationTableIds ?? []), ...(copy.bottomNavigationTableIds ?? [])])].slice(0, MAX_BOTTOM_NAVIGATION_TABLES),
        };
        return { ...merged, activeNodeId: resolveActiveTableNodeId(merged, copy.nodes.find((node) => node.type === 'table')?.id) };
      })();
    const importedTableIds = next.tables.filter(table => mode === 'replace' || !data.tables.includes(table)).map(table => table.id);
    commit(next, undefined, { clearAllHistory: true, importedTableIds });
    dialogs.close('workspaceImport');
    setNotice(mode === 'replace' ? '資料庫已取代' : '資料庫已合併');
  };

  return {
    importTableInputRef,
    importWorkspaceInputRef,
    importTableParentId,
    openNameDialog,
    addFolder,
    addTable,
    renameNode,
    submitName,
    askDeleteNode,
    relocateNode,
    openNode,
    saveCellValue,
    updateCell,
    openCell,
    selectCellValue,
    addRow,
    askDeleteRow,
    addColumn,
    askDeleteColumn,
    saveColumn,
    exportCurrent,
    exportAll,
    chooseImport,
    readImport,
    finishTableImport,
    finishWorkspaceImport,
  };
}
