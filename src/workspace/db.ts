import { openDB, type DBSchema } from 'idb';
import { emptyWorkspace, normalizeWorkspace } from './model';
import { createEmptyWorkspaceTableHistory, pruneWorkspaceTableHistory, type WorkspaceTableHistory, type WorkspaceTableHistoryEntry } from './history';
import type { WorkspaceData, WorkspaceNode, WorkspaceTable } from './types';

type WorkspaceMetadata = {
  version: WorkspaceData['version'];
  storageRevision?: string;
  updatedAt?: number;
  structureRevision?: string;
  nodes: WorkspaceNode[];
  activeNodeId: string | null;
  bottomNavigationTableIds?: string[];
};

interface WorkspaceDb extends DBSchema {
  state: { key: string; value: WorkspaceData };
  meta: { key: string; value: WorkspaceMetadata };
  tables: { key: string; value: WorkspaceTable };
  history: { key: string; value: WorkspaceTableHistory };
}

const DATABASE_NAME = 'board-game-helper-workspace';
const STATE_KEY = 'workspace';
const META_KEY = 'workspace';

const database = typeof indexedDB === 'undefined'
  ? null
  : openDB<WorkspaceDb>(DATABASE_NAME, 3, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('state')) db.createObjectStore('state');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('tables')) db.createObjectStore('tables');
      if (!db.objectStoreNames.contains('history')) db.createObjectStore('history');
    },
  });

let saveQueue: Promise<void> = Promise.resolve();
let historySaveQueue: Promise<void> = Promise.resolve();
let savedTableSignatures = new Map<string, string>();
let savedTables = new Map<string, WorkspaceTable>();
let savedStorageRevision: string | null = null;

export class WorkspaceStorageConflictError extends Error {
  constructor() {
    super('Workspace data was changed in another tab');
    this.name = 'WorkspaceStorageConflictError';
  }
}

