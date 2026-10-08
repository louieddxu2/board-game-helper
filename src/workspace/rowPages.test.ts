import { describe, expect, it } from 'vitest';
import {
  planWorkspaceRowPages,
  validateWorkspaceRowPage,
  validateWorkspaceTableHead,
  workspaceRowPageMatchesHead,
  type WorkspaceTableHead,
} from './rowPages';
import { applyWorkspaceTableHistoryAction, type WorkspaceTableHistoryAction } from './history';
import { createTable } from './model';
import {
  createWorkspaceTableStorageSnapshot,
  updateWorkspaceTableStorageSnapshot,
} from './rowChunkStorage';
import type { WorkspaceData, WorkspaceRow, WorkspaceTable } from './types';

const makeTable = (count: number, columns = 1): WorkspaceTable => {
  const base = createTable('分頁測試');
  base.columns = base.columns.length === columns ? base.columns : Array.from({ length: columns }, (_, index) => ({
    id: `column-${index}`,
    name: `欄位 ${index}`,
    inputType: 'text' as const,
    options: [],
  }));
  base.rows = Array.from({ length: count }, (_, index) => ({
    id: `row-${index}`,
    name: `物件 ${index}`,
    values: Object.fromEntries(base.columns.map(column => [column.id, `值 ${index}-${column.id}`])),
  }));
  return base;
};

const dataOf = (table: WorkspaceTable): WorkspaceData => ({
  version: 1,
  activeNodeId: 'node-1',
  nodes: [{ id: 'node-1', type: 'table', tableId: table.id, name: table.name, parentId: null, order: 0 }],
  tables: [table],
});

const firstPlan = (table: WorkspaceTable) => {
  const snapshot = createWorkspaceTableStorageSnapshot(table);
  const plan = planWorkspaceRowPages(snapshot, undefined, undefined, 'layout-0');
  return { snapshot, head: plan.head };
};

const apply = (table: WorkspaceTable, action: WorkspaceTableHistoryAction, direction: 'undo' | 'redo' = 'redo') =>
  applyWorkspaceTableHistoryAction(dataOf(table), table.id, action, direction).tables[0];

const snapshotAfter = (
  previous: ReturnType<typeof createWorkspaceTableStorageSnapshot>,
  table: WorkspaceTable,
  action?: WorkspaceTableHistoryAction,
) => updateWorkspaceTableStorageSnapshot(previous, table, action);

const pageIndices = (plan: ReturnType<typeof planWorkspaceRowPages>) => plan.pages.map(page => page.index);

