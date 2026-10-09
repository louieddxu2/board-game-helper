import { isWorkspaceHistoryEntry, pruneWorkspaceTableHistory, type WorkspaceHistoryReference, type WorkspaceTableHistory, type WorkspaceTableHistoryEntry, type WorkspaceTableHistoryView } from './history';
import { WorkspaceStorageIntegrityError } from './rowChunkStorage';

export type StoredHistoryReference = { id: string; createdAt: number; label?: string };
export interface StoredHistoryHead {
  storageFormat: 'history-entries-v1'; tableId: string;
  past: StoredHistoryReference[]; future: StoredHistoryReference[];
}
export const isHistoryHead = (history: StoredHistoryHead | WorkspaceTableHistory): history is StoredHistoryHead => 'storageFormat' in history && history.storageFormat === 'history-entries-v1';
export const historyReferenceOf = ({ id, createdAt, label }: StoredHistoryReference): StoredHistoryReference => ({ id, createdAt, ...(label !== undefined ? { label } : {}) });

export const validateHistoryReference = (reference: StoredHistoryReference, tableId: string) => {
  if (!reference || typeof reference.id !== 'string' || !reference.id || !Number.isFinite(reference.createdAt)
    || (reference.label !== undefined && typeof reference.label !== 'string')) throw new WorkspaceStorageIntegrityError(`Invalid history reference: ${tableId}`);
};
export const validateHistoryEntry = (entry: WorkspaceTableHistoryEntry | undefined, tableId: string, reference: StoredHistoryReference): WorkspaceTableHistoryEntry => {
  if (!entry || !isWorkspaceHistoryEntry(entry) || entry.id !== reference.id || entry.tableId !== tableId
    || entry.createdAt !== reference.createdAt || typeof entry.label !== 'string' || !entry.action || typeof entry.action.type !== 'string') {
    throw new WorkspaceStorageIntegrityError(`Missing history entry: ${tableId}`);
  }
  return entry;
};
export const decodeHistoryHead = (tableId: string, record: StoredHistoryHead | WorkspaceTableHistory | undefined): WorkspaceTableHistoryView => {
  if (!record) return { tableId, past: [], future: [] };
  if (record.tableId !== tableId || !Array.isArray(record.past) || !Array.isArray(record.future)) throw new WorkspaceStorageIntegrityError(`Invalid history head: ${tableId}`);
  const ids = new Set<string>();
  const decode = (reference: StoredHistoryReference): WorkspaceHistoryReference => {
    validateHistoryReference(reference, tableId);
    if (ids.has(reference.id)) throw new WorkspaceStorageIntegrityError(`Duplicate history entry: ${tableId}`);
    ids.add(reference.id);
    if (!isHistoryHead(record)) return validateHistoryEntry(reference as WorkspaceTableHistoryEntry, tableId, reference);
    // Older directories have no label. Do not read a potentially large action for a tooltip.
    return { id: reference.id, createdAt: reference.createdAt, label: reference.label ?? '上一個操作' };
  };
  return pruneWorkspaceTableHistory({ tableId, past: record.past.map(decode), future: record.future.map(decode) });
};
