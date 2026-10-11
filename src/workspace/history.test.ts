import { describe, expect, it } from 'vitest';
import { applyWorkspaceTableHistoryAction, createEmptyWorkspaceTableHistory, hydrateWorkspaceHistories, inferWorkspaceTableMutation, pruneWorkspaceTableHistory, pushWorkspaceTableHistory, workspaceHistoryLimit, workspaceHistoryRetentionMs } from './history';
import { removeWorkspaceColumnValues } from './cellChanges';
import { emptyWorkspace, normalizeWorkspace } from './model';
import { prepareWorkspaceColumnSave } from './columnConversion';
import type { WorkspaceData, WorkspaceTable } from './types';

const table = (): WorkspaceTable => ({
  id: 'table-1', name: '測試表格', rowHeaderName: '物件', rowHeader: { id: 'row-header-table-1', name: '物件', inputType: 'text', options: [] },
  columns: [{ id: 'column-1', name: '名稱', inputType: 'text', options: [] }],
  rows: [{ id: 'row-1', name: '第一筆', values: { 'column-1': null } }], updatedAt: 1,
});

const data = (current = table()): WorkspaceData => ({ ...emptyWorkspace(), activeNodeId: 'node-1', nodes: [{ id: 'node-1', type: 'table', name: current.name, parentId: null, order: 0, tableId: current.id }], tables: [current] });

