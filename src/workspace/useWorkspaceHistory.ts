import { useCallback, useLayoutEffect, useRef } from 'react';
import type { WorkspaceTable } from './types';
import type { WorkspaceStorageController } from './useWorkspaceStorage';

export const useWorkspaceHistory = (storage: Pick<WorkspaceStorageController, 'historyLoadedTableIds' | 'historyByTable' | 'moveTableHistory'>, table: WorkspaceTable | undefined, closeEditors: () => void) => {
  const { historyLoadedTableIds, historyByTable, moveTableHistory } = storage;
  const tableId = table?.id;
  const ownerRef = useRef(0);
  useLayoutEffect(() => {
    ownerRef.current += 1;
    return () => { ownerRef.current += 1; };
  }, [tableId]);
  const move = useCallback((direction: 'undo' | 'redo') => {
    const owner = ownerRef.current;
    if (tableId) void moveTableHistory(tableId, direction).then(moved => {
      if (moved && ownerRef.current === owner) closeEditors();
    });
  }, [tableId, moveTableHistory, closeEditors]);
  const undoTable = useCallback(() => move('undo'), [move]);
  const redoTable = useCallback(() => move('redo'), [move]);
  return { currentTableHistory: tableId && historyLoadedTableIds.has(tableId) ? historyByTable.get(tableId) : undefined, undoTable, redoTable };
};
