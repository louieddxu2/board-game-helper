import type { IDBPDatabase } from 'idb';
import { isWorkspaceHistoryEntry, pruneWorkspaceTableHistory, workspaceHistoryLimit, workspaceHistoryRetentionMs, type WorkspaceTableHistory, type WorkspaceTableHistoryEntry, type WorkspaceTableHistoryView, type WorkspaceHistoryReference } from './history';
import { WorkspaceStorageIntegrityError } from './rowChunkStorage';
import type { WorkspaceDb, WorkspaceMetadata, WorkspaceStorageState, WorkspaceWriteTransaction } from './workspaceDbSchema';
import { decodeHistoryHead, historyReferenceOf, isHistoryHead, validateHistoryEntry, validateHistoryReference, type StoredHistoryReference } from './workspaceHistoryRecords';
import { yieldWorkspaceTask } from './workspaceCooperativeWork';

export interface WorkspaceHistoryStorageChanges {
  clearAll?: boolean;
  deleteTableIds?: readonly string[];
  replace?: readonly WorkspaceTableHistoryView[];
  /** Early edits are merged by ID without replacing unread disk history. */
  append?: readonly WorkspaceTableHistoryEntry[];
}
export interface WorkspaceHistoryReadContext {
  checkCurrent: () => void;
  checkVersion: (state: WorkspaceMetadata | WorkspaceStorageState | undefined) => void;
}
const tableRange = (id: string) => IDBKeyRange.bound([id, ''], [id, '\uffff']);
const pruneReferences = (entries: StoredHistoryReference[]) => entries.filter(entry => Date.now() - entry.createdAt <= workspaceHistoryRetentionMs).slice(-workspaceHistoryLimit);

const writeHistory = async (transaction: WorkspaceWriteTransaction, tableId: string, change: { replace?: WorkspaceTableHistoryView; append?: WorkspaceTableHistoryEntry[] }) => {
  const store = transaction.objectStore('history');
  const entries = transaction.objectStore('historyEntries');
  const previous = await store.get(tableId);
  if (previous) decodeHistoryHead(tableId, previous);
  const previousPast = previous?.past.map(historyReferenceOf) ?? [];
  const previousFuture = previous?.future.map(historyReferenceOf) ?? [];
  const previousById = new Map([...previousPast, ...previousFuture].map(entry => [entry.id, entry]));
  const legacyEntries = previous && !isHistoryHead(previous) ? [...previous.past, ...previous.future] : [];
  const incoming = change.replace ? [...change.replace.past, ...change.replace.future] : change.append ?? [];
  for (const entry of incoming) {
    validateHistoryReference(entry, tableId);
    const stored = previousById.get(entry.id);
    if (stored && stored.createdAt !== entry.createdAt) throw new WorkspaceStorageIntegrityError(`Changed history identity: ${tableId}`);
    if (isWorkspaceHistoryEntry(entry)) validateHistoryEntry(entry, tableId, entry);
    else if (!stored) throw new WorkspaceStorageIntegrityError(`Unknown history reference: ${tableId}`);
  }
  const past = pruneReferences(change.replace ? change.replace.past.map(historyReferenceOf) : [...new Map([...previousPast, ...incoming.map(historyReferenceOf)].map(entry => [entry.id, entry])).values()]);
  const future = pruneReferences(change.replace?.future.map(historyReferenceOf) ?? []);
  const nextIds = new Set([...past, ...future].map(entry => entry.id));
  if (nextIds.size !== past.length + future.length) throw new WorkspaceStorageIntegrityError(`Duplicate history entry: ${tableId}`);
  // Directory-only entries refer to existing bodies; only new actions need a payload write.
  const writes = new Map([...legacyEntries, ...incoming.filter(isWorkspaceHistoryEntry)].filter(entry => nextIds.has(entry.id) && (legacyEntries.length || !previousById.has(entry.id))).map(entry => [entry.id, entry]));
  await Promise.all([
    ...[...writes.values()].map(entry => entries.put(entry, [tableId, entry.id])),
    ...[...previousById.keys()].filter(id => !nextIds.has(id)).map(id => entries.delete([tableId, id])),
    nextIds.size ? store.put({ storageFormat: 'history-entries-v1', tableId, past, future }, tableId) : store.delete(tableId),
  ]);
};

