import { describe, expect, it } from 'vitest';
import { applyWorkspaceTableHistoryAction, createEmptyWorkspaceTableHistory, inferWorkspaceTableMutation, pruneWorkspaceTableHistory, pushWorkspaceTableHistory, workspaceHistoryLimit, workspaceHistoryRetentionMs } from './history';
import { emptyWorkspace } from './model';
import type { WorkspaceData, WorkspaceTable } from './types';

const table = (): WorkspaceTable => ({
  id: 'table-1', name: '測試表格', rowHeaderName: '物件', rowHeader: { id: 'row-header-table-1', name: '物件', inputType: 'text', options: [] },
  columns: [{ id: 'column-1', name: '名稱', inputType: 'text', options: [] }],
  rows: [{ id: 'row-1', name: '第一筆', values: { 'column-1': null } }], updatedAt: 1,
});

const data = (current = table()): WorkspaceData => ({ ...emptyWorkspace(), activeNodeId: 'node-1', nodes: [{ id: 'node-1', type: 'table', name: current.name, parentId: null, order: 0, tableId: current.id }], tables: [current] });

describe('workspace table history', () => {
  it('expires entries after six hours and keeps at most fifty per direction', () => {
    const now = 10_000_000;
    const entries = Array.from({ length: 55 }, (_, index) => ({ id: String(index), tableId: 'table-1', label: String(index), createdAt: now - index, action: { type: 'set-cell' as const, rowId: 'row-1', columnId: 'column-1', before: null, after: index } }));
    const expired = { ...entries[0], id: 'expired', createdAt: now - workspaceHistoryRetentionMs - 1 };
    const result = pruneWorkspaceTableHistory({ tableId: 'table-1', past: [...entries, expired], future: entries }, now);
    expect(result.past).toHaveLength(workspaceHistoryLimit);
    expect(result.future).toHaveLength(workspaceHistoryLimit);
    expect(result.past.some((entry) => entry.id === 'expired')).toBe(false);
    expect(result.past.at(-1)?.id).toBe('54');
  });

  it('clears redo history when a new edit is pushed', () => {
    const history = { ...createEmptyWorkspaceTableHistory('table-1'), future: [{ id: 'redo', tableId: 'table-1', label: 'redo', createdAt: 1, action: { type: 'set-cell' as const, rowId: 'row-1', columnId: 'column-1', before: null, after: 'x' } }] };
    const result = pushWorkspaceTableHistory(history, { tableId: 'table-1', label: 'edit', action: { type: 'set-cell', rowId: 'row-1', columnId: 'column-1', before: null, after: 'y' } }, 2);
    expect(result.future).toEqual([]);
    expect(result.past.at(-1)?.label).toBe('edit');
  });

  it('infers a single-cell edit and applies it in both directions', () => {
    const before = data();
    const after = data({ ...table(), rows: [{ ...table().rows[0], values: { 'column-1': '新值' } }] });
    const mutation = inferWorkspaceTableMutation(before, after);
    expect(mutation?.action).toEqual({ type: 'set-cell', rowId: 'row-1', columnId: 'column-1', before: null, after: '新值' });
    const undone = applyWorkspaceTableHistoryAction(before, 'table-1', mutation!.action, 'undo');
    expect(undone.tables[0].rows[0].values['column-1']).toBe(null);
    const redone = applyWorkspaceTableHistoryAction(undone, 'table-1', mutation!.action, 'redo');
    expect(redone.tables[0].rows[0].values['column-1']).toBe('新值');
  });

  it('infers row and column insertion without adding history for text scale', () => {
    const before = data();
    const newRow = { id: 'row-2', name: '第二筆', values: { 'column-1': null } };
    const withRow = data({ ...table(), rows: [...table().rows, newRow] });
    expect(inferWorkspaceTableMutation(before, withRow)?.action.type).toBe('add-row');
    const scaled = data({ ...table(), textScale: 1.5 });
    expect(inferWorkspaceTableMutation(before, scaled)).toBeUndefined();
  });

  it('undoes and redoes a multi-cell edit as one history action', () => {
    const current = table();
    current.rows.push({ id: 'row-2', name: '第二筆', values: { 'column-1': '舊值' } });
    const action = {
      type: 'set-cells' as const,
      columnId: 'column-1',
      changes: [
        { rowId: 'row-1', before: null, after: '同一值' },
        { rowId: 'row-2', before: '舊值', after: '同一值' },
      ],
    };
    const redone = applyWorkspaceTableHistoryAction(data(current), 'table-1', action, 'redo');
    expect(redone.tables[0].rows.map((row) => row.values['column-1'])).toEqual(['同一值', '同一值']);
    const undone = applyWorkspaceTableHistoryAction(redone, 'table-1', action, 'undo');
    expect(undone.tables[0].rows.map((row) => row.values['column-1'])).toEqual([null, '舊值']);
  });

  it('undoes and redoes a pasted range including appended rows and columns', () => {
    const addedColumn = { id: 'column-2', name: '屬性 2', inputType: 'text' as const, options: [] };
    const addedRow = { id: 'row-2', name: '物件 2', values: { 'column-1': null, 'column-2': null } };
    const action = {
      type: 'paste-range' as const,
      addedColumns: [addedColumn],
      addedRows: [addedRow],
      changes: [
        { rowId: 'row-1', columnId: 'column-1', before: null, after: '甲' },
        { rowId: 'row-2', columnId: 'column-2', before: null, after: '乙' },
      ],
    };
    const redone = applyWorkspaceTableHistoryAction(data(), 'table-1', action, 'redo');
    expect(redone.tables[0].columns).toHaveLength(2);
    expect(redone.tables[0].rows).toHaveLength(2);
    expect(redone.tables[0].rows[1].values['column-2']).toBe('乙');
    const undone = applyWorkspaceTableHistoryAction(redone, 'table-1', action, 'undo');
    expect(undone.tables[0].columns).toHaveLength(1);
    expect(undone.tables[0].rows).toHaveLength(1);
    expect(undone.tables[0].rows[0].values['column-1']).toBe(null);
  });
});
