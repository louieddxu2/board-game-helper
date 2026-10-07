import { useCallback } from 'react';
import type { WorkspaceTable } from './types';
import type { WorkspaceStorageController } from './useWorkspaceStorage';

export const useWorkspaceHistory = (storage: Pick<WorkspaceStorageController, 'historyReady' | 'historyByTable' | 'moveTableHistory'>, table: WorkspaceTable | undefined, closeEditors: () => void) => {
  const { historyReady, historyByTable, moveTableHistory } = storage;
  const tableId = table?.id;
  const move = useCallback((direction: 'undo' | 'redo') => {
    if (tableId && moveTableHistory(tableId, direction)) closeEditors();
  }, [tableId, moveTableHistory, closeEditors]);
  const undoTable = useCallback(() => move('undo'), [move]);
  const redoTable = useCallback(() => move('redo'), [move]);
  return { currentTableHistory: tableId && historyReady ? historyByTable.get(tableId) : undefined, undoTable, redoTable };
};
