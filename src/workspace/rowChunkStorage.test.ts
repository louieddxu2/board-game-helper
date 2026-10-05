import { describe, expect, it } from 'vitest';
import {
  assembleChunkedWorkspaceTable,
  createWorkspaceTableStorageSnapshot,
  defaultRowChunkCapacity,
  hasCurrentWorkspaceColumnState,
  planWorkspaceTableStorageWrite,
  updateWorkspaceTableStorageSnapshot,
  WorkspaceStorageIntegrityError,
} from './rowChunkStorage';
import { createColumn, createTable, emptyWorkspace, ensureTableDynamicOptions, normalizeWorkspace } from './model';
import { WorkspaceDynamicOptionsCache } from './dynamicOptionsCache';
import { assignWorkspaceChangeRevisions } from './changeRevisions';
import type { WorkspaceTable } from './types';

const makeTable = (rowCount: number): WorkspaceTable => {
  const table = createTable('分塊測試');
  const [column] = table.columns;
  return {
    ...table,
    rows: Array.from({ length: rowCount }, (_, index) => ({
      id: `row-${index}`,
      name: `物件 ${index}`,
      values: { [column.id]: `值 ${index}` },
    })),
  };
};

const cellAction = (table: WorkspaceTable, rowId: string, before: string, after: string) => ({
  type: 'set-cell' as const,
  rowId,
  columnId: table.columns[0].id,
  before,
  after,
});

const setCell = (table: WorkspaceTable, rowId: string, value: string): WorkspaceTable => {
  const columnId = table.columns[0].id;
  return {
    ...table,
    updatedAt: table.updatedAt + 1,
    rows: table.rows.map((row) => row.id === rowId ? { ...row, values: { ...row.values, [columnId]: value } } : row),
  };
};