describe('workspace table history', () => {
  it('ignores derived statistics during mutation inference and never saves them in history', () => {
    const before = data();
    const column = before.tables[0].columns[0];
    const statistics = { version: 1 as const, sourceRevision: 'current', isMultiple: false, counts: [], toJSON() { throw new Error('Statistics must not be serialized into history'); } };
    before.tables[0].columns[0] = { ...column, inputType: 'dynamic-select', dynamicOptions: statistics };
    const refreshed: WorkspaceTable = { ...before.tables[0], columns: [{ ...before.tables[0].columns[0], dynamicOptions: { ...statistics, sourceRevision: 'refreshed' } }] };
    expect(inferWorkspaceTableMutation(before, data(refreshed))).toBeUndefined();

    const configured = { ...refreshed, columns: [{ ...refreshed.columns[0], hidden: true }] };
    const mutation = inferWorkspaceTableMutation(before, data(configured))!;
    expect(mutation.action.type).toBe('update-column');
    if (mutation.action.type !== 'update-column') throw new Error('Expected column settings history');
    expect(mutation.action.before).not.toHaveProperty('dynamicOptions');
    expect(mutation.action.after).not.toHaveProperty('dynamicOptions');
    const stored = pushWorkspaceTableHistory(createEmptyWorkspaceTableHistory('table-1'), {
      ...mutation, action: { type: 'update-column', before: before.tables[0].columns[0], after: configured.columns[0] },
    });
    expect(() => JSON.stringify(stored)).not.toThrow();
    expect(applyWorkspaceTableHistoryAction(data(configured), 'table-1', stored.past[0].action, 'undo').tables[0].columns[0].hidden).toBeUndefined();
  });

  const historyEntry = (id: string, createdAt = Date.now()) => ({
    id,
    tableId: 'table-1',
    label: id,
    createdAt,
    action: { type: 'set-cell' as const, rowId: 'row-1', columnId: 'column-1', before: null, after: id },
  });

  it('merges an edit made while persisted history is still loading and drops the old redo branch', () => {
    const stored = new Map([['table-1', {
      tableId: 'table-1',
      past: [historyEntry('stored-edit')],
      future: [historyEntry('stale-redo')],
    }]]);
    const pending = new Map([['table-1', {
      tableId: 'table-1',
      past: [historyEntry('startup-edit')],
      future: [],
    }]]);

    const result = hydrateWorkspaceHistories(stored, pending, new Set(['table-1']), { all: false, ids: new Set() });

    expect(result.get('table-1')?.past.map((entry) => entry.id)).toEqual(['stored-edit', 'startup-edit']);
    expect(result.get('table-1')?.future).toEqual([]);
  });

  it('does not resurrect history after a table or workspace history reset during loading', () => {
    const stored = new Map([
      ['table-1', { tableId: 'table-1', past: [historyEntry('deleted-table')], future: [] }],
      ['table-2', { tableId: 'table-2', past: [historyEntry('cleared-workspace')], future: [] }],
    ]);

    const deletedTable = hydrateWorkspaceHistories(stored, new Map(), new Set(['table-1']), { all: false, ids: new Set(['table-1']) });
    expect(deletedTable).toEqual(new Map());

    const clearedWorkspace = hydrateWorkspaceHistories(stored, new Map(), new Set(['table-1', 'table-2']), { all: true, ids: new Set() });
    expect(clearedWorkspace).toEqual(new Map());
  });

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

  it('does not turn a revision metadata change into a user history entry', () => {
    const before = data({ ...table(), changeRevision: 'revision-before' });
    const after = data({ ...table(), changeRevision: 'revision-after' });

    expect(inferWorkspaceTableMutation(before, after)).toBeUndefined();
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

  it('restores link objects when a persisted column conversion is undone and reapplied', () => {
    const linkColumn = { ...table().columns[0], inputType: 'link' as const, name: '網站' };
    const beforeTable: WorkspaceTable = {
      ...table(),
      columns: [linkColumn],
      rows: [
        { id: 'row-1', name: '第一筆', values: { [linkColumn.id]: { url: 'https://example.com/game', label: '遊戲官網' } } },
        { id: 'row-2', name: '第二筆', values: { [linkColumn.id]: { url: 'https://example.com/rules', label: '' } } },
      ],
    };
    const before = data(beforeTable);
    const prepared = prepareWorkspaceColumnSave(beforeTable, { ...linkColumn, inputType: 'text' });
    const after = normalizeWorkspace(data(prepared.table));
    const action = {
      type: 'update-column' as const,
      before: linkColumn,
      after: prepared.table.columns[0],
      changes: prepared.changes,
    };
    const stored = pushWorkspaceTableHistory(createEmptyWorkspaceTableHistory(beforeTable.id), { tableId: beforeTable.id, label: '設定屬性', action });
    const persistedAction = JSON.parse(JSON.stringify(stored.past[0].action)) as typeof action;

    const undone = applyWorkspaceTableHistoryAction(after, beforeTable.id, persistedAction, 'undo');
    expect(undone.tables[0].columns[0].inputType).toBe('link');
    expect(undone.tables[0].rows.map((row) => row.values[linkColumn.id])).toEqual([
      { url: 'https://example.com/game', label: '遊戲官網' },
      { url: 'https://example.com/rules', label: '' },
    ]);

    const redone = applyWorkspaceTableHistoryAction(undone, beforeTable.id, persistedAction, 'redo');
    expect(redone.tables[0].columns[0].inputType).toBe('text');
    expect(redone.tables[0].rows.map((row) => row.values[linkColumn.id])).toEqual(['遊戲官網', 'https://example.com/rules']);
    expect(before.tables[0].rows.map((row) => row.values[linkColumn.id])).toEqual([
      { url: 'https://example.com/game', label: '遊戲官網' },
      { url: 'https://example.com/rules', label: '' },
    ]);
  });

  it('undoes and redoes a persisted row-header conversion with its original link values', () => {
    const rowHeader = { ...table().rowHeader!, inputType: 'link' as const, name: '來源' };
    const beforeTable: WorkspaceTable = {
      ...table(),
      rowHeaderName: '來源',
      rowHeader,
      rows: [
        { id: 'row-1', name: { url: 'https://example.com/a', label: '甲網站' }, values: { 'column-1': null } },
        { id: 'row-2', name: { url: 'https://example.com/b', label: '' }, values: { 'column-1': null } },
      ],
    };
    const prepared = prepareWorkspaceColumnSave(beforeTable, { ...rowHeader, inputType: 'text' });
    const action = {
      type: 'update-row-header' as const,
      before: rowHeader,
      after: prepared.table.rowHeader,
      beforeName: beforeTable.rowHeaderName,
      afterName: prepared.table.rowHeaderName,
      changes: prepared.changes,
    };
    const stored = pushWorkspaceTableHistory(createEmptyWorkspaceTableHistory(beforeTable.id), { tableId: beforeTable.id, label: '設定物件屬性', action });
    const persistedAction = JSON.parse(JSON.stringify(stored.past[0].action)) as typeof action;
    const after = normalizeWorkspace(data(prepared.table));

    const undone = applyWorkspaceTableHistoryAction(after, beforeTable.id, persistedAction, 'undo');
    expect(undone.tables[0].rows.map((row) => row.name)).toEqual([
      { url: 'https://example.com/a', label: '甲網站' },
      { url: 'https://example.com/b', label: '' },
    ]);
    const redone = applyWorkspaceTableHistoryAction(undone, beforeTable.id, persistedAction, 'redo');
    expect(redone.tables[0].rows.map((row) => row.name)).toEqual(['甲網站', 'https://example.com/b']);
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

  it('preserves existing values and references across repeated add-column redo', () => {
    const addedColumn = { id: 'column-2', name: '備註', inputType: 'text' as const, options: [] };
    const currentTable: WorkspaceTable = {
      ...table(),
      rows: [
        { id: 'row-1', name: '第一筆', values: { 'column-1': null, [addedColumn.id]: '既有值' } },
        { id: 'row-2', name: '第二筆', values: { 'column-1': '乙' } },
      ],
    };
    const action = { type: 'add-column' as const, column: addedColumn, index: 1 };
    const redone = applyWorkspaceTableHistoryAction(data(currentTable), currentTable.id, action, 'redo');
    expect(redone.tables[0].rows).toBe(currentTable.rows);
    expect(redone.tables[0].rows[0]).toBe(currentTable.rows[0]);
    expect(redone.tables[0].rows[0].values[addedColumn.id]).toBe('既有值');
    expect(Object.hasOwn(redone.tables[0].rows[1].values, addedColumn.id)).toBe(false);

    const repeated = applyWorkspaceTableHistoryAction(redone, currentTable.id, action, 'redo');
    expect(repeated.tables[0].rows).toBe(redone.tables[0].rows);
    expect(repeated.tables[0].rows[0]).toBe(redone.tables[0].rows[0]);
    expect(repeated.tables[0].rows[1]).toBe(redone.tables[0].rows[1]);
    expect(repeated.tables[0].rows[0].values[addedColumn.id]).toBe('既有值');
    expect(Object.hasOwn(repeated.tables[0].rows[1].values, addedColumn.id)).toBe(false);
    expect(repeated.tables[0].columns).toEqual([currentTable.columns[0], addedColumn]);
  });

  it('keeps a missing new-column key through add undo and redo', () => {
    const addedColumn = { id: 'column-2', name: '備註', inputType: 'text' as const, options: [] };
    const before = data({
      ...table(),
      rows: [
        { id: 'row-1', name: '第一筆', values: { 'column-1': null } },
        { id: 'row-2', name: '第二筆', values: { 'column-1': '乙' } },
      ],
    });
    const action = { type: 'add-column' as const, column: addedColumn, index: 1 };

    const added = applyWorkspaceTableHistoryAction(before, before.tables[0].id, action, 'redo');
    expect(added.tables[0].rows).toBe(before.tables[0].rows);
    expect(added.tables[0].rows.every(row => !Object.hasOwn(row.values, addedColumn.id))).toBe(true);

    const undone = applyWorkspaceTableHistoryAction(added, before.tables[0].id, action, 'undo');
    expect(undone.tables[0].rows).toBe(added.tables[0].rows);
    expect(undone.tables[0].columns).toEqual(before.tables[0].columns);

    const redone = applyWorkspaceTableHistoryAction(undone, before.tables[0].id, action, 'redo');
    expect(redone.tables[0].rows).toBe(undone.tables[0].rows);
    expect(redone.tables[0].rows.every(row => !Object.hasOwn(row.values, addedColumn.id))).toBe(true);
  });

  it('removes sparse column values on redo and restores explicit nulls on undo', () => {
    const removedColumn = { id: 'column-2', name: '備註', inputType: 'link' as const, options: [] };
    const link = { url: 'https://example.com/rules', label: '規則' };
    const currentTable: WorkspaceTable = {
      ...table(),
      columns: [...table().columns, removedColumn],
      rows: [
        { id: 'row-1', name: '第一筆', values: { 'column-1': null, [removedColumn.id]: null } },
        { id: 'row-2', name: '第二筆', values: { 'column-1': '乙' } },
        { id: 'row-3', name: '第三筆', values: { 'column-1': '丙', [removedColumn.id]: link } },
      ],
    };
    const action = {
      type: 'remove-column' as const, column: removedColumn, index: 1,
      values: { 'row-1': null, 'row-2': null, 'row-3': link },
    };
    const redone = applyWorkspaceTableHistoryAction(data(currentTable), currentTable.id, action, 'redo');
    expect(redone.tables[0].rows[0]).not.toBe(currentTable.rows[0]);
    expect(redone.tables[0].rows[1]).toBe(currentTable.rows[1]);
    expect(redone.tables[0].rows[2]).not.toBe(currentTable.rows[2]);
    expect(redone.tables[0].rows.every(row => !(removedColumn.id in row.values))).toBe(true);

    const undone = applyWorkspaceTableHistoryAction(redone, currentTable.id, action, 'undo');
    expect(undone.tables[0].rows.every(row => removedColumn.id in row.values)).toBe(true);
    expect(undone.tables[0].rows[0].values[removedColumn.id]).toBeNull();
    expect(undone.tables[0].rows[1].values[removedColumn.id]).toBeNull();
    expect(undone.tables[0].rows[2].values[removedColumn.id]).toEqual(link);
  });

  it('infers sparse removal values and restores only captured rows through undo and redo', () => {
    const removedColumn = { id: 'column-2', name: '稀疏欄', inputType: 'link' as const, options: [] };
    const linkValue = { url: 'https://example.com/rules', label: '規則' };
    const beforeTable: WorkspaceTable = {
      ...table(),
      columns: [...table().columns, removedColumn],
      rows: [
        { id: 'row-missing', name: '缺少', values: { 'column-1': 'a' } },
        { id: 'row-null', name: '空值', values: { 'column-1': 'b', [removedColumn.id]: null } },
        { id: 'row-empty', name: '空字串', values: { 'column-1': 'c', [removedColumn.id]: '' } },
        { id: 'row-zero', name: '零', values: { 'column-1': 'd', [removedColumn.id]: 0 } },
        { id: 'row-link', name: '連結', values: { 'column-1': 'e', [removedColumn.id]: linkValue } },
        { id: '__proto__', name: '特殊', values: { 'column-1': 'f', [removedColumn.id]: '特殊值' } },
      ],
    };
    const before = data(beforeTable);
    const afterTable: WorkspaceTable = {
      ...beforeTable,
      columns: [beforeTable.columns[0]],
      rows: removeWorkspaceColumnValues(beforeTable.rows, new Set([removedColumn.id])),
    };
    const mutation = inferWorkspaceTableMutation(before, data(afterTable));

    expect(mutation?.action.type).toBe('remove-column');
    if (!mutation || mutation.action.type !== 'remove-column') throw new Error('Expected sparse remove-column action');
    expect(Object.keys(mutation.action.values)).toEqual(['row-empty', 'row-zero', 'row-link', '__proto__']);
    expect(Object.hasOwn(mutation.action.values, 'row-missing')).toBe(false);
    expect(Object.hasOwn(mutation.action.values, 'row-null')).toBe(false);
    expect(mutation.action.values['row-empty']).toBe('');
    expect(mutation.action.values['row-zero']).toBe(0);
    expect(mutation.action.values['row-link']).toEqual(linkValue);
    expect(Object.hasOwn(mutation.action.values, '__proto__')).toBe(true);

    const removed = applyWorkspaceTableHistoryAction(before, beforeTable.id, mutation.action, 'redo');
    const undone = applyWorkspaceTableHistoryAction(removed, beforeTable.id, mutation.action, 'undo');
    const redone = applyWorkspaceTableHistoryAction(undone, beforeTable.id, mutation.action, 'redo');
    expect(removed.tables[0].rows[0]).toBe(beforeTable.rows[0]);
    expect(undone.tables[0].rows[0]).toBe(removed.tables[0].rows[0]);
    expect(Object.hasOwn(undone.tables[0].rows[0].values, removedColumn.id)).toBe(false);
    expect(undone.tables[0].rows.slice(1).map(row => row.values[removedColumn.id])).toEqual([undefined, '', 0, linkValue, '特殊值']);
    expect(redone.tables[0].rows.every(row => !Object.hasOwn(row.values, removedColumn.id))).toBe(true);
  });

  it('keeps unaffected sparse rows through pasted-column undo', () => {
    const addedColumn = { id: 'column-2', name: '備註', inputType: 'text' as const, options: [] };
    const addedRow = { id: 'row-4', name: '新增', values: { 'column-1': null, [addedColumn.id]: null } };
    const currentTable: WorkspaceTable = {
      ...table(),
      rows: [
        { id: 'row-1', name: '第一筆', values: { 'column-1': null } },
        { id: 'row-2', name: '第二筆', values: { 'column-1': '乙' } },
        { id: 'row-3', name: '第三筆', values: { 'column-1': '丙', [addedColumn.id]: '外部值' } },
      ],
    };
    const action = {
      type: 'paste-range' as const,
      addedColumns: [addedColumn], addedRows: [addedRow],
      changes: [{ rowId: 'row-1', columnId: 'column-1', before: null, after: '甲' }, { rowId: addedRow.id, columnId: addedColumn.id, before: null, after: '新增值' }],
    };
    const redone = applyWorkspaceTableHistoryAction(data(currentTable), currentTable.id, action, 'redo');
    expect(redone.tables[0].rows[1]).toBe(currentTable.rows[1]);
    expect(redone.tables[0].rows[2]).toBe(currentTable.rows[2]);
    expect(redone.tables[0].rows[3].values[addedColumn.id]).toBe('新增值');
    const undone = applyWorkspaceTableHistoryAction(redone, currentTable.id, action, 'undo');
    expect(undone.tables[0].rows[1]).toBe(currentTable.rows[1]);
    expect(undone.tables[0].rows[2]).not.toBe(currentTable.rows[2]);
    expect(undone.tables[0].rows[2].values[addedColumn.id]).toBeUndefined();
  });

  it('appends a large paste linearly, preserves row references, and does not duplicate redo additions', () => {
    let rowIdReads = 0;
    const column = { id: 'column-1', name: '名稱', inputType: 'text' as const, options: [] };
    const addedColumn = { id: 'column-2', name: '網址', inputType: 'link' as const, options: [], hidden: true };
    const countedRow = (id: string, name: string, value: string, includeAddedColumn = false) => {
      const row = { id, name, values: { [column.id]: value, ...(includeAddedColumn ? { [addedColumn.id]: null } : {}) } };
      Object.defineProperty(row, 'id', { configurable: true, enumerable: true, get: () => { rowIdReads += 1; return id; } });
      return row;
    };
    const existingRows = Array.from({ length: 10_000 }, (_, index) => countedRow(`row-${index}`, `既有 ${index}`, '既有'));
    const addedRows = Array.from({ length: 10_000 }, (_, index) => countedRow(`added-${index}`, `新增 ${index}`, `值 ${index}`, true));
    const currentTable: WorkspaceTable = {
      id: 'table-1', name: '大型貼上', rowHeaderName: '物件',
      rowHeader: { id: 'row-header-table-1', name: '物件', inputType: 'text', options: [] },
      columns: [column], rows: existingRows, updatedAt: 1,
    };
    const source = data(currentTable);
    const action = { type: 'paste-range' as const, changes: [], addedRows, addedColumns: [addedColumn] };
    const rowBudget = (existingRows.length + addedRows.length) * 4;

    rowIdReads = 0;
    const redone = applyWorkspaceTableHistoryAction(source, currentTable.id, action, 'redo');
    expect(rowIdReads).toBeLessThanOrEqual(rowBudget);
    expect(redone.tables[0].rows).toHaveLength(20_000);
    expect(redone.tables[0].rows.slice(0, existingRows.length).every((row, index) => row === existingRows[index])).toBe(true);
    expect(redone.tables[0].rows.slice(existingRows.length).every((row, index) => row === addedRows[index])).toBe(true);
    expect(redone.tables[0].columns).toEqual([column, addedColumn]);
    expect(source.tables[0].rows).toBe(existingRows);
    expect(source.tables[0].rows[0].values[column.id]).toBe('既有');
    expect(source.tables[0].columns).toEqual([column]);

    rowIdReads = 0;
    const repeated = applyWorkspaceTableHistoryAction(redone, currentTable.id, action, 'redo');
    expect(rowIdReads).toBeLessThanOrEqual(rowBudget);
    expect(repeated.tables[0].rows).toHaveLength(20_000);
    expect(repeated.tables[0].rows.slice(0, existingRows.length).every((row, index) => row === existingRows[index])).toBe(true);
    expect(repeated.tables[0].rows.slice(existingRows.length).every((row, index) => row === addedRows[index])).toBe(true);
    expect(repeated.tables[0].columns).toEqual([column, addedColumn]);
    expect(repeated.tables[0].rows[existingRows.length].values[addedColumn.id]).toBe(null);

    const undone = applyWorkspaceTableHistoryAction(repeated, currentTable.id, action, 'undo');
    expect(undone.tables[0].rows).toEqual(existingRows);
    expect(undone.tables[0].rows.every((row) => !(addedColumn.id in row.values))).toBe(true);
    expect(undone.tables[0].columns).toEqual([column]);
    const redoneAgain = applyWorkspaceTableHistoryAction(undone, currentTable.id, action, 'redo');
    expect(redoneAgain.tables[0].rows.slice(existingRows.length).every((row, index) => row === addedRows[index])).toBe(true);
    expect(redoneAgain.tables[0].columns[1]).toBe(addedColumn);
  });

  it('repositions duplicate insertions and clamps their indexes', () => {
    const current = table();
    const secondColumn = { id: 'column-2', name: '第二欄', inputType: 'text' as const, options: [] };
    current.columns = [...current.columns, secondColumn];
    current.rows[0].values[secondColumn.id] = null;
    const currentData = data(current);
    const duplicateRow = { ...current.rows[0], name: '重放列' };
    const movedRow = applyWorkspaceTableHistoryAction(currentData, current.id, { type: 'add-row', row: duplicateRow, index: 99 }, 'redo').tables[0];
    expect(movedRow.rows).toEqual([duplicateRow]);

    const duplicateColumn = { ...current.columns[0], name: '重放欄' };
    const movedColumn = applyWorkspaceTableHistoryAction(currentData, current.id, { type: 'add-column', column: duplicateColumn, index: 99 }, 'redo').tables[0];
    expect(movedColumn.columns).toEqual([secondColumn, duplicateColumn]);

    const insertedRow = { id: 'row-new', name: '最前列', values: { 'column-1': null, 'column-2': null } };
    const clamped = applyWorkspaceTableHistoryAction(currentData, current.id, { type: 'add-row', row: insertedRow, index: -5 }, 'redo').tables[0];
    expect(clamped.rows[0]).toBe(insertedRow);
    expect(clamped.rows[1]).toBe(current.rows[0]);
  });
});
