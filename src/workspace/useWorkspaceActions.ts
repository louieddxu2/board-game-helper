import { useRef, useState } from 'react';
import type { WorkspaceCellValue, WorkspaceColumn, WorkspaceData, WorkspaceNode, WorkspaceRow, WorkspaceTable } from './types';
import { createColumn, createNode, createRow, createTable, displayWorkspaceCellValue, displayWorkspaceColumnValue, getChildren, getDynamicOptions, getRowHeaderColumn, moveNode, normalizeWorkspaceDateTime, removeNodeAndDescendants, resolveActiveTableNodeId } from './model';
import { cloneImportedWorkspace, exportWorkspaceXlsx, importWorkspaceXlsx, type WorkspaceImportSource } from './spreadsheet';
import type { WorkspaceCommitOptions, WorkspaceTableMutation } from './history';
import type { NameDialogState } from './workspaceShared';
import { download, fileBaseName, updateTable } from './workspaceShared';

interface UseWorkspaceActionsProps {
  data: WorkspaceData | undefined;
  table: WorkspaceTable | undefined;
  rowHeader: WorkspaceColumn | undefined;
  commit: (next: WorkspaceData, mutation?: WorkspaceTableMutation, options?: WorkspaceCommitOptions) => void;
  setNotice: (msg: string) => void;
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
  setDrawerOpen: (open: boolean) => void;
  setEditing: (editing: { rowId: string; columnId: string } | undefined) => void;
  setFocusTarget: (target: { rowId: string; columnId: string } | undefined) => void;
  setSelectionEditor: (editor: { rowId: string; column: WorkspaceColumn; value: WorkspaceCellValue; options: string[]; isRowHeader: boolean } | undefined) => void;
  setConfiguring: (config: { column: WorkspaceColumn; isRowHeader: boolean } | undefined) => void;
  setNodeMenu: (node: WorkspaceNode | undefined) => void;
  setMovingNode: (node: WorkspaceNode | undefined) => void;
  setTableActionsOpen: (open: boolean) => void;
  setTableCreateParentId: (id: string | null | undefined) => void;
  setNameDialog: (state: NameDialogState | undefined) => void;
  setConfirmDialog: (dialog: { title: string; message: string; onConfirm(): void } | undefined) => void;
  setWorkspaceImport: (data: WorkspaceData | undefined) => void;
  setTableImportPreview: (preview: WorkspaceTableImportPreview | undefined) => void;
  onExported: () => void;
  nameDialog: NameDialogState | undefined;
  selectionEditor: { rowId: string; column: WorkspaceColumn; value: WorkspaceCellValue; options: string[]; isRowHeader: boolean } | undefined;
  configuring: { column: WorkspaceColumn; isRowHeader: boolean } | undefined;
  workspaceImport: WorkspaceData | undefined;
}

export type WorkspaceTableImportPreview = {
  table: WorkspaceTable;
  source: WorkspaceImportSource;
  parentId: string | null;
};