/** Identity baselines avoid rewriting directories belonging to unchanged tables. */
export class WorkspaceHistoryStorage {
  private saved = new Map<string, WorkspaceTableHistoryView>();
  reset() { this.saved.clear(); }
  rememberRead(history: WorkspaceTableHistoryView) { this.saved.set(history.tableId, history); }
  async writeChanges(transaction: WorkspaceWriteTransaction, changes: WorkspaceHistoryStorageChanges | undefined, removedIds: readonly string[] = []) {
    if (changes?.clearAll) await Promise.all([transaction.objectStore('history').clear(), transaction.objectStore('historyEntries').clear()]);
    for (const id of new Set([...removedIds, ...(changes?.deleteTableIds ?? [])])) await Promise.all([transaction.objectStore('history').delete(id), transaction.objectStore('historyEntries').delete(tableRange(id))]);
    for (const history of changes?.replace ?? []) if (changes?.clearAll || changes?.deleteTableIds?.includes(history.tableId) || this.saved.get(history.tableId) !== history) await writeHistory(transaction, history.tableId, { replace: pruneWorkspaceTableHistory(history) });
    const pending = new Map<string, WorkspaceTableHistoryEntry[]>();
    for (const entry of changes?.append ?? []) pending.set(entry.tableId, [...(pending.get(entry.tableId) ?? []), entry]);
    for (const [tableId, append] of pending) await writeHistory(transaction, tableId, { append });
  }
  rememberSaved(changes: WorkspaceHistoryStorageChanges | undefined, removedIds: readonly string[] = []) {
    if (changes?.clearAll) this.saved.clear();
    for (const id of [...removedIds, ...(changes?.deleteTableIds ?? [])]) this.saved.delete(id);
    for (const history of changes?.replace ?? []) this.saved.set(history.tableId, history);
    for (const entry of changes?.append ?? []) this.saved.delete(entry.tableId);
  }
}

/** Read one compact directory and verify retained keys without cloning any action body. */
export const readWorkspaceHistoryHead = async (db: IDBPDatabase<WorkspaceDb>, tableId: string, context: WorkspaceHistoryReadContext) => {
  context.checkCurrent();
  const transaction = db.transaction(['meta', 'history'], 'readonly');
  const [state, record] = await Promise.all([transaction.objectStore('meta').get('storage'), transaction.objectStore('history').get(tableId)]);
  await transaction.done;
  context.checkVersion(state);
  const history = decodeHistoryHead(tableId, record);
  const legacy = Boolean(record && !isHistoryHead(record));
  if (!legacy) {
    const references = [...history.past, ...history.future];
    for (let offset = 0; offset < references.length; offset += 8) {
      context.checkCurrent();
      const batch = db.transaction(['meta', 'historyEntries'], 'readonly');
      const [version, keys] = await Promise.all([batch.objectStore('meta').get('storage'), Promise.all(references.slice(offset, offset + 8).map(entry => batch.objectStore('historyEntries').getKey([tableId, entry.id])))]);
      await batch.done;
      context.checkVersion(version);
      if (keys.some(key => !key)) throw new WorkspaceStorageIntegrityError(`Missing history entry: ${tableId}`);
      if (offset + 8 < references.length) await yieldWorkspaceTask();
    }
  }
  return { history, legacy };
};

export const readWorkspaceHistoryEntry = async (db: IDBPDatabase<WorkspaceDb>, tableId: string, reference: WorkspaceHistoryReference, context: WorkspaceHistoryReadContext) => {
  validateHistoryReference(reference, tableId);
  context.checkCurrent();
  const transaction = db.transaction(['meta', 'historyEntries'], 'readonly');
  const [state, entry] = await Promise.all([transaction.objectStore('meta').get('storage'), transaction.objectStore('historyEntries').get([tableId, reference.id])]);
  await transaction.done;
  context.checkVersion(state);
  return validateHistoryEntry(entry, tableId, reference);
};

/** Compatibility/export callers explicitly request complete histories. The UI uses directories. */
export const readWorkspaceHistories = async (db: IDBPDatabase<WorkspaceDb>, context: WorkspaceHistoryReadContext) => {
  const transaction = db.transaction(['meta', 'history', 'historyEntries'], 'readonly');
  const [state, records] = await Promise.all([transaction.objectStore('meta').get('storage'), transaction.objectStore('history').getAll()]);
  const loaded = await Promise.all(records.map(async record => {
    const history = decodeHistoryHead(record.tableId, record);
    if (!isHistoryHead(record)) return history as WorkspaceTableHistory;
    const entries = await transaction.objectStore('historyEntries').getAll(tableRange(record.tableId));
    const byId = new Map(entries.map(entry => [entry.id, entry]));
    const resolve = (references: WorkspaceHistoryReference[]) => references.map(reference => validateHistoryEntry(byId.get(reference.id), record.tableId, reference));
    return { tableId: history.tableId, past: resolve(history.past), future: resolve(history.future) };
  }));
  await transaction.done;
  context.checkVersion(state);
  return { histories: new Map(loaded.map(history => [history.tableId, history])), legacyIds: records.filter(record => !isHistoryHead(record)).map(record => record.tableId) };
};
