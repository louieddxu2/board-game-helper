import { openDB, type IDBPDatabase } from 'idb';
import { emptyWorkspace, ensureTableDynamicOptionsSteps, normalizeWorkspace } from './model';
import { type WorkspaceHistoryReference, type WorkspaceTableHistory, type WorkspaceTableHistoryEntry, type WorkspaceTableMutation } from './history';
import { createWorkspaceTableStorageSnapshot, createWorkspaceTableStorageSnapshotSteps, hasCurrentWorkspaceColumnState, isChunkedWorkspaceTable, planWorkspaceTableStorageWrite, updateWorkspaceTableStorageSnapshot, WorkspaceStorageIntegrityError, type StoredWorkspaceRowChunk, type StoredWorkspaceTable, type StoredWorkspaceTableState, type WorkspaceTableStorageSnapshot } from './rowChunkStorage';
import type { WorkspaceData, WorkspaceTable } from './types';
import { assertWorkspaceTableComplete, initialWorkspaceRowPages, planWorkspaceRowPages, validateWorkspaceRowPage, validateWorkspaceTableHead, workspaceRowPageCount, workspaceRowPageKey, workspaceRowPageStorageKey, type WorkspaceRowPage, type WorkspaceTableHead, type WorkspaceTableWindow } from './rowPages';
import { loadWorkspaceTableViewState } from './viewState';
import type { StoredWorkspaceRowOrderPage } from './rowOrderStorage';
import { planWorkspaceRowBlockMaintenance } from './rowBlockMaintenance';
import { runWorkspaceIdleSteps, type WorkspaceIdleOptions } from './workspaceIdleSteps';
import { runWorkspaceCooperativeSteps, yieldWorkspaceTask } from './workspaceCooperativeWork';
import { readWorkspaceStoredTable, workspaceStorageState, type WorkspaceStoredReadContext } from './workspaceStoredTableReader';
import { workspaceBackupTableSummary, type WorkspaceBackupSource, type WorkspaceBackupTableSummary } from './workspaceBackupSource';
import { workspaceDbStores as stores, type WorkspaceDb, type WorkspaceMetadata, type WorkspaceStorageState } from './workspaceDbSchema';
import { WorkspaceHistoryStorage, readWorkspaceHistories, readWorkspaceHistoryHead, readWorkspaceHistoryEntry, type WorkspaceHistoryReadContext, type WorkspaceHistoryStorageChanges } from './workspaceHistoryStorage';
export type { WorkspaceHistoryStorageChanges } from './workspaceHistoryStorage';

const DATABASE_NAME = 'board-game-helper-workspace';
const META_KEY = 'workspace';
const STORAGE_KEY = 'storage';

const notifyStorageError = (error: unknown) => window.dispatchEvent(new CustomEvent('workspace-storage-error', { detail: error }));
const database = typeof indexedDB === 'undefined' ? null : openDB<WorkspaceDb>(DATABASE_NAME, 8, {
  upgrade(db, oldVersion, _newVersion, transaction) {
    for (const name of stores) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    // Only the small metadata record is migrated during the version upgrade.
    if (oldVersion < 4) void transaction.objectStore('meta').get(META_KEY).then(value => {
      if (!value || !('nodes' in value)) return;
      const { storageRevision, updatedAt, ...meta } = value as WorkspaceMetadata & Partial<WorkspaceStorageState>;
      if (storageRevision) void transaction.objectStore('meta').put({ storageRevision, updatedAt }, STORAGE_KEY);
      void transaction.objectStore('meta').put(meta, META_KEY);
    });
  },
  blocked() {
    document.documentElement.setAttribute('data-workspace-storage-blocked', 'true');
    window.dispatchEvent(new Event('workspace-storage-blocked'));
  },
  blocking(_currentVersion, _blockedVersion, event) {
    (event.target as IDBDatabase).close();
    window.dispatchEvent(new Event('workspace-storage-versionchange'));
  },
});

let saveQueue: Promise<void> = Promise.resolve();
let backupContentEpoch = 0;
let savedStorageRevision: string | null = null;
let savedMetadata: WorkspaceMetadata | undefined;
let savedUpdatedAt: number | undefined;
let savedTables = new Map<string, { snapshot: WorkspaceTableStorageSnapshot; legacy: boolean; orderPending?: boolean; columnStatePending?: boolean }>();
let workingTables = new Map<string, WorkspaceTableStorageSnapshot>();
let tableSnapshots = new WeakMap<WorkspaceTable, WorkspaceTableStorageSnapshot>();
const historyStorage = new WorkspaceHistoryStorage();
type PendingTableSnapshot = { table: WorkspaceTable; stored?: { record: StoredWorkspaceTable; chunks: StoredWorkspaceRowChunk[]; orderPages?: StoredWorkspaceRowOrderPage[]; state?: StoredWorkspaceTableState } };
let pendingTableSnapshots = new Map<string, PendingTableSnapshot>();
let savedTableHeads = new Map<string, WorkspaceTableHead>();

