import { describe, expect, it } from 'vitest';
import { applyWorkspaceTableHistoryAction, type WorkspaceTableHistoryAction } from './history';
import { createTable, emptyWorkspace } from './model';
import type { WorkspaceData, WorkspaceTable } from './types';

const makeTable = (rowCount = 4, columnCount = 3): WorkspaceTable => {
  const table = createTable('移動測試');
  table.columns = Array.from({ length: columnCount }, (_, index) => ({
    id: `column-${index}`, name: `欄位 ${index}`, inputType: 'text' as const, options: [],
  }));
  table.rows = Array.from({ length: rowCount }, (_, index) => ({
    id: `row-${index}`, name: `物件 ${index}`,
    values: Object.fromEntries(table.columns.map(column => [column.id, `值-${index}-${column.id}`])),
  }));
  return table;
};

const dataOf = (table: WorkspaceTable): WorkspaceData => ({
  ...emptyWorkspace(),
  activeNodeId: 'node-1',
  nodes: [{ id: 'node-1', type: 'table', tableId: table.id, name: table.name, parentId: null, order: 0 }],
  tables: [table],
});

const apply = (table: WorkspaceTable, action: WorkspaceTableHistoryAction, direction: 'undo' | 'redo' = 'redo') =>
  applyWorkspaceTableHistoryAction(dataOf(table), table.id, action, direction).tables[0];

describe('compact workspace move history actions', () => {
  it.each([
    { type: 'row' as const, ids: ['row-0', 'row-1', 'row-2', 'row-3'], source: 'row-0', beforeIndex: 0, afterIndex: 2 },
    { type: 'column' as const, ids: ['column-0', 'column-1', 'column-2'], source: 'column-0', beforeIndex: 0, afterIndex: 2 },
  ])('moves a $type in both directions while preserving item references', scenario => {
    const before = makeTable();
    const action: WorkspaceTableHistoryAction = scenario.type === 'row'
      ? { type: 'move-row', rowId: scenario.source, beforeIndex: scenario.beforeIndex, afterIndex: scenario.afterIndex }
      : { type: 'move-column', columnId: scenario.source, beforeIndex: scenario.beforeIndex, afterIndex: scenario.afterIndex };
    const redone = apply(before, action);
    const values = scenario.type === 'row' ? redone.rows : redone.columns;
    expect(values.map(item => item.id)).toEqual(scenario.type === 'row'
      ? ['row-1', 'row-2', 'row-0', 'row-3']
      : ['column-1', 'column-2', 'column-0']);
    const undone = apply(redone, action, 'undo');
    const restored = scenario.type === 'row' ? undone.rows : undone.columns;
    expect(restored.map(item => item.id)).toEqual(scenario.ids);
    const reapplied = apply(undone, action);
    const reappliedItems = scenario.type === 'row' ? reapplied.rows : reapplied.columns;
    expect(reappliedItems.map(item => item.id)).toEqual(values.map(item => item.id));
    if (scenario.type === 'row') expect(reapplied.rows[2].values).toBe(before.rows[0].values);
  });

  it('replays mixed edits, additions, removal and a move in reverse order', () => {
    const initial = makeTable(3, 1);
    const columnId = initial.columns[0].id;
    const added = { id: 'row-added', name: '新增', values: { [columnId]: null } };
    const add: WorkspaceTableHistoryAction = { type: 'add-row', row: added, index: 3 };
    const edit: WorkspaceTableHistoryAction = { type: 'set-cell', rowId: 'row-1', columnId, before: '值-1-column-0', after: '已編輯' };
    const move: WorkspaceTableHistoryAction = { type: 'move-row', rowId: 'row-0', beforeIndex: 0, afterIndex: 2 };
    const remove: WorkspaceTableHistoryAction = { type: 'remove-row', row: initial.rows[2], index: 1 };
    const afterAdd = apply(initial, add);
    const afterEdit = apply(afterAdd, edit);
    const afterMove = apply(afterEdit, move);
    const afterRemove = apply(afterMove, remove);
    expect(afterRemove.rows.map(row => row.id)).toEqual(['row-1', 'row-0', 'row-added']);
    expect(afterRemove.rows[0].values[columnId]).toBe('已編輯');

    const undoneRemove = apply(afterRemove, remove, 'undo');
    const undoneMove = apply(undoneRemove, move, 'undo');
    const undoneEdit = apply(undoneMove, edit, 'undo');
    const undoneAdd = apply(undoneEdit, add, 'undo');
    expect(undoneAdd.rows.map(row => row.id)).toEqual(initial.rows.map(row => row.id));
    expect(undoneAdd.rows.map(row => row.values[columnId])).toEqual(initial.rows.map(row => row.values[columnId]));

    const redoneAdd = apply(undoneAdd, add);
    const redoneEdit = apply(redoneAdd, edit);
    const redoneMove = apply(redoneEdit, move);
    const redoneRemove = apply(redoneMove, remove);
    expect(redoneRemove.rows.map(row => row.id)).toEqual(afterRemove.rows.map(row => row.id));
    expect(redoneRemove.rows[0].values[columnId]).toBe('已編輯');
  });

  it('treats a missing target or an unchanged index as a no-op for row and column order', () => {
    const table = makeTable();
    const rowSame = apply(table, { type: 'move-row', rowId: 'row-1', beforeIndex: 1, afterIndex: 1 });
    const rowMissing = apply(table, { type: 'move-row', rowId: 'missing', beforeIndex: 0, afterIndex: 1 });
    const columnSame = apply(table, { type: 'move-column', columnId: 'column-1', beforeIndex: 1, afterIndex: 1 });
    const columnMissing = apply(table, { type: 'move-column', columnId: 'missing', beforeIndex: 0, afterIndex: 1 });
    expect(rowSame.rows).toBe(table.rows);
    expect(rowMissing.rows).toBe(table.rows);
    expect(columnSame.columns).toBe(table.columns);
    expect(columnMissing.columns).toBe(table.columns);
  });

  it('keeps legacy full-order actions compatible with undo and redo', () => {
    const before = makeTable(3, 3);
    const action: WorkspaceTableHistoryAction = {
      type: 'reorder-rows', beforeIds: ['row-0', 'row-1', 'row-2'], afterIds: ['row-2', 'row-0', 'row-1'],
    };
    const redone = apply(before, action);
    expect(redone.rows.map(row => row.id)).toEqual(['row-2', 'row-0', 'row-1']);
    expect(apply(redone, action, 'undo').rows.map(row => row.id)).toEqual(action.beforeIds);
  });

});
