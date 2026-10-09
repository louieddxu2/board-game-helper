import type { DBSchema, IDBPTransaction } from 'idb';
import type { WorkspaceTableHistory, WorkspaceTableHistoryEntry } from './history';
import type { StoredHistoryHead } from './workspaceHistoryRecords';
import type { StoredWorkspaceRowChunk, StoredWorkspaceTable, StoredWorkspaceTableState } from './rowChunkStorage';
import type { WorkspaceRowPage, WorkspaceTableHead } from './rowPages';
import type { StoredWorkspaceRowOrderPage } from './rowOrderStorage';
import type { WorkspaceData, WorkspaceNode, WorkspaceTable } from './types';

export type WorkspaceMetadata = {
  version: WorkspaceData['version']; structureRevision?: string; nodes: WorkspaceNode[];
  activeNodeId: string | null; bottomNavigationTableIds?: string[];
};
export type WorkspaceStorageState = { storageRevision: string; updatedAt?: number };
export interface WorkspaceDb extends DBSchema {
  state: { key: string; value: WorkspaceData };
  meta: { key: string; value: WorkspaceMetadata | WorkspaceStorageState };
  tables: { key: string; value: WorkspaceTable | StoredWorkspaceTable };
  tableState: { key: string; value: StoredWorkspaceTableState };
  rowChunks: { key: [string, string]; value: StoredWorkspaceRowChunk };
  rowOrderPages: { key: [string, string]; value: StoredWorkspaceRowOrderPage };
  tableHeads: { key: string; value: WorkspaceTableHead };
  rowPages: { key: [string, number | string]; value: WorkspaceRowPage };
  history: { key: string; value: WorkspaceTableHistory | StoredHistoryHead };
  historyEntries: { key: [string, string]; value: WorkspaceTableHistoryEntry };
}
export const workspaceDbStores = ['state', 'meta', 'tables', 'tableState', 'rowChunks', 'rowOrderPages', 'tableHeads', 'rowPages', 'history', 'historyEntries'] as const;
export type WorkspaceWriteTransaction = IDBPTransaction<WorkspaceDb, typeof workspaceDbStores[number][], 'readwrite'>;