export class WorkspaceStorageConflictError extends Error {
  constructor() { super('Workspace data was changed in another tab'); this.name = 'WorkspaceStorageConflictError'; }
}
export interface WorkspaceSaveOptions {
  partial?: boolean;
  deletedTableIds?: readonly string[];
  mutation?: Pick<WorkspaceTableMutation, 'tableId' | 'action'>;
  history?: WorkspaceHistoryStorageChanges;
  replaceTableIds?: readonly string[];
}
const nextStorageRevision = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
const tableRange = (id: string) => IDBKeyRange.bound([id, ''], [id, '\uffff']);
const pageRange = (id: string) => IDBKeyRange.bound([id, 0], [id, '\uffff']);
const asMetadata = (value: WorkspaceMetadata | WorkspaceStorageState | undefined) => value && 'nodes' in value ? value : undefined;
const asStorageState = (value: WorkspaceMetadata | WorkspaceStorageState | undefined) => value && 'storageRevision' in value ? value : undefined;
const metadataOf = (data: WorkspaceData): WorkspaceMetadata => ({ version: data.version, structureRevision: data.structureRevision, nodes: data.nodes, activeNodeId: data.activeNodeId, bottomNavigationTableIds: data.bottomNavigationTableIds ?? [] });
const sameMetadata = (left: WorkspaceMetadata | undefined, right: WorkspaceMetadata) => left?.version === right.version && left.structureRevision === right.structureRevision && left.nodes === right.nodes && left.activeNodeId === right.activeNodeId && left.bottomNavigationTableIds === right.bottomNavigationTableIds;
const backupContentChanged = (data: WorkspaceData, meta: WorkspaceMetadata, snapshots: WorkspaceTableStorageSnapshot[], removed: string[]) => removed.length > 0
  || meta.structureRevision !== savedMetadata?.structureRevision || meta.nodes !== savedMetadata?.nodes || meta.activeNodeId !== savedMetadata?.activeNodeId
  || data.updatedAt !== savedUpdatedAt
  || (meta.bottomNavigationTableIds?.length ?? 0) !== (savedMetadata?.bottomNavigationTableIds?.length ?? 0)
  || meta.bottomNavigationTableIds?.some((id, index) => id !== savedMetadata?.bottomNavigationTableIds?.[index])
  || snapshots.some(snapshot => { const prior = savedTables.get(snapshot.table.id)?.snapshot.table; return !prior || prior.changeRevision !== snapshot.table.changeRevision || prior.updatedAt !== snapshot.table.updatedAt; });
const enqueueSave = (work: () => Promise<void>) => {
  const pending = saveQueue.catch(() => undefined).then(work);
  saveQueue = pending;
  return pending;
};
const assertRevision = (state: WorkspaceStorageState | undefined) => {
  if ((state?.storageRevision ?? null) !== savedStorageRevision) throw new WorkspaceStorageConflictError();
};
const resetSnapshots = () => { backupContentEpoch += 1; savedTables = new Map(); workingTables = new Map(); tableSnapshots = new WeakMap(); historyStorage.reset(); pendingTableSnapshots = new Map(); savedTableHeads = new Map(); };
const materializeTableSnapshot = (id: string) => {
  const pending = pendingTableSnapshots.get(id);
  if (pending) {
    const snapshot = createWorkspaceTableStorageSnapshot(pending.table, pending.stored);
    savedTables.set(id, { snapshot, legacy: !pending.stored, orderPending: pending.stored?.record.storageFormat === 'row-chunks-v1', columnStatePending: Boolean(pending.stored && !hasCurrentWorkspaceColumnState(pending.table, pending.stored.state)) });
    workingTables.set(id, snapshot); tableSnapshots.set(pending.table, snapshot);
    pendingTableSnapshots.delete(id);
  }
  return workingTables.get(id);
};

