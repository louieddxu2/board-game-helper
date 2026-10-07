import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { assignWorkspaceChangeRevisions } from './changeRevisions';
import { saveWorkspace, type WorkspaceSaveOptions } from './db';
import { WorkspaceDynamicOptionsCache } from './dynamicOptionsCache';
import { applyWorkspaceTableHistoryActionWithNode, createEmptyWorkspaceTableHistory, inferWorkspaceTableMutation, pushWorkspaceTableHistory, type WorkspaceCommitOptions, type WorkspaceTableHistory, type WorkspaceTableMutation } from './history';
import { getTableForNode } from './model';
import type { WorkspaceTableWindow } from './rowPages';
import type { WorkspaceData, WorkspaceTable } from './types';

/** Owns the in-memory workspace, history and save state shared by loading and editing. */
export const useWorkspaceStorage = (setNotice: (message: string) => void) => {
  const [data, setData] = useState<WorkspaceData>();
  const [tableWindow, setTableWindow] = useState<WorkspaceTableWindow>();
  const progressiveRef = useRef(false);
  const mountedRef = useRef(true);
  const [historyByTable, setHistoryByTable] = useState<Map<string, WorkspaceTableHistory>>(new Map());
  const [historyReady, setHistoryReady] = useState(false);
  const [allTablesReady, setAllTablesReady] = useState(false);
  const [storageVersion, setStorageVersion] = useState<number | null>(null);
  const [remainingLoadError, setRemainingLoadError] = useState(false);
  const [storageConflict, setStorageConflict] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [storageUpgradeBlocked, setStorageUpgradeBlocked] = useState(() => document.documentElement.hasAttribute('data-workspace-storage-blocked'));
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [lastSavedAt, setLastSavedAt] = useState<number>();
  const dataRef = useRef<WorkspaceData | undefined>(undefined);
  const dynamicOptionsCacheRef = useRef(new WorkspaceDynamicOptionsCache());
  const getDynamicOptions = useCallback((table: WorkspaceTable, columnId: string) => dynamicOptionsCacheRef.current.getOptions(table, columnId), []);
  const historyRef = useRef(new Map<string, WorkspaceTableHistory>());
  const historyReadyRef = useRef(false);
  const allTablesReadyRef = useRef(false);
  const historyResetRef = useRef({ all: false, ids: new Set<string>() });
  const pendingHistoryResetRef = useRef({ all: false, ids: new Set<string>() });
  const saveRevisionRef = useRef(0);

  // Only allow full saves after the render using the complete table set has committed.
  useLayoutEffect(() => { allTablesReadyRef.current = allTablesReady; }, [allTablesReady]);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const reportSaveError = useCallback((error: unknown) => {
    setSaveState('error');
    if (error instanceof Error && error.name === 'WorkspaceStorageConflictError') setStorageConflict(true);
    else setNotice('本機儲存失敗，請先匯出資料備份');
  }, []);

  useEffect(() => {
    const failed = (event: Event) => reportSaveError((event as CustomEvent<unknown>).detail);
    window.addEventListener('workspace-storage-error', failed);
    return () => window.removeEventListener('workspace-storage-error', failed);
  }, [reportSaveError]);

  /** Publish data and history together; only the latest save may update the UI status. */
  const publish = useCallback((next: WorkspaceData, histories: Map<string, WorkspaceTableHistory>, options: Pick<WorkspaceSaveOptions, 'mutation' | 'deletedTableIds'> & Pick<WorkspaceCommitOptions, 'clearAllHistory' | 'clearTableHistoryIds'> & { direction?: 'undo' | 'redo' }) => {
    const previous = dataRef.current;
    const committed = dynamicOptionsCacheRef.current.prepare(previous, assignWorkspaceChangeRevisions(previous, next), options.mutation, options.direction);
    if (options.clearAllHistory) {
      historyResetRef.current.all = true;
      pendingHistoryResetRef.current = { all: true, ids: new Set() };
    } else if (options.clearTableHistoryIds?.length) {
      options.clearTableHistoryIds.forEach(id => historyResetRef.current.ids.add(id));
      pendingHistoryResetRef.current = { ...pendingHistoryResetRef.current, ids: new Set([...pendingHistoryResetRef.current.ids, ...options.clearTableHistoryIds]) };
    }
    dataRef.current = committed;
    setData(committed);
    historyRef.current = histories;
    setHistoryByTable(histories);
    const saveRevision = ++saveRevisionRef.current;
    setSaveState('saving');
    const reset = pendingHistoryResetRef.current;
    void saveWorkspace(committed, {
      partial: !allTablesReadyRef.current,
      mutation: options.mutation,
      deletedTableIds: options.deletedTableIds,
      replaceTableIds: options.clearAllHistory ? committed.tables.filter(table => previous?.tables.find(item => item.id === table.id) !== table).map(table => table.id) : undefined,
      history: {
        clearAll: reset.all, deleteTableIds: [...reset.ids],
        ...(historyReadyRef.current ? { replace: [...histories.values()] } : { append: [...histories.values()].flatMap(history => history.past) }),
      },
    }).then(() => {
      if (pendingHistoryResetRef.current === reset) pendingHistoryResetRef.current = { all: false, ids: new Set() };
      if (saveRevision !== saveRevisionRef.current) return;
      setSaveState('saved');
      setLastSavedAt(Date.now());
    }).catch((error: unknown) => {
      if (saveRevision === saveRevisionRef.current) reportSaveError(error);
    });
  }, [reportSaveError]);

  const commit = useCallback((next: WorkspaceData, explicitMutation?: WorkspaceTableMutation, options?: WorkspaceCommitOptions) => {
    const previous = dataRef.current;
    if (!allTablesReadyRef.current && previous && (
      (!progressiveRef.current && next.activeNodeId !== previous.activeNodeId && !getTableForNode(next, next.activeNodeId))
      || next.tables.length !== previous.tables.length
      || next.tables.some((table, index) => table.id !== previous.tables[index]?.id)
    )) {
      setNotice('正在讀取其他表格，請稍候');
      return;
    }
    const mutation = explicitMutation ?? (previous && !options?.clearAllHistory ? inferWorkspaceTableMutation(previous, next) : undefined);
    const meaningfulChange = !previous
      || previous.nodes !== next.nodes
      || previous.tables !== next.tables
      || previous.bottomNavigationTableIds !== next.bottomNavigationTableIds;
    if (options?.importedTableIds) dynamicOptionsCacheRef.current.primeImportedTables(next, options.importedTableIds);
    const removedTableIds = previous?.tables.filter((table) => !next.tables.some((item) => item.id === table.id)).map((table) => table.id) ?? [];
    const cleared = options?.clearTableHistoryIds?.length ? options.clearTableHistoryIds : removedTableIds;
    let histories = historyRef.current;
    if (options?.clearAllHistory) {
      histories = new Map();
    } else if (cleared.length) {
      histories = new Map(histories);
      cleared.forEach(id => histories.delete(id));
    }
    if (mutation) {
      const currentHistory = histories.get(mutation.tableId) ?? createEmptyWorkspaceTableHistory(mutation.tableId);
      histories = new Map(histories).set(mutation.tableId, pushWorkspaceTableHistory(currentHistory, mutation));
    }
    publish(meaningfulChange ? { ...next, updatedAt: Date.now() } : next, histories, {
      deletedTableIds: removedTableIds,
      mutation,
      clearAllHistory: options?.clearAllHistory,
      clearTableHistoryIds: cleared,
    });
  }, [publish]);

  const moveTableHistory = useCallback((tableId: string, direction: 'undo' | 'redo') => {
    const current = dataRef.current;
    if (!current || !current.tables.some(table => table.id === tableId) || !historyReadyRef.current) return false;
    const history = historyRef.current.get(tableId) ?? createEmptyWorkspaceTableHistory(tableId);
    const source = direction === 'undo' ? history.past : history.future;
    const entry = source.at(-1);
    if (!entry) return false;
    const moved: WorkspaceTableHistory = direction === 'undo'
      ? { tableId, past: history.past.slice(0, -1), future: [...history.future, entry] }
      : { tableId, past: [...history.past, entry], future: history.future.slice(0, -1) };
    publish(applyWorkspaceTableHistoryActionWithNode(current, tableId, entry.action, direction), new Map(historyRef.current).set(tableId, moved), {
      mutation: { tableId, action: entry.action }, direction,
    });
    setNotice(direction === 'undo' ? `已復原：${entry.label}` : `已重做：${entry.label}`);
    return true;
  }, [publish]);

  return {
    data, setData, dataRef, tableWindow, setTableWindow, progressiveRef, mountedRef,
    historyByTable, setHistoryByTable, historyRef, historyReady, setHistoryReady, historyReadyRef,
    allTablesReady, setAllTablesReady, allTablesReadyRef, storageVersion, setStorageVersion,
    remainingLoadError, setRemainingLoadError, storageConflict, setStorageConflict, loadError, setLoadError,
    storageUpgradeBlocked, setStorageUpgradeBlocked, historyResetRef,
    saveState, lastSavedAt, setLastSavedAt, getDynamicOptions, commit, moveTableHistory,
  };
};

export type WorkspaceStorageController = ReturnType<typeof useWorkspaceStorage>;
