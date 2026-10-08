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
  /** Expected content version for each page; omitted by legacy v5 heads. */
  pageRevisions?: string[];
  updatedAt: number;
  changeRevision?: string;
}
export interface WorkspaceRowPage {
  tableId: string;
  index: number;
  /** Legacy field name, now the version of this page's content. */
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
  if (head.pageRevisions !== undefined) {
    if (!Array.isArray(head.pageRevisions) || head.pageRevisions.length !== Math.ceil(head.rowCount / head.pageSize)) {
      throw new WorkspaceStorageIntegrityError(`Invalid page versions: ${tableId}`);
    }
    for (const revision of head.pageRevisions) if (typeof revision !== 'string' || !revision) {
      throw new WorkspaceStorageIntegrityError(`Invalid page version: ${tableId}`);
    }
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
  revision: string,
) => {
  if (savedHead) validateWorkspaceTableHead(snapshot.table.id, savedHead);
  const rebuild = !savedHead || !previous || previous.table.id !== snapshot.table.id || savedHead.rowCount !== previous.table.rows.length;
  const orderChanged = rebuild || previous.order !== snapshot.order;
  const pageCount = Math.ceil(snapshot.table.rows.length / workspaceRowPageSize);
  const head: WorkspaceTableHead = {
    format: 'row-pages-v1', definition: snapshot.record.definition,
    rowCount: snapshot.table.rows.length, pageSize: workspaceRowPageSize,
    layoutRevision: orderChanged ? revision : savedHead.layoutRevision,
    updatedAt: snapshot.table.updatedAt, changeRevision: snapshot.table.changeRevision,
  };
  const indices = new Set<number>();
  if (rebuild) {
    for (let index = 0; index < pageCount; index++) indices.add(index);
  } else if (orderChanged) {
    // Compare row references at display positions, without copying or inspecting cells.
    const first = snapshot.rowOrderChange?.beforeRows === previous.table.rows
      ? Math.floor(snapshot.rowOrderChange.from / workspaceRowPageSize) : 0;
    for (let index = first; index < pageCount; index++) {
      const start = index * workspaceRowPageSize;
      const end = Math.min(start + workspaceRowPageSize, head.rowCount);
      if (Math.min(start + workspaceRowPageSize, previous.table.rows.length) !== end) indices.add(index);
      else for (let slot = start; slot < end; slot++) if (snapshot.table.rows[slot] !== previous.table.rows[slot]) {
        indices.add(index);
        break;
      }
    }
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
  head.pageRevisions = Array.from({ length: pageCount }, (_, index) => indices.has(index)
    ? revision : workspaceRowPageRevision(savedHead!, index));
  const pages: WorkspaceRowPage[] = [...indices].map(index => ({
    tableId: snapshot.table.id, index, layoutRevision: head.pageRevisions![index],
    rows: snapshot.table.rows.slice(index * workspaceRowPageSize, (index + 1) * workspaceRowPageSize),
  }));
  const deletes = rebuild ? [] : Array.from({ length: Math.max(0, Math.ceil(savedHead.rowCount / workspaceRowPageSize) - pageCount) }, (_, offset) => pageCount + offset);
  return { head, pages, deletes, rebuild };
};

export const workspaceRowPageRevision = (head: WorkspaceTableHead, index: number) => head.pageRevisions?.[index] ?? head.layoutRevision;
export const workspaceRowPageMatchesHead = (head: WorkspaceTableHead, index: number, page: WorkspaceRowPage | undefined): page is WorkspaceRowPage => {
  const expected = Math.min(head.pageSize, head.rowCount - index * head.pageSize);
  return Number.isSafeInteger(index) && index >= 0 && Boolean(page && page.tableId === head.definition.id && page.index === index
    && page.layoutRevision === workspaceRowPageRevision(head, index) && expected > 0 && Array.isArray(page.rows) && page.rows.length === expected);
};

export const validateWorkspaceRowPage = (head: WorkspaceTableHead, index: number, page: WorkspaceRowPage | undefined) => {
  if (!workspaceRowPageMatchesHead(head, index, page)
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
