import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useCallback, useMemo } from 'react';
import type { WorkspaceCommitOptions, WorkspaceTableMutation } from './history';
import { displayWorkspaceColumnValue, getTableForNode } from './model';
import type { WorkspaceColumn, WorkspaceData, WorkspaceTable } from './types';
import type { WorkspaceReadiness } from './useReadyWorkspaceActions';
import { useReadyWorkspaceActions } from './useReadyWorkspaceActions';
import { applyWorkspaceMatrixPaste, parseWorkspaceClipboard } from './workspacePaste';
import { updateTable } from './workspaceShared';

interface WorkspaceClipboardOptions {
  table: WorkspaceTable | undefined;
  rowHeader: WorkspaceColumn | undefined;
  lastPasteTarget: { rowId: string; columnId: string; } | undefined;
  focusTarget: { rowId: string; columnId: string; } | undefined;
  dataRef: RefObject<WorkspaceData | undefined>;
  setNotice: Dispatch<SetStateAction<string>>;
  setPasteDialogOpen: Dispatch<SetStateAction<boolean>>;
  commit: (next: WorkspaceData, explicitMutation?: WorkspaceTableMutation, options?: WorkspaceCommitOptions) => void;
  readiness: WorkspaceReadiness;
}

export const useWorkspaceClipboard = ({ table, rowHeader, lastPasteTarget, focusTarget, dataRef, setNotice, setPasteDialogOpen, commit, readiness }: WorkspaceClipboardOptions) => {
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

  const rawPasteMatrix = useCallback((matrix: string[][]) => {
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

  const { pasteMatrix } = useReadyWorkspaceActions({ pasteMatrix: rawPasteMatrix }, { pasteMatrix: 'active' }, readiness);

  const handleWorkspacePaste = useCallback((event: React.ClipboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && !window.matchMedia('(pointer: fine)').matches) return;
    if (target.closest('input, textarea, select, [contenteditable="true"]') || !pasteTarget || (!lastPasteTarget && !focusTarget)) return;
    const text = event.clipboardData.getData('text/plain');
    if (!text) return;
    event.preventDefault();
    pasteMatrix(parseWorkspaceClipboard(text));
  }, [focusTarget, lastPasteTarget, pasteMatrix, pasteTarget]);

  return { handleWorkspacePaste, pasteTarget, pasteTargetLabel, pasteMatrix };
};