type WorkspaceLoadOptions = { expectCurrentRevision?: boolean; tableIds?: readonly string[]; deferStartupWork?: boolean; isCurrent?: () => boolean; activeOnly?: boolean };
class WorkspaceReadRestart extends Error {}
export const loadWorkspace = async (options?: WorkspaceLoadOptions): Promise<WorkspaceData> => (await readWorkspace(options)).data;
const readWorkspace = async (options?: WorkspaceLoadOptions): Promise<{ data: WorkspaceData; complete: boolean }> => {
  for (;;) {
    try { return await loadWorkspaceVersion(options); }
    catch (error) { if (!(error instanceof WorkspaceReadRestart)) throw error; }
  }
};
const loadWorkspaceVersion = async (options?: WorkspaceLoadOptions): Promise<{ data: WorkspaceData; complete: boolean }> => {
  if (!database) return { data: emptyWorkspace(), complete: true };
  const pending = saveQueue;
  await pending.catch(() => undefined);
  const checkCurrent = () => {
    if (options?.isCurrent && !options.isCurrent()) throw new DOMException('Workspace read cancelled', 'AbortError');
    if (saveQueue !== pending) throw new WorkspaceReadRestart();
  };
  const db = await database;
  const transaction = db.transaction(['meta', 'tables', 'state'], 'readonly');
  const [metaValue, stateValue, keys] = await Promise.all([transaction.objectStore('meta').get(META_KEY), transaction.objectStore('meta').get(STORAGE_KEY), transaction.objectStore('tables').getAllKeys()]);
  const meta = asMetadata(metaValue);
  const state = asStorageState(stateValue);
  if (!meta) {
    const legacy = await transaction.objectStore('state').get(META_KEY);
    await transaction.done;
    checkCurrent();
    if (options?.expectCurrentRevision) assertRevision(state);
    // Missing directory metadata is not proof of a new database. Preserve orphaned
    // records instead of publishing and saving an empty workspace over them.
    const legacyValid = legacy && legacy.version === 1 && Array.isArray(legacy.nodes) && Array.isArray(legacy.tables);
    if (metaValue !== undefined || (legacy !== undefined && !legacyValid)) throw new WorkspaceStorageIntegrityError('Invalid workspace metadata');
    const residue = db.transaction([...stores], 'readonly');
    const counts = await Promise.all(stores.map(name => name === 'state' && legacyValid ? Promise.resolve(0) : residue.objectStore(name).count()));
    await residue.done;
    checkCurrent();
    if (counts.some(count => count > 0)) throw new WorkspaceStorageIntegrityError('Missing workspace metadata with existing records');
    resetSnapshots(); savedMetadata = undefined; savedStorageRevision = state?.storageRevision ?? null;
    const loaded = normalizeWorkspace(legacy ?? emptyWorkspace(), { deferDynamicOptions: options?.deferStartupWork });
    await saveWorkspace(loaded);
    await db.delete('state', META_KEY);
    return { data: loaded, complete: true };
  }
  await transaction.done;
  checkCurrent();
  if (options?.expectCurrentRevision) assertRevision(state);
  const checkVersion = (value: WorkspaceMetadata | WorkspaceStorageState | undefined) => {
    checkCurrent();
    if ((asStorageState(value)?.storageRevision ?? null) !== (state?.storageRevision ?? null)) {
      if (options?.expectCurrentRevision) throw new WorkspaceStorageConflictError();
      throw new WorkspaceReadRestart();
    }
  };
  const available = new Set(keys);
  const activeId = options?.activeOnly ? meta.nodes.find(node => node.id === meta.activeNodeId && node.type === 'table')?.tableId : undefined;
  const ids = options?.tableIds ? [...new Set(options.tableIds)] : activeId ? [activeId] : keys;
  if (!options?.tableIds && !activeId) for (const node of meta.nodes) if (node.type === 'table' && node.tableId && !available.has(node.tableId)) throw new WorkspaceStorageIntegrityError(`Missing table: ${node.tableId}`);
  const preparedPending = new Map<string, { snapshot: WorkspaceTableStorageSnapshot; pending: PendingTableSnapshot }>();
  if (options?.expectCurrentRevision && !options.deferStartupWork) for (const [id, item] of pendingTableSnapshots) {
    const snapshot = await runWorkspaceCooperativeSteps(createWorkspaceTableStorageSnapshotSteps(item.table, item.stored), checkCurrent);
    preparedPending.set(id, { snapshot, pending: item });
  }
  const readIds = ids.filter(id => !options?.expectCurrentRevision || (!workingTables.has(id) && !pendingTableSnapshots.has(id)));
  const loadedRecords = [];
  for (const id of readIds) {
    loadedRecords.push({ id, ...await readWorkspaceStoredTable(db, id, { checkCurrent, checkVersion }, options?.deferStartupWork) });
    await yieldWorkspaceTask();
  }
  const preparedWorking = new Map<string, WorkspaceTableStorageSnapshot>();
  if (options?.expectCurrentRevision && !options.deferStartupWork) for (const [id, snapshot] of [...workingTables, ...[...preparedPending].map(([id, item]) => [id, item.snapshot] as const)]) {
    const table = await runWorkspaceCooperativeSteps(ensureTableDynamicOptionsSteps(snapshot.table), checkCurrent);
    if (table !== snapshot.table) preparedWorking.set(id, updateWorkspaceTableStorageSnapshot(snapshot, table));
  }
  // No global baseline is published until every batch and CPU phase share one version.
  checkVersion(await db.get('meta', STORAGE_KEY));
  if (!options?.expectCurrentRevision) resetSnapshots();
  for (const [id, { snapshot, pending: item }] of preparedPending) {
    savedTables.set(id, { snapshot, legacy: !item.stored, orderPending: item.stored?.record.storageFormat === 'row-chunks-v1', columnStatePending: Boolean(item.stored && !hasCurrentWorkspaceColumnState(snapshot.table, item.stored.state)) });
    workingTables.set(id, snapshot); tableSnapshots.set(snapshot.table, snapshot); pendingTableSnapshots.delete(id);
  }
  for (const item of loadedRecords) {
    const { table, snapshot } = item;
    if (item.head) savedTableHeads.set(table.id, item.head);
    if (!snapshot) {
      pendingTableSnapshots.set(table.id, { table, stored: item.stored });
      continue;
    }
    savedTables.set(table.id, { snapshot, legacy: !item.stored, orderPending: item.stored?.record.storageFormat === 'row-chunks-v1', columnStatePending: Boolean(item.stored && !hasCurrentWorkspaceColumnState(table, item.stored.state)) });
    workingTables.set(table.id, snapshot); tableSnapshots.set(table, snapshot);
  }
  for (const [id, next] of preparedWorking) {
    workingTables.set(id, next); tableSnapshots.set(next.table, next);
    const saved = savedTables.get(id);
    if (saved) savedTables.set(id, { ...saved, columnStatePending: true });
  }
  savedStorageRevision = state?.storageRevision ?? null;
  savedUpdatedAt = state?.updatedAt;
  if (!options?.expectCurrentRevision || !savedMetadata) savedMetadata = { ...meta, bottomNavigationTableIds: meta.bottomNavigationTableIds ?? [] };
  const result: WorkspaceData = { ...savedMetadata, updatedAt: savedUpdatedAt, tables: (activeId ? ids : keys).flatMap(id => workingTables.get(id)?.table ?? pendingTableSnapshots.get(id)?.table ?? []) };
  if (!options?.tableIds && !activeId) result.bottomNavigationTableIds = [...new Set(meta.bottomNavigationTableIds ?? [])].filter(id => available.has(id));
  // This read is used after first paint; legacy tables migrate independently through the same queue.
  if (options?.expectCurrentRevision && !options.deferStartupWork) scheduleLegacyTableMigrations(result);
  return { data: result, complete: !activeId && !options?.tableIds };
};

