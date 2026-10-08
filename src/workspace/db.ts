import { openDB, type DBSchema, type IDBPTransaction } from 'idb';
import { emptyWorkspace, ensureTableDynamicOptions, normalizeWorkspace } from './model';
import { pruneWorkspaceTableHistory, workspaceHistoryLimit, workspaceHistoryRetentionMs, type WorkspaceTableHistory, type WorkspaceTableHistoryEntry, type WorkspaceTableMutation } from './history';
import { assembleChunkedWorkspaceTable, createWorkspaceTableStorageSnapshot, hasCurrentWorkspaceColumnState, isChunkedWorkspaceTable, planWorkspaceTableStorageWrite, updateWorkspaceTableStorageSnapshot, WorkspaceStorageIntegrityError, type StoredWorkspaceRowChunk, type StoredWorkspaceTable, type StoredWorkspaceTableState, type WorkspaceTableStorageSnapshot } from './rowChunkStorage';
import type { WorkspaceData, WorkspaceNode, WorkspaceTable } from './types';
import { assertWorkspaceTableComplete, initialWorkspaceRowPages, planWorkspaceRowPages, validateWorkspaceRowPage, validateWorkspaceTableHead, type WorkspaceRowPage, type WorkspaceTableHead, type WorkspaceTableWindow } from './rowPages';
import { loadWorkspaceTableViewState } from './viewState';
import type { StoredWorkspaceRowOrderPage } from './rowOrderStorage';

