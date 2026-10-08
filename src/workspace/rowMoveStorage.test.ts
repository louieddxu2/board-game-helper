import { describe, expect, it } from 'vitest';
import { applyWorkspaceTableHistoryAction, type WorkspaceTableHistoryAction } from './history';
import {
  assembleChunkedWorkspaceTable,
  createWorkspaceTableStorageSnapshot,
  planWorkspaceTableStorageWrite,
  updateWorkspaceTableStorageSnapshot,
} from './rowChunkStorage';
import { createTable, emptyWorkspace } from './model';
import { planWorkspaceRowPages, type WorkspaceBlockTableHead } from './rowPages';
import { updateWorkspaceRowMoveStorage } from './rowMoveStorage';
import type { WorkspaceRow, WorkspaceTable } from './types';

const makeTable = (count: number): WorkspaceTable => {
  const table = createTable('列移動測試');
  const columnId = table.columns[0].id;
  return {
    ...table,
    rows: Array.from({ length: count }, (_, index) => ({
      id: `row-${index}`,
      name: `物件 ${index}`,
      values: { [columnId]: `值 ${index}` },
    })),
  };
};

const moveAction = (table: WorkspaceTable, from: number, to: number): WorkspaceTableHistoryAction => ({
  type: 'move-row', rowId: table.rows[from].id, beforeIndex: from, afterIndex: to,
});

const moveTable = (table: WorkspaceTable, action: WorkspaceTableHistoryAction) => {
  if (action.type !== 'move-row') throw new Error('Expected a row move');
  return applyWorkspaceTableHistoryAction({ ...emptyWorkspace(), tables: [table] }, table.id, action, 'redo').tables[0];
};

const firstHead = (table: WorkspaceTable) => {
  const snapshot = createWorkspaceTableStorageSnapshot(table);
  return planWorkspaceRowPages(snapshot, undefined, undefined, 'initial').head;
};

const customHead = (table: WorkspaceTable, counts: readonly number[]): WorkspaceBlockTableHead => {
  if (counts.reduce((sum, count) => sum + count, 0) !== table.rows.length) throw new Error('Invalid test counts');
  const head = firstHead(table);
  return {
    ...head,
    layoutRevision: 'custom-layout',
    blocks: counts.map((count, index) => ({ id: `block-${index}`, count, revision: `block-revision-${index}` })),
  };
};

const overlayDisplayRows = (head: WorkspaceBlockTableHead, pages: ReadonlyMap<string, WorkspaceRow[]>) =>
  head.blocks.flatMap(block => pages.get(block.id) ?? []);

const pageRowsFrom = (table: WorkspaceTable, head: WorkspaceBlockTableHead) => {
  const pages = new Map<string, WorkspaceRow[]>();
  head.blocks.forEach((block, index) => {
    const start = head.blocks.slice(0, index).reduce((sum, item) => sum + item.count, 0);
    pages.set(block.id, table.rows.slice(start, start + block.count));
  });
  return pages;
};

const applyDisplayPlan = (previous: ReadonlyMap<string, WorkspaceRow[]>, plan: ReturnType<typeof planWorkspaceRowPages>) => {
  const pages = new Map(previous);
  plan.deletes.forEach(id => pages.delete(id));
  plan.pages.forEach(page => pages.set(page.id, page.rows));
  return pages;
};

const planMove = (table: WorkspaceTable, from: number, to: number, head = firstHead(table)) => {
  const saved = createWorkspaceTableStorageSnapshot(table);
  const action = moveAction(table, from, to);
  const moved = moveTable(table, action);
  const next = updateWorkspaceRowMoveStorage(saved, moved, action, saved.record.definition);
  if (!next) throw new Error('Expected the shared move producer to certify this move');
  const storage = planWorkspaceTableStorageWrite(next, saved);
  const pages = planWorkspaceRowPages(next, saved, head, 'move-layout');
  const reopened = assembleChunkedWorkspaceTable(table.id, next.record, storage.state, [...next.chunks.values()], [...next.order.pages.values()]);
  return { action, moved, next, storage, pages, reopened };
};

