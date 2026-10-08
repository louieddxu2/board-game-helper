import { describe, expect, it } from 'vitest';
import {
  planWorkspaceRowPages,
  validateWorkspaceRowPage,
  validateWorkspaceTableHead,
  workspaceRowPageIndex,
  workspaceRowPageMatchesHead,
  workspaceRowPageOffset,
  workspaceRowPageRevision,
  workspaceRowPageStorageKey,
  workspaceRowPageKey,
  workspaceRowBlockCapacity,
  workspaceRowPageSize,
  type LegacyWorkspaceTableHead,
  type WorkspaceBlockTableHead,
  type WorkspaceRowBlock,
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

const apply = (table: WorkspaceTable, action: WorkspaceTableHistoryAction, direction: 'undo' | 'redo' = 'redo') =>
  applyWorkspaceTableHistoryAction(dataOf(table), table.id, action, direction).tables[0];

const snapshotAfter = (
  previous: ReturnType<typeof createWorkspaceTableStorageSnapshot>,
  table: WorkspaceTable,
  action?: WorkspaceTableHistoryAction,
) => updateWorkspaceTableStorageSnapshot(previous, table, action);

const firstPlan = (table: WorkspaceTable) => {
  const snapshot = createWorkspaceTableStorageSnapshot(table);
  const plan = planWorkspaceRowPages(snapshot, undefined, undefined, 'layout-0');
  return { snapshot, plan, head: plan.head };
};

const blockIds = (plan: ReturnType<typeof planWorkspaceRowPages>) => plan.pages.map(page => page.id);
const blockCounts = (head: WorkspaceTableHead) => head.format === 'row-blocks-v1' ? head.blocks.map(block => block.count) : [];

const legacyHeadOf = (table: WorkspaceTable, revision = 'legacy-layout', pageRevisions?: string[]): LegacyWorkspaceTableHead => ({
  format: 'row-pages-v1',
  definition: {
    id: table.id,
    name: table.name,
    rowHeaderName: table.rowHeaderName,
    rowHeader: table.rowHeader,
    columns: table.columns,
    textScale: table.textScale,
    transposed: table.transposed,
  },
  rowCount: table.rows.length,
  pageSize: workspaceRowPageSize,
  layoutRevision: revision,
  pageRevisions,
  updatedAt: table.updatedAt,
});

const overlayPages = (
  base: WorkspaceRowBlock[],
  plan: ReturnType<typeof planWorkspaceRowPages>,
): WorkspaceRow[] => {
  const changed = new Map(plan.pages.map(page => [page.id, page]));
  return plan.head.blocks.flatMap(block => changed.get(block.id)?.rows ?? base.find(page => page.id === block.id)?.rows ?? []);
};

describe('workspace row block write planning', () => {
  it('seeds 128-row blocks with stable IDs and per-block revisions', () => {
    const { plan, head } = firstPlan(makeTable(300));

    expect(head.format).toBe('row-blocks-v1');
    expect(blockCounts(head)).toEqual([128, 128, 44]);
    expect(plan.pages.map(page => page.id)).toEqual(head.blocks.map(block => block.id));
    expect(plan.pages.map(page => page.rows.length)).toEqual(blockCounts(head));
    expect(plan.pages.every((page, index) => page.layoutRevision === head.blocks[index].revision)).toBe(true);
    expect(plan.rebuild).toBe(true);
    expect(plan.deletes).toEqual([]);
  });

  it('writes only the tail block for a 10,000-row append', () => {
    const before = makeTable(10_000);
    const initial = firstPlan(before);
    const row: WorkspaceRow = { id: 'row-new', name: '新增', values: {} };
    const action: WorkspaceTableHistoryAction = { type: 'add-row', row, index: before.rows.length };
    const after = apply(before, action);
    const plan = planWorkspaceRowPages(snapshotAfter(initial.snapshot, after, action), initial.snapshot, initial.head, 'layout-1');

    expect(blockIds(plan)).toEqual([initial.head.blocks.at(-1)!.id]);
    expect(plan.deletes).toEqual([]);
    expect(plan.rebuild).toBe(false);
    expect(plan.head.blocks.slice(0, -1)).toEqual(initial.head.blocks.slice(0, -1));
    expect(plan.head.blocks.at(-1)).toMatchObject({ id: initial.head.blocks.at(-1)!.id, count: 17, revision: 'layout-1' });
    expect(plan.pages[0].rows.at(-1)?.id).toBe(row.id);
  });

  it('keeps a 129-row block together instead of splitting at the target size', () => {
    const before = makeTable(128);
    const initial = firstPlan(before);
    const row: WorkspaceRow = { id: 'row-new', name: '新增', values: {} };
    const action: WorkspaceTableHistoryAction = { type: 'add-row', row, index: 128 };
    const after = apply(before, action);
    const plan = planWorkspaceRowPages(snapshotAfter(initial.snapshot, after, action), initial.snapshot, initial.head, 'layout-1');

    expect(blockIds(plan)).toEqual([initial.head.blocks[0].id]);
    expect(blockCounts(plan.head)).toEqual([129]);
    expect(plan.pages[0].rows).toHaveLength(129);
    expect(plan.pages[0].rows.at(-1)?.id).toBe(row.id);
  });

  it('preserves a full 256-row tail block and appends a new one-row block', () => {
    const before = makeTable(256);
    const initial = firstPlan(before);
    const fullBlockId = 'full-tail-block';
    const savedHead: WorkspaceBlockTableHead = {
      ...initial.head,
      blocks: [{ id: fullBlockId, count: 256, revision: 'layout-0' }],
    };
    const row: WorkspaceRow = { id: 'row-new', name: '新增', values: {} };
    const action: WorkspaceTableHistoryAction = { type: 'add-row', row, index: 256 };
    const after = apply(before, action);
    const plan = planWorkspaceRowPages(snapshotAfter(initial.snapshot, after, action), initial.snapshot, savedHead, 'layout-1');

    expect(blockIds(plan)).toHaveLength(1);
    expect(plan.pages[0].rows).toEqual([row]);
    expect(plan.pages[0].id).not.toBe(fullBlockId);
    expect(plan.head.blocks[0]).toEqual({ id: fullBlockId, count: 256, revision: 'layout-0' });
    expect(plan.head.blocks[1]).toMatchObject({ count: 1, revision: 'layout-1' });
    expect(plan.deletes).toEqual([]);
  });

  it('splits a generic 257-row growth into 129 and 128 at the hard cap', () => {
    const before = makeTable(256);
    const initial = firstPlan(before);
    const fullBlockId = 'full-growth-block';
    const savedHead: WorkspaceBlockTableHead = {
      ...initial.head,
      blocks: [{ id: fullBlockId, count: workspaceRowBlockCapacity, revision: 'layout-0' }],
    };
    const inserted = { id: 'row-new', name: '新增', values: {} };
    const after = { ...before, rows: [...before.rows.slice(0, 128), inserted, ...before.rows.slice(128)] };
    const next = snapshotAfter(initial.snapshot, after);
    const plan = planWorkspaceRowPages(next, initial.snapshot, savedHead, 'layout-1');

    expect(plan.pages.map(page => page.rows.length)).toEqual([129, 128]);
    expect(plan.pages[0].id).toBe(fullBlockId);
    expect(plan.head.blocks.map(block => block.count)).toEqual([129, 128]);
    expect(plan.head.blocks[0].revision).toBe('layout-1');
    expect(plan.head.blocks[1].revision).toBe('layout-1');
    expect(plan.pages.flatMap(page => page.rows).map(row => row.id)).toEqual(after.rows.map(row => row.id));
  });

  it('touches one block for a single tail deletion and removes no block record', () => {
    const before = makeTable(10_000);
    const initial = firstPlan(before);
    const remove = before.rows.at(-1)!;
    const action: WorkspaceTableHistoryAction = { type: 'remove-row', row: remove, index: before.rows.length - 1 };
    const after = apply(before, action);
    const plan = planWorkspaceRowPages(snapshotAfter(initial.snapshot, after, action), initial.snapshot, initial.head, 'layout-1');

    expect(blockIds(plan)).toEqual([initial.head.blocks.at(-1)!.id]);
    expect(plan.pages[0].rows).toHaveLength(15);
    expect(plan.pages[0].rows.some(row => row.id === remove.id)).toBe(false);
    expect(plan.deletes).toEqual([]);
    expect(blockCounts(plan.head)).toEqual([...blockCounts(initial.head).slice(0, -1), 15]);
  });

  it('touches one block for a 10,000-row middle deletion', () => {
    const before = makeTable(10_000);
    const initial = firstPlan(before);
    const index = 5_000;
    const remove = before.rows[index];
    const action: WorkspaceTableHistoryAction = { type: 'remove-row', row: remove, index };
    const after = apply(before, action);
    const plan = planWorkspaceRowPages(snapshotAfter(initial.snapshot, after, action), initial.snapshot, initial.head, 'layout-1');
    const block = initial.head.blocks[Math.floor(index / workspaceRowPageSize)];

    expect(blockIds(plan)).toEqual([block.id]);
    expect(plan.pages[0].rows.some(row => row.id === remove.id)).toBe(false);
    expect(plan.deletes).toEqual([]);
    expect(plan.head.rowCount).toBe(9_999);
  });

  it('retains stable block IDs and old content revisions for an isolated cell edit', () => {
    const before = makeTable(300);
    const initial = firstPlan(before);
    const columnId = before.columns[0].id;
    const action: WorkspaceTableHistoryAction = { type: 'set-cell', rowId: before.rows[0].id, columnId, before: '值 0-column-0', after: '後續編輯' };
    const after = apply(before, action);
    const plan = planWorkspaceRowPages(snapshotAfter(initial.snapshot, after, action), initial.snapshot, initial.head, 'cell-layout');

    expect(blockIds(plan)).toEqual([initial.head.blocks[0].id]);
    expect(plan.head.blocks.slice(1)).toEqual(initial.head.blocks.slice(1));
    expect(plan.head.layoutRevision).toBe(initial.head.layoutRevision);
    expect(plan.head.blocks[0].revision).toBe('cell-layout');
    expect(plan.pages[0].layoutRevision).toBe('cell-layout');
    expect(plan.pages[0].rows[0].values[columnId]).toBe('後續編輯');
  });

  it('writes an appended tail and an earlier cell edit from the unchanged saved baseline', () => {
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

    expect(blockIds(retry)).toEqual([initial.head.blocks[0].id, initial.head.blocks.at(-1)!.id]);
    expect(retry.head.blocks[0].revision).toBe('retry-layout');
    expect(retry.head.blocks.at(-1)!.revision).toBe('retry-layout');
    expect(retry.head.blocks.slice(1, -1)).toEqual(initial.head.blocks.slice(1, -1));
    expect(retry.pages[0].rows[0].values[columnId]).toBe('後續編輯');
    expect(retry.pages[1].rows.at(-1)?.id).toBe('row-new');
  });

  it('updates source and destination blocks for a distant one-row move', () => {
    const before = makeTable(1_024);
    const initial = firstPlan(before);
    const source = 2;
    const target = 900;
    const moved = before.rows[source];
    const action: WorkspaceTableHistoryAction = { type: 'move-row', rowId: moved.id, beforeIndex: source, afterIndex: target };
    const after = apply(before, action);
    const plan = planWorkspaceRowPages(snapshotAfter(initial.snapshot, after, action), initial.snapshot, initial.head, 'move-layout');
    const expected = [initial.head.blocks[Math.floor(source / workspaceRowPageSize)].id, initial.head.blocks[Math.floor(target / workspaceRowPageSize)].id];

    expect(blockIds(plan)).toEqual(expected);
    expect(plan.pages.flatMap(page => page.rows).some(row => row.id === moved.id)).toBe(true);
  });

  it('preserves the complete row order through generic reorder planning', () => {
    const before = makeTable(513);
    const initial = firstPlan(before);
    const after = { ...before, rows: [before.rows[512], ...before.rows.slice(0, 512)] };
    const next = snapshotAfter(initial.snapshot, after);
    const plan = planWorkspaceRowPages(next, initial.snapshot, initial.head, 'reorder-layout');

    expect(overlayPages(initial.plan.pages, plan).map(row => row.id)).toEqual(after.rows.map(row => row.id));
    expect(plan.head.blocks.reduce((sum, block) => sum + block.count, 0)).toBe(after.rows.length);
    expect(plan.pages.length).toBeGreaterThan(0);
  });

  it('rebuilds atomically from a readable legacy head', () => {
    const table = makeTable(300);
    const snapshot = createWorkspaceTableStorageSnapshot(table);
    const legacy = legacyHeadOf(table, 'legacy-layout', ['legacy-0', 'legacy-1', 'legacy-2']);
    const plan = planWorkspaceRowPages(snapshot, snapshot, legacy, 'migrated-layout');

    expect(plan.rebuild).toBe(true);
    expect(plan.head.format).toBe('row-blocks-v1');
    expect(blockCounts(plan.head)).toEqual([128, 128, 44]);
    expect(plan.pages.map(page => page.rows).flat()).toEqual(table.rows);
    expect(plan.deletes).toEqual([]);
    expect(plan.pages.every(page => typeof page.id === 'string')).toBe(true);
  });

  it('writes no row blocks for a metadata-only edit', () => {
    const before = makeTable(300);
    const initial = firstPlan(before);
    const changed: WorkspaceTable = { ...before, name: '改名', columns: [{ ...before.columns[0], name: '改名欄位' }] };
    const plan = planWorkspaceRowPages(snapshotAfter(initial.snapshot, changed), initial.snapshot, initial.head, 'metadata-layout');

    expect(plan.pages).toEqual([]);
    expect(plan.deletes).toEqual([]);
    expect(plan.head.blocks).toEqual(initial.head.blocks);
    expect(plan.head.definition.name).toBe('改名');
    expect(plan.head.definition.columns[0].name).toBe('改名欄位');
  });
});

describe('workspace row block validation', () => {
  it('validates block IDs, counts, revisions, and total row count', () => {
    const table = makeTable(300);
    const { head } = firstPlan(table);
    if (head.format !== 'row-blocks-v1') throw new Error('expected block head');
    const malformed: WorkspaceTableHead[] = [
      { ...head, blocks: [{ ...head.blocks[0], id: '' }, ...head.blocks.slice(1)] },
      { ...head, blocks: [{ ...head.blocks[0], id: head.blocks[1].id }, ...head.blocks.slice(1)] },
      { ...head, blocks: [{ ...head.blocks[0], count: 0 }, ...head.blocks.slice(1)] },
      { ...head, blocks: [{ ...head.blocks[0], count: workspaceRowBlockCapacity + 1 }, ...head.blocks.slice(1)] },
      { ...head, blocks: [{ ...head.blocks[0], count: 1.5 }, ...head.blocks.slice(1)] },
      { ...head, blocks: [{ ...head.blocks[0], revision: '' }, ...head.blocks.slice(1)] },
      { ...head, rowCount: head.rowCount + 1 },
    ];
    for (const malformedHead of malformed) expect(() => validateWorkspaceTableHead(table.id, malformedHead)).toThrow();
    expect(() => validateWorkspaceTableHead(table.id, { ...head, blocks: [{ ...head.blocks[0], count: 127 }, ...head.blocks.slice(1)] })).toThrow();
  });

  it('matches block storage IDs and content versions through the union helpers', () => {
    const table = makeTable(129);
    const initial = firstPlan(table);
    const { head } = initial;
    const page = initial.plan.pages[0];
    const index = workspaceRowPageIndex(head, page);

    expect(index).toBe(0);
    expect(workspaceRowPageKey(head, index)).toBe(page.id);
    expect(workspaceRowPageStorageKey(page)).toBe(page.id);
    expect(workspaceRowPageOffset(head, 0)).toBe(0);
    expect(workspaceRowPageOffset(head, 1)).toBe(128);
    expect(workspaceRowPageRevision(head, index)).toBe(page.layoutRevision);
    expect(workspaceRowPageMatchesHead(head, index, page)).toBe(true);
    expect(workspaceRowPageMatchesHead(head, index, { ...page, layoutRevision: 'stale-version' })).toBe(false);
    expect(workspaceRowPageMatchesHead(head, index, { ...page, id: 'unknown-block' })).toBe(false);
    expect(() => validateWorkspaceRowPage(head, index, { ...page, rows: page.rows.slice(0, -1) })).toThrow();
    expect(() => validateWorkspaceRowPage(head, index, { ...page, rows: [page.rows[0], page.rows[0], ...page.rows.slice(2)] })).toThrow();
  });

  it('accepts readable legacy heads and rejects sparse page revision vectors', () => {
    const table = makeTable(129);
    const legacy = legacyHeadOf(table, 'legacy-layout', ['legacy-0', 'legacy-1']);
    expect(() => validateWorkspaceTableHead(table.id, legacy)).not.toThrow();
    const sparse = ['legacy-0'] as string[];
    sparse.length = 2;
    expect(() => validateWorkspaceTableHead(table.id, { ...legacy, pageRevisions: sparse })).toThrow();
    expect(() => validateWorkspaceTableHead(table.id, { ...legacy, pageRevisions: ['legacy-0', ''] })).toThrow();
    expect(() => validateWorkspaceTableHead(table.id, { ...legacy, pageRevisions: ['legacy-0'] })).toThrow();
    expect(() => validateWorkspaceTableHead(table.id, { ...legacy, pageSize: 64 as typeof workspaceRowPageSize })).toThrow();
  });
});
