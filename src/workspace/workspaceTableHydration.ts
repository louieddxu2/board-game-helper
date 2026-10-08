import { normalizeWorkspaceTableSteps } from './model';
import {
  assembleChunkedWorkspaceTableSteps, createWorkspaceTableStorageSnapshotSteps, isChunkedWorkspaceTable,
  WorkspaceStorageIntegrityError, type StoredWorkspaceRowChunk, type StoredWorkspaceTableState, type StoredWorkspaceTable,
} from './rowChunkStorage';
import type { StoredWorkspaceRowOrderPage } from './rowOrderStorage';
import type { WorkspaceTable } from './types';
import { runWorkspaceCooperativeSteps, yieldWorkspaceTask } from './workspaceCooperativeWork';

export const workspaceHydrationBatchSize = 2;
interface WorkspaceTableReader {
  chunks: (ids: readonly string[]) => Promise<StoredWorkspaceRowChunk[]>;
  order: (ids: readonly string[]) => Promise<StoredWorkspaceRowOrderPage[]>;
}
const validateIds = (tableId: string, ids: string[]) => {
  if (!Array.isArray(ids) || Array.from(ids).some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) {
    throw new WorkspaceStorageIntegrityError(`Invalid table manifest IDs: ${tableId}`);
  }
};
const collect = async <T>(ids: string[], read: (ids: readonly string[]) => Promise<T[]>, checkCurrent: () => void): Promise<T[]> => {
  const result: T[] = [];
  for (let start = 0; start < ids.length; start += workspaceHydrationBatchSize) {
    checkCurrent();
    result.push(...await read(ids.slice(start, start + workspaceHydrationBatchSize)));
    await yieldWorkspaceTask();
    checkCurrent();
  }
  return result;
};

/** Keep all intermediate rows/indexes local until the caller verifies the final revision. */
export const hydrateWorkspaceTable = async (tableId: string, record: WorkspaceTable | StoredWorkspaceTable, state: StoredWorkspaceTableState | undefined, read: WorkspaceTableReader, checkCurrent: () => void, deferStartupWork = false) => {
  let table: WorkspaceTable;
  let stored: { record: StoredWorkspaceTable; chunks: StoredWorkspaceRowChunk[]; orderPages: StoredWorkspaceRowOrderPage[]; state: StoredWorkspaceTableState | undefined } | undefined;
  if (isChunkedWorkspaceTable(record)) {
    validateIds(tableId, record.chunkIds);
    if (record.storageFormat === 'row-chunks-v2') validateIds(tableId, record.orderPageIds);
    const chunks = await collect(record.chunkIds, read.chunks, checkCurrent);
    const orderPages = record.storageFormat === 'row-chunks-v2' ? await collect(record.orderPageIds, read.order, checkCurrent) : [];
    table = await runWorkspaceCooperativeSteps(assembleChunkedWorkspaceTableSteps(tableId, record, state, chunks, orderPages), checkCurrent);
    stored = { record, chunks, orderPages, state };
  } else table = record;
  table = await runWorkspaceCooperativeSteps(normalizeWorkspaceTableSteps(table, { deferDynamicOptions: deferStartupWork }), checkCurrent);
  if (deferStartupWork) return { table, stored, snapshot: undefined };
  const snapshot = await runWorkspaceCooperativeSteps(createWorkspaceTableStorageSnapshotSteps(table, stored), checkCurrent);
  return { table, snapshot, stored };
};
