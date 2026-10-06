import type { WorkspaceRow, WorkspaceTable } from './types';
import type { WorkspaceTableDefinition, WorkspaceTableStorageSnapshot } from './rowChunkStorage';
import { WorkspaceStorageIntegrityError } from './rowChunkStorage';

export const workspaceRowPageSize = 128;
export interface WorkspaceTableHead {
  format: 'row-pages-v1';
  definition: WorkspaceTableDefinition;
  rowCount: number;
  pageSize: typeof workspaceRowPageSize;
  layoutRevision: string;
  updatedAt: number;
  changeRevision?: string;
}
export interface WorkspaceRowPage {
  tableId: string;
  index: number;
  layoutRevision: string;
  rows: WorkspaceRow[];
}
/** Read-only projection. It deliberately does not implement WorkspaceTable. */
export interface WorkspaceTableWindow {
  head: WorkspaceTableHead;
  pages: WorkspaceRowPage[];
}
export const initialWorkspaceRowPages = (head: WorkspaceTableHead, scrollTop: number, viewportHeight: number): number[] => {
  if (!head.rowCount) return [];
  const top = Math.min(Math.max(0, scrollTop), Math.max(0, head.rowCount * 36 - viewportHeight));
  const firstRow = Math.floor(top / 36);
  const first = Math.floor(Math.max(0, firstRow - 6) / head.pageSize);
  const last = Math.min(Math.ceil(head.rowCount / head.pageSize) - 1, Math.floor((firstRow + Math.ceil(viewportHeight / 36) + 6) / head.pageSize));
  return Array.from({ length: last - first + 1 }, (_, offset) => first + offset);
};
export const validateWorkspaceTableHead = (tableId: string, head: WorkspaceTableHead) => {
  if (head.format !== 'row-pages-v1' || head.definition?.id !== tableId || head.pageSize !== workspaceRowPageSize
    || !Number.isSafeInteger(head.rowCount) || head.rowCount < 0 || head.rowCount >= 2 ** 31
    || !head.layoutRevision || !Array.isArray(head.definition.columns)) {
    throw new WorkspaceStorageIntegrityError(`Invalid table head: ${tableId}`);
  }
  return head;
};
const readOnlyProjection = Symbol('workspace-read-only-window');
export const assertWorkspaceTableComplete = (table: WorkspaceTable) => {
  if (readOnlyProjection in table) throw new WorkspaceStorageIntegrityError('A table window cannot be saved or exported as a complete table');
};

export const planWorkspaceRowPages = (
  snapshot: WorkspaceTableStorageSnapshot,
  previous: WorkspaceTableStorageSnapshot | undefined,
  savedHead: WorkspaceTableHead | undefined,
  layoutRevision: string,
) => {
  const rebuild = !savedHead || !previous || previous.record.rowOrder !== snapshot.record.rowOrder;
  const head: WorkspaceTableHead = {
    format: 'row-pages-v1', definition: snapshot.record.definition,
    rowCount: snapshot.table.rows.length, pageSize: workspaceRowPageSize,
    layoutRevision: rebuild ? layoutRevision : savedHead.layoutRevision,
    updatedAt: snapshot.table.updatedAt, changeRevision: snapshot.table.changeRevision,
  };
  const indices = new Set<number>();
  if (rebuild) {
    for (let index = 0; index < Math.ceil(head.rowCount / workspaceRowPageSize); index++) indices.add(index);
  } else {
    for (const [chunkId, chunk] of snapshot.chunks) {
      const before = previous.chunks.get(chunkId);
      if (before === chunk) continue;
      chunk.rows.forEach((row, slot) => {
        if (before?.rows[slot] === row) return;
        const index = snapshot.rowIndexes.get(row.id);
        if (index !== undefined) indices.add(Math.floor(index / workspaceRowPageSize));
      });
    }
  }
  const pages: WorkspaceRowPage[] = [...indices].map(index => ({
    tableId: snapshot.table.id, index, layoutRevision: head.layoutRevision,
    rows: snapshot.table.rows.slice(index * workspaceRowPageSize, (index + 1) * workspaceRowPageSize),
  }));
  return { head, pages, rebuild };
};

export const validateWorkspaceRowPage = (head: WorkspaceTableHead, index: number, page: WorkspaceRowPage | undefined) => {
  const expected = Math.min(head.pageSize, head.rowCount - index * head.pageSize);
  if (!page || page.tableId !== head.definition.id || page.index !== index
    || page.layoutRevision !== head.layoutRevision || expected <= 0 || !Array.isArray(page.rows) || page.rows.length !== expected
    || new Set(page.rows.map(row => row.id)).size !== page.rows.length
    || page.rows.some(row => !row.id || !row.values || typeof row.values !== 'object')) {
    throw new WorkspaceStorageIntegrityError(`Invalid row page: ${head.definition.id}/${index}`);
  }
  return page;
};

const pendingRows = new WeakSet<WorkspaceRow>();
export const createPendingWorkspaceRow = (index: number): WorkspaceRow => {
  const row: WorkspaceRow = { id: `pending-workspace-row-${index}`, name: null, values: {} };
  pendingRows.add(row);
  return row;
};
export const isPendingWorkspaceRow = (row: WorkspaceRow) => pendingRows.has(row);

/** Used by display code only. Never include the result in WorkspaceData.tables. */
export const workspaceWindowDisplayTable = (window: WorkspaceTableWindow): WorkspaceTable => Object.assign({
  ...window.head.definition, updatedAt: window.head.updatedAt, changeRevision: window.head.changeRevision,
  rows: window.pages.flatMap(page => page.rows),
}, { [readOnlyProjection]: true });
