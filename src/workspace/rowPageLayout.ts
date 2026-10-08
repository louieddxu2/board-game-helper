import type { WorkspaceRow } from './types';
import { WorkspaceStorageIntegrityError, type WorkspaceTableDefinition } from './rowChunkStorage';

export const workspaceRowPageSize = 128;
export const workspaceRowBlockCapacity = 256;
export const workspaceRowBlockSplitThreshold = 192;
interface TableHeadBase {
  definition: WorkspaceTableDefinition;
  rowCount: number;
  layoutRevision: string;
  updatedAt: number;
  changeRevision?: string;
}
export interface LegacyWorkspaceTableHead extends TableHeadBase {
  format: 'row-pages-v1';
  pageSize: typeof workspaceRowPageSize;
  pageRevisions?: string[];
}
export interface WorkspaceRowBlockDescriptor { id: string; count: number; revision: string }
export interface WorkspaceBlockTableHead extends TableHeadBase {
  format: 'row-blocks-v1';
  blocks: WorkspaceRowBlockDescriptor[];
}
export type WorkspaceTableHead = LegacyWorkspaceTableHead | WorkspaceBlockTableHead;
export interface LegacyWorkspaceRowPage { tableId: string; index: number; layoutRevision: string; rows: WorkspaceRow[] }
export interface WorkspaceRowBlock { tableId: string; id: string; layoutRevision: string; rows: WorkspaceRow[] }
export type WorkspaceRowPage = LegacyWorkspaceRowPage | WorkspaceRowBlock;
/** Read-only projection. It deliberately does not implement WorkspaceTable. */
export interface WorkspaceTableWindow { head: WorkspaceTableHead; pages: WorkspaceRowPage[] }

const starts = new WeakMap<WorkspaceTableHead, number[]>();
const pageStarts = (head: WorkspaceTableHead) => {
  let offsets = starts.get(head);
  if (!offsets) {
    offsets = [0];
    if (head.format === 'row-blocks-v1') for (const block of head.blocks) offsets.push(offsets.at(-1)! + block.count);
    else for (let index = 0; index < Math.ceil(head.rowCount / head.pageSize); index++) offsets.push(Math.min(head.rowCount, (index + 1) * head.pageSize));
    starts.set(head, offsets);
  }
  return offsets;
};
export const workspaceRowPageCount = (head: WorkspaceTableHead) => pageStarts(head).length - 1;
export const workspaceRowPageOffset = (head: WorkspaceTableHead, index: number) => pageStarts(head)[index];
export const workspaceRowPageKey = (head: WorkspaceTableHead, index: number): string | number => head.format === 'row-blocks-v1' ? head.blocks[index].id : index;
export const workspaceRowPageStorageKey = (page: WorkspaceRowPage): string | number => 'id' in page ? page.id : page.index;
export const workspaceRowPageIndex = (head: WorkspaceTableHead, page: WorkspaceRowPage) => head.format === 'row-blocks-v1'
  ? ('id' in page ? head.blocks.findIndex(block => block.id === page.id) : -1) : ('index' in page ? page.index : -1);
export const workspaceRowPageRevision = (head: WorkspaceTableHead, index: number) => head.format === 'row-blocks-v1' ? head.blocks[index]?.revision : head.pageRevisions?.[index] ?? head.layoutRevision;
export const workspaceRowPageAt = (head: WorkspaceTableHead, rowIndex: number) => {
  const offsets = pageStarts(head);
  let low = 0, high = offsets.length - 2;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (offsets[middle] <= rowIndex) low = middle; else high = middle - 1;
  }
  return high < 0 ? -1 : low;
};
export const initialWorkspaceRowPages = (head: WorkspaceTableHead, scrollTop: number, viewportHeight: number): number[] => {
  if (!head.rowCount) return [];
  const top = Math.min(Math.max(0, scrollTop), Math.max(0, head.rowCount * 36 - viewportHeight));
  const row = Math.floor(top / 36);
  const first = workspaceRowPageAt(head, Math.max(0, row - 6));
  const last = workspaceRowPageAt(head, Math.min(head.rowCount - 1, row + Math.ceil(viewportHeight / 36) + 6));
  return Array.from({ length: last - first + 1 }, (_, offset) => first + offset);
};
export const validateWorkspaceTableHead = (tableId: string, head: WorkspaceTableHead) => {
  const fail = () => { throw new WorkspaceStorageIntegrityError(`Invalid table head: ${tableId}`); };
  if (!head || head.definition?.id !== tableId || !Number.isSafeInteger(head.rowCount) || head.rowCount < 0 || head.rowCount >= 2 ** 31
    || !head.layoutRevision || !Array.isArray(head.definition.columns)) fail();
  if (head.format === 'row-pages-v1') {
    if (head.pageSize !== workspaceRowPageSize) fail();
    if (head.pageRevisions !== undefined && (!Array.isArray(head.pageRevisions) || head.pageRevisions.length !== Math.ceil(head.rowCount / head.pageSize)
      || Array.from(head.pageRevisions).some(revision => typeof revision !== 'string' || !revision))) fail();
  } else if (head.format === 'row-blocks-v1') {
    if (!Array.isArray(head.blocks)) fail();
    let count = 0;
    const ids = new Set<string>();
    for (const block of head.blocks) {
      if (!block || typeof block.id !== 'string' || !block.id || ids.has(block.id) || !Number.isSafeInteger(block.count)
        || block.count <= 0 || block.count > workspaceRowBlockCapacity || typeof block.revision !== 'string' || !block.revision) fail();
      ids.add(block.id); count += block.count;
    }
    if (count !== head.rowCount) fail();
  } else fail();
  return head;
};
export const workspaceRowPageMatchesHead = (head: WorkspaceTableHead, index: number, page: WorkspaceRowPage | undefined): page is WorkspaceRowPage => {
  if (!Number.isSafeInteger(index) || index < 0 || index >= workspaceRowPageCount(head)) return false;
  const expected = workspaceRowPageOffset(head, index + 1) - workspaceRowPageOffset(head, index);
  return Boolean(page && page.tableId === head.definition.id && workspaceRowPageStorageKey(page) === workspaceRowPageKey(head, index)
    && page.layoutRevision === workspaceRowPageRevision(head, index) && expected > 0 && Array.isArray(page.rows) && page.rows.length === expected);
};
export const validateWorkspaceRowPage = (head: WorkspaceTableHead, index: number, page: WorkspaceRowPage | undefined) => {
  if (!workspaceRowPageMatchesHead(head, index, page) || new Set(page.rows.map(row => row.id)).size !== page.rows.length
    || page.rows.some(row => !row.id || !row.values || typeof row.values !== 'object')) {
    throw new WorkspaceStorageIntegrityError(`Invalid row page: ${head.definition.id}/${index}`);
  }
  return page;
};
