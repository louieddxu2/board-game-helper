import { describe, expect, it } from 'vitest';
import { createTable } from './model';
import { planWorkspaceRowPages } from './rowPages';
import { createWorkspaceTableStorageSnapshot } from './rowChunkStorage';
import { planWorkspaceRowBlockMaintenance } from './rowBlockMaintenance';
import type { WorkspaceRow, WorkspaceTable } from './types';

const makeTable = (counts: number[], changeRevision = 'content-1'): { table: WorkspaceTable; head: ReturnType<typeof planWorkspaceRowPages>['head'] } => {
  const table = createTable('維護測試');
  const columnId = table.columns[0].id;
  const rows: WorkspaceRow[] = counts.flatMap((count, block) => Array.from({ length: count }, (_, slot) => ({
    id: `row-${block}-${slot}`,
    name: `物件 ${block}-${slot}`,
    values: { [columnId]: `${block}-${slot}` },
  })));
  const complete = { ...table, rows, changeRevision };
  const snapshot = createWorkspaceTableStorageSnapshot(complete);
  const initial = planWorkspaceRowPages(snapshot, undefined, undefined, 'saved-layout');
  if (initial.head.format !== 'row-blocks-v1') throw new Error('expected row block head');
  return {
    table: complete,
    head: {
      ...initial.head,
      rowCount: rows.length,
      blocks: counts.map((count, index) => ({ id: `block-${index}`, count, revision: `saved-${index}` })),
    },
  };
};

const finish = <T>(generator: Generator<void, T>) => {
  let step = generator.next();
  while (!step.done) step = generator.next();
  return step.value;
};

describe('workspace row block maintenance planning', () => {
  it('splits a 193-row block into 97 and 96 while preserving the first ID', () => {
    const { table, head } = makeTable([193]);
    const plan = finish(planWorkspaceRowBlockMaintenance(table, head, 'maintenance-layout'))!;

    expect(plan.pages.map(page => page.rows.length)).toEqual([97, 96]);
    expect(plan.pages[0].id).toBe('block-0');
    expect(plan.pages[1].id).not.toBe('block-0');
    expect(plan.pages.flatMap(page => page.rows)).toEqual(table.rows);
    expect(plan.head.blocks.map(block => block.count)).toEqual([97, 96]);
    expect(plan.head.blocks.every(block => block.revision === 'maintenance-layout')).toBe(true);
    expect(plan.deletes).toEqual([]);
  });

  it.each([
    { counts: [64, 64], merged: true },
    { counts: [64, 65], merged: false },
  ])('merges adjacent blocks only when their combined count is at most 128 ($counts)', ({ counts, merged }) => {
    const { table, head } = makeTable(counts);
    const plan = finish(planWorkspaceRowBlockMaintenance(table, head, 'maintenance-layout'));

    if (merged) {
      expect(plan?.pages.map(page => page.rows.length)).toEqual([128]);
      expect(plan?.pages[0].id).toBe('block-0');
      expect(plan?.deletes).toEqual(['block-1']);
      expect(plan?.head.blocks.map(block => block.count)).toEqual([128]);
    } else {
      expect(plan).toBeUndefined();
    }
  });

  it('merges a fragmented prefix and leaves the already-sized suffix byte-for-byte untouched', () => {
    const { table, head } = makeTable([40, 40, 128]);
    const plan = finish(planWorkspaceRowBlockMaintenance(table, head, 'maintenance-layout'))!;

    expect(plan.pages).toHaveLength(1);
    expect(plan.pages[0].id).toBe('block-0');
    expect(plan.pages[0].rows).toEqual(table.rows.slice(0, 80));
    expect(plan.head.blocks).toEqual([
      { id: 'block-0', count: 80, revision: 'maintenance-layout' },
      { id: 'block-2', count: 128, revision: 'saved-2' },
    ]);
    expect(plan.deletes).toEqual(['block-1']);
  });

  it('returns no plan when the current table is already reasonably laid out', () => {
    const { table, head } = makeTable([128, 65]);
    const plan = finish(planWorkspaceRowBlockMaintenance(table, head, 'maintenance-layout'));

    expect(plan).toBeUndefined();
  });

  it('abandons a stale row count or semantic revision before yielding work', () => {
    const countMismatch = makeTable([128]);
    const changedCount = { ...countMismatch.table, rows: [...countMismatch.table.rows, { id: 'new', name: '新列', values: {} }] };
    const revisionMismatch = makeTable([128]);
    const changedRevision = { ...revisionMismatch.table, changeRevision: 'new-content' };

    expect(finish(planWorkspaceRowBlockMaintenance(changedCount, countMismatch.head, 'maintenance-layout'))).toBeUndefined();
    expect(finish(planWorkspaceRowBlockMaintenance(changedRevision, revisionMismatch.head, 'maintenance-layout'))).toBeUndefined();
  });

  it('yields between merge candidates so an idle runner can cancel the generator', () => {
    const { table, head } = makeTable([40, 40, 40]);
    const generator = planWorkspaceRowBlockMaintenance(table, head, 'maintenance-layout');

    const first = generator.next();
    expect(first.done).toBe(false);
    const second = generator.next();
    expect(second.done).toBe(false);
  });
});