export function useWorkspaceActions({
  data, table, rowHeader, commit, setNotice, setExpanded, setDrawerOpen,
  setEditing, setFocusTarget, setSelectionEditor, setConfiguring, setNodeMenu, setMovingNode,
  setTableActionsOpen, setTableCreateParentId, setNameDialog,
  setConfirmDialog, setWorkspaceImport, setTableImportPreview, onExported, nameDialog, selectionEditor, configuring, workspaceImport
}: UseWorkspaceActionsProps) {

  const importTableInputRef = useRef<HTMLInputElement>(null);
  const importWorkspaceInputRef = useRef<HTMLInputElement>(null);
  const importTableParentId = useRef<string | null>(null);

  const openNameDialog = (mode: NameDialogState['mode'], initialValue: string, parentId?: string | null, node?: WorkspaceNode) => setNameDialog({ mode, initialValue, parentId, node });
  const addFolder = (parentId: string | null) => openNameDialog('folder', '', parentId);
  const addTable = (parentId: string | null) => openNameDialog('table', '', parentId);
  const renameNode = (node: WorkspaceNode) => openNameDialog('rename', node.name, undefined, node);
  const renameRow = (row: WorkspaceRow) => setNameDialog({ mode: 'row', initialValue: rowHeader ? displayWorkspaceColumnValue(row.name, rowHeader) : displayWorkspaceCellValue(row.name), row });
  const renameRowHeader = (currentTable: WorkspaceTable) => setNameDialog({ mode: 'axis', initialValue: getRowHeaderColumn(currentTable).name, table: currentTable });

  const submitName = (name: string) => {
    if (!data || !nameDialog) return;
    if (nameDialog.mode === 'folder' || nameDialog.mode === 'table') {
      const parentId = nameDialog.parentId ?? null;
      if (nameDialog.mode === 'folder') {
        const node = createNode('folder', name, parentId, getChildren(data, parentId).length);
        commit({ ...data, nodes: [...data.nodes, node] });
        setExpanded((current) => { const next = new Set(current); if (parentId) next.add(parentId); else next.add(node.id); return next; });
      } else {
        const currentTable = createTable(name);
        const node = createNode('table', currentTable.name, parentId, getChildren(data, parentId).length, currentTable.id);
        commit({ ...data, tables: [...data.tables, currentTable], nodes: [...data.nodes, node], activeNodeId: node.id });
        if (parentId) setExpanded((current) => new Set(current).add(parentId));
        setDrawerOpen(false);
      }
    } else if (nameDialog.row && table) {
      const rowId = nameDialog.row.id;
      commit(updateTable(data, table.id, (current) => ({ ...current, updatedAt: Date.now(), rows: current.rows.map((row) => row.id === rowId ? { ...row, name } : row) })));
    } else if (nameDialog.table && table) {
      commit(updateTable(data, table.id, (current) => ({ ...current, rowHeaderName: name, updatedAt: Date.now() })));
    } else if (nameDialog.node) {
      const node = nameDialog.node;
      const next = { ...data, nodes: data.nodes.map((item) => item.id === node.id ? { ...item, name } : item), tables: node.tableId ? data.tables.map((item) => item.id === node.tableId ? { ...item, name, updatedAt: Date.now() } : item) : data.tables };
      commit(next);
    }
    setNameDialog(undefined);
  };

  const askDeleteNode = (node: WorkspaceNode) => {
    setNodeMenu(undefined);
    setConfirmDialog({ title: '確認刪除', message: `確定要刪除「${node.name}」嗎？${node.type === 'folder' ? '資料夾內的內容也會一併刪除。' : ''}`, onConfirm: () => { if (data) commit(removeNodeAndDescendants(data, node.id)); setConfirmDialog(undefined); } });
  };

  const relocateNode = (node: WorkspaceNode, parentId: string | null) => {
    if (!data) return;
    const next = moveNode(data, node.id, parentId);
    if (next !== data) {
      commit(next);
      if (parentId) setExpanded((current) => new Set(current).add(parentId));
      setNotice(`已移動「${node.name}」`);
    }
    setMovingNode(undefined);
    setNodeMenu(undefined);
  };

  const openNode = (node: WorkspaceNode) => {
    if (!data) return;
    if (node.type === 'folder') {
      setExpanded((current) => { const next = new Set(current); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; });
      return;
    }
    commit({ ...data, activeNodeId: node.id });
    setEditing(undefined);
    setFocusTarget(undefined);
    setSelectionEditor(undefined);
    setDrawerOpen(false);
    setNodeMenu(undefined);
  };

  const saveCellValue = (rowId: string, column: WorkspaceColumn, value: WorkspaceCellValue) => {
    if (!data || !table) return;
    const isRowHeader = rowHeader?.id === column.id;
    commit(updateTable(data, table.id, (current) => ({
      ...current,
      updatedAt: Date.now(),
      rows: current.rows.map((row) => row.id === rowId ? isRowHeader ? { ...row, name: value } : { ...row, values: { ...row.values, [column.id]: value } } : row),
    })));
    setEditing(undefined);
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
    setFocusTarget(undefined);
    const isRowHeader = rowHeader?.id === column.id;
    const value = isRowHeader ? row.name : row.values[column.id];
    if (column.inputType === 'select' || column.inputType === 'dynamic-select') {
      setEditing(undefined);
      setSelectionEditor({ rowId: row.id, column, value, options: column.inputType === 'dynamic-select' ? getDynamicOptions(table, column.id) : column.options, isRowHeader });
      return;
    }
    setEditing({ rowId: row.id, columnId: column.id });
  };

  const selectCellValue = (value: string) => {
    if (!selectionEditor) return;
    updateCell(selectionEditor.rowId, selectionEditor.column, value);
    if (!selectionEditor.column.isMultiple) setSelectionEditor(undefined);
  };

  const addRow = () => {
    if (!data || !table || !rowHeader) return;
    const row = createRow(table.columns, `物件 ${table.rows.length + 1}`);
    commit(updateTable(data, table.id, (current) => ({ ...current, updatedAt: Date.now(), rows: [...current.rows, row] })));
    setFocusTarget({ rowId: row.id, columnId: table.transposed ? table.columns[0]?.id ?? rowHeader.id : rowHeader.id });
    setNotice('已新增物件');
  };
  const askDeleteRow = (row: WorkspaceRow, rowIndex: number) => setConfirmDialog({ title: '刪除物件', message: `確定要刪除「${(rowHeader ? displayWorkspaceColumnValue(row.name, rowHeader) : displayWorkspaceCellValue(row.name)) || `第 ${rowIndex + 1} 個物件`}」嗎？`, onConfirm: () => { if (data && table) commit(updateTable(data, table.id, (current) => ({ ...current, updatedAt: Date.now(), rows: current.rows.filter((item) => item.id !== row.id) }))); setConfirmDialog(undefined); } });
  const addColumn = () => {
    if (!data || !table || !table.rows.length) return;
    const column = createColumn(`屬性 ${table.columns.length + 1}`);
    commit(updateTable(data, table.id, (current) => ({ ...current, updatedAt: Date.now(), columns: [...current.columns, column], rows: current.rows.map((row) => ({ ...row, values: { ...row.values, [column.id]: null } })) })));
    setFocusTarget({ rowId: table.rows[0].id, columnId: column.id });
    setNotice('已新增屬性');
  };
  const askDeleteColumn = (column: WorkspaceColumn) => setConfirmDialog({ title: '刪除屬性', message: `確定要刪除屬性「${column.name}」嗎？此屬性的資料也會一併刪除。`, onConfirm: () => { if (data && table) commit(updateTable(data, table.id, (current) => ({ ...current, updatedAt: Date.now(), columns: current.columns.filter((item) => item.id !== column.id), rows: current.rows.map((row) => { const values = { ...row.values }; delete values[column.id]; return { ...row, values }; }) }))); setConfirmDialog(undefined); } });
  
  const saveColumn = (column: WorkspaceColumn) => {
    if (!data || !table || !configuring) return;
    commit(updateTable(data, table.id, (current) => configuring.isRowHeader
      ? { ...current, updatedAt: Date.now(), rowHeaderName: column.name, rowHeader: column }
      : { ...current, updatedAt: Date.now(), columns: current.columns.map((item) => item.id === column.id ? column : item) }));
    setConfiguring(undefined);
  };

  const exportCurrent = () => { if (!data || !table) return; download(exportWorkspaceXlsx(data, table), `${fileBaseName(table.name)}.xlsx`); onExported(); setTableActionsOpen(false); setNotice('已匯出目前表格'); };
  const exportAll = () => { if (!data) return; download(exportWorkspaceXlsx(data), 'workspace.xlsx'); onExported(); setDrawerOpen(false); setNotice('已匯出整個資料庫'); };
  
  const chooseImport = (kind: 'table' | 'workspace') => {
    const input = kind === 'table' ? importTableInputRef.current : importWorkspaceInputRef.current;
    if (!input) { setNotice('無法開啟檔案選擇器'); return; }
    try {
      if (typeof input.showPicker === 'function') input.showPicker();
      else input.click();
      setTableActionsOpen(false);
      setTableCreateParentId(undefined);
      if (kind === 'workspace') setDrawerOpen(false);
    } catch {
      input.click();
      setTableActionsOpen(false);
      setTableCreateParentId(undefined);
      if (kind === 'workspace') setDrawerOpen(false);
    }
  };

  const readImport = async (file: File, kind: 'table' | 'workspace') => {
    setNotice(`正在匯入「${file.name}」…`);
    try {
      const imported = await importWorkspaceXlsx(file);
      if (kind === 'table') {
        if (imported.isWorkspace || !imported.table || !data) throw new Error('請選擇單張表格檔案');
        setTableImportPreview({ table: imported.table, source: imported.source, parentId: importTableParentId.current });
        setNotice('檔案已讀取，請檢查匯入內容');
      } else {
        if (!imported.isWorkspace || !imported.data || !data) throw new Error('請選擇整個資料庫檔案');
        setWorkspaceImport(imported.data);
      }
    } catch (error) {
      console.error('[workspace-import] failed', { kind, fileName: file.name, fileSize: file.size, error });
      setNotice(error instanceof Error ? `匯入失敗：${error.message}` : '匯入失敗');
    }
  };

  const finishTableImport = (tableCopy: WorkspaceTable) => {
    if (!data) return;
    const parentId = importTableParentId.current;
    const node = createNode('table', tableCopy.name, parentId, getChildren(data, parentId).length, tableCopy.id);
    commit({ ...data, tables: [...data.tables, tableCopy], nodes: [...data.nodes, node], activeNodeId: node.id });
    setTableImportPreview(undefined);
    setDrawerOpen(false);
    setNotice(`已匯入「${tableCopy.name}」`);
  };

  const finishWorkspaceImport = (mode: 'replace' | 'merge') => {
    if (!data || !workspaceImport) return;
    const next = mode === 'replace'
      ? { ...workspaceImport, activeNodeId: resolveActiveTableNodeId(workspaceImport) }
      : (() => {
        const copy = cloneImportedWorkspace(workspaceImport);
        const merged = { ...data, nodes: [...data.nodes, ...copy.nodes], tables: [...data.tables, ...copy.tables] };
        return { ...merged, activeNodeId: resolveActiveTableNodeId(merged, copy.nodes.find((node) => node.type === 'table')?.id) };
      })();
    commit(next, undefined, { clearAllHistory: true });
    setWorkspaceImport(undefined);
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
    renameRow,
    renameRowHeader,
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
