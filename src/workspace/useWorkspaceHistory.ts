import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useCallback } from 'react';
import { assignWorkspaceChangeRevisions } from './changeRevisions';
import { saveWorkspace } from './db';
import type { WorkspaceDynamicOptionsCache } from './dynamicOptionsCache';
import { applyWorkspaceTableHistoryActionWithNode, createEmptyWorkspaceTableHistory, type WorkspaceTableHistory } from './history';
import type { WorkspaceCellValue, WorkspaceColumn, WorkspaceData, WorkspaceTable } from './types';

interface WorkspaceHistoryOptions {
  data: WorkspaceData | undefined;
  table: WorkspaceTable | undefined;
  historyReadyRef: RefObject<boolean>;
  historyRef: RefObject<Map<string, WorkspaceTableHistory>>;
  dynamicOptionsCacheRef: RefObject<WorkspaceDynamicOptionsCache>;
  setHistoryByTable: Dispatch<SetStateAction<Map<string, WorkspaceTableHistory>>>;
  setData: Dispatch<SetStateAction<WorkspaceData | undefined>>;
  dataRef: RefObject<WorkspaceData | undefined>;
  setEditing: Dispatch<SetStateAction<{ rowId: string; columnId: string; } | undefined>>;
  setSelectionEditor: Dispatch<SetStateAction<{ rowId: string; column: WorkspaceColumn; value: WorkspaceCellValue; options: string[]; isRowHeader: boolean; } | undefined>>;
  saveRevisionRef: RefObject<number>;
  setSaveState: Dispatch<SetStateAction<"saved" | "saving" | "error">>;
  pendingHistoryResetRef: RefObject<{ all: boolean; ids: Set<string>; }>;
  allTablesReadyRef: RefObject<boolean>;
  setLastSavedAt: Dispatch<SetStateAction<number | undefined>>;
  reportSaveError: (error: unknown) => void;
  setNotice: Dispatch<SetStateAction<string>>;
  historyReady: boolean;
  historyByTable: Map<string, WorkspaceTableHistory>;
}

export const useWorkspaceHistory = ({ data, table, historyReadyRef, historyRef, dynamicOptionsCacheRef, setHistoryByTable, setData, dataRef, setEditing, setSelectionEditor, saveRevisionRef, setSaveState, pendingHistoryResetRef, allTablesReadyRef, setLastSavedAt, reportSaveError, setNotice, historyReady, historyByTable }: WorkspaceHistoryOptions) => {
  const moveTableHistory = useCallback((direction: 'undo' | 'redo') => {
    if (!data || !table || !historyReadyRef.current) return;
    const currentHistory = historyRef.current.get(table.id) ?? createEmptyWorkspaceTableHistory(table.id);
    const source = direction === 'undo' ? currentHistory.past : currentHistory.future;
    const entry = source[source.length - 1];
    if (!entry) return;
    const revised = assignWorkspaceChangeRevisions(data, applyWorkspaceTableHistoryActionWithNode(data, table.id, entry.action, direction));
    const nextData = dynamicOptionsCacheRef.current.prepare(data, revised, { tableId: table.id, action: entry.action }, direction);
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
    const saveRevision = ++saveRevisionRef.current;
    setSaveState('saving');
    const reset = pendingHistoryResetRef.current;
    void saveWorkspace(nextData, {
      partial: !allTablesReadyRef.current,
      mutation: { tableId: table.id, action: entry.action },
      history: { clearAll: reset.all, deleteTableIds: [...reset.ids], replace: [...nextHistories.values()] },
    }).then(() => {
      if (pendingHistoryResetRef.current === reset) pendingHistoryResetRef.current = { all: false, ids: new Set() };
      if (saveRevision !== saveRevisionRef.current) return;
      setSaveState('saved');
      setLastSavedAt(Date.now());
    }).catch((error: unknown) => {
      if (saveRevision !== saveRevisionRef.current) return;
      reportSaveError(error);
    });
    setNotice(direction === 'undo' ? `已復原：${entry.label}` : `已重做：${entry.label}`);
  }, [data, reportSaveError, table]);

  const undoTable = useCallback(() => moveTableHistory('undo'), [moveTableHistory]);

  const redoTable = useCallback(() => moveTableHistory('redo'), [moveTableHistory]);

  const currentTableHistory = table && historyReady ? historyByTable.get(table.id) : undefined;

  return { currentTableHistory, undoTable, redoTable };
};
