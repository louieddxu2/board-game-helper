import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { type WorkspaceBulkSelection } from './bulkEdit';
import { applyWorkspaceCellChanges } from './cellChanges';
import { sameWorkspaceCellValue } from './model';
import { getWorkspaceRow, getWorkspaceRowIndexes } from './rowIndexes';
import type { WorkspaceCommitOptions, WorkspaceTableMutation } from './history';
import type { WorkspaceCellValue, WorkspaceData, WorkspaceRow, WorkspaceTable } from './types';
import type { WorkspaceDialogController } from './useWorkspaceDialogs';
import { numericWorkspaceValue, updateTable } from './workspaceShared';

const emptyRows: WorkspaceRow[] = [];

const toggleBulkSelectionRow = (selection: WorkspaceBulkSelection, rowId: string): WorkspaceBulkSelection | undefined => {
  const selected = selection.rowIds.includes(rowId);
  const rowIds = selected ? selection.rowIds.filter((id) => id !== rowId) : [...selection.rowIds, rowId];
  if (rowIds.length === 0) return undefined;
  return { ...selection, rowIds };
};

interface WorkspaceBulkSelectionOptions {
  table: WorkspaceTable | undefined;
  setNotice: Dispatch<SetStateAction<string>>;
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
  setEditBarOpen: Dispatch<SetStateAction<boolean>>;
  setTableActionsOpen: Dispatch<SetStateAction<boolean>>;
  filteredRows: WorkspaceRow[];
  dataRef: RefObject<WorkspaceData | undefined>;
  commit: (next: WorkspaceData, explicitMutation?: WorkspaceTableMutation, options?: WorkspaceCommitOptions) => void;
  dialogs: Pick<WorkspaceDialogController, 'set' | 'close'>;
}

export const useWorkspaceBulkSelection = ({ table, setNotice, setSearchOpen, setEditBarOpen, setTableActionsOpen, filteredRows, dataRef, commit, dialogs }: WorkspaceBulkSelectionOptions) => {
  const { close: closeDialogs, set: setDialog } = dialogs;
  const [bulkSelection, setBulkSelection] = useState<WorkspaceBulkSelection>();

  const [bulkTopRowRevealed, setBulkTopRowRevealed] = useState(false);

  const [bulkEditorOpen, setBulkEditorOpen] = useState(false);

  const bulkColumn = useMemo(() => bulkSelection && table?.id === bulkSelection.tableId ? table.columns.find((column) => column.id === bulkSelection.columnId) : undefined, [bulkSelection, table]);

  const bulkSelectedRowIds = useMemo(() => new Set(bulkSelection?.rowIds ?? []), [bulkSelection?.rowIds]);

  const bulkRows = useMemo(() => bulkSelection && table?.id === bulkSelection.tableId ? bulkSelection.rowIds.flatMap((rowId) => {
    const row = getWorkspaceRow(table.rows, rowId);
    return row ? [row] : [];
  }) : emptyRows, [bulkSelection, table?.id, table?.rows]);

  const bulkNumericValues = useMemo(() => bulkColumn?.inputType === 'number'
    ? bulkRows.map((row) => numericWorkspaceValue(row.values[bulkColumn.id] ?? null)).filter((value): value is number => value !== undefined)
    : [], [bulkColumn, bulkRows]);

  const bulkMultiSelectRows = useMemo(() => bulkColumn ? bulkRows.map((row) => ({ rowId: row.id, value: row.values[bulkColumn.id] ?? null })) : [], [bulkColumn, bulkRows]);

  const startBulkSelection = useCallback((rowId: string, columnId: string) => {
    if (!table || !table.columns.some((column) => column.id === columnId)) return false;
    if (bulkSelection) {
      if (bulkSelection.columnId !== columnId) {
        setNotice('批次編輯只能選取同一屬性的格子');
        return false;
      }
      setBulkSelection((current) => current && !current.rowIds.includes(rowId) ? { ...current, rowIds: [...current.rowIds, rowId] } : current);
      return true;
    }
    closeDialogs('editing', 'selectionEditor', 'configuring');
    setSearchOpen(false);
    setEditBarOpen(false);
    setTableActionsOpen(false);
    setBulkTopRowRevealed(false);
    setBulkSelection({ tableId: table.id, columnId, rowIds: [rowId] });
    setNotice('已進入批次選取');
    return true;
  }, [bulkSelection, table, setSearchOpen, closeDialogs]);

  const sweepBulkSelection = useCallback((fromRowId: string, toRowId: string, columnId: string) => {
    const indexes = getWorkspaceRowIndexes(filteredRows);
    const fromIndex = indexes.get(fromRowId) ?? -1;
    const toIndex = indexes.get(toRowId) ?? -1;
    if (!table || fromIndex < 0 || toIndex < 0) return;
    const crossedIds = filteredRows.slice(Math.min(fromIndex, toIndex), Math.max(fromIndex, toIndex) + 1).map((row) => row.id);
    setBulkSelection((current) => {
      if (!current || current.tableId !== table.id || current.columnId !== columnId) return current;
      const rowIds = [...current.rowIds];
      const selected = new Set(rowIds);
      for (const id of crossedIds) {
        if (selected.has(id)) continue;
        selected.add(id);
        rowIds.push(id);
      }
      return rowIds.length === current.rowIds.length ? current : { ...current, rowIds };
    });
  }, [filteredRows, table]);

  useEffect(() => {
    if (!bulkSelection) setBulkTopRowRevealed(false);
  }, [bulkSelection]);

  const toggleBulkCell = useCallback((rowId: string, columnId: string) => {
    if (!bulkSelection || bulkSelection.tableId !== table?.id) return;
    setDialog('lastPasteTarget', { rowId, columnId });
    if (bulkSelection.columnId !== columnId) {
      setNotice('批次編輯只能選取同一屬性的格子');
      return;
    }
    setBulkSelection((current) => current?.tableId === table.id && current.columnId === columnId
      ? toggleBulkSelectionRow(current, rowId) : current);
  }, [bulkSelection, table, setDialog]);

  const closeBulkSelection = useCallback(() => {
    setBulkSelection(undefined);
    setBulkEditorOpen(false);
  }, []);

  const commitBulkCellUpdates = useCallback((updates: Array<{ rowId: string; value: WorkspaceCellValue }>) => {
    const currentData = dataRef.current;
    if (!currentData || !table || !bulkSelection || !bulkColumn) return;
    const valuesByRowId = new Map(updates.map((update) => [update.rowId, update.value]));
    const changes = [...valuesByRowId].flatMap(([rowId, after]) => {
      const row = getWorkspaceRow(table.rows, rowId);
      if (!row) return [];
      const before = row.values[bulkColumn.id] ?? null;
      return sameWorkspaceCellValue(before, after) ? [] : [{ rowId, before, after }];
    });
    if (changes.length === 0) {
      setNotice('選取的格子沒有變更');
      closeBulkSelection();
      return;
    }
    const next = updateTable(currentData, table.id, (current) => ({
      ...current,
      updatedAt: Date.now(),
      rows: applyWorkspaceCellChanges(current.rows, undefined, changes.map(change => ({ ...change, columnId: bulkColumn.id }))),
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

  return { bulkTopRowRevealed, setBulkSelection, setBulkEditorOpen, startBulkSelection, sweepBulkSelection, toggleBulkCell, bulkSelection, setBulkTopRowRevealed, closeBulkSelection, bulkEditorOpen, bulkColumn, bulkSelectedRowIds, bulkNumericValues, bulkRows, bulkDraftValue, commitBulkSelection, bulkMultiSelectRows, commitBulkCellUpdates };
};
