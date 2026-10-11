import { useCallback, useEffect, useMemo, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { flushSync } from 'react-dom';
import { loadWorkspace, loadWorkspaceInitial, loadWorkspaceHistoryHead } from './db';
import { getTableForNode } from './model';
import { hydrateWorkspaceHistories, type WorkspaceTableHistoryView } from './history';
import { afterWorkspacePaint } from './backgroundWork';
import { loadWorkspaceTableViewState } from './viewState';
import { expandedFoldersStorageKey } from './workspaceShared';
import type { WorkspaceData } from './types';
import type { WorkspaceReadiness } from './useReadyWorkspaceActions';
import type { WorkspaceStorageController } from './useWorkspaceStorage';
import { useWorkspaceRowMaintenance } from './useWorkspaceRowMaintenance';

interface WorkspaceLoadingOptions {
  setNotice: (message: string) => void;
  setExpanded: Dispatch<SetStateAction<Set<string>>>;
  setVirtualScrollTop: Dispatch<SetStateAction<number>>;
  viewportRef: RefObject<HTMLDivElement | null>;
  programmaticTableScrollRef: RefObject<boolean>;
  pendingOpenNodeIdRef: RefObject<string | undefined>;
  captureWindowAnchorRef: RefObject<(() => { rowId: string; within: number } | undefined) | undefined>;
}

const mergeLoadedWorkspaceTables = (current: WorkspaceData, loaded: WorkspaceData): WorkspaceData => {
  const tables = new Map(current.tables.map(table => [table.id, table]));
  const present = new Set(current.nodes.flatMap(node => node.type === 'table' && node.tableId ? [node.tableId] : []));
  for (const table of loaded.tables) {
    if (!present.has(table.id)) continue;
    const existing = tables.get(table.id);
    // Keep unsaved edits, including tables outside this read request.
    if (!existing || existing.rows === table.rows) tables.set(table.id, table);
  }
  return { ...current, tables: [...tables.values()] };
};

/** Keeps initial reads, background hydration and operation readiness in one lifecycle. */
export const useWorkspaceLoading = (storage: WorkspaceStorageController, {
  setNotice, setExpanded, setVirtualScrollTop, viewportRef, programmaticTableScrollRef,
  pendingOpenNodeIdRef, captureWindowAnchorRef,
}: WorkspaceLoadingOptions) => {
  const {
    data, setData, dataRef, tableWindow, setTableWindow, progressiveRef, mountedRef,
    historyRef, historyLoadedTableIdsRef, setHistoryByTable, setHistoryLoadedTableIds, historyResetRef,
    allTablesReadyRef, setAllTablesReady, setStorageVersion, setLastSavedAt,
    setStorageUpgradeBlocked, storageConflict, setStorageConflict, setRemainingLoadError, setLoadError,
  } = storage;
  const readQueueRef = useRef<Promise<void>>(Promise.resolve());
  const fullTable = useMemo(() => data ? getTableForNode(data, data.activeNodeId) : undefined, [data]);
  const activeWindow = !fullTable && data?.nodes.some(node => node.id === data.activeNodeId && node.tableId === tableWindow?.head.definition.id) ? tableWindow : undefined;
  useWorkspaceRowMaintenance(fullTable?.id, dataRef, storageConflict);

  const publishHistory = useCallback((stored: WorkspaceTableHistoryView) => {
    const tableId = stored.tableId;
    if (historyLoadedTableIdsRef.current.has(tableId) || !dataRef.current?.nodes.some(node => node.tableId === tableId)) return;
    const selected = hydrateWorkspaceHistories(new Map([[tableId, stored]]), historyRef.current, new Set([tableId]), historyResetRef.current);
    const histories = new Map(historyRef.current);
    const history = selected.get(tableId);
    if (history) histories.set(tableId, history);
    historyRef.current = histories;
    historyLoadedTableIdsRef.current = new Set(historyLoadedTableIdsRef.current).add(tableId);
    setHistoryByTable(histories); setHistoryLoadedTableIds(historyLoadedTableIdsRef.current);
  }, [historyLoadedTableIdsRef, historyRef, historyResetRef, setHistoryByTable, setHistoryLoadedTableIds]);

  useEffect(() => {
    let cancelled = false;
    let cancelHistoryLoad: (() => void) | undefined;
    const blocked = () => setStorageUpgradeBlocked(true);
    const changedVersion = () => { setStorageConflict(true); setNotice('本機儲存格式已更新，請重新開啟此頁面'); };
    window.addEventListener('workspace-storage-blocked', blocked);
    window.addEventListener('workspace-storage-versionchange', changedVersion);
    const reload = async () => {
      const initial = await loadWorkspaceInitial({ paged: true });
      const loaded = initial.data;
      if (cancelled) return;
      setData(loaded);
      progressiveRef.current = Boolean(initial.progressive);
      setTableWindow(initial.window);
      if (initial.window) setVirtualScrollTop(loadWorkspaceTableViewState(initial.window.head.definition.id).scrollTop);
      setStorageVersion(initial.storageVersion);
      document.documentElement.removeAttribute('data-workspace-storage-blocked');
      setStorageUpgradeBlocked(false);
      dataRef.current = loaded;
      allTablesReadyRef.current = initial.complete;
      setAllTablesReady(initial.complete);
      setLastSavedAt(initial.window?.head.updatedAt ?? (Math.max(0, ...loaded.tables.map((table) => table.updatedAt)) || undefined));
      const folderIds = new Set(loaded.nodes.filter((node) => node.type === 'folder').map((node) => node.id));
      let restored = new Set(folderIds);
      try {
        const stored = window.localStorage.getItem(expandedFoldersStorageKey);
        if (stored !== null) restored = new Set((JSON.parse(stored) as unknown[]).filter((id): id is string => typeof id === 'string' && folderIds.has(id)));
      } catch { /* Ignore damaged UI preferences. */ }
      let current = loaded.nodes.find((node) => node.id === loaded.activeNodeId);
      while (current?.parentId) {
        restored.add(current.parentId);
        current = loaded.nodes.find((node) => node.id === current?.parentId);
      }
      setExpanded(restored);
      cancelHistoryLoad = afterWorkspacePaint(() => {
        if (initial.progressive) {
          // A legacy table gets its read projection once, after it is already visible.
          const visible = dataRef.current;
          const active = visible && getTableForNode(visible, visible.activeNodeId);
          const isCurrent = () => !cancelled && mountedRef.current && dataRef.current?.activeNodeId === visible?.activeNodeId && !pendingOpenNodeIdRef.current;
          if (active) void loadWorkspace({ expectCurrentRevision: true, tableIds: [active.id], isCurrent }).then(remaining => {
            if (!isCurrent()) return;
            const current = dataRef.current;
            const merged = current ? mergeLoadedWorkspaceTables(current, remaining) : remaining;
            dataRef.current = merged; setData(merged);
            const complete = merged.nodes.filter(node => node.type === 'table').every(node => merged.tables.some(table => table.id === node.tableId));
            allTablesReadyRef.current = complete; setAllTablesReady(complete);
          }).catch(error => { if (isCurrent()) { setRemainingLoadError(true); console.error('[workspace-migration]', error); } });
          return;
        }
        const finishTables = async () => {
          const isCurrent = () => !cancelled && mountedRef.current;
          const mergeLoaded = (remaining: WorkspaceData) => {
            if (!isCurrent()) return;
            const current = dataRef.current;
            const merged = current
              ? { ...mergeLoadedWorkspaceTables(current, remaining), bottomNavigationTableIds: remaining.bottomNavigationTableIds }
              : remaining;
            dataRef.current = merged;
            setData(merged);
          };
          if (initial.complete) {
            // Full-load fallbacks also defer statistics; share the rebuilt column objects.
            mergeLoaded(await loadWorkspace({ expectCurrentRevision: true, isCurrent }));
            return;
          }
          // Measured 10k-row reads exceed the requested 0.5 ms threshold. Preload pins first.
          const pins = (loaded.bottomNavigationTableIds ?? []).filter(id => !loaded.tables.some(table => table.id === id) && loaded.nodes.some(node => node.tableId === id));
          if (pins.length) mergeLoaded(await loadWorkspace({ expectCurrentRevision: true, tableIds: pins, isCurrent }));
          if (cancelled) return;
          mergeLoaded(await loadWorkspace({ expectCurrentRevision: true, isCurrent }));
          if (cancelled) return;
          allTablesReadyRef.current = true;
          setAllTablesReady(true);
        };
        void finishTables().catch((error: unknown) => {
          if (cancelled) return;
          if (error instanceof Error && error.name === 'WorkspaceStorageConflictError') setStorageConflict(true);
          else setRemainingLoadError(true);
        });
      }, Boolean(initial.progressive));
    };
    void reload().catch(() => { if (!cancelled) setLoadError(true); });
    return () => {
      cancelled = true; cancelHistoryLoad?.();
      window.removeEventListener('workspace-storage-blocked', blocked);
      window.removeEventListener('workspace-storage-versionchange', changedVersion);
    };
  }, []);

  const reportReadError = useCallback((error: unknown) => {
    if (!mountedRef.current) return;
    if (error instanceof Error && error.name === 'WorkspaceStorageConflictError') setStorageConflict(true);
    setNotice('資料讀取失敗，請重新開啟此頁面');
  }, []);
  const hydrateWorkspace = useCallback((tableIds?: readonly string[], withHistory = false, isCurrent?: () => boolean): Promise<void> => {
    const work = readQueueRef.current.catch(() => undefined).then(async () => {
      const current = dataRef.current;
      if (!current || !mountedRef.current || (isCurrent && !isCurrent())) return;
      const needed = tableIds ? tableIds.some(id => !current.tables.some(table => table.id === id)) : !allTablesReadyRef.current;
      if (needed) {
        const loaded = await loadWorkspace({ expectCurrentRevision: true, tableIds, isCurrent: () => mountedRef.current && (!isCurrent || isCurrent()) });
        if (!mountedRef.current || (isCurrent && !isCurrent())) return;
        const latest = dataRef.current!;
        const merged = mergeLoadedWorkspaceTables(latest, loaded);
        const anchor = captureWindowAnchorRef.current?.();
        const active = getTableForNode(merged, merged.activeNodeId);
        const index = active && anchor ? active.rows.findIndex(row => row.id === anchor.rowId) : -1;
        const top = index >= 0 && anchor ? index * 36 + anchor.within : undefined;
        const complete = merged.nodes.filter(node => node.type === 'table').every(node => merged.tables.some(table => table.id === node.tableId));
        flushSync(() => {
          dataRef.current = merged; setData(merged);
          allTablesReadyRef.current = complete; setAllTablesReady(complete);
          if (top !== undefined) setVirtualScrollTop(top);
        });
        if (top !== undefined && viewportRef.current) {
          programmaticTableScrollRef.current = true;
          viewportRef.current.scrollTop = top;
          requestAnimationFrame(() => { programmaticTableScrollRef.current = false; });
        }
      }
      if (withHistory) {
        const owner = dataRef.current?.activeNodeId;
        const activeId = dataRef.current?.nodes.find(node => node.id === owner)?.tableId;
        const ids = tableIds ?? (activeId ? [activeId] : []);
        const isHistoryCurrent = () => mountedRef.current && dataRef.current?.activeNodeId === owner && (!isCurrent || isCurrent());
        for (const id of ids) {
          if (!isHistoryCurrent() || historyLoadedTableIdsRef.current.has(id)) continue;
          try {
            const stored = await loadWorkspaceHistoryHead(id, { isCurrent: isHistoryCurrent });
            if (isHistoryCurrent()) flushSync(() => publishHistory(stored));
          } catch (error) {
            if (!isHistoryCurrent() || (error instanceof Error && error.name === 'AbortError')) return;
            if (error instanceof Error && error.name === 'WorkspaceStorageConflictError') throw error;
            // Editing remains available, but saves must append until a real directory is loaded.
            setNotice('先前的復原紀錄讀取失敗，表格仍可使用');
          }
        }
      }
    });
    readQueueRef.current = work;
    return work;
  }, [publishHistory]);
  useEffect(() => {
    const tableId = activeWindow?.head.definition.id;
    const nodeId = data?.activeNodeId;
    if (!tableId || !nodeId || storageConflict) return;
    let cancelled = false;
    const isCurrent = () => !cancelled && dataRef.current?.activeNodeId === nodeId && !pendingOpenNodeIdRef.current;
    const cancel = afterWorkspacePaint(() => {
      if (isCurrent()) void hydrateWorkspace([tableId], false, isCurrent).catch(error => {
        if (isCurrent()) reportReadError(error);
      });
    }, true);
    return () => { cancelled = true; cancel(); };
  }, [activeWindow?.head.definition.id, data?.activeNodeId, hydrateWorkspace, reportReadError, storageConflict]);
  const readiness = useMemo<WorkspaceReadiness>(() => ({
    isReady: (scope) => {
      if (typeof scope === 'object') return Boolean(dataRef.current?.tables.some(table => table.id === scope.tableId));
      if (scope === 'all') return allTablesReadyRef.current;
      const active = dataRef.current && getTableForNode(dataRef.current, dataRef.current.activeNodeId);
      return Boolean(active && (scope !== 'history' || historyLoadedTableIdsRef.current.has(active.id)));
    },
    ensure: (scope) => {
      if (typeof scope === 'object') return hydrateWorkspace([scope.tableId]);
      const id = dataRef.current?.nodes.find(node => node.id === dataRef.current?.activeNodeId)?.tableId;
      return hydrateWorkspace(scope === 'all' ? undefined : id ? [id] : [], scope === 'history');
    },
    onError: reportReadError, ownerKey: () => dataRef.current?.activeNodeId ?? undefined,
  }), [hydrateWorkspace, reportReadError]);
  const withActiveTable = useCallback((work: () => void) => {
    if (readiness.isReady('active')) { work(); return; }
    const owner = readiness.ownerKey?.();
    void readiness.ensure('active').then(() => {
      if (mountedRef.current && readiness.ownerKey?.() === owner) work();
    }).catch(reportReadError);
  }, [readiness, reportReadError]);

  return { fullTable, activeWindow, reportReadError, hydrateWorkspace, readiness, withActiveTable };
};
