import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useCallback, useRef } from 'react';
import type { WorkspaceCommitOptions, WorkspaceTableMutation } from './history';
import { displayWorkspaceColumnValue, getTableForNode } from './model';
import type { WorkspaceCellValue, WorkspaceColumn, WorkspaceData, WorkspaceRow } from './types';
import { updateTable } from './workspaceShared';

interface WorkspaceHiddenFieldsOptions {
  dataRef: RefObject<WorkspaceData | undefined>;
  commit: (next: WorkspaceData, explicitMutation?: WorkspaceTableMutation, options?: WorkspaceCommitOptions) => void;
  withActiveTable: (work: () => void) => void;
  setHiddenFieldsEditor: Dispatch<SetStateAction<{ rowId: string; title: string; } | undefined>>;
  rowHeader: WorkspaceColumn | undefined;
}

export const useWorkspaceHiddenFields = ({ dataRef, commit, withActiveTable, setHiddenFieldsEditor, rowHeader }: WorkspaceHiddenFieldsOptions) => {
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

  const openHiddenFields = (row: WorkspaceRow) => withActiveTable(() => setHiddenFieldsEditor({ rowId: row.id, title: rowHeader ? displayWorkspaceColumnValue(row.name, rowHeader) : '' }));

  const openHiddenFieldsRef = useRef(openHiddenFields);

  openHiddenFieldsRef.current = openHiddenFields;

  const stableOpenHiddenFields = useCallback((row: WorkspaceRow) => openHiddenFieldsRef.current(row), []);

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

  return { stableOpenHiddenFields, toggleColumnVisibility, saveHiddenFields };
};
