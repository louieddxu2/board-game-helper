import { describe, expect, it } from 'vitest';
import { createWorkspaceStoragePlan, tableStorageSignature } from './db';
import { createTable, emptyWorkspace } from './model';

describe('workspace independent table storage', () => {
  it('writes only changed tables and removes tables no longer referenced', () => {
    const unchanged = createTable('不變');
    const changed = createTable('修改前');
    const removed = createTable('已刪除');
    const signatures = new Map([
      [unchanged.id, tableStorageSignature(unchanged)],
      [changed.id, tableStorageSignature(changed)],
      [removed.id, tableStorageSignature(removed)],
    ]);
    const nextChanged = { ...changed, name: '修改後', updatedAt: changed.updatedAt + 1 };
    const data = { ...emptyWorkspace(), tables: [unchanged, nextChanged] };

    const plan = createWorkspaceStoragePlan(data, signatures, [unchanged.id, changed.id, removed.id]);

    expect(plan.upserts.map((table) => table.id)).toEqual([changed.id]);
    expect(plan.deletes).toEqual([removed.id]);
    expect(plan.meta).not.toHaveProperty('tables');
  });

  it('stores bottom navigation order in workspace metadata without rewriting tables', () => {
    const table = createTable('常用表格');
    const signatures = new Map([[table.id, tableStorageSignature(table)]]);
    const plan = createWorkspaceStoragePlan({ ...emptyWorkspace(), tables: [table], bottomNavigationTableIds: [table.id] }, signatures, [table.id]);

    expect(plan.upserts).toEqual([]);
    expect(plan.meta.bottomNavigationTableIds).toEqual([table.id]);
  });
});
