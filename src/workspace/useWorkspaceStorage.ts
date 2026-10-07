import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { saveWorkspace, type WorkspaceSaveOptions } from './db';
import { createEmptyWorkspaceTableHistory, inferWorkspaceTableMutation, pushWorkspaceTableHistory, type WorkspaceCommitOptions, type WorkspaceTableHistory, type WorkspaceTableMutation } from './history';
import { getTableForNode } from './model';
import { WorkspaceDynamicOptionsCache } from './dynamicOptionsCache';
import { assignWorkspaceChangeRevisions } from './changeRevisions';
import type { WorkspaceData, WorkspaceTable } from './types';
import type { WorkspaceTableWindow } from './rowPages';

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
    const revised = assignWorkspaceChangeRevisions(previous, meaningfulChange ? { ...next, updatedAt: Date.now() } : next);
    const committed = dynamicOptionsCacheRef.current.prepare(previous, revised, mutation);
    const removedTableIds = previous?.tables.filter((table) => !next.tables.some((item) => item.id === table.id)).map((table) => table.id) ?? [];
    setData(committed);
    dataRef.current = committed;
    if (options?.clearAllHistory) {
      historyResetRef.current.all = true;
      pendingHistoryResetRef.current = { all: true, ids: new Set() };
      historyRef.current = new Map();
      setHistoryByTable(new Map());
    } else if (options?.clearTableHistoryIds?.length) {
      options.clearTableHistoryIds.forEach((id) => historyResetRef.current.ids.add(id));
      pendingHistoryResetRef.current = { ...pendingHistoryResetRef.current, ids: new Set([...pendingHistoryResetRef.current.ids, ...options.clearTableHistoryIds]) };
      const nextHistories = new Map(historyRef.current);
      options.clearTableHistoryIds.forEach((tableId) => nextHistories.delete(tableId));
      historyRef.current = nextHistories;
      setHistoryByTable(nextHistories);
    } else if (removedTableIds.length) {
      removedTableIds.forEach((id) => historyResetRef.current.ids.add(id));
      pendingHistoryResetRef.current = { ...pendingHistoryResetRef.current, ids: new Set([...pendingHistoryResetRef.current.ids, ...removedTableIds]) };
      const nextHistories = new Map(historyRef.current);
      removedTableIds.forEach((tableId) => nextHistories.delete(tableId));
      historyRef.current = nextHistories;
      setHistoryByTable(nextHistories);
    }
    if (mutation) {
      const currentHistory = historyRef.current.get(mutation.tableId) ?? createEmptyWorkspaceTableHistory(mutation.tableId);
      const nextHistory = pushWorkspaceTableHistory(currentHistory, mutation);
      const nextHistories = new Map(historyRef.current).set(mutation.tableId, nextHistory);
      historyRef.current = nextHistories;
      setHistoryByTable(nextHistories);
    }
    const saveRevision = ++saveRevisionRef.current;
    setSaveState('saving');
    const reset = pendingHistoryResetRef.current;
    const histories = [...historyRef.current.values()];
    const saveOptions: WorkspaceSaveOptions = {
      partial: !allTablesReadyRef.current,
      deletedTableIds: removedTableIds,
      mutation,
      replaceTableIds: options?.clearAllHistory ? committed.tables.filter(table => previous?.tables.find(item => item.id === table.id) !== table).map(table => table.id) : undefined,
      history: {
        clearAll: reset.all, deleteTableIds: [...reset.ids],
        ...(historyReadyRef.current ? { replace: histories } : { append: histories.flatMap(history => history.past) }),
      },
    };
    const save = saveWorkspace(committed, saveOptions);
    void save.then(() => {
      if (pendingHistoryResetRef.current === reset) pendingHistoryResetRef.current = { all: false, ids: new Set() };
      if (saveRevision !== saveRevisionRef.current) return;
      setSaveState('saved');
      setLastSavedAt(Date.now());
    }).catch((error: unknown) => {
      if (saveRevision !== saveRevisionRef.current) return;
      reportSaveError(error);
    });
  }, [reportSaveError]);

  return {
    data, setData, dataRef, tableWindow, setTableWindow, progressiveRef, mountedRef,
    historyByTable, setHistoryByTable, historyRef, historyReady, setHistoryReady, historyReadyRef,
    allTablesReady, setAllTablesReady, allTablesReadyRef, storageVersion, setStorageVersion,
    remainingLoadError, setRemainingLoadError, storageConflict, setStorageConflict, loadError, setLoadError,
    storageUpgradeBlocked, setStorageUpgradeBlocked, historyResetRef, pendingHistoryResetRef,
    saveState, setSaveState, lastSavedAt, setLastSavedAt, saveRevisionRef,
    dynamicOptionsCacheRef, getDynamicOptions, reportSaveError, commit,
  };
};

export type WorkspaceStorageController = ReturnType<typeof useWorkspaceStorage>;
