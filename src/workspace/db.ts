import { openDB, type DBSchema } from 'idb';
import { emptyWorkspace, normalizeWorkspace } from './model';
import type { WorkspaceData, WorkspaceNode, WorkspaceTable } from './types';

type WorkspaceMetadata = {
  version: WorkspaceData['version'];
  nodes: WorkspaceNode[];
  activeNodeId: string | null;
};

interface WorkspaceDb extends DBSchema {
  state: { key: string; value: WorkspaceData };
  meta: { key: string; value: WorkspaceMetadata };
  tables: { key: string; value: WorkspaceTable };
}

const DATABASE_NAME = 'board-game-helper-workspace';
const STATE_KEY = 'workspace';
const META_KEY = 'workspace';

const database = typeof indexedDB === 'undefined'
  ? null
  : openDB<WorkspaceDb>(DATABASE_NAME, 2, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('state')) db.createObjectStore('state');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('tables')) db.createObjectStore('tables');
    },
  });

let saveQueue: Promise<void> = Promise.resolve();
let savedTableSignatures = new Map<string, string>();

export const tableStorageSignature = (table: WorkspaceTable) => JSON.stringify(table);

export const createWorkspaceStoragePlan = (data: WorkspaceData, signatures: ReadonlyMap<string, string>, storedIds: readonly string[]) => {
  const nextSignatures = new Map(data.tables.map((table) => [table.id, tableStorageSignature(table)]));
  const currentIds = new Set(nextSignatures.keys());
  return {
    meta: { version: data.version, nodes: data.nodes, activeNodeId: data.activeNodeId } satisfies WorkspaceMetadata,
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
    savedTableSignatures = new Map(loaded.tables.map((table) => [table.id, tableStorageSignature(table)]));
    return loaded;
  }

  const legacy = await db.get('state', STATE_KEY);
  const loaded = normalizeWorkspace(legacy ?? emptyWorkspace());
  savedTableSignatures = new Map();
  await saveWorkspace(loaded);
  await db.delete('state', STATE_KEY);
  return loaded;
};

export const saveWorkspace = (data: WorkspaceData) => {
  if (!database) return Promise.resolve();
  const pending = saveQueue.catch(() => undefined).then(async () => {
    const db = await database;
    const storedIds = (await db.getAllKeys('tables')).map(String);
    const plan = createWorkspaceStoragePlan(data, savedTableSignatures, storedIds);
    const transaction = db.transaction(['meta', 'tables'], 'readwrite');
    await transaction.objectStore('meta').put(plan.meta, META_KEY);
    await Promise.all([
      ...plan.upserts.map((table) => transaction.objectStore('tables').put(table, table.id)),
      ...plan.deletes.map((id) => transaction.objectStore('tables').delete(id)),
    ]);
    await transaction.done;
    savedTableSignatures = plan.signatures;
  });
  saveQueue = pending;
  return pending;
};

export const flushWorkspaceSaves = () => saveQueue;

export const clearWorkspace = async () => {
  if (!database) return;
  await saveQueue.catch(() => undefined);
  const db = await database;
  const transaction = db.transaction(['state', 'meta', 'tables'], 'readwrite');
  await Promise.all([
    transaction.objectStore('state').clear(),
    transaction.objectStore('meta').clear(),
    transaction.objectStore('tables').clear(),
  ]);
  await transaction.done;
  savedTableSignatures = new Map();
};
