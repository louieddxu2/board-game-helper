import { useEffect, useRef } from 'react';
import { prepareWorkspaceColumnSave, WorkspaceColumnConversionError } from './columnConversion';
import type { WorkspaceCommitOptions, WorkspaceTableMutation } from './history';
import { createColumn, createNode, createRow, createTable, displayWorkspaceCellValue, displayWorkspaceColumnValue, getChildren, getRowHeaderColumn, MAX_BOTTOM_NAVIGATION_TABLES, moveNode, normalizeWorkspaceDateTime, removeNodeAndDescendants, resolveActiveTableNodeId } from './model';
import { cloneImportedWorkspace, exportWorkspaceArchive, exportWorkspaceXlsx, importWorkspaceArchive, importWorkspaceXlsx, WORKSPACE_ARCHIVE_FILE_NAME, type WorkspaceImportSource } from './spreadsheet';
import type { WorkspaceCellValue, WorkspaceColumn, WorkspaceData, WorkspaceNode, WorkspaceRow, WorkspaceTable } from './types';
import type { WorkspaceDialogController } from './useWorkspaceDialogs';
import type { NameDialogState } from './workspaceShared';
import { download, fileBaseName, updateTable } from './workspaceShared';

interface UseWorkspaceActionsProps {
  data: WorkspaceData | undefined;
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

export function useWorkspaceActions({ data, table, rowHeader, commit, getDynamicOptions, setNotice, setExpanded, setDrawerOpen, setTableActionsOpen, onExported, dialogs }: UseWorkspaceActionsProps) {
  const { nameDialog, selectionEditor, configuring, workspaceImport } = dialogs.state;

  const importTableInputRef = useRef<HTMLInputElement>(null);
  const importWorkspaceInputRef = useRef<HTMLInputElement>(null);
  const importTableParentId = useRef<string | null>(null);
  const importGeneration = useRef(0);
  const importOwnerMounted = useRef(false);

  useEffect(() => {
    importOwnerMounted.current = true;
    return () => {
      importOwnerMounted.current = false;
      importGeneration.current += 1;
    };
  }, []);

  const openNameDialog = (mode: NameDialogState['mode'], initialValue: string, parentId?: string | null, node?: WorkspaceNode) => dialogs.set('nameDialog', { mode, initialValue, parentId, node });
  const addFolder = (parentId: string | null) => openNameDialog('folder', '', parentId);
  const addTable = (parentId: string | null) => openNameDialog('table', '', parentId);
  const renameNode = (node: WorkspaceNode) => openNameDialog('rename', node.name, undefined, node);
  const renameRow = (row: WorkspaceRow) => dialogs.set('nameDialog', { mode: 'row', initialValue: rowHeader ? displayWorkspaceColumnValue(row.name, rowHeader) : displayWorkspaceCellValue(row.name), row });
  const renameRowHeader = (currentTable: WorkspaceTable) => dialogs.set('nameDialog', { mode: 'axis', initialValue: getRowHeaderColumn(currentTable).name, table: currentTable });

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
    dialogs.close('nameDialog');
  };

  const askDeleteNode = (node: WorkspaceNode) => {
    dialogs.close('nodeMenu');
    dialogs.set('confirmDialog', { title: '確認刪除', message: `確定要刪除「${node.name}」嗎？${node.type === 'folder' ? '資料夾內的內容也會一併刪除。' : ''}`, onConfirm: () => { if (data) commit(removeNodeAndDescendants(data, node.id)); dialogs.close('confirmDialog'); } });
  };

