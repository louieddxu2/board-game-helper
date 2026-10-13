import type { RefObject } from 'react';
import { useStableCallback } from '../hooks/useStableCallback';
import { applyWorkspaceCellChanges, sameWorkspaceCellValue } from './cellChanges';
import type { WorkspaceCommitOptions, WorkspaceTableMutation } from './history';
import { displayWorkspaceColumnValue, getRowHeaderColumn, getTableForNode } from './model';
import type { WorkspaceCellValue, WorkspaceColumn, WorkspaceData, WorkspaceRow } from './types';
import type { WorkspaceDialogController } from './useWorkspaceDialogs';
import { updateTable } from './workspaceShared';

interface WorkspaceHiddenFieldsOptions {
  dataRef: RefObject<WorkspaceData | undefined>;
  commit: (next: WorkspaceData, explicitMutation?: WorkspaceTableMutation, options?: WorkspaceCommitOptions) => void;
  withActiveTable: (work: () => void) => void;
  rowHeader: WorkspaceColumn | undefined;
  dialogs: Pick<WorkspaceDialogController, 'set' | 'close'>;
}

export const useWorkspaceHiddenFields = ({ dataRef, commit, withActiveTable, rowHeader, dialogs }: WorkspaceHiddenFieldsOptions) => {
  const { set: setDialog, close: closeDialogs } = dialogs;
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

  const stableOpenHiddenFields = useStableCallback((row: WorkspaceRow) => withActiveTable(() => setDialog('hiddenFieldsEditor', { rowId: row.id, title: rowHeader ? displayWorkspaceColumnValue(row.name, rowHeader) : '' })));

  const saveHiddenFields = (rowId: string, values: Record<string, WorkspaceCellValue>) => {
    const currentData = dataRef.current;
    if (!currentData) return;
    const currentTable = getTableForNode(currentData, currentData.activeNodeId);
    const row = currentTable?.rows.find((item) => item.id === rowId);
    if (!currentTable || !row) return;
    const changes = currentTable.columns.flatMap(column => {
      if (!column.hidden || column.formula) return [];
      const before = row.values[column.id] ?? null;
      const after = values[column.id] ?? null;
      return sameWorkspaceCellValue(before, after) ? [] : [{ rowId, columnId: column.id, before, after }];
    });
    if (changes.length) commit(updateTable(currentData, currentTable.id, current => ({
      ...current, updatedAt: Date.now(),
      rows: applyWorkspaceCellChanges(current.rows, getRowHeaderColumn(current).id, changes),
    })), { tableId: currentTable.id, label: '編輯隱藏欄位', action: { type: 'paste-range', changes, addedRows: [], addedColumns: [] } });
    closeDialogs('hiddenFieldsEditor');
  };

  return { stableOpenHiddenFields, toggleColumnVisibility, saveHiddenFields };
};