describe('workspace row chunk storage contracts', () => {
  it('stores dynamic statistics with column state and edits one chunk without rewriting 10,000 row IDs', () => {
    const original = makeTable(10_000);
    original.columns[0] = { ...original.columns[0], inputType: 'dynamic-select' };
    const columnId = original.columns[0].id;
    original.rows = original.rows.map((row, index) => ({ ...row, values: { [columnId]: index < 6_000 ? 'Common' : 'Rare' } }));
    const table = ensureTableDynamicOptions(original);
    const saved = createWorkspaceTableStorageSnapshot(table);
    const data = { ...emptyWorkspace(), tables: [table] };
    const action = cellAction(table, 'row-9999', 'Rare', 'Common');
    const revised = assignWorkspaceChangeRevisions(data, { ...data, tables: [setCell(table, 'row-9999', 'Common')] });
    const prepared = new WorkspaceDynamicOptionsCache().prepare(data, revised, { tableId: table.id, action });
    const next = updateWorkspaceTableStorageSnapshot(saved, prepared.tables[0], action);
    const plan = planWorkspaceTableStorageWrite(next, saved);

    expect(plan.definition).toBeUndefined();
    expect(next.record.rowOrder).toBe(saved.record.rowOrder);
    expect(plan.upserts).toHaveLength(1);
    expect(plan.state.columnState?.[columnId].dynamicOptions).toMatchObject({ counts: [{ count: 6_001 }, { count: 3_999 }] });
    expect(next.record.definition.columns[0].dynamicOptions).toBeUndefined();

    const persisted = structuredClone({ record: next.record, state: plan.state, chunks: [...next.chunks.values()] });
    const reopened = assembleChunkedWorkspaceTable(table.id, persisted.record, persisted.state, persisted.chunks);
    const normalized = normalizeWorkspace({ ...data, tables: [reopened] }).tables[0];
    expect(hasCurrentWorkspaceColumnState(normalized, persisted.state)).toBe(true);
    expect(new WorkspaceDynamicOptionsCache().getOptions(normalized, columnId)).toEqual(['Common', 'Rare']);
    expect(normalized).not.toHaveProperty('columnState');
  });

  it('repairs missing or invalid legacy statistics by writing state only', () => {
    const table = makeTable(257);
    table.columns[0] = { ...table.columns[0], inputType: 'dynamic-select' };
    const saved = createWorkspaceTableStorageSnapshot(table);
    const state = { updatedAt: table.updatedAt };
    const assembled = assembleChunkedWorkspaceTable(table.id, saved.record, state, [...saved.chunks.values()]);
    const normalized = normalizeWorkspace({ ...emptyWorkspace(), tables: [assembled] }).tables[0];
    expect(hasCurrentWorkspaceColumnState(normalized, state)).toBe(false);
    const baseline = createWorkspaceTableStorageSnapshot(normalized, { record: saved.record, chunks: [...saved.chunks.values()] });
    const plan = planWorkspaceTableStorageWrite(baseline, baseline);
    expect(plan.definition).toBeUndefined();
    expect(plan.upserts).toEqual([]);
    expect(plan.state.columnState?.[table.columns[0].id].dynamicOptions?.counts).toHaveLength(257);
  });

  it('drops saved statistics when a column is disabled or deleted', () => {
    const original = makeTable(1);
    original.columns[0] = { ...original.columns[0], inputType: 'dynamic-select' };
    const table = ensureTableDynamicOptions(original);
    const saved = createWorkspaceTableStorageSnapshot(table);
    const data = { ...emptyWorkspace(), tables: [table] };
    for (const columns of [[{ ...table.columns[0], inputType: 'text' as const }], []]) {
      const prepared = new WorkspaceDynamicOptionsCache().prepare(data, { ...data, tables: [{ ...table, columns }] });
      const next = updateWorkspaceTableStorageSnapshot(saved, prepared.tables[0]);
      const plan = planWorkspaceTableStorageWrite(next, saved);
      expect(plan.state.columnState).toEqual({});
      expect(hasCurrentWorkspaceColumnState(prepared.tables[0], plan.state)).toBe(true);
    }
  });

  it('uses 256 row chunks and preserves their IDs through normal edits', () => {
    const table = makeTable(513);
    const initial = createWorkspaceTableStorageSnapshot(table);
    const next = updateWorkspaceTableStorageSnapshot(initial, setCell(table, 'row-300', '修改'), cellAction(table, 'row-300', '值 300', '修改'));

    expect(defaultRowChunkCapacity).toBe(256);
    expect(initial.record.chunkCapacity).toBe(256);
    expect(initial.record.chunkIds).toHaveLength(3);
    expect(next.record.chunkIds).toEqual(initial.record.chunkIds);
  });

  it('writes only the affected chunk for a single-cell edit', () => {
    const table = makeTable(513);
    const saved = createWorkspaceTableStorageSnapshot(table);
    const next = updateWorkspaceTableStorageSnapshot(saved, setCell(table, 'row-300', '修改'), cellAction(table, 'row-300', '值 300', '修改'));

    const plan = planWorkspaceTableStorageWrite(next, saved);

    expect(plan.definition).toBeUndefined();
    expect(plan.upserts.map((chunk) => chunk.chunkId)).toEqual([saved.record.chunkIds[1]]);
    expect(plan.deletes).toEqual([]);
    expect(next.chunks.get(saved.record.chunkIds[0])).toBe(saved.chunks.get(saved.record.chunkIds[0]));
    expect(next.chunks.get(saved.record.chunkIds[2])).toBe(saved.chunks.get(saved.record.chunkIds[2]));
  });

  it('changes only the manifest on row reorder and writes no chunks', () => {
    const table = makeTable(513);
    const saved = createWorkspaceTableStorageSnapshot(table);
    const reordered = { ...table, rows: [table.rows[512], ...table.rows.slice(0, 512)] };
    const next = updateWorkspaceTableStorageSnapshot(saved, reordered, {
      type: 'reorder-rows', beforeIds: table.rows.map((row) => row.id), afterIds: reordered.rows.map((row) => row.id),
    });

    const plan = planWorkspaceTableStorageWrite(next, saved);

    expect(next.record.rowOrder[0]).toBe('row-512');
    expect(plan.definition).toEqual(next.record);
    expect(plan.upserts).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });

  it('keeps existing chunk IDs when adding or removing at the top', () => {
    const table = makeTable(512);
    const saved = createWorkspaceTableStorageSnapshot(table);
    const addedRow = { id: 'row-new', name: '最上方', values: { [table.columns[0].id]: '新增' } };
    const added = { ...table, rows: [addedRow, ...table.rows], updatedAt: table.updatedAt + 1 };
    const afterAdd = updateWorkspaceTableStorageSnapshot(saved, added, {
      type: 'add-row', row: addedRow, index: 0,
    });
    const addPlan = planWorkspaceTableStorageWrite(afterAdd, saved);

    expect(afterAdd.record.chunkIds.slice(0, 2)).toEqual(saved.record.chunkIds);
    expect(addPlan.upserts).toHaveLength(1);
    expect(addPlan.upserts[0].chunkId).not.toBe(saved.record.chunkIds[0]);
    expect(addPlan.upserts[0].chunkId).not.toBe(saved.record.chunkIds[1]);

    const removed = { ...table, rows: table.rows.slice(1), updatedAt: table.updatedAt + 1 };
    const afterRemove = updateWorkspaceTableStorageSnapshot(saved, removed, {
      type: 'remove-row', row: table.rows[0], index: 0,
    });
    const removePlan = planWorkspaceTableStorageWrite(afterRemove, saved);

    expect(afterRemove.record.chunkIds).toEqual(saved.record.chunkIds);
    expect(removePlan.upserts.map((chunk) => chunk.chunkId)).toEqual([saved.record.chunkIds[0]]);
    expect(removePlan.deletes).toEqual([]);
  });

  it('reclaims empty chunks and fills an available slot before creating another chunk', () => {
    const table = makeTable(512);
    const saved = createWorkspaceTableStorageSnapshot(table);
    const retainedLastRow = table.rows[511];
    const afterRemove = updateWorkspaceTableStorageSnapshot(saved, {
      ...table,
      rows: [...table.rows.slice(0, 256), retainedLastRow],
      updatedAt: table.updatedAt + 1,
    }, {
      type: 'paste-range',
      changes: table.rows.slice(256, 511).map((row) => ({ rowId: row.id, columnId: table.columns[0].id, before: row.values[table.columns[0].id], after: null })),
      addedRows: [], addedColumns: [],
    });
    const removedPlan = planWorkspaceTableStorageWrite(afterRemove, saved);

    expect(afterRemove.record.chunkIds).toEqual(saved.record.chunkIds);
    expect(afterRemove.chunks.get(saved.record.chunkIds[1])?.rows).toHaveLength(1);
    expect(removedPlan.upserts.map((chunk) => chunk.chunkId)).toEqual([saved.record.chunkIds[1]]);

    const addedRow = { id: 'row-reused', name: '補位', values: { [table.columns[0].id]: '補位' } };
    const afterAdd = updateWorkspaceTableStorageSnapshot(afterRemove, {
      ...afterRemove.table,
      rows: [...afterRemove.table.rows, addedRow],
      updatedAt: afterRemove.table.updatedAt + 1,
    }, { type: 'add-row', row: addedRow, index: afterRemove.table.rows.length });
    const addPlan = planWorkspaceTableStorageWrite(afterAdd, afterRemove);

    expect(afterAdd.chunks.get(saved.record.chunkIds[1])?.rows.map((row) => row.id)).toEqual(['row-511', 'row-reused']);
    expect(addPlan.upserts.map((chunk) => chunk.chunkId)).toEqual([saved.record.chunkIds[1]]);

    const emptied = updateWorkspaceTableStorageSnapshot(afterAdd, {
      ...afterAdd.table,
      rows: afterAdd.table.rows.slice(0, 256),
      updatedAt: afterAdd.table.updatedAt + 1,
    }, { type: 'remove-row', row: addedRow, index: afterAdd.table.rows.length - 1 });
    const emptiedAgain = updateWorkspaceTableStorageSnapshot(emptied, {
      ...emptied.table,
      rows: emptied.table.rows.slice(0, 256),
      updatedAt: emptied.table.updatedAt + 1,
    }, { type: 'remove-row', row: emptied.table.rows[256], index: 256 });
    const emptyPlan = planWorkspaceTableStorageWrite(emptiedAgain, afterAdd);

    expect(emptiedAgain.record.chunkIds).toEqual([saved.record.chunkIds[0]]);
    expect(emptyPlan.deletes).toEqual([saved.record.chunkIds[1]]);
  });

  it('updates each affected chunk for a batch spanning two chunks', () => {
    const table = makeTable(512);
    const saved = createWorkspaceTableStorageSnapshot(table);
    const first = setCell(table, 'row-0', 'A');
    const changed = setCell(first, 'row-256', 'B');
    const next = updateWorkspaceTableStorageSnapshot(saved, changed, {
      type: 'set-cells', columnId: table.columns[0].id, changes: [
        { rowId: 'row-0', before: '值 0', after: 'A' },
        { rowId: 'row-256', before: '值 256', after: 'B' },
      ],
    });

    const plan = planWorkspaceTableStorageWrite(next, saved);

    expect(plan.upserts.map((chunk) => chunk.chunkId)).toEqual(saved.record.chunkIds);
    expect(next.chunks.get(saved.record.chunkIds[0])?.rows[0].values[table.columns[0].id]).toBe('A');
    expect(next.chunks.get(saved.record.chunkIds[1])?.rows[0].values[table.columns[0].id]).toBe('B');
  });

  it('preserves existing values when a column changes and writes all affected chunks', () => {
    const table = makeTable(513);
    const saved = createWorkspaceTableStorageSnapshot(table);
    const addedColumn = createColumn('新增欄');
    const next = {
      ...table,
      columns: [...table.columns, addedColumn],
      rows: table.rows.map((row) => ({ ...row, values: { ...row.values, [addedColumn.id]: null } })),
      updatedAt: table.updatedAt + 1,
    };
    const snapshot = updateWorkspaceTableStorageSnapshot(saved, next, { type: 'add-column', column: addedColumn, index: 1 });
    const plan = planWorkspaceTableStorageWrite(snapshot, saved);

    expect(snapshot.table.rows[0].values[table.columns[0].id]).toBe('值 0');
    expect(snapshot.table.rows[300].values[table.columns[0].id]).toBe('值 300');
    expect(snapshot.table.rows.every((row) => row.values[addedColumn.id] === null)).toBe(true);
    expect(plan.definition).toEqual(snapshot.record);
    expect(plan.upserts.map((chunk) => chunk.chunkId)).toEqual(saved.record.chunkIds);
  });

  it('rejects incomplete and duplicate chunk data before assembly', () => {
    const table = makeTable(257);
    const saved = createWorkspaceTableStorageSnapshot(table);
    const state = { updatedAt: table.updatedAt };
    const chunks = [...saved.chunks.values()];

    expect(() => assembleChunkedWorkspaceTable(table.id, saved.record, state, chunks.slice(0, 1))).toThrow(WorkspaceStorageIntegrityError);
    expect(() => assembleChunkedWorkspaceTable(table.id, saved.record, state, [chunks[0], { ...chunks[1], chunkId: chunks[0].chunkId }])).toThrow(WorkspaceStorageIntegrityError);
    expect(() => assembleChunkedWorkspaceTable(table.id, saved.record, state, [chunks[0], { ...chunks[1], rows: [chunks[0].rows[0], ...chunks[1].rows.slice(1)] }])).toThrow(WorkspaceStorageIntegrityError);
  });
});
