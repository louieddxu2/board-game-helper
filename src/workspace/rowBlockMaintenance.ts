import { makeId } from './model';
import type { WorkspaceTable } from './types';
import type { WorkspaceRowPagePlan } from './rowBlockPlanning';
import { validateWorkspaceTableHead, workspaceRowBlockSplitThreshold, workspaceRowPageOffset, workspaceRowPageSize, type WorkspaceBlockTableHead, type WorkspaceRowBlock, type WorkspaceRowBlockDescriptor } from './rowPageLayout';

/** One bounded group per step; unchanged blocks retain both identity and content version. */
export function* planWorkspaceRowBlockMaintenance(table: WorkspaceTable, head: WorkspaceBlockTableHead, revision: string): Generator<void, WorkspaceRowPagePlan | undefined> {
  validateWorkspaceTableHead(table.id, head);
  if (table.rows.length !== head.rowCount || table.changeRevision !== head.changeRevision) return;
  const blocks: WorkspaceRowBlockDescriptor[] = [], pages: WorkspaceRowBlock[] = [];
  const write = (id: string, start: number, count: number) => {
    blocks.push({ id, count, revision });
    pages.push({ tableId: table.id, id, layoutRevision: revision, rows: table.rows.slice(start, start + count) });
  };
  for (let index = 0; index < head.blocks.length; index++) {
    const block = head.blocks[index];
    const start = workspaceRowPageOffset(head, index);
    if (block.count > workspaceRowBlockSplitThreshold) {
      const first = Math.ceil(block.count / 2);
      write(block.id, start, first);
      write(makeId('display'), start + first, block.count - first);
    } else {
      let count = block.count, end = index;
      while (end + 1 < head.blocks.length && count + head.blocks[end + 1].count <= workspaceRowPageSize) {
        count += head.blocks[++end].count;
        // Long runs of tiny blocks also yield between candidates.
        yield;
      }
      if (end === index) blocks.push(block); else write(block.id, start, count);
      index = end;
    }
    yield;
  }
  if (!pages.length) return;
  const ids = new Set(blocks.map(block => block.id));
  return { rebuild: false, pages, deletes: head.blocks.filter(block => !ids.has(block.id)).map(block => block.id),
    head: { ...head, blocks, layoutRevision: revision } };
}