/** Read the active display window, or fall back to the complete legacy/filtered table. */
export const loadWorkspaceInitial = async (options?: { paged?: boolean }): Promise<{ data: WorkspaceData; complete: boolean; storageVersion: number | null; window?: WorkspaceTableWindow; progressive?: boolean }> => {
  if (!database) return { data: emptyWorkspace(), complete: true, storageVersion: null };
  const pending = saveQueue;
  await pending.catch(() => undefined);
  const db = await database;
  if (options?.paged) {
    const transaction = db.transaction(['meta', 'tableHeads', 'rowPages'], 'readonly');
    const [metaValue, stateValue] = await Promise.all([transaction.objectStore('meta').get(META_KEY), transaction.objectStore('meta').get(STORAGE_KEY)]);
    const meta = asMetadata(metaValue);
    const state = asStorageState(stateValue);
    const activeId = meta?.nodes.find(node => node.id === meta.activeNodeId && node.type === 'table')?.tableId;
    const head = activeId ? await transaction.objectStore('tableHeads').get(activeId) : undefined;
    if (head) validateWorkspaceTableHead(activeId!, head);
    let window: WorkspaceTableWindow | undefined;
    const view = activeId ? loadWorkspaceTableViewState(activeId) : undefined;
    const needsFullView = Boolean(view?.searchOpen || view?.searchQuery.trim() || Object.values(view?.headerFilters ?? {}).some(filter => filter.sort || filter.includedKeys !== null || filter.query?.trim() || filter.min?.trim() || filter.max?.trim()));
    if (head && !needsFullView) {
      const indices = initialWorkspaceRowPages(head, view?.scrollTop ?? 0, globalThis.innerHeight || 844);
      window = { head, pages: await Promise.all(indices.map(async index => validateWorkspaceRowPage(head, index, await transaction.objectStore('rowPages').get([activeId!, workspaceRowPageKey(head, index)])))) };
    }
    await transaction.done;
    if (saveQueue !== pending) return loadWorkspaceInitial(options);
    if (meta && !activeId) {
      resetSnapshots(); savedMetadata = meta; savedStorageRevision = state?.storageRevision ?? null; savedUpdatedAt = state?.updatedAt;
      return { data: { ...meta, updatedAt: state?.updatedAt, tables: [] }, complete: !meta.nodes.some(node => node.type === 'table'), storageVersion: db.version, progressive: true };
    }
    if (meta && window) {
      resetSnapshots(); savedMetadata = meta; savedStorageRevision = state?.storageRevision ?? null; savedUpdatedAt = state?.updatedAt;
      savedTableHeads.set(window.head.definition.id, window.head);
      return { data: { ...meta, updatedAt: state?.updatedAt, tables: [] }, window, complete: false, storageVersion: db.version, progressive: true };
    }
    const fallback = await loadWorkspaceInitial();
    return { ...fallback, progressive: true };
  }
  // Legacy/filtered views need the full active table, but share the bounded reader.
  return { ...await readWorkspace({ activeOnly: true, deferStartupWork: true }), storageVersion: db.version };
};

