import { describe, expect, it } from 'vitest';
import {
  createWorkspaceTableStorageSnapshot,
  planWorkspaceTableStorageWrite,
  updateWorkspaceTableStorageSnapshot,
} from './rowChunkStorage';
import { createTable } from './model';
import type { WorkspaceTable } from './types';

const makeTable = (rowCount: number): WorkspaceTable => {
  const table = createTable('排程測試');
  const columnId = table.columns[0].id;
  return {
    ...table,
    rows: Array.from({ length: rowCount }, (_, index) => ({
      id: `row-${index}`,
      name: `物件 ${index}`,
      values: { [columnId]: `值 ${index}` },
    })),
  };
};

const setCell = (table: WorkspaceTable, rowId: string, value: string): WorkspaceTable => {
  const columnId = table.columns[0].id;
  return {
    ...table,
    updatedAt: table.updatedAt + 1,
    rows: table.rows.map((row) => row.id === rowId ? { ...row, values: { ...row.values, [columnId]: value } } : row),
  };
};

describe('workspace storage save snapshots', () => {
  it('keeps chunk IDs stable across two queued snapshots', () => {
    const initial = makeTable(512);
    const saved = createWorkspaceTableStorageSnapshot(initial);
    const firstEdit = setCell(initial, 'row-0', '第一次編輯');
    const firstSnapshot = updateWorkspaceTableStorageSnapshot(saved, firstEdit, {
      type: 'set-cell', rowId: 'row-0', columnId: initial.columns[0].id, before: '值 0', after: '第一次編輯',
    });
    const secondEdit = setCell(firstEdit, 'row-256', '第二次編輯');
    const secondSnapshot = updateWorkspaceTableStorageSnapshot(firstSnapshot, secondEdit, {
      type: 'set-cell', rowId: 'row-256', columnId: initial.columns[0].id, before: '值 256', after: '第二次編輯',
    });

    expect(secondSnapshot.record.chunkIds).toEqual(saved.record.chunkIds);
    expect([...secondSnapshot.chunks.keys()]).toEqual([...saved.chunks.keys()]);
    expect(secondSnapshot.record.orderPageIds).toEqual(saved.record.orderPageIds);
  });

  it('keeps both changed chunks dirty when the first queued save did not advance its baseline', () => {
    const initial = makeTable(512);
    const saved = createWorkspaceTableStorageSnapshot(initial);
    const firstEdit = setCell(initial, 'row-0', 'A');
    const firstSnapshot = updateWorkspaceTableStorageSnapshot(saved, firstEdit, {
      type: 'set-cell', rowId: 'row-0', columnId: initial.columns[0].id, before: '值 0', after: 'A',
    });
    const secondEdit = setCell(firstEdit, 'row-256', 'B');
    const secondSnapshot = updateWorkspaceTableStorageSnapshot(firstSnapshot, secondEdit, {
      type: 'set-cell', rowId: 'row-256', columnId: initial.columns[0].id, before: '值 256', after: 'B',
    });

    const plan = planWorkspaceTableStorageWrite(secondSnapshot, saved);

    expect(plan.upserts.map((chunk) => chunk.chunkId)).toEqual(saved.record.chunkIds);
    expect(plan.deletes).toEqual([]);
  });
});