type WorkspaceMetadata = {
  version: WorkspaceData['version']; structureRevision?: string; nodes: WorkspaceNode[];
  activeNodeId: string | null; bottomNavigationTableIds?: string[];
};
type WorkspaceStorageState = { storageRevision: string; updatedAt?: number };
type HistoryReference = { id: string; createdAt: number };
interface StoredHistoryHead { storageFormat: 'history-entries-v1'; tableId: string; past: HistoryReference[]; future: HistoryReference[] }
interface WorkspaceDb extends DBSchema {
  state: { key: string; value: WorkspaceData };
  meta: { key: string; value: WorkspaceMetadata | WorkspaceStorageState };
  tables: { key: string; value: WorkspaceTable | StoredWorkspaceTable };
  tableState: { key: string; value: StoredWorkspaceTableState };
  rowChunks: { key: [string, string]; value: StoredWorkspaceRowChunk };
  rowOrderPages: { key: [string, string]; value: StoredWorkspaceRowOrderPage };
  tableHeads: { key: string; value: WorkspaceTableHead };
  rowPages: { key: [string, number]; value: WorkspaceRowPage };
  history: { key: string; value: WorkspaceTableHistory | StoredHistoryHead };
  historyEntries: { key: [string, string]; value: WorkspaceTableHistoryEntry };
}
const DATABASE_NAME = 'board-game-helper-workspace';
const META_KEY = 'workspace';
const STORAGE_KEY = 'storage';
const stores = ['state', 'meta', 'tables', 'tableState', 'rowChunks', 'rowOrderPages', 'tableHeads', 'rowPages', 'history', 'historyEntries'] as const;
type WriteTransaction = IDBPTransaction<WorkspaceDb, typeof stores[number][], 'readwrite'>;
const notifyStorageError = (error: unknown) => window.dispatchEvent(new CustomEvent('workspace-storage-error', { detail: error }));
const database = typeof indexedDB === 'undefined' ? null : openDB<WorkspaceDb>(DATABASE_NAME, 7, {
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
let savedStorageRevision: string | null = null;
let savedMetadata: WorkspaceMetadata | undefined;
let savedUpdatedAt: number | undefined;
let savedTables = new Map<string, { snapshot: WorkspaceTableStorageSnapshot; legacy: boolean; orderPending?: boolean; columnStatePending?: boolean }>();
let workingTables = new Map<string, WorkspaceTableStorageSnapshot>();
let tableSnapshots = new WeakMap<WorkspaceTable, WorkspaceTableStorageSnapshot>();
let savedHistories = new Map<string, WorkspaceTableHistory>();
type PendingTableSnapshot = { table: WorkspaceTable; stored?: { record: StoredWorkspaceTable; chunks: StoredWorkspaceRowChunk[]; orderPages?: StoredWorkspaceRowOrderPage[]; state?: StoredWorkspaceTableState } };
let pendingTableSnapshots = new Map<string, PendingTableSnapshot>();
let savedTableHeads = new Map<string, WorkspaceTableHead>();

export class WorkspaceStorageConflictError extends Error {
  constructor() { super('Workspace data was changed in another tab'); this.name = 'WorkspaceStorageConflictError'; }
}
export interface WorkspaceHistoryStorageChanges {
  clearAll?: boolean;
  deleteTableIds?: readonly string[];
  replace?: readonly WorkspaceTableHistory[];
  /** Pending early entries, including earlier failed saves, merged by ID with disk history. */
  append?: readonly WorkspaceTableHistoryEntry[];
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
const pageRange = (id: string) => IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);
const asMetadata = (value: WorkspaceMetadata | WorkspaceStorageState | undefined) => value && 'nodes' in value ? value : undefined;
const asStorageState = (value: WorkspaceMetadata | WorkspaceStorageState | undefined) => value && 'storageRevision' in value ? value : undefined;
const metadataOf = (data: WorkspaceData): WorkspaceMetadata => ({ version: data.version, structureRevision: data.structureRevision, nodes: data.nodes, activeNodeId: data.activeNodeId, bottomNavigationTableIds: data.bottomNavigationTableIds ?? [] });
const sameMetadata = (left: WorkspaceMetadata | undefined, right: WorkspaceMetadata) => left?.version === right.version && left.structureRevision === right.structureRevision && left.nodes === right.nodes && left.activeNodeId === right.activeNodeId && left.bottomNavigationTableIds === right.bottomNavigationTableIds;
const enqueueSave = (work: () => Promise<void>) => {
  const pending = saveQueue.catch(() => undefined).then(work);
  saveQueue = pending;
  return pending;
};
const assertRevision = (state: WorkspaceStorageState | undefined) => {
  if ((state?.storageRevision ?? null) !== savedStorageRevision) throw new WorkspaceStorageConflictError();
};
const resetSnapshots = () => { savedTables = new Map(); workingTables = new Map(); tableSnapshots = new WeakMap(); savedHistories = new Map(); pendingTableSnapshots = new Map(); savedTableHeads = new Map(); };
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

export const loadWorkspace = async (options?: { expectCurrentRevision?: boolean; tableIds?: readonly string[]; deferStartupWork?: boolean }): Promise<WorkspaceData> => {
  if (!database) return emptyWorkspace();
  const pending = saveQueue;
  await pending.catch(() => undefined);
  if (options?.expectCurrentRevision) for (const id of pendingTableSnapshots.keys()) materializeTableSnapshot(id);
  const db = await database;
  const transaction = db.transaction(['meta', 'tables', 'tableState', 'rowChunks', 'rowOrderPages', 'tableHeads', 'state'], 'readonly');
  const [metaValue, stateValue, keys] = await Promise.all([transaction.objectStore('meta').get(META_KEY), transaction.objectStore('meta').get(STORAGE_KEY), transaction.objectStore('tables').getAllKeys()]);
  const meta = asMetadata(metaValue);
  const state = asStorageState(stateValue);
  if (!meta) {
    const legacy = await transaction.objectStore('state').get(META_KEY);
    await transaction.done;
    if (saveQueue !== pending) return loadWorkspace(options);
    if (options?.expectCurrentRevision) assertRevision(state);
    resetSnapshots(); savedMetadata = undefined; savedStorageRevision = state?.storageRevision ?? null;
    const loaded = normalizeWorkspace(legacy ?? emptyWorkspace(), { deferDynamicOptions: options?.deferStartupWork });
    await saveWorkspace(loaded);
    await db.delete('state', META_KEY);
    return loaded;
  }
  const available = new Set(keys);
  const ids = options?.tableIds ? [...new Set(options.tableIds)] : keys;
  if (!options?.tableIds) for (const node of meta.nodes) if (node.type === 'table' && node.tableId && !available.has(node.tableId)) throw new WorkspaceStorageIntegrityError(`Missing table: ${node.tableId}`);
  const readIds = ids.filter(id => !options?.expectCurrentRevision || !workingTables.has(id));
  const loadedRecords = await Promise.all(readIds.map(async id => {
    const record = await transaction.objectStore('tables').get(id);
    const head = await transaction.objectStore('tableHeads').get(id);
    if (!record) throw new WorkspaceStorageIntegrityError(`Missing table: ${id}`);
    if (!isChunkedWorkspaceTable(record)) return { id, table: record, stored: undefined, head };
    const [tableState, chunks, orderPages] = await Promise.all([transaction.objectStore('tableState').get(id), transaction.objectStore('rowChunks').getAll(tableRange(id)), record.storageFormat === 'row-chunks-v2' ? transaction.objectStore('rowOrderPages').getAll(tableRange(id)) : Promise.resolve([])]);
    return { id, table: assembleChunkedWorkspaceTable(id, record, tableState, chunks, orderPages), stored: { record, chunks, orderPages, state: tableState }, head };
  }));
  await transaction.done;
  if (saveQueue !== pending) return loadWorkspace(options);
  if (options?.expectCurrentRevision) assertRevision(state);
  if (!options?.expectCurrentRevision) resetSnapshots();
  // Only new tables are normalized. Active table objects/baselines survive background hydration.
  const normalized = normalizeWorkspace({ ...meta, updatedAt: state?.updatedAt, tables: loadedRecords.map(item => item.table) }, { deferDynamicOptions: options?.deferStartupWork });
  normalized.tables.forEach((table, index) => {
    const item = loadedRecords[index];
    if (item.head) savedTableHeads.set(table.id, item.head);
    if (options?.deferStartupWork) {
      pendingTableSnapshots.set(table.id, { table, stored: item.stored });
      return;
    }
    const snapshot = createWorkspaceTableStorageSnapshot(table, item.stored);
    savedTables.set(table.id, { snapshot, legacy: !item.stored, orderPending: item.stored?.record.storageFormat === 'row-chunks-v1', columnStatePending: Boolean(item.stored && !hasCurrentWorkspaceColumnState(table, item.stored.state)) });
    workingTables.set(table.id, snapshot); tableSnapshots.set(table, snapshot);
  });
  if (options?.expectCurrentRevision) for (const [id, snapshot] of workingTables) {
    const prepared = ensureTableDynamicOptions(snapshot.table);
    if (prepared === snapshot.table) continue;
    const next = updateWorkspaceTableStorageSnapshot(snapshot, prepared);
    workingTables.set(id, next); tableSnapshots.set(prepared, next);
    const saved = savedTables.get(id);
    if (saved) savedTables.set(id, { ...saved, columnStatePending: true });
  }
  savedStorageRevision = state?.storageRevision ?? null;
  savedUpdatedAt = state?.updatedAt;
  if (!options?.expectCurrentRevision || !savedMetadata) savedMetadata = metadataOf({ ...normalized, bottomNavigationTableIds: meta.bottomNavigationTableIds ?? [] });
  const result: WorkspaceData = { ...savedMetadata, updatedAt: savedUpdatedAt, tables: keys.flatMap(id => workingTables.get(id)?.table ?? pendingTableSnapshots.get(id)?.table ?? []) };
  if (!options?.tableIds) result.bottomNavigationTableIds = [...new Set(meta.bottomNavigationTableIds ?? [])].filter(id => available.has(id));
  // This read is used after first paint; legacy tables migrate independently through the same queue.
  if (options?.expectCurrentRevision) scheduleLegacyTableMigrations(result);
  return result;
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
      window = { head, pages: await Promise.all(indices.map(async index => validateWorkspaceRowPage(head, index, await transaction.objectStore('rowPages').get([activeId!, index])))) };
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
  const transaction = db.transaction(['meta', 'tables', 'tableState', 'rowChunks', 'rowOrderPages', 'tableHeads'], 'readonly');
  const [metaValue, stateValue] = await Promise.all([transaction.objectStore('meta').get(META_KEY), transaction.objectStore('meta').get(STORAGE_KEY)]);
  const meta = asMetadata(metaValue);
  const state = asStorageState(stateValue);
  const active = meta?.nodes.find(node => node.id === meta.activeNodeId && node.type === 'table');
  const record = active?.tableId ? await transaction.objectStore('tables').get(active.tableId) : undefined;
  const savedHead = active?.tableId ? await transaction.objectStore('tableHeads').get(active.tableId) : undefined;
  let stored: PendingTableSnapshot['stored'];
  let table: WorkspaceTable | undefined;
  if (record && active?.tableId) {
    if (isChunkedWorkspaceTable(record)) {
      const [tableState, chunks, orderPages] = await Promise.all([transaction.objectStore('tableState').get(active.tableId), transaction.objectStore('rowChunks').getAll(tableRange(active.tableId)), record.storageFormat === 'row-chunks-v2' ? transaction.objectStore('rowOrderPages').getAll(tableRange(active.tableId)) : Promise.resolve([])]);
      table = assembleChunkedWorkspaceTable(active.tableId, record, tableState, chunks, orderPages);
      stored = { record, chunks, orderPages, state: tableState };
    } else table = record;
  }
  await transaction.done;
  if (saveQueue !== pending) return loadWorkspaceInitial();
  if (!meta || !table) return { data: await loadWorkspace({ deferStartupWork: true }), complete: true, storageVersion: db.version };
  const normalized = normalizeWorkspace({ ...meta, updatedAt: state?.updatedAt, tables: [table] }, { deferDynamicOptions: true });
  const data = { ...normalized, bottomNavigationTableIds: meta.bottomNavigationTableIds ?? [] };
  resetSnapshots();
  if (savedHead) savedTableHeads.set(table.id, savedHead);
  // Indexes and chunk snapshots are needed by a save or background work, not first paint.
  pendingTableSnapshots.set(table.id, { table: data.tables[0], stored });
  savedMetadata = metadataOf(data); savedStorageRevision = state?.storageRevision ?? null; savedUpdatedAt = state?.updatedAt;
  return { data, complete: false, storageVersion: db.version };
};

/** A bounded read of display-order pages, checked against the current storage revision. */
export const loadWorkspaceTableWindow = async (tableId: string, indices: readonly number[]): Promise<WorkspaceTableWindow | undefined> => {
  if (!database) return undefined;
  const pending = saveQueue;
  await pending.catch(() => undefined);
  const db = await database;
  const transaction = db.transaction(['meta', 'tableHeads', 'rowPages'], 'readonly');
  const [state, head] = await Promise.all([transaction.objectStore('meta').get(STORAGE_KEY), transaction.objectStore('tableHeads').get(tableId)]);
  if (head) validateWorkspaceTableHead(tableId, head);
  const pages = head ? await Promise.all([...new Set(indices)].filter(index => Number.isSafeInteger(index) && index >= 0 && index * head.pageSize < head.rowCount).map(async index =>
    validateWorkspaceRowPage(head, index, await transaction.objectStore('rowPages').get([tableId, index])),
  )) : [];
  await transaction.done;
  if (saveQueue !== pending) return loadWorkspaceTableWindow(tableId, indices);
  assertRevision(asStorageState(state));
  return head ? { head, pages } : undefined;
};

const isHistoryHead = (history: StoredHistoryHead | WorkspaceTableHistory): history is StoredHistoryHead => 'storageFormat' in history && history.storageFormat === 'history-entries-v1';
const referenceOf = ({ id, createdAt }: HistoryReference): HistoryReference => ({ id, createdAt });
const pruneReferences = (entries: HistoryReference[]) => entries.filter(entry => Date.now() - entry.createdAt <= workspaceHistoryRetentionMs).slice(-workspaceHistoryLimit);
const writeHistory = async (transaction: WriteTransaction, tableId: string, change: { replace?: WorkspaceTableHistory; append?: WorkspaceTableHistoryEntry[] }) => {
  const store = transaction.objectStore('history');
  const entries = transaction.objectStore('historyEntries');
  const previous = await store.get(tableId);
  const previousPast = previous?.past.map(referenceOf) ?? [];
  const previousFuture = previous?.future.map(referenceOf) ?? [];
  const previousIds = new Set([...previousPast, ...previousFuture].map(entry => entry.id));
  const legacyEntries = previous && !isHistoryHead(previous) ? [...previous.past, ...previous.future] : [];
  const incoming = change.replace ? [...change.replace.past, ...change.replace.future] : change.append ?? [];
  if (incoming.some(entry => entry.tableId !== tableId)) throw new WorkspaceStorageIntegrityError(`Invalid history table: ${tableId}`);
  const past = pruneReferences(change.replace ? change.replace.past.map(referenceOf) : [...new Map([...previousPast, ...incoming.map(referenceOf)].map(entry => [entry.id, entry])).values()]);
  const future = pruneReferences(change.replace?.future.map(referenceOf) ?? []);
  const nextIds = new Set([...past, ...future].map(entry => entry.id));
  if (nextIds.size !== past.length + future.length) throw new WorkspaceStorageIntegrityError(`Duplicate history entry: ${tableId}`);
  const writes = new Map([...legacyEntries, ...incoming].filter(entry => nextIds.has(entry.id) && (legacyEntries.length || !previousIds.has(entry.id))).map(entry => [entry.id, entry]));
  await Promise.all([
    ...[...writes.values()].map(entry => entries.put(entry, [tableId, entry.id])),
    ...[...previousIds].filter(id => !nextIds.has(id)).map(id => entries.delete([tableId, id])),
    nextIds.size ? store.put({ storageFormat: 'history-entries-v1', tableId, past, future }, tableId) : store.delete(tableId),
  ]);
};
const writeHistoryChanges = async (transaction: WriteTransaction, changes: WorkspaceHistoryStorageChanges | undefined, removedIds: readonly string[] = []) => {
  if (changes?.clearAll) await Promise.all([transaction.objectStore('history').clear(), transaction.objectStore('historyEntries').clear()]);
  for (const id of new Set([...removedIds, ...(changes?.deleteTableIds ?? [])])) await Promise.all([transaction.objectStore('history').delete(id), transaction.objectStore('historyEntries').delete(tableRange(id))]);
  for (const history of changes?.replace ?? []) if (changes?.clearAll || changes?.deleteTableIds?.includes(history.tableId) || savedHistories.get(history.tableId) !== history) await writeHistory(transaction, history.tableId, { replace: pruneWorkspaceTableHistory(history) });
  const pending = new Map<string, WorkspaceTableHistoryEntry[]>();
  for (const entry of changes?.append ?? []) pending.set(entry.tableId, [...(pending.get(entry.tableId) ?? []), entry]);
  for (const [tableId, append] of pending) await writeHistory(transaction, tableId, { append });
};
const rememberSavedHistories = (changes: WorkspaceHistoryStorageChanges | undefined, removedIds: readonly string[] = []) => {
  if (changes?.clearAll) savedHistories.clear();
  for (const id of [...removedIds, ...(changes?.deleteTableIds ?? [])]) savedHistories.delete(id);
  for (const history of changes?.replace ?? []) savedHistories.set(history.tableId, history);
  for (const entry of changes?.append ?? []) savedHistories.delete(entry.tableId);
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
    const plans = snapshots.filter(snapshot => savedTables.get(snapshot.table.id)?.snapshot !== snapshot || savedTables.get(snapshot.table.id)?.legacy || savedTables.get(snapshot.table.id)?.orderPending || savedTables.get(snapshot.table.id)?.columnStatePending || !savedTableHeads.has(snapshot.table.id)).map(snapshot => ({
      snapshot, plan: planWorkspaceTableStorageWrite(snapshot, savedTables.get(snapshot.table.id)?.snapshot, savedTables.get(snapshot.table.id)?.legacy, savedTables.get(snapshot.table.id)?.orderPending),
      pages: planWorkspaceRowPages(snapshot, savedTables.get(snapshot.table.id)?.snapshot, savedTableHeads.get(snapshot.table.id), nextStorageRevision()),
    }));
    const transaction = db.transaction([...stores], 'readwrite');
    const writes: Promise<unknown>[] = [];
    try {
      assertRevision(asStorageState(await transaction.objectStore('meta').get(STORAGE_KEY)));
      const revision = nextStorageRevision();
      if (!sameMetadata(savedMetadata, meta)) writes.push(transaction.objectStore('meta').put(meta, META_KEY));
      writes.push(transaction.objectStore('meta').put({ storageRevision: revision, updatedAt: data.updatedAt }, STORAGE_KEY));
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
        for (const page of pages.pages) writes.push(transaction.objectStore('rowPages').put(page, [id, page.index]));
      }
      for (const id of removed) writes.push(transaction.objectStore('tables').delete(id), transaction.objectStore('tableState').delete(id), transaction.objectStore('rowChunks').delete(tableRange(id)), transaction.objectStore('rowOrderPages').delete(tableRange(id)), transaction.objectStore('tableHeads').delete(id), transaction.objectStore('rowPages').delete(pageRange(id)));
      await Promise.all([...writes, writeHistoryChanges(transaction, options?.history, removed)]);
      await transaction.done;
      // Never move the baseline to a later in-memory edit or after an aborted transaction.
      savedStorageRevision = revision; savedUpdatedAt = data.updatedAt; savedMetadata = meta;
      rememberSavedHistories(options?.history, removed);
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
  for (const table of data.tables) if (savedTables.get(table.id)?.legacy || savedTables.get(table.id)?.orderPending || savedTables.get(table.id)?.columnStatePending || !savedTableHeads.has(table.id)) void saveWorkspace({ ...data, tables: [table] }, { partial: true }).catch(notifyStorageError);
};
export const flushWorkspaceSaves = () => saveQueue;
export const flushWorkspaceHistorySaves = () => saveQueue;
export const assertWorkspaceStorageCurrent = async () => {
  if (!database) return;
  await saveQueue.catch(() => undefined);
  const db = await database;
  assertRevision(asStorageState(await db.get('meta', STORAGE_KEY)));
};

export const loadWorkspaceHistories = async (): Promise<Map<string, WorkspaceTableHistory>> => {
  if (!database) return new Map();
  const pending = saveQueue;
  await pending.catch(() => undefined);
  const db = await database;
  const transaction = db.transaction(['meta', 'history', 'historyEntries'], 'readonly');
  const [state, histories] = await Promise.all([transaction.objectStore('meta').get(STORAGE_KEY), transaction.objectStore('history').getAll()]);
  const loaded = await Promise.all(histories.map(async history => {
    if (!isHistoryHead(history)) return pruneWorkspaceTableHistory(history);
    const entries = await transaction.objectStore('historyEntries').getAll(tableRange(history.tableId));
    const byId = new Map(entries.map(entry => [entry.id, entry]));
    const resolve = (references: HistoryReference[]) => references.map(reference => {
      const entry = byId.get(reference.id);
      if (!entry || entry.tableId !== history.tableId || entry.createdAt !== reference.createdAt) throw new WorkspaceStorageIntegrityError(`Missing history entry: ${history.tableId}`);
      return entry;
    });
    return pruneWorkspaceTableHistory({ tableId: history.tableId, past: resolve(history.past), future: resolve(history.future) });
  }));
  await transaction.done;
  if (saveQueue !== pending) return loadWorkspaceHistories();
  assertRevision(asStorageState(state));
  const result = new Map(loaded.map(history => [history.tableId, history]));
  histories.forEach((history, index) => { if (isHistoryHead(history)) savedHistories.set(history.tableId, loaded[index]); });
  for (const history of histories) if (!isHistoryHead(history)) void saveWorkspaceHistory(result.get(history.tableId)!).catch(notifyStorageError);
  return result;
};

const saveHistoryChanges = (changes: WorkspaceHistoryStorageChanges) => enqueueSave(async () => {
  if (!database) return;
  const db = await database;
  const transaction = db.transaction([...stores], 'readwrite');
  try {
    assertRevision(asStorageState(await transaction.objectStore('meta').get(STORAGE_KEY)));
    await writeHistoryChanges(transaction, changes);
    const revision = nextStorageRevision();
    await transaction.objectStore('meta').put({ storageRevision: revision, updatedAt: savedUpdatedAt }, STORAGE_KEY);
    await transaction.done;
    savedStorageRevision = revision;
    rememberSavedHistories(changes);
  } catch (error) {
    try { transaction.abort(); } catch { /* Already aborted. */ }
    await transaction.done.catch(() => undefined);
    throw error;
  }
});
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