/** A bounded read of display-order pages, checked against the current storage revision. */
export const loadWorkspaceTableWindow = async (tableId: string, selection: readonly number[] | { scrollTop: number; viewportHeight: number }): Promise<WorkspaceTableWindow | undefined> => {
  if (!database) return undefined;
  const pending = saveQueue;
  await pending.catch(() => undefined);
  const db = await database;
  const transaction = db.transaction(['meta', 'tableHeads', 'rowPages'], 'readonly');
  const [state, head] = await Promise.all([transaction.objectStore('meta').get(STORAGE_KEY), transaction.objectStore('tableHeads').get(tableId)]);
  if (head) validateWorkspaceTableHead(tableId, head);
  const indices = head && 'scrollTop' in selection ? initialWorkspaceRowPages(head, selection.scrollTop, selection.viewportHeight)
    : 'scrollTop' in selection ? [] : selection;
  const pages = head ? await Promise.all([...new Set(indices)].filter(index => Number.isSafeInteger(index) && index >= 0 && index < workspaceRowPageCount(head)).map(async index =>
    validateWorkspaceRowPage(head, index, await transaction.objectStore('rowPages').get([tableId, workspaceRowPageKey(head, index)])),
  )) : [];
  await transaction.done;
  if (saveQueue !== pending) return loadWorkspaceTableWindow(tableId, selection);
  assertRevision(asStorageState(state));
  return head ? { head, pages } : undefined;
};

export const saveWorkspace = (data: WorkspaceData, options?: WorkspaceSaveOptions): Promise<void> => {
  if (!database) return Promise.resolve();
  // Capture immutable layouts when called, so queued snapshots and migration share stable chunk IDs.
  let snapshots: WorkspaceTableStorageSnapshot[];
  try { snapshots = data.tables.map(table => {
    assertWorkspaceTableComplete(table);
    if (options?.replaceTableIds?.includes(table.id)) pendingTableSnapshots.delete(table.id);
    let snapshot = options?.replaceTableIds?.includes(table.id) ? undefined : tableSnapshots.get(table);
    if (!snapshot) {
      const previous = options?.replaceTableIds?.includes(table.id) ? undefined : materializeTableSnapshot(table.id);
      snapshot = previous ? updateWorkspaceTableStorageSnapshot(previous, table, options?.mutation?.tableId === table.id ? options.mutation.action : undefined) : createWorkspaceTableStorageSnapshot(table);
      tableSnapshots.set(table, snapshot);
    }
    workingTables.set(table.id, snapshot);
    return snapshot;
  }); } catch (error) { return Promise.reject(error); }
  const meta = metadataOf(data);
  const presentIds = new Set(data.tables.map(table => table.id));
  const removed = (options?.deletedTableIds ?? []).filter(id => !presentIds.has(id));
  const removedSnapshots = new Map(removed.map(id => [id, workingTables.get(id)]));
  return enqueueSave(async () => {
    const db = await database;
    const plans = snapshots.filter(snapshot => savedTables.get(snapshot.table.id)?.snapshot !== snapshot || savedTables.get(snapshot.table.id)?.legacy || savedTables.get(snapshot.table.id)?.orderPending || savedTables.get(snapshot.table.id)?.columnStatePending || savedTableHeads.get(snapshot.table.id)?.format !== 'row-blocks-v1').map(snapshot => ({
      snapshot, plan: planWorkspaceTableStorageWrite(snapshot, savedTables.get(snapshot.table.id)?.snapshot, savedTables.get(snapshot.table.id)?.legacy, savedTables.get(snapshot.table.id)?.orderPending),
      pages: planWorkspaceRowPages(snapshot, savedTables.get(snapshot.table.id)?.snapshot, savedTableHeads.get(snapshot.table.id), nextStorageRevision()),
    }));
    const transaction = db.transaction([...stores], 'readwrite');
    const writes: Promise<unknown>[] = [];
    try {
      const state = asStorageState(await transaction.objectStore('meta').get(STORAGE_KEY));
      assertRevision(state);
      const revision = nextStorageRevision();
      if (!sameMetadata(savedMetadata, meta)) writes.push(transaction.objectStore('meta').put(meta, META_KEY));
      writes.push(transaction.objectStore('meta').put({ ...state, storageRevision: revision, updatedAt: data.updatedAt }, STORAGE_KEY));
      for (const { snapshot, plan, pages } of plans) {
        const id = snapshot.table.id;
        if (plan.definition) writes.push(transaction.objectStore('tables').put(plan.definition, id));
        writes.push(transaction.objectStore('tableState').put(plan.state, id));
        for (const chunk of plan.upserts) writes.push(transaction.objectStore('rowChunks').put(chunk, [id, chunk.chunkId]));
        for (const chunkId of plan.deletes) writes.push(transaction.objectStore('rowChunks').delete([id, chunkId]));
        for (const page of plan.orderUpserts) writes.push(transaction.objectStore('rowOrderPages').put(page, [id, page.pageId]));
        for (const pageId of plan.orderDeletes) writes.push(transaction.objectStore('rowOrderPages').delete([id, pageId]));
        writes.push(transaction.objectStore('tableHeads').put(pages.head, id));
        if (pages.rebuild) writes.push(transaction.objectStore('rowPages').delete(pageRange(id)));
        for (const index of pages.deletes) writes.push(transaction.objectStore('rowPages').delete([id, index]));
        for (const page of pages.pages) writes.push(transaction.objectStore('rowPages').put(page, [id, workspaceRowPageStorageKey(page)]));
      }
      for (const id of removed) writes.push(transaction.objectStore('tables').delete(id), transaction.objectStore('tableState').delete(id), transaction.objectStore('rowChunks').delete(tableRange(id)), transaction.objectStore('rowOrderPages').delete(tableRange(id)), transaction.objectStore('tableHeads').delete(id), transaction.objectStore('rowPages').delete(pageRange(id)));
      await Promise.all([...writes, historyStorage.writeChanges(transaction, options?.history, removed)]);
      await transaction.done;
      // Never move the baseline to a later in-memory edit or after an aborted transaction.
      if (backupContentChanged(data, meta, snapshots, removed)) backupContentEpoch += 1;
      savedStorageRevision = revision; savedUpdatedAt = data.updatedAt; savedMetadata = meta;
      historyStorage.rememberSaved(options?.history, removed);
      for (const snapshot of snapshots) savedTables.set(snapshot.table.id, { snapshot, legacy: false });
      for (const { snapshot, pages } of plans) savedTableHeads.set(snapshot.table.id, pages.head);
      for (const id of removed) {
        savedTables.delete(id);
        savedTableHeads.delete(id);
        pendingTableSnapshots.delete(id);
        if (workingTables.get(id) === removedSnapshots.get(id)) workingTables.delete(id);
      }
    } catch (error) {
      try { transaction.abort(); } catch { /* It may already have aborted. */ }
      await Promise.allSettled(writes);
      await transaction.done.catch(() => undefined);
      throw error;
    }
  });
};