  const relocateNode = (node: WorkspaceNode, parentId: string | null) => {
    if (!data) return;
    const next = moveNode(data, node.id, parentId);
    if (next !== data) {
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
    const row = table.rows.find((item) => item.id === rowId);
    if (!row) { dialogs.close('editing'); return; }
    const before = isRowHeader ? row.name : row.values[column.id] ?? null;
    if (JSON.stringify(before) === JSON.stringify(value)) { dialogs.close('editing'); return; }
    commit(updateTable(data, table.id, (current) => ({
      ...current,
      updatedAt: Date.now(),
      rows: current.rows.map((row) => row.id === rowId ? isRowHeader ? { ...row, name: value } : { ...row, values: { ...row.values, [column.id]: value } } : row),
    })), {
      tableId: table.id,
      label: isRowHeader ? '編輯物件' : '編輯儲存格',
      action: { type: 'set-cell', rowId, columnId: column.id, before, after: value },
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

  const addRow = () => {
    if (!data || !table || !rowHeader) return;
    const row = createRow(table.columns, `物件 ${table.rows.length + 1}`);
    commit(updateTable(data, table.id, (current) => ({ ...current, updatedAt: Date.now(), rows: [...current.rows, row] })));
    dialogs.set('focusTarget', { rowId: row.id, columnId: table.transposed ? table.columns[0]?.id ?? rowHeader.id : rowHeader.id });
    setNotice('已新增物件');
  };
  const askDeleteRow = (row: WorkspaceRow, rowIndex: number) => dialogs.set('confirmDialog', { title: '刪除物件', message: `確定要刪除「${(rowHeader ? displayWorkspaceColumnValue(row.name, rowHeader) : displayWorkspaceCellValue(row.name)) || `第 ${rowIndex + 1} 個物件`}」嗎？`, onConfirm: () => { if (data && table) commit(updateTable(data, table.id, (current) => ({ ...current, updatedAt: Date.now(), rows: current.rows.filter((item) => item.id !== row.id) }))); dialogs.close('confirmDialog'); } });
  const addColumn = () => {
    if (!data || !table || !table.rows.length) return;
    const column = createColumn(`屬性 ${table.columns.length + 1}`);
    commit(updateTable(data, table.id, (current) => ({ ...current, updatedAt: Date.now(), columns: [...current.columns, column], rows: current.rows.map((row) => ({ ...row, values: { ...row.values, [column.id]: null } })) })));
    dialogs.set('focusTarget', { rowId: table.rows[0].id, columnId: column.id });
    setNotice('已新增屬性');
  };
  const askDeleteColumn = (column: WorkspaceColumn) => dialogs.set('confirmDialog', { title: '刪除屬性', message: `確定要刪除屬性「${column.name}」嗎？此屬性的資料也會一併刪除。`, onConfirm: () => { if (data && table) commit(updateTable(data, table.id, (current) => ({ ...current, updatedAt: Date.now(), columns: current.columns.filter((item) => item.id !== column.id), rows: current.rows.map((row) => { const values = { ...row.values }; delete values[column.id]; return { ...row, values }; }) }))); dialogs.close('confirmDialog'); } });
  
  const saveColumn = (column: WorkspaceColumn) => {
    if (!data || !table || !configuring) return;
    let prepared: ReturnType<typeof prepareWorkspaceColumnSave>;
    try { prepared = prepareWorkspaceColumnSave(table, column); }
    catch (error) {
      if (!(error instanceof WorkspaceColumnConversionError)) throw error;
      return error.message;
    }
    const changes = prepared.changes.length ? prepared.changes : undefined;
    const action: WorkspaceTableMutation['action'] = configuring.isRowHeader
      ? { type: 'update-row-header', before: table.rowHeader, after: prepared.table.rowHeader, beforeName: table.rowHeaderName, afterName: prepared.table.rowHeaderName, changes }
      : { type: 'update-column', before: table.columns.find(item => item.id === column.id)!, after: prepared.table.columns.find(item => item.id === column.id)!, changes };
    commit(updateTable(data, table.id, () => ({ ...prepared.table, updatedAt: Date.now() })), changes ? {
      tableId: table.id, label: configuring.isRowHeader ? '設定物件屬性' : '設定屬性', action,
    } : undefined);
    dialogs.close('configuring');
  };

  const exportCurrent = () => { if (!data || !table) return; download(exportWorkspaceXlsx(data, table), `${fileBaseName(table.name)}.xlsx`); onExported(); setTableActionsOpen(false); setNotice('已匯出目前表格'); };
  const exportAll = async () => {
    if (!data) return;
    setNotice('正在準備整個資料庫備份…');
    try {
      download(await exportWorkspaceArchive(data), WORKSPACE_ARCHIVE_FILE_NAME);
      onExported();
      setDrawerOpen(false);
      setNotice('已匯出整個資料庫備份');
    } catch (error) {
      console.error('[workspace-export] failed', error);
      setNotice(error instanceof Error ? `匯出失敗：${error.message}` : '匯出失敗');
    }
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
    const isCurrentImport = () => importOwnerMounted.current && importGeneration.current === generation;
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