describe('certified row move storage', () => {
  it('moves both ends of 10,000 rows and keeps same-page and boundary moves local', () => {
    const table = makeTable(10_000);
    for (const [from, to, displayPuts] of [[0, 9_999, 2], [9_999, 0, 2], [20, 30, 1], [127, 128, 2]] as const) {
      const result = planMove(table, from, to);
      expect(result.storage.upserts).toEqual([]);
      expect(result.storage.deletes).toEqual([]);
      expect(result.storage.orderUpserts.length).toBeLessThanOrEqual(3);
      expect(result.storage.orderDeletes.length).toBeLessThanOrEqual(1);
      expect(result.pages.pages).toHaveLength(displayPuts);
      expect(result.pages.pages.length).toBeLessThanOrEqual(3);
      expect(result.pages.deletes).toEqual([]);
      expect(result.reopened.rows.map(row => row.id)).toEqual(result.moved.rows.map(row => row.id));
    }
  });

  it('splits a full destination block within the bounded three-page display budget', () => {
    const table = makeTable(512);
    const head = customHead(table, [256, 256]);
    const result = planMove(table, 0, 511, head);

    expect(result.storage.upserts).toEqual([]);
    expect(result.storage.deletes).toEqual([]);
    expect(result.storage.orderUpserts.length).toBeLessThanOrEqual(3);
    expect(result.pages.pages.length).toBeLessThanOrEqual(3);
    expect(result.pages.pages.map(page => page.rows.length)).toEqual([255, 1]);
    expect(result.pages.head.blocks.map(block => block.count)).toEqual([255, 256, 1]);
    expect(result.reopened.rows.map(row => row.id)).toEqual(result.moved.rows.map(row => row.id));
  });

  it('deletes a one-row source block after moving its row into the preceding block', () => {
    const table = makeTable(257);
    const head = customHead(table, [128, 1, 128]);
    const result = planMove(table, 128, 0, head);

    expect(result.storage.upserts).toEqual([]);
    expect(result.pages.pages).toHaveLength(1);
    expect(result.pages.pages[0].id).toBe('block-0');
    expect(result.pages.deletes).toEqual(['block-1']);
    expect(result.pages.head.blocks.map(block => block.count)).toEqual([129, 128]);
    expect(result.reopened.rows.map(row => row.id)).toEqual(result.moved.rows.map(row => row.id));
  });

  it('keeps an unrecognized move with an extra cell edit lossless through generic reconciliation', () => {
    const table = makeTable(513);
    const saved = createWorkspaceTableStorageSnapshot(table);
    const action = moveAction(table, 0, table.rows.length - 1);
    const columnId = table.columns[0].id;
    const changed = {
      ...table,
      rows: [...table.rows.slice(1), { ...table.rows[0], values: { ...table.rows[0].values, [columnId]: '同時修改' } }],
      updatedAt: table.updatedAt + 1,
    };
    const next = updateWorkspaceTableStorageSnapshot(saved, changed, action);
    const storage = planWorkspaceTableStorageWrite(next, saved);
    const reopened = assembleChunkedWorkspaceTable(table.id, next.record, storage.state, [...next.chunks.values()], [...next.order.pages.values()]);

    expect(next.rowOrderChange).toBeUndefined();
    expect(storage.upserts.length).toBeLessThanOrEqual(1);
    expect(reopened.rows.map(row => row.id)).toEqual(changed.rows.map(row => row.id));
    expect(reopened.rows.at(-1)?.values[columnId]).toBe('同時修改');
  });

  it('requires the shared move token before taking the certified path', () => {
    const table = makeTable(8);
    const saved = createWorkspaceTableStorageSnapshot(table);
    const action = moveAction(table, 0, 4);
    const unrecognized = { ...table, rows: [table.rows[1], table.rows[2], table.rows[3], table.rows[4], table.rows[0], ...table.rows.slice(5)] };

    expect(updateWorkspaceRowMoveStorage(saved, unrecognized, action, saved.record.definition)).toBeUndefined();
  });

  it('reconciles a deterministic mixed move stream through display block overlays', () => {
    let table = makeTable(300);
    let current = createWorkspaceTableStorageSnapshot(table);
    let saved = current;
    let head = customHead(table, [1, 128, 128, 43]);
    let persistedPages = pageRowsFrom(table, head);
    let sawVariableCounts = false;
    let sawSingleRowSource = false;

    for (let step = 1; step <= 120; step++) {
      const from = step % 2 ? (step * 29) % table.rows.length : table.rows.length - 1 - ((step * 13) % table.rows.length);
      let to = step % 2 ? table.rows.length - 1 - ((step * 47) % table.rows.length) : (step * 53) % table.rows.length;
      if (from === to) to = (to + 1) % table.rows.length;
      const action = moveAction(table, from, to);
      const moved = moveTable(table, action);
      const immediate = updateWorkspaceTableStorageSnapshot(current, moved, action);
      expect(immediate.rowOrderChange?.beforeRows).toBe(current.table.rows);
      const candidate = updateWorkspaceTableStorageSnapshot(saved, moved, action);
      const plan = planWorkspaceRowPages(candidate, saved, head, `mixed-${step}`);
      const overlayPages = applyDisplayPlan(persistedPages, plan);
      const flattened = overlayDisplayRows(plan.head, overlayPages);

      expect(flattened.map(row => row.id)).toEqual(moved.rows.map(row => row.id));
      expect(plan.head.blocks.reduce((sum, block) => sum + block.count, 0)).toBe(moved.rows.length);
      expect(plan.head.blocks.every(block => block.count > 0 && block.count <= 256)).toBe(true);
      sawVariableCounts ||= plan.head.blocks.some((block, index) => block.count !== head.blocks[index]?.count);
      sawSingleRowSource ||= plan.deletes.length > 0 || head.blocks.some(block => block.count === 1);

      table = moved;
      current = immediate;
      // Every seventeenth operation models a queued save that failed: the next
      // successful plan must catch up from the previous persisted baseline.
      if (step % 17 === 0) continue;
      saved = candidate;
      head = plan.head;
      persistedPages = overlayPages;
      current = saved;
    }

    expect(sawVariableCounts).toBe(true);
    expect(sawSingleRowSource).toBe(true);
  });
});