const scheduleLegacyTableMigrations = (data: WorkspaceData) => {
  for (const table of data.tables) if (savedTables.get(table.id)?.legacy || savedTables.get(table.id)?.orderPending || savedTables.get(table.id)?.columnStatePending || savedTableHeads.get(table.id)?.format !== 'row-blocks-v1') void saveWorkspace({ ...data, tables: [table] }, { partial: true }).catch(notifyStorageError);
};
/** Layout-only maintenance shares the save queue without changing data/history/backup revisions. */
export const maintainWorkspaceRowPages = async (tableId: string, options: WorkspaceIdleOptions): Promise<void> => {
  if (!database) return;
  while (!options.signal.aborted && options.isCurrent()) {
    await saveQueue.catch(() => undefined);
    materializeTableSnapshot(tableId);
    const snapshot = savedTables.get(tableId)?.snapshot;
    const head = savedTableHeads.get(tableId);
    if (!snapshot || head?.format !== 'row-blocks-v1' || workingTables.get(tableId) !== snapshot) return;
    const isCurrent = () => !options.signal.aborted && options.isCurrent() && workingTables.get(tableId) === snapshot
      && savedTables.get(tableId)?.snapshot === snapshot && savedTableHeads.get(tableId) === head;
    const plan = await runWorkspaceIdleSteps(planWorkspaceRowBlockMaintenance(snapshot.table, head, nextStorageRevision()), { ...options, isCurrent });
    if (!isCurrent()) continue;
    if (!plan) return;
    let committed = false;
    await enqueueSave(async () => {
      if (!isCurrent() || !options.canRun()) return;
      const db = await database;
      if (!isCurrent()) return;
      const transaction = db.transaction(['meta', 'tableHeads', 'rowPages'], 'readwrite');
      const writes: Promise<unknown>[] = [];
      try {
        const state = asStorageState(await transaction.objectStore('meta').get(STORAGE_KEY));
        assertRevision(state);
        if (!isCurrent() || !options.canRun()) {
          transaction.abort();
          await transaction.done.catch(() => undefined);
          return;
        }
        const revision = nextStorageRevision();
        writes.push(transaction.objectStore('meta').put({ ...state, storageRevision: revision, updatedAt: state?.updatedAt }, STORAGE_KEY));
        writes.push(transaction.objectStore('tableHeads').put(plan.head, tableId));
        for (const page of plan.pages) writes.push(transaction.objectStore('rowPages').put(page, [tableId, page.id]));
        for (const id of plan.deletes) writes.push(transaction.objectStore('rowPages').delete([tableId, id]));
        await Promise.all(writes);
        await transaction.done;
        savedStorageRevision = revision;
        savedTableHeads.set(tableId, plan.head);
        committed = true;
      } catch (error) {
        try { transaction.abort(); } catch { /* Already aborted. */ }
        await Promise.allSettled(writes);
        await transaction.done.catch(() => undefined);
        throw error;
      }
    });
    if (committed) return;
  }
};
export const flushWorkspaceSaves = () => saveQueue;
export const flushWorkspaceHistorySaves = () => saveQueue;
export const assertWorkspaceStorageCurrent = async () => {
  if (!database) return;
  await saveQueue.catch(() => undefined);
  const db = await database;
  assertRevision(asStorageState(await db.get('meta', STORAGE_KEY)));
};

