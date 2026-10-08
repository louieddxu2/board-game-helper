import { describe, expect, it } from 'vitest';
import {
  assembleChunkedWorkspaceTable,
  createWorkspaceTableStorageSnapshot,
  planWorkspaceTableStorageWrite,
  updateWorkspaceTableStorageSnapshot,
  WorkspaceStorageIntegrityError,
} from './rowChunkStorage';
import { createTable, emptyWorkspace } from './model';
import { applyWorkspaceTableHistoryAction, inferWorkspaceTableMutation } from './history';
import { planWorkspaceRowPages } from './rowPages';
import {
  createWorkspaceRowOrder,
  spliceWorkspaceRowOrder,
  workspaceRowOrderCapacity,
  type StoredWorkspaceRowOrderPage,
} from './rowOrderStorage';
import type { WorkspaceTable, WorkspaceRow } from './types';

const makeTable = (count: number): WorkspaceTable => {
  const table = createTable('順序頁測試');
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

const newRow = (table: WorkspaceTable, id = 'row-new'): WorkspaceRow => ({
  id,
  name: '新增物件',
  values: { [table.columns[0].id]: '新值' },
});

const addRow = (table: WorkspaceTable, row: WorkspaceRow, index: number) => ({
  ...table,
  rows: [...table.rows.slice(0, index), row, ...table.rows.slice(index)],
  updatedAt: table.updatedAt + 1,
});

const removeRow = (table: WorkspaceTable, index: number) => ({
  ...table,
  rows: [...table.rows.slice(0, index), ...table.rows.slice(index + 1)],
  updatedAt: table.updatedAt + 1,
});

const addAction = (row: WorkspaceRow, index: number) => ({ type: 'add-row' as const, row, index });
const removeAction = (row: WorkspaceRow, index: number) => ({ type: 'remove-row' as const, row, index });

describe('workspace row order pages', () => {
  it('rejects negative and overflowing splices, including a delete crossing the last page', () => {
    const order = createWorkspaceRowOrder('table', Array.from({ length: 512 }, (_, index) => `row-${index}`));
    for (const [index, count] of [[-1, 0], [513, 0], [500, 20], [512, 1], [0, -1]]) {
      expect(() => spliceWorkspaceRowOrder(order, 'table', index, count, [])).toThrow('Invalid row order splice');
    }
  });

  it('uses the shared row action to append without visiting all existing row IDs in storage planning', () => {
    const table = makeTable(10_000);
    let reads = 0;
    for (const row of table.rows) {
      const id = row.id;
      Object.defineProperty(row, 'id', { enumerable: true, get: () => { reads++; return id; } });
    }
    const saved = createWorkspaceTableStorageSnapshot(table);
    const head = planWorkspaceRowPages(saved, undefined, undefined, 'before').head;
    const row = newRow(table);
    const action = addAction(row, table.rows.length);
    const nextTable = applyWorkspaceTableHistoryAction({ ...emptyWorkspace(), tables: [table] }, table.id, action, 'redo').tables[0];
    reads = 0;
    const next = updateWorkspaceTableStorageSnapshot(saved, nextTable, action);
    const pages = planWorkspaceRowPages(next, saved, head, 'after');
    expect(reads).toBeLessThan(20);
    expect(pages.pages.map(page => page.index)).toEqual([78]);
  });

  it('preserves earlier cell edits when an external add/remove hint describes only part of the change', () => {
    for (const adding of [true, false]) {
      const table = makeTable(512);
      const saved = createWorkspaceTableStorageSnapshot(table);
      const head = planWorkspaceRowPages(saved, undefined, undefined, 'before').head;
      const row = adding ? newRow(table) : table.rows[511];
      const action = adding ? addAction(row, 512) : removeAction(row, 511);
      const changed = adding ? addRow(table, row, 512) : removeRow(table, 511);
      changed.rows[0] = { ...table.rows[0], values: { ...table.rows[0].values, [table.columns[0].id]: '同時修改' } };
      expect(inferWorkspaceTableMutation({ ...emptyWorkspace(), tables: [table] }, { ...emptyWorkspace(), tables: [changed] })).toBeUndefined();
      const next = updateWorkspaceTableStorageSnapshot(saved, changed, action);
      const plan = planWorkspaceTableStorageWrite(next, saved);
      const reopened = assembleChunkedWorkspaceTable(table.id, next.record, plan.state, [...next.chunks.values()], [...next.order.pages.values()]);
      expect(reopened.rows[0].values[table.columns[0].id]).toBe('同時修改');
      expect(reopened.rows).toEqual(changed.rows);
      expect(plan.upserts).toHaveLength(2);
      expect(planWorkspaceRowPages(next, saved, head, 'after').pages.map(page => page.index)).toEqual([0, adding ? 4 : 3]);
    }
  });

  it('partitions order into bounded pages and flattens without changing IDs', () => {
    const order = createWorkspaceRowOrder('table-1', Array.from({ length: 10_000 }, (_, index) => `row-${index}`));
    expect(order.pageIds).toHaveLength(Math.ceil(10_000 / workspaceRowOrderCapacity));
    expect([...order.pages.values()].every(page => page.tableId === 'table-1' && page.rowIds.length <= workspaceRowOrderCapacity)).toBe(true);
    expect(order.pageIds.flatMap(id => order.pages.get(id)!.rowIds)).toEqual(Array.from({ length: 10_000 }, (_, index) => `row-${index}`));
  });

  it('appends one row to 10,000 rows by writing only the tail order page', () => {
    const table = makeTable(10_000);
    const saved = createWorkspaceTableStorageSnapshot(table);
    const row = newRow(table);
    const nextTable = addRow(table, row, table.rows.length);
    const next = updateWorkspaceTableStorageSnapshot(saved, nextTable, addAction(row, table.rows.length));
    const plan = planWorkspaceTableStorageWrite(next, saved);
    const tailId = saved.order.pageIds.at(-1)!;

    expect(plan.orderUpserts.map(page => page.pageId)).toEqual([tailId]);
    expect(plan.orderDeletes).toEqual([]);
    expect(plan.orderUpserts[0].rowIds.at(-1)).toBe(row.id);
    expect(plan.orderUpserts[0].rowIds.length).toBe(17);
    expect(plan.orderUpserts[0].rowIds.slice(0, -1)).toEqual(saved.order.pages.get(tailId)!.rowIds);
    expect(plan.orderUpserts.length).toBeLessThanOrEqual(1);
  });

  it('appends at a full page boundary with one new order page and preserves the old page', () => {
    const table = makeTable(workspaceRowOrderCapacity);
    const saved = createWorkspaceTableStorageSnapshot(table);
    const oldPage = saved.order.pages.get(saved.order.pageIds[0])!;
    const row = newRow(table);
    const next = updateWorkspaceTableStorageSnapshot(saved, addRow(table, row, table.rows.length), addAction(row, table.rows.length));
    const plan = planWorkspaceTableStorageWrite(next, saved);

    expect(plan.orderUpserts).toHaveLength(1);
    expect(plan.orderUpserts[0].pageId).not.toBe(oldPage.pageId);
    expect(plan.orderUpserts[0].rowIds).toEqual([row.id]);
    expect(next.order.pages.get(oldPage.pageId)).toBe(oldPage);
    expect(plan.orderDeletes).toEqual([]);
  });

  it('deletes a tail or middle row from 10,000 rows by rewriting one order page', () => {
    for (const index of [9_999, 5_000]) {
      const table = makeTable(10_000);
      const saved = createWorkspaceTableStorageSnapshot(table);
      const next = updateWorkspaceTableStorageSnapshot(saved, removeRow(table, index), removeAction(table.rows[index], index));
      const plan = planWorkspaceTableStorageWrite(next, saved);
      const pageId = saved.order.pageIds[Math.floor(index / workspaceRowOrderCapacity)];

      expect(plan.orderUpserts.map(page => page.pageId)).toEqual([pageId]);
      expect(plan.orderDeletes).toEqual([]);
      expect(plan.orderUpserts).toHaveLength(1);
      expect(plan.orderUpserts[0].rowIds).not.toContain(table.rows[index].id);
    }
  });

  it('removes an empty order page when deleting the only row in a page', () => {
    const table = makeTable(workspaceRowOrderCapacity + 1);
    const saved = createWorkspaceTableStorageSnapshot(table);
    const lastPageId = saved.order.pageIds.at(-1)!;
    const next = updateWorkspaceTableStorageSnapshot(saved, removeRow(table, workspaceRowOrderCapacity), removeAction(table.rows[workspaceRowOrderCapacity], workspaceRowOrderCapacity));
    const plan = planWorkspaceTableStorageWrite(next, saved);

    expect(next.order.pageIds).toEqual(saved.order.pageIds.slice(0, -1));
    expect(plan.orderUpserts).toEqual([]);
    expect(plan.orderDeletes).toEqual([lastPageId]);
  });

  it('reorders through the generic reconciliation path without rewriting row chunks', () => {
    const table = makeTable(513);
    const saved = createWorkspaceTableStorageSnapshot(table);
    const reordered = { ...table, rows: [table.rows[512], ...table.rows.slice(0, 512)] };
    const next = updateWorkspaceTableStorageSnapshot(saved, reordered, {
      type: 'reorder-rows', beforeIds: table.rows.map(row => row.id), afterIds: reordered.rows.map(row => row.id),
    });
    const plan = planWorkspaceTableStorageWrite(next, saved);
    const reopened = assembleChunkedWorkspaceTable(reordered.id, next.record, { updatedAt: reordered.updatedAt }, [...next.chunks.values()], [...next.order.pages.values()]);

    expect(plan.upserts).toEqual([]);
    expect(plan.deletes).toEqual([]);
    expect(plan.orderUpserts.length).toBeGreaterThan(0);
    expect(reopened.rows.map(row => row.id)).toEqual(reordered.rows.map(row => row.id));
  });

  it('rejects missing, duplicate, empty, and foreign order pages', () => {
    const table = makeTable(workspaceRowOrderCapacity + 1);
    const saved = createWorkspaceTableStorageSnapshot(table);
    const state = { updatedAt: table.updatedAt };
    const chunks = [...saved.chunks.values()];
    const pages = [...saved.order.pages.values()];
    const invalid = (record: typeof saved.record, orderPages: StoredWorkspaceRowOrderPage[]) =>
      expect(() => assembleChunkedWorkspaceTable(table.id, record, state, chunks, orderPages)).toThrow(WorkspaceStorageIntegrityError);

    invalid(saved.record, pages.slice(0, 1));
    invalid({ ...saved.record, orderPageIds: [pages[0].pageId, pages[0].pageId] }, pages);
    invalid(saved.record, [pages[0], { ...pages[0] }]);
    invalid(saved.record, [{ ...pages[0], rowIds: [] }, pages[1]]);
    invalid(saved.record, [{ ...pages[0], tableId: 'other-table' }, pages[1]]);
  });

  it('rejects sparse order page IDs and sparse or empty row IDs instead of flattening holes', () => {
    const table = makeTable(1);
    const saved = createWorkspaceTableStorageSnapshot(table);
    const page = [...saved.order.pages.values()][0];
    const state = { updatedAt: table.updatedAt };
    const chunks = [...saved.chunks.values()];
    const sparsePageIds = [page.pageId] as string[];
    sparsePageIds.length = 2;
    expect(() => assembleChunkedWorkspaceTable(table.id, { ...saved.record, orderPageIds: sparsePageIds }, state, chunks, [page])).toThrow(WorkspaceStorageIntegrityError);

    const sparseRowIds = [table.rows[0].id] as string[];
    sparseRowIds.length = 2;
    expect(() => assembleChunkedWorkspaceTable(table.id, saved.record, state, chunks, [{ ...page, rowIds: sparseRowIds }])).toThrow(WorkspaceStorageIntegrityError);
    expect(() => assembleChunkedWorkspaceTable(table.id, saved.record, state, chunks, [{ ...page, rowIds: [''] }])).toThrow(WorkspaceStorageIntegrityError);
  });

  it('keeps an empty table valid with no order pages', () => {
    const table = makeTable(0);
    const snapshot = createWorkspaceTableStorageSnapshot(table);
    const restored = assembleChunkedWorkspaceTable(table.id, snapshot.record, { updatedAt: table.updatedAt }, [], []);

    expect(snapshot.order.pageIds).toEqual([]);
    expect(restored.rows).toEqual([]);
  });
});