const storageRevision = (meta: WorkspaceMetadata | undefined) => meta?.storageRevision ?? null;
const nextStorageRevision = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random()}`;
const normalizeStoredWorkspace = (meta: WorkspaceMetadata, tables: WorkspaceTable[]) => normalizeWorkspace({
  version: meta.version,
  updatedAt: meta.updatedAt,
  structureRevision: meta.structureRevision,
  nodes: meta.nodes,
  activeNodeId: meta.activeNodeId,
  bottomNavigationTableIds: meta.bottomNavigationTableIds,
  tables,
});

export const tableStorageSignature = (table: WorkspaceTable) => JSON.stringify(table);

export const createWorkspaceStoragePlan = (data: WorkspaceData, signatures: ReadonlyMap<string, string>, deletedTableIds: readonly string[] = []) => {
  const nextSignatures = new Map(data.tables.map((table) => [table.id, tableStorageSignature(table)]));
  const currentIds = new Set(nextSignatures.keys());
  return {
    meta: { version: data.version, updatedAt: data.updatedAt, structureRevision: data.structureRevision, nodes: data.nodes, activeNodeId: data.activeNodeId, bottomNavigationTableIds: data.bottomNavigationTableIds ?? [] } satisfies WorkspaceMetadata,
    upserts: data.tables.filter((table) => signatures.get(table.id) !== nextSignatures.get(table.id)),
    deletes: deletedTableIds.filter((id) => !currentIds.has(id)),
    signatures: nextSignatures,
  };
};

export const loadWorkspace = async (options?: { expectCurrentRevision?: boolean }): Promise<WorkspaceData> => {
  if (!database) return emptyWorkspace();
  const pendingSaves = saveQueue;
  await pendingSaves.catch(() => undefined);
  const db = await database;
  const transaction = db.transaction(['meta', 'tables'], 'readonly');
  const meta = await transaction.objectStore('meta').get(META_KEY);
  if (meta) {
    const tables = await transaction.objectStore('tables').getAll();
    await transaction.done;
    if (saveQueue !== pendingSaves) return loadWorkspace(options);
    if (options?.expectCurrentRevision && storageRevision(meta) !== savedStorageRevision) throw new WorkspaceStorageConflictError();
    const loaded = normalizeStoredWorkspace(meta, tables);
    // Keep immutable snapshots. Only changed tables need serialization when saving.
    savedTables = new Map(loaded.tables.map((table) => [table.id, table]));
    savedTableSignatures = new Map();
    savedStorageRevision = storageRevision(meta);
    return loaded;
  }
  await transaction.done;
  if (saveQueue !== pendingSaves) return loadWorkspace(options);
  if (options?.expectCurrentRevision && savedStorageRevision !== null) throw new WorkspaceStorageConflictError();

  const legacy = await db.get('state', STATE_KEY);
  const loaded = normalizeWorkspace(legacy ?? emptyWorkspace());
  savedTableSignatures = new Map();
  savedTables = new Map();
  savedStorageRevision = null;
  await saveWorkspace(loaded);
  await db.delete('state', STATE_KEY);
  return loaded;
};

/** Read only the active table for the first paint. Other tables hydrate after it. */
export const loadWorkspaceInitial = async (): Promise<{ data: WorkspaceData; complete: boolean }> => {
  if (!database) return { data: emptyWorkspace(), complete: true };
  await saveQueue.catch(() => undefined);
  const db = await database;
  const transaction = db.transaction(['meta', 'tables'], 'readonly');
  const meta = await transaction.objectStore('meta').get(META_KEY);
  const active = meta?.nodes.find((node) => node.id === meta.activeNodeId && node.type === 'table');
  const table = active?.tableId ? await transaction.objectStore('tables').get(active.tableId) : undefined;
  await transaction.done;
  if (!meta || !table) return { data: await loadWorkspace(), complete: true };
  const normalized = normalizeStoredWorkspace(meta, [table]);
  // Normalization filters pins by loaded tables; retain metadata until the rest hydrate.
  const data = { ...normalized, bottomNavigationTableIds: meta.bottomNavigationTableIds ?? [] };
  savedTables = new Map(data.tables.map((item) => [item.id, item]));
  savedTableSignatures = new Map();
  savedStorageRevision = storageRevision(meta);
  return { data, complete: false };
};

export const saveWorkspace = (data: WorkspaceData, options?: { partial?: boolean; deletedTableIds?: readonly string[] }) => {
  if (!database) return Promise.resolve();
  const pending = saveQueue.catch(() => undefined).then(async () => {
    const db = await database;
    const changedTables = data.tables.filter((table) => savedTables.get(table.id) !== table);
    for (const table of changedTables) {
      const previous = savedTables.get(table.id);
      if (previous && !savedTableSignatures.has(table.id)) savedTableSignatures.set(table.id, tableStorageSignature(previous));
    }
    const changedPlan = createWorkspaceStoragePlan({ ...data, tables: changedTables }, savedTableSignatures);
    const currentIds = new Set(data.tables.map((table) => table.id));
    const plan = { ...changedPlan, deletes: (options?.deletedTableIds ?? []).filter((id) => !currentIds.has(id)) };
    const transaction = db.transaction(['meta', 'tables'], 'readwrite');
    const currentMeta = await transaction.objectStore('meta').get(META_KEY);
    if (storageRevision(currentMeta) !== savedStorageRevision) throw new WorkspaceStorageConflictError();
    const revision = nextStorageRevision();
    await transaction.objectStore('meta').put({ ...plan.meta, storageRevision: revision }, META_KEY);
    await Promise.all([
      ...plan.upserts.map((table) => transaction.objectStore('tables').put(table, table.id)),
      ...plan.deletes.map((id) => transaction.objectStore('tables').delete(id)),
    ]);
    await transaction.done;
    savedStorageRevision = revision;
    for (const table of plan.upserts) savedTableSignatures.set(table.id, plan.signatures.get(table.id)!);
    for (const id of plan.deletes) savedTableSignatures.delete(id);
    savedTables = options?.partial
      ? new Map([...savedTables, ...data.tables.map((table) => [table.id, table] as const)])
      : new Map(data.tables.map((table) => [table.id, table]));
  });
  saveQueue = pending;
  return pending;
};

export const flushWorkspaceSaves = () => saveQueue;

/** Confirm that an in-memory snapshot still belongs to the current local database. */
export const assertWorkspaceStorageCurrent = async () => {
  if (!database) return;
  await saveQueue.catch(() => undefined);
  const db = await database;
  const meta = await db.get('meta', META_KEY);
  if (storageRevision(meta) !== savedStorageRevision) throw new WorkspaceStorageConflictError();
};

export const loadWorkspaceHistories = async (): Promise<Map<string, WorkspaceTableHistory>> => {
  if (!database) return new Map();
  await historySaveQueue.catch(() => undefined);
  const db = await database;
  const histories = await db.getAll('history');
  const now = Date.now();
  const result = new Map<string, WorkspaceTableHistory>();
  for (const history of histories) {
    const pruned = pruneWorkspaceTableHistory(history, now);
    result.set(pruned.tableId, pruned);
  }
  // Pruned records are persisted on the next edit, never on the startup read path.
  return result;
};

export const saveWorkspaceHistory = (history: WorkspaceTableHistory) => {
  historySaveQueue = historySaveQueue.catch(() => undefined).then(async () => {
    if (!database) return;
    const db = await database;
    const pruned = pruneWorkspaceTableHistory(history);
    if (pruned.past.length === 0 && pruned.future.length === 0) {
      await db.delete('history', history.tableId);
      return;
    }
    await db.put('history', pruned, history.tableId);
  });
  return historySaveQueue;
};

/** Persist early edits without waiting for every table's history to hydrate. */
export const appendWorkspaceHistoryEntry = (entry: WorkspaceTableHistoryEntry) => {
  historySaveQueue = historySaveQueue.catch(() => undefined).then(async () => {
    if (!database) return;
    const db = await database;
    const transaction = db.transaction('history', 'readwrite');
    const previous = await transaction.store.get(entry.tableId) ?? createEmptyWorkspaceTableHistory(entry.tableId);
    const next = pruneWorkspaceTableHistory({ tableId: entry.tableId, past: [...previous.past, entry], future: [] });
    await transaction.store.put(next, entry.tableId);
    await transaction.done;
  });
  return historySaveQueue;
};

export const deleteWorkspaceHistories = (tableIds: readonly string[]) => {
  historySaveQueue = historySaveQueue.catch(() => undefined).then(async () => {
    if (!database || tableIds.length === 0) return;
    const db = await database;
    const transaction = db.transaction('history', 'readwrite');
    await Promise.all(tableIds.map((tableId) => transaction.store.delete(tableId)));
    await transaction.done;
  });
  return historySaveQueue;
};

export const clearAllWorkspaceHistories = () => {
  historySaveQueue = historySaveQueue.catch(() => undefined).then(async () => {
    if (!database) return;
    const db = await database;
    await db.clear('history');
  });
  return historySaveQueue;
};

export const flushWorkspaceHistorySaves = () => historySaveQueue;

export const clearWorkspace = async () => {
  if (!database) return;
  await saveQueue.catch(() => undefined);
  await historySaveQueue.catch(() => undefined);
  const db = await database;
  const transaction = db.transaction(['state', 'meta', 'tables', 'history'], 'readwrite');
  await Promise.all([
    transaction.objectStore('state').clear(),
    transaction.objectStore('meta').clear(),
    transaction.objectStore('tables').clear(),
    transaction.objectStore('history').clear(),
  ]);
  await transaction.done;
  savedTableSignatures = new Map();
  savedTables = new Map();
  savedStorageRevision = null;
};
