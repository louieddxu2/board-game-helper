import { openDB, type DBSchema } from 'idb';
import { emptyWorkspace, normalizeWorkspace } from './model';
import { createEmptyWorkspaceTableHistory, pruneWorkspaceTableHistory, type WorkspaceTableHistory, type WorkspaceTableHistoryEntry } from './history';
import type { WorkspaceData, WorkspaceNode, WorkspaceTable } from './types';

type WorkspaceMetadata = {
  version: WorkspaceData['version'];
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

export const tableStorageSignature = (table: WorkspaceTable) => JSON.stringify(table);

export const createWorkspaceStoragePlan = (data: WorkspaceData, signatures: ReadonlyMap<string, string>, storedIds: readonly string[]) => {
  const nextSignatures = new Map(data.tables.map((table) => [table.id, tableStorageSignature(table)]));
  const currentIds = new Set(nextSignatures.keys());
  return {
    meta: { version: data.version, nodes: data.nodes, activeNodeId: data.activeNodeId, bottomNavigationTableIds: data.bottomNavigationTableIds ?? [] } satisfies WorkspaceMetadata,
    upserts: data.tables.filter((table) => signatures.get(table.id) !== nextSignatures.get(table.id)),
    deletes: storedIds.filter((id) => !currentIds.has(id)),
    signatures: nextSignatures,
  };
};

export const loadWorkspace = async (): Promise<WorkspaceData> => {
  if (!database) return emptyWorkspace();
  await saveQueue.catch(() => undefined);
  const db = await database;
  const meta = await db.get('meta', META_KEY);
  if (meta) {
    const loaded = normalizeWorkspace({ ...meta, tables: await db.getAll('tables') });
    // Keep immutable snapshots. Only changed tables need serialization when saving.
    savedTables = new Map(loaded.tables.map((table) => [table.id, table]));
    savedTableSignatures = new Map();
    return loaded;
  }

  const legacy = await db.get('state', STATE_KEY);
  const loaded = normalizeWorkspace(legacy ?? emptyWorkspace());
  savedTableSignatures = new Map();
  savedTables = new Map();
  await saveWorkspace(loaded);
  await db.delete('state', STATE_KEY);
  return loaded;
};

export const saveWorkspace = (data: WorkspaceData) => {
  if (!database) return Promise.resolve();
  const pending = saveQueue.catch(() => undefined).then(async () => {
    const db = await database;
    const storedIds = (await db.getAllKeys('tables')).map(String);
    const changedTables = data.tables.filter((table) => savedTables.get(table.id) !== table);
    for (const table of changedTables) {
      const previous = savedTables.get(table.id);
      if (previous && !savedTableSignatures.has(table.id)) savedTableSignatures.set(table.id, tableStorageSignature(previous));
    }
    const changedPlan = createWorkspaceStoragePlan({ ...data, tables: changedTables }, savedTableSignatures, []);
    const currentIds = new Set(data.tables.map((table) => table.id));
    const plan = { ...changedPlan, deletes: storedIds.filter((id) => !currentIds.has(id)) };
    const transaction = db.transaction(['meta', 'tables'], 'readwrite');
    await transaction.objectStore('meta').put(plan.meta, META_KEY);
    await Promise.all([
      ...plan.upserts.map((table) => transaction.objectStore('tables').put(table, table.id)),
      ...plan.deletes.map((id) => transaction.objectStore('tables').delete(id)),
    ]);
    await transaction.done;
    for (const [id, signature] of plan.signatures) savedTableSignatures.set(id, signature);
    for (const id of plan.deletes) savedTableSignatures.delete(id);
    savedTables = new Map(data.tables.map((table) => [table.id, table]));
  });
  saveQueue = pending;
  return pending;
};

export const flushWorkspaceSaves = () => saveQueue;

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
};
