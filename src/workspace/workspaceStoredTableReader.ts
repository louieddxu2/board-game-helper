import type { IDBPDatabase } from 'idb';
import type { WorkspaceDb, WorkspaceStorageState } from './workspaceDbSchema';
import { isChunkedWorkspaceTable, WorkspaceStorageIntegrityError, type StoredWorkspaceRowChunk } from './rowChunkStorage';
import type { StoredWorkspaceRowOrderPage } from './rowOrderStorage';
import { hydrateWorkspaceTable } from './workspaceTableHydration';

export interface WorkspaceStoredReadContext {
  checkCurrent(): void;
  checkVersion(state: WorkspaceDb['meta']['value'] | undefined): void;
}
export const workspaceStorageState = (value: WorkspaceDb['meta']['value'] | undefined): WorkspaceStorageState | undefined => value && 'storageRevision' in value ? value : undefined;
const tableRange = (id: string) => IDBKeyRange.bound([id, ''], [id, '\uffff']);

/** Both hydration and transient backups validate the same bounded canonical reads. */
export const readWorkspaceStoredTable = async (db: IDBPDatabase<WorkspaceDb>, id: string, context: WorkspaceStoredReadContext, deferStartupWork = false) => {
  context.checkCurrent();
  const manifest = db.transaction(['meta', 'tables', 'tableState', 'tableHeads', 'rowChunks', 'rowOrderPages'], 'readonly');
  const [version, record, state, head] = await Promise.all([manifest.objectStore('meta').get('storage'), manifest.objectStore('tables').get(id), manifest.objectStore('tableState').get(id), manifest.objectStore('tableHeads').get(id)]);
  const counts = record && isChunkedWorkspaceTable(record) ? await Promise.all([
    manifest.objectStore('rowChunks').count(tableRange(id)),
    record.storageFormat === 'row-chunks-v2' ? manifest.objectStore('rowOrderPages').count(tableRange(id)) : undefined,
  ]) : undefined;
  await manifest.done;
  context.checkVersion(version);
  if (!record) throw new WorkspaceStorageIntegrityError(`Missing table: ${id}`);
  if (counts && isChunkedWorkspaceTable(record) && (counts[0] !== record.chunkIds?.length || (record.storageFormat === 'row-chunks-v2' && counts[1] !== record.orderPageIds?.length))) throw new WorkspaceStorageIntegrityError(`Unexpected table records: ${id}`);
  const readBatch = async <T>(store: 'rowChunks' | 'rowOrderPages', keys: readonly string[]): Promise<T[]> => {
    context.checkCurrent();
    const batch = db.transaction(['meta', store], 'readonly');
    const [revision, rows] = await Promise.all([batch.objectStore('meta').get('storage'), Promise.all(keys.map(key => batch.objectStore(store).get([id, key])))]);
    await batch.done;
    context.checkVersion(revision);
    return rows.map(row => { if (!row) throw new WorkspaceStorageIntegrityError(`Missing ${store}: ${id}`); return row as T; });
  };
  return { head, ...await hydrateWorkspaceTable(id, record, state, {
    chunks: keys => readBatch<StoredWorkspaceRowChunk>('rowChunks', keys),
    order: keys => readBatch<StoredWorkspaceRowOrderPage>('rowOrderPages', keys),
  }, context.checkCurrent, deferStartupWork) };
};
