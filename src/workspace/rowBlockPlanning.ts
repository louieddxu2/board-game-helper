import { makeId } from './model';
import type { WorkspaceRow } from './types';
import type { WorkspaceTableStorageSnapshot } from './rowChunkStorage';
import {
  validateWorkspaceTableHead, workspaceRowBlockCapacity, workspaceRowPageAt, workspaceRowPageOffset, workspaceRowPageSize,
  type WorkspaceBlockTableHead, type WorkspaceRowBlock, type WorkspaceRowBlockDescriptor, type WorkspaceTableHead,
} from './rowPageLayout';

export interface WorkspaceRowPagePlan { head: WorkspaceBlockTableHead; pages: WorkspaceRowBlock[]; deletes: string[]; rebuild: boolean }

/** Keep the longest unchanged subsequence; a moved row belongs to its destination block. */
const retainedRowIds = (rows: readonly WorkspaceRow[], previous: WorkspaceTableStorageSnapshot) => {
  const tails: number[] = [], links: number[] = [];
  rows.forEach((row, position) => {
    const index = previous.rowIndexes.get(row.id);
    if (index === undefined) return;
    let low = 0, high = tails.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (previous.rowIndexes.get(rows[tails[middle]].id)! < index) low = middle + 1; else high = middle;
    }
    links[position] = low ? tails[low - 1] : -1;
    tails[low] = position;
  });
  const ids = new Set<string>();
  for (let position = tails.at(-1) ?? -1; position >= 0; position = links[position]) ids.add(rows[position].id);
  return ids;
};

const changedGroups = (snapshot: WorkspaceTableStorageSnapshot, previous: WorkspaceTableStorageSnapshot, head: WorkspaceBlockTableHead) => {
  const groups = new Map<number, WorkspaceRow[]>();
  const delta = snapshot.table.rows.length - previous.table.rows.length;
  if (snapshot.rowOrderChange?.beforeRows === previous.table.rows && (delta === 1 || delta === -1) && head.blocks.length) {
    const index = snapshot.rowOrderChange.from;
    const block = workspaceRowPageAt(head, Math.min(index, previous.table.rows.length - 1));
    const start = workspaceRowPageOffset(head, block);
    groups.set(block, snapshot.table.rows.slice(start, start + head.blocks[block].count + delta));
    return groups;
  }
  if (snapshot.order === previous.order) {
    for (const [id, chunk] of snapshot.chunks) {
      const before = previous.chunks.get(id);
      if (before === chunk) continue;
      chunk.rows.forEach((row, slot) => {
        if (before?.rows[slot] === row) return;
        const position = snapshot.rowIndexes.get(row.id)!;
        const block = workspaceRowPageAt(head, position);
        if (!groups.has(block)) groups.set(block, snapshot.table.rows.slice(workspaceRowPageOffset(head, block), workspaceRowPageOffset(head, block + 1)));
      });
    }
    return groups;
  }
  const retained = retainedRowIds(snapshot.table.rows, previous);
  const first = snapshot.table.rows.find(row => retained.has(row.id));
  let block = first ? workspaceRowPageAt(head, previous.rowIndexes.get(first.id)!) : 0;
  snapshot.table.rows.forEach(row => {
    if (retained.has(row.id)) block = workspaceRowPageAt(head, previous.rowIndexes.get(row.id)!);
    let rows = groups.get(block);
    if (!rows) { rows = []; groups.set(block, rows); }
    rows.push(row);
  });
  head.blocks.forEach((_, index) => { if (!groups.has(index)) groups.set(index, []); });
  return groups;
};

export const planWorkspaceRowPages = (snapshot: WorkspaceTableStorageSnapshot, previous: WorkspaceTableStorageSnapshot | undefined, savedHead: WorkspaceTableHead | undefined, revision: string): WorkspaceRowPagePlan => {
  if (savedHead) validateWorkspaceTableHead(snapshot.table.id, savedHead);
  const rebuild = !previous || !savedHead || savedHead.format !== 'row-blocks-v1' || previous.table.id !== snapshot.table.id || savedHead.rowCount !== previous.table.rows.length;
  const pages: WorkspaceRowBlock[] = [], blocks: WorkspaceRowBlockDescriptor[] = [];
  const append = (rows: WorkspaceRow[], id = makeId('display')) => {
    blocks.push({ id, count: rows.length, revision });
    pages.push({ tableId: snapshot.table.id, id, layoutRevision: revision, rows });
  };
  if (rebuild) {
    for (let start = 0; start < snapshot.table.rows.length; start += workspaceRowPageSize) append(snapshot.table.rows.slice(start, start + workspaceRowPageSize));
  } else {
    const groups = changedGroups(snapshot, previous, savedHead);
    savedHead.blocks.forEach((block, index) => {
      const rows = groups.get(index);
      if (!rows) { blocks.push(block); return; }
      const start = workspaceRowPageOffset(savedHead, index);
      if (rows.length === block.count && rows.every((row, slot) => row === previous.table.rows[start + slot])) { blocks.push(block); return; }
      if (block.count === workspaceRowBlockCapacity && rows.length > block.count
        && rows.slice(0, block.count).every((row, slot) => row === previous.table.rows[start + slot])) {
        blocks.push(block);
        for (let offset = block.count; offset < rows.length; offset += workspaceRowPageSize) append(rows.slice(offset, offset + workspaceRowPageSize));
        return;
      }
      // Ordinary growth is allowed. Only overflow beyond the hard limit splits now.
      const count = Math.ceil(rows.length / workspaceRowBlockCapacity);
      const size = count ? Math.ceil(rows.length / count) : 0;
      for (let offset = 0; offset < rows.length; offset += size) append(rows.slice(offset, offset + size), offset ? undefined : block.id);
    });
    if (!savedHead.blocks.length && snapshot.table.rows.length) {
      for (let start = 0; start < snapshot.table.rows.length; start += workspaceRowPageSize) append(snapshot.table.rows.slice(start, start + workspaceRowPageSize));
    }
  }
  const ids = new Set(blocks.map(block => block.id));
  const deletes = !rebuild ? savedHead.blocks.filter(block => !ids.has(block.id)).map(block => block.id) : [];
  const layoutChanged = rebuild || snapshot.order !== previous.order || blocks.length !== savedHead.blocks.length
    || blocks.some((block, index) => block.id !== savedHead.blocks[index].id || block.count !== savedHead.blocks[index].count);
  return { rebuild, pages, deletes, head: {
    format: 'row-blocks-v1', definition: snapshot.record.definition, blocks, rowCount: snapshot.table.rows.length,
    layoutRevision: layoutChanged ? revision : savedHead.layoutRevision,
    updatedAt: snapshot.table.updatedAt, changeRevision: snapshot.table.changeRevision,
  } };
};