describe('workspace row page write planning', () => {
  it('writes only the tail page for a 10,000-row append', () => {
    const before = makeTable(10_000);
    const initial = firstPlan(before);
    const action: WorkspaceTableHistoryAction = { type: 'add-row', row: { id: 'row-new', name: '新增', values: {} }, index: 10_000 };
    const after = apply(before, action);
    const snapshot = snapshotAfter(initial.snapshot, after, action);
    const plan = planWorkspaceRowPages(snapshot, initial.snapshot, initial.head, 'layout-1');

    expect(pageIndices(plan)).toEqual([78]);
    expect(plan.deletes).toEqual([]);
    expect(plan.rebuild).toBe(false);
    expect(plan.head.pageRevisions).toHaveLength(79);
    expect(plan.head.pageRevisions!.slice(0, 78)).toEqual(initial.head.pageRevisions!.slice(0, 78));
    expect(plan.pages[0].rows.at(-1)?.id).toBe('row-new');
  });

  it('creates only the new page when an append crosses a page boundary', () => {
    const before = makeTable(128);
    const initial = firstPlan(before);
    const action: WorkspaceTableHistoryAction = { type: 'add-row', row: { id: 'row-new', name: '新增', values: {} }, index: 128 };
    const after = apply(before, action);
    const plan = planWorkspaceRowPages(snapshotAfter(initial.snapshot, after, action), initial.snapshot, initial.head, 'layout-1');

    expect(pageIndices(plan)).toEqual([1]);
    expect(plan.pages[0].rows).toHaveLength(1);
    expect(plan.pages[0].rows[0].id).toBe('row-new');
    expect(plan.head.pageRevisions).toEqual(['layout-0', 'layout-1']);
  });

  it('writes each page touched by multiple appended rows', () => {
    const before = makeTable(127);
    const initial = firstPlan(before);
    const additions = [128, 129, 130].map(index => ({ id: `row-new-${index}`, name: '新增', values: {} }));
    const after: WorkspaceTable = { ...before, rows: [...before.rows, ...additions] };
    const plan = planWorkspaceRowPages(snapshotAfter(initial.snapshot, after), initial.snapshot, initial.head, 'layout-1');

    expect(pageIndices(plan)).toEqual([0, 1]);
    expect(plan.pages.find(page => page.index === 0)?.rows).toHaveLength(128);
    expect(plan.pages.find(page => page.index === 1)?.rows).toHaveLength(2);
  });

  it.each([
    { name: 'same-page reorder', count: 512, source: 2, target: 10, expected: [0] },
    { name: 'cross-page reorder', count: 512, source: 2, target: 130, expected: [0, 1] },
    { name: 'head-to-tail reorder', count: 512, source: 0, target: 511, expected: [0, 1, 2, 3] },
  ])('$name writes the pages whose row references moved', ({ count, source, target, expected }) => {
    const before = makeTable(count);
    const initial = firstPlan(before);
    const row = before.rows[source];
    const action: WorkspaceTableHistoryAction = { type: 'move-row', rowId: row.id, beforeIndex: source, afterIndex: target };
    const after = apply(before, action);
    const plan = planWorkspaceRowPages(snapshotAfter(initial.snapshot, after, action), initial.snapshot, initial.head, 'layout-1');

    expect(pageIndices(plan)).toEqual(expected);
    expect(plan.pages.every(page => page.rows.length > 0)).toBe(true);
  });

  it.each([
    { name: 'tail', count: 257, remove: 256, expected: [], deletes: [2] },
    { name: 'page boundary', count: 256, remove: 128, expected: [1], deletes: [] },
    { name: 'middle', count: 512, remove: 200, expected: [1, 2, 3], deletes: [] },
  ])('$name deletion updates shifted pages and deletes obsolete pages', ({ count, remove, expected, deletes }) => {
    const before = makeTable(count);
    const initial = firstPlan(before);
    const row = before.rows[remove];
    const action: WorkspaceTableHistoryAction = { type: 'remove-row', row, index: remove };
    const after = apply(before, action);
    const plan = planWorkspaceRowPages(snapshotAfter(initial.snapshot, after, action), initial.snapshot, initial.head, 'layout-1');

    expect(pageIndices(plan)).toEqual(expected);
    expect(plan.deletes).toEqual(deletes);
  });

  it('keeps unchanged page versions valid when the layout revision changes', () => {
    const before = makeTable(300);
    const initial = firstPlan(before);
    const row = before.rows[0];
    const action: WorkspaceTableHistoryAction = { type: 'move-row', rowId: row.id, beforeIndex: 0, afterIndex: 1 };
    const after = apply(before, action);
    const plan = planWorkspaceRowPages(snapshotAfter(initial.snapshot, after, action), initial.snapshot, initial.head, 'layout-1');
    const page0 = plan.pages.find(page => page.index === 0);
    const oldPage1 = { ...initial.head, pageRevisions: [...initial.head.pageRevisions!] };
    const unchangedPage = { tableId: before.id, index: 1, layoutRevision: oldPage1.pageRevisions![1], rows: before.rows.slice(128, 256) };

    expect(plan.head.layoutRevision).toBe('layout-1');
    expect(plan.head.pageRevisions![1]).toBe('layout-0');
    expect(workspaceRowPageMatchesHead(plan.head, 1, unchangedPage)).toBe(true);
    expect(page0 && workspaceRowPageMatchesHead(plan.head, 0, page0)).toBe(true);
    expect(() => validateWorkspaceRowPage(plan.head, 1, unchangedPage)).not.toThrow();
  });

  it('plans append and an existing-cell edit together from an unchanged failed-save baseline', () => {
    const before = makeTable(10_000);
    const initial = firstPlan(before);
    const add: WorkspaceTableHistoryAction = { type: 'add-row', row: { id: 'row-new', name: '新增', values: {} }, index: before.rows.length };
    const appended = apply(before, add);
    const appendedSnapshot = snapshotAfter(initial.snapshot, appended, add);
    const columnId = before.columns[0].id;
    const edit: WorkspaceTableHistoryAction = { type: 'set-cell', rowId: before.rows[0].id, columnId, before: '值 0-column-0', after: '後續編輯' };
    const edited = apply(appended, edit);
    const current = snapshotAfter(appendedSnapshot, edited, edit);
    const retry = planWorkspaceRowPages(current, initial.snapshot, initial.head, 'retry-layout');

    expect(pageIndices(retry)).toEqual([0, 78]);
    expect(retry.head.pageRevisions![0]).toBe('retry-layout');
    expect(retry.head.pageRevisions![78]).toBe('retry-layout');
    expect(retry.head.pageRevisions!.slice(1, 78)).toEqual(initial.head.pageRevisions!.slice(1, 78));
  });

  it('rejects malformed version vectors and page mismatches', () => {
    const before = makeTable(129);
    const initial = firstPlan(before);
    const malformed = [
      { ...initial.head, pageRevisions: ['only-one'] },
      { ...initial.head, pageRevisions: ['ok', ''] },
      { ...initial.head, pageRevisions: Object.assign(['ok', 'ok'], { 1: undefined }) },
    ];
    for (const head of malformed) expect(() => validateWorkspaceTableHead(before.id, head)).toThrow();

    const page = { tableId: before.id, index: 0, layoutRevision: initial.head.pageRevisions![0], rows: before.rows.slice(0, 128) };
    expect(workspaceRowPageMatchesHead({ ...initial.head, pageRevisions: ['wrong', initial.head.pageRevisions![1]] }, 0, page)).toBe(false);
    expect(() => validateWorkspaceRowPage(initial.head, 1, page)).toThrow();
  });

  it('emits no row pages for a column-only edit and upgrades a legacy head without rewriting old pages', () => {
    const before = makeTable(300);
    const initial = firstPlan(before);
    const changed: WorkspaceTable = { ...before, columns: [{ ...before.columns[0], name: '改名' }] };
    const columnPlan = planWorkspaceRowPages(snapshotAfter(initial.snapshot, changed), initial.snapshot, initial.head, 'layout-1');
    expect(columnPlan.pages).toEqual([]);
    expect(columnPlan.head.pageRevisions).toEqual(initial.head.pageRevisions);

    const legacyHead: WorkspaceTableHead = { ...initial.head, pageRevisions: undefined };
    const legacyPlan = planWorkspaceRowPages(initial.snapshot, initial.snapshot, legacyHead, 'layout-2');
    expect(legacyPlan.pages).toEqual([]);
    expect(legacyPlan.head.pageRevisions).toEqual(['layout-0', 'layout-0', 'layout-0']);
    expect(workspaceRowPageMatchesHead(legacyPlan.head, 0, { tableId: before.id, index: 0, layoutRevision: 'layout-0', rows: before.rows.slice(0, 128) })).toBe(true);
  });
});

describe('workspace row page validation', () => {
  it('accepts legacy heads and rejects sparse vectors', () => {
    const table = makeTable(1);
    const { head } = firstPlan(table);
    const legacy = { ...head, pageRevisions: undefined };
    expect(() => validateWorkspaceTableHead(table.id, legacy)).not.toThrow();
    const sparse = [] as string[];
    sparse.length = 1;
    expect(() => validateWorkspaceTableHead(table.id, { ...head, pageRevisions: sparse })).toThrow();
  });
});