class WorkspaceBackupReadRestart extends Error {}
/** Content edits cancel backup; layout/history writes can restart a bounded read. */
const workspaceBackupReadContext = async (isCurrent?: () => boolean) => {
  if (!database) throw new Error('Workspace database is unavailable');
  let pending = saveQueue;
  await pending;
  const epoch = backupContentEpoch;
  let revision = savedStorageRevision;
  const db = await database;
  const checkCurrent = () => {
    if (isCurrent && !isCurrent()) throw new DOMException('Workspace backup cancelled', 'AbortError');
    if (backupContentEpoch !== epoch) throw new Error('本機資料在備份期間已有變更，請稍後再試');
    if (saveQueue !== pending) throw new WorkspaceBackupReadRestart();
  };
  const context: WorkspaceStoredReadContext = { checkCurrent, checkVersion: value => {
    checkCurrent();
    if ((workspaceStorageState(value)?.storageRevision ?? null) !== revision) throw new WorkspaceStorageConflictError();
  } };
  const verify = async () => {
    for (;;) {
      pending = saveQueue;
      await pending;
      revision = savedStorageRevision;
      try { context.checkCurrent(); context.checkVersion(await db.get('meta', STORAGE_KEY)); return; }
      catch (error) { if (!(error instanceof WorkspaceBackupReadRestart)) throw error; }
    }
  };
  const read = async <T>(work: () => Promise<T>): Promise<T> => {
    for (;;) {
      await verify();
      try { const value = await work(); await verify(); return value; }
      catch (error) { if (!(error instanceof WorkspaceBackupReadRestart)) throw error; }
    }
  };
  await verify();
  return { db, context, verify, read };
};

const readBackupSummaries = async (data: WorkspaceData, db: IDBPDatabase<WorkspaceDb>, context: WorkspaceStoredReadContext) => {
  const loaded = new Map(data.tables.map(table => [table.id, table]));
  const summaries: WorkspaceBackupTableSummary[] = [];
  for (const id of new Set(data.nodes.flatMap(node => node.type === 'table' && node.tableId ? [node.tableId] : []))) {
    context.checkCurrent();
    const resident = loaded.get(id);
    if (resident) { assertWorkspaceTableComplete(resident); summaries.push(workspaceBackupTableSummary(resident)); continue; }
    const transaction = db.transaction(['meta', 'tableHeads', 'tables', 'tableState'], 'readonly');
    const version = await transaction.objectStore('meta').get(STORAGE_KEY);
    const head = await transaction.objectStore('tableHeads').get(id);
    if (head) {
      validateWorkspaceTableHead(id, head);
      summaries.push(workspaceBackupTableSummary({ ...head.definition, updatedAt: head.updatedAt, changeRevision: head.changeRevision }));
    } else {
      // Old table records may contain rows; extract only markers and drop each record.
      const record = await transaction.objectStore('tables').get(id);
      if (!record) throw new WorkspaceStorageIntegrityError(`Missing table: ${id}`);
      const state = isChunkedWorkspaceTable(record) ? await transaction.objectStore('tableState').get(id) : undefined;
      const definition = isChunkedWorkspaceTable(record) ? record.definition : record;
      summaries.push(workspaceBackupTableSummary({ ...definition, updatedAt: state?.updatedAt ?? ('updatedAt' in record ? record.updatedAt : 0), changeRevision: state?.changeRevision ?? ('changeRevision' in record ? record.changeRevision : undefined) }));
    }
    await transaction.done;
    context.checkVersion(version);
    await yieldWorkspaceTask();
  }
  return summaries;
};

export const loadWorkspaceBackupSummaries = async (data: WorkspaceData, options?: { isCurrent?: () => boolean }) => {
  const { db, context, read } = await workspaceBackupReadContext(options?.isCurrent);
  return read(() => readBackupSummaries(data, db, context));
};
export const prepareWorkspaceBackup = async (data: WorkspaceData, options?: { isCurrent?: () => boolean }): Promise<WorkspaceBackupSource> => {
  const { db, context, verify, read } = await workspaceBackupReadContext(options?.isCurrent);
  const tables = await read(() => readBackupSummaries(data, db, context));
  return { tables, verify, async readTable(id) {
    if (!tables.some(table => table.id === id)) throw new WorkspaceStorageIntegrityError(`Missing table: ${id}`);
    return read(async () => data.tables.find(table => table.id === id) ?? (await readWorkspaceStoredTable(db, id, context, true)).table);
  } };
};

type HistoryLoadOptions = { isCurrent?: () => boolean };
/** All batches must refer to the same saved version; edits queued during a read restart it. */
const readHistory = async <Result>(read: (db: IDBPDatabase<WorkspaceDb>, context: WorkspaceHistoryReadContext) => Promise<Result>, options?: HistoryLoadOptions): Promise<Result> => {
  if (!database) throw new Error('Workspace database is unavailable');
  for (;;) {
    const pending = saveQueue;
    await pending.catch(() => undefined);
    const checkCurrent = () => {
      if (options?.isCurrent && !options.isCurrent()) throw new DOMException('Workspace history read cancelled', 'AbortError');
      if (saveQueue !== pending) throw new WorkspaceReadRestart();
    };
    const context: WorkspaceHistoryReadContext = { checkCurrent, checkVersion: state => { checkCurrent(); assertRevision(asStorageState(state)); } };
    try {
      checkCurrent();
      const db = await database;
      const result = await read(db, context);
      context.checkVersion(await db.get('meta', STORAGE_KEY));
      return result;
    } catch (error) { if (!(error instanceof WorkspaceReadRestart)) throw error; }
  }
};
export const loadWorkspaceHistoryHead = async (tableId: string, options?: HistoryLoadOptions) => {
  if (!database) return { tableId, past: [], future: [] };
  const { history, legacy } = await readHistory((db, context) => readWorkspaceHistoryHead(db, tableId, context), options);
  if (legacy) void saveWorkspaceHistory(history as WorkspaceTableHistory).catch(notifyStorageError);
  else historyStorage.rememberRead(history);
  return history;
};
export const loadWorkspaceHistoryEntry = (tableId: string, reference: WorkspaceHistoryReference, options?: HistoryLoadOptions) => readHistory((db, context) => readWorkspaceHistoryEntry(db, tableId, reference, context), options);
export const loadWorkspaceHistories = async (): Promise<Map<string, WorkspaceTableHistory>> => {
  if (!database) return new Map();
  const { histories, legacyIds } = await readHistory(readWorkspaceHistories);
  for (const history of histories.values()) {
    if (legacyIds.includes(history.tableId)) void saveWorkspaceHistory(history).catch(notifyStorageError);
    else historyStorage.rememberRead(history);
  }
  return histories;
};

const saveHistoryChanges = (changes: WorkspaceHistoryStorageChanges) => enqueueSave(async () => {
  if (!database) return;
  const db = await database;
  const transaction = db.transaction([...stores], 'readwrite');
  try {
    const state = asStorageState(await transaction.objectStore('meta').get(STORAGE_KEY));
    assertRevision(state);
    await historyStorage.writeChanges(transaction, changes);
    const revision = nextStorageRevision();
    await transaction.objectStore('meta').put({ ...state, storageRevision: revision, updatedAt: savedUpdatedAt }, STORAGE_KEY);
    await transaction.done;
    savedStorageRevision = revision;
    historyStorage.rememberSaved(changes);
  } catch (error) {
    try { transaction.abort(); } catch { /* Already aborted. */ }
    await transaction.done.catch(() => undefined);
    throw error;
  }
});
/** Bind backup receipts to this database, independently of surviving localStorage settings. */
export const loadWorkspaceStorageIdentity = async (): Promise<string> => {
  if (!database) throw new Error('Workspace database is unavailable');
  let identity = '';
  await enqueueSave(async () => {
    const db = await database;
    const transaction = db.transaction('meta', 'readwrite');
    try {
      const state = asStorageState(await transaction.store.get(STORAGE_KEY));
      assertRevision(state);
      if (!state) throw new WorkspaceStorageConflictError();
      identity = state.storageIdentity || nextStorageRevision();
      if (!state.storageIdentity) await transaction.store.put({ ...state, storageIdentity: identity }, STORAGE_KEY);
      await transaction.done;
    } catch (error) {
      try { transaction.abort(); } catch { /* Already aborted. */ }
      await transaction.done.catch(() => undefined);
      throw error;
    }
  });
  return identity;
};
// Compatibility for non-UI callers; normal mutations use saveWorkspace's atomic history plan.
export const saveWorkspaceHistory = (history: WorkspaceTableHistory) => saveHistoryChanges({ replace: [history] });
export const appendWorkspaceHistoryEntry = (entry: WorkspaceTableHistoryEntry) => saveHistoryChanges({ append: [entry] });
export const deleteWorkspaceHistories = (tableIds: readonly string[]) => saveHistoryChanges({ deleteTableIds: tableIds });
export const clearAllWorkspaceHistories = () => saveHistoryChanges({ clearAll: true });
export const clearWorkspace = () => enqueueSave(async () => {
  if (!database) return;
  const db = await database;
  const transaction = db.transaction([...stores], 'readwrite');
  try {
    assertRevision(asStorageState(await transaction.objectStore('meta').get(STORAGE_KEY)));
    await Promise.all(stores.map(name => transaction.objectStore(name).clear()));
    await transaction.done;
    resetSnapshots(); savedMetadata = undefined; savedStorageRevision = null; savedUpdatedAt = undefined;
  } catch (error) {
    try { transaction.abort(); } catch { /* Already aborted. */ }
    await transaction.done.catch(() => undefined);
    throw error;
  }
});
