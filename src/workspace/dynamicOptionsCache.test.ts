import { describe, expect, it } from 'vitest';
import { WorkspaceDynamicOptionsCache } from './dynamicOptionsCache';
import { applyWorkspaceTableHistoryAction, type WorkspaceTableHistoryAction } from './history';
import { createColumn, createTable, emptyWorkspace, ensureTableDynamicOptions, getDynamicOptions, getRowHeaderColumn, normalizeWorkspace } from './model';
import { applyWorkspaceMatrixPaste } from './workspacePaste';
import { assignWorkspaceChangeRevisions, workspaceTableChangeRevision } from './changeRevisions';
import type { WorkspaceCellValue, WorkspaceData, WorkspaceTable } from './types';

const fixture = (values: WorkspaceCellValue[], isMultiple = false) => {
  const table = createTable('清單');
  const column = { ...createColumn('標籤', 'dynamic-select'), isMultiple };
  const text = createColumn('備註');
  table.columns = [column, text];
  table.rows = values.map((value, index) => ({ id: `r${index}`, name: `項目 ${index}`, values: { [column.id]: value, [text.id]: null } }));
  return { table, column, text, data: { ...emptyWorkspace(), tables: [table] } };
};

const transition = (cache: WorkspaceDynamicOptionsCache, data: WorkspaceData, action: WorkspaceTableHistoryAction, direction: 'undo' | 'redo' = 'redo') => {
  const tableId = data.tables[0].id;
  const next = applyWorkspaceTableHistoryAction(data, tableId, action, direction);
  cache.update(data, next, { tableId, action }, direction);
  return next;
};

describe('dynamic option frequency cache', () => {
  const prepareTransition = (cache: WorkspaceDynamicOptionsCache, data: WorkspaceData, action: WorkspaceTableHistoryAction, direction: 'undo' | 'redo' = 'redo') => {
    const tableId = data.tables[0].id;
    const next = assignWorkspaceChangeRevisions(data, applyWorkspaceTableHistoryAction(data, tableId, action, direction));
    return cache.prepare(data, next, { tableId, action }, direction);
  };

  it('fills missing statistics on the first same-object prepare and reuses the prepared table', () => {
    const { table, column, data } = fixture(['A', 'B']);
    const cache = new WorkspaceDynamicOptionsCache();

    const prepared = cache.prepare(data, data);
    expect(prepared.tables[0]).not.toBe(table);
    expect(prepared.tables[0].columns[0].dynamicOptions?.counts.map(item => item.count)).toEqual([1, 1]);

    const preparedTable = prepared.tables[0];
    const preparedColumns = preparedTable.columns;
    let columnReads = 0;
    Object.defineProperty(preparedTable, 'columns', { configurable: true, get: () => { columnReads += 1; return preparedColumns; } });
    const repeated = cache.prepare(prepared, prepared);
    expect(repeated).toBe(prepared);
    expect(repeated.tables[0]).toBe(prepared.tables[0]);
    expect(columnReads).toBe(0);
    expect(cache.getOptions(repeated.tables[0], column.id)).toEqual(['A', 'B']);
  });

  it('builds statistics when the attribute becomes dynamic without opening its menu', () => {
    const { table, column, data } = fixture(['Rare', 'Common', 'Common']);
    const before = { ...column, inputType: 'text' as const };
    table.columns[0] = before;
    const cache = new WorkspaceDynamicOptionsCache();
    const next = prepareTransition(cache, data, { type: 'update-column', before, after: column });
    expect(next.tables[0].columns[0].dynamicOptions).toMatchObject({
      version: 1, sourceRevision: workspaceTableChangeRevision(next.tables[0]), isMultiple: false,
      counts: [{ key: 'rare', count: 1 }, { key: 'common', count: 2 }],
    });
    expect(cache.getOptions(next.tables[0], column.id)).toEqual(['Common', 'Rare']);
  });

  it('hydrates saved statistics in a new session without reading 10,000 cell values', () => {
    const { table, column } = fixture(Array.from({ length: 10_000 }, (_, index) => index < 6_000 ? 'Common' : 'Rare'));
    const saved = ensureTableDynamicOptions(table);
    const reopened = structuredClone(saved);
    let reads = 0;
    reopened.rows = reopened.rows.map(row => {
      const values = row.values;
      return { ...row, get values() { reads += 1; return values; } };
    });
    const cache = new WorkspaceDynamicOptionsCache();
    expect(cache.getOptions(reopened, column.id)).toEqual(['Common', 'Rare']);
    expect(reads).toBe(0);
    const data = { ...emptyWorkspace(), tables: [reopened] };
    const next = applyWorkspaceTableHistoryAction(data, table.id, { type: 'set-cell', rowId: 'r9999', columnId: column.id, before: 'Rare', after: 'Common' }, 'redo');
    const readsBeforePrepare = reads;
    const prepared = cache.prepare(data, assignWorkspaceChangeRevisions(data, next), { tableId: table.id, action: { type: 'set-cell', rowId: 'r9999', columnId: column.id, before: 'Rare', after: 'Common' } });
    expect(prepared.tables[0].columns[0].dynamicOptions?.counts.map(item => item.count)).toEqual([6_001, 3_999]);
    expect(reads).toBe(readsBeforePrepare);
  });

  it('keeps sparse normalized rows out of dynamic options and updates one edited cell', () => {
    const { table, column, data } = fixture([]);
    table.rows = [
      { id: 'r0', name: '空白', values: {} },
      { id: 'r1', name: '已用', values: { [column.id]: '已擁有' } },
      { id: 'r2', name: '明確空值', values: { [column.id]: null } },
    ];
    const normalized = normalizeWorkspace(data);
    const reopened = normalized.tables[0];
    const reopenedData = { ...normalized, tables: [reopened] };
    const cache = new WorkspaceDynamicOptionsCache();

    expect(Object.hasOwn(reopened.rows[0].values, column.id)).toBe(false);
    expect(cache.getOptions(reopened, column.id)).toEqual(['已擁有']);

    const action: WorkspaceTableHistoryAction = { type: 'set-cell', rowId: 'r0', columnId: column.id, before: null, after: '想要' };
    const next = assignWorkspaceChangeRevisions(reopenedData, applyWorkspaceTableHistoryAction(reopenedData, table.id, action, 'redo'));
    const prepared = cache.prepare(reopenedData, next, { tableId: table.id, action });
    expect(prepared.tables[0].rows[0].values[column.id]).toBe('想要');
    expect(cache.getOptions(prepared.tables[0], column.id)).toEqual(['已擁有', '想要']);
  });

  it('keeps queued statistics immutable while applying edits and undo/redo', () => {
    const { table, column, data } = fixture(['A', 'A', 'B']);
    const cache = new WorkspaceDynamicOptionsCache();
    const initial = cache.prepare(undefined, data);
    const initialStatistics = structuredClone(initial.tables[0].columns[0].dynamicOptions);
    const action: WorkspaceTableHistoryAction = { type: 'set-cell', rowId: 'r0', columnId: column.id, before: 'A', after: 'B' };
    const changed = prepareTransition(cache, initial, action);
    const changedStatistics = structuredClone(changed.tables[0].columns[0].dynamicOptions);
    expect(cache.getOptions(changed.tables[0], column.id)).toEqual(['B', 'A']);
    const undone = prepareTransition(cache, changed, action, 'undo');
    expect(cache.getOptions(undone.tables[0], column.id)).toEqual(['A', 'B']);
    const redone = prepareTransition(cache, undone, action);
    expect(cache.getOptions(redone.tables[0], column.id)).toEqual(['B', 'A']);
    expect(initial.tables[0].columns[0].dynamicOptions).toEqual(initialStatistics);
    expect(changed.tables[0].columns[0].dynamicOptions).toEqual(changedStatistics);
    expect(redone.tables[0].columns[0].dynamicOptions?.sourceRevision).toBe(workspaceTableChangeRevision(redone.tables[0]));
    expect(table.columns[0].dynamicOptions).toBeUndefined();
  });

  it.each(['new', 'replace'] as const)('reuses imported 10,000-row statistics when committing a %s table', (mode) => {
    const { table, column, data } = fixture([]);
    let reads = 0;
    table.rows = Array.from({ length: 10_000 }, (_, index) => ({
      id: `r${index}`, name: `項目 ${index}`,
      get values() { reads += 1; return { [column.id]: index < 6_000 ? 'Common' : 'Rare' }; },
    }));
    const imported = ensureTableDynamicOptions(table);
    expect(reads).toBe(10_000);
    const originalStatistics = imported.columns[0].dynamicOptions!;
    const previous = { ...data, tables: mode === 'new' ? [] : [ensureTableDynamicOptions({
      ...table, rows: [{ id: 'old', name: '舊列', values: { [column.id]: 'Old' } }],
    })] };
    const cache = new WorkspaceDynamicOptionsCache();
    if (mode === 'replace') expect(cache.getOptions(previous.tables[0], column.id)).toEqual(['Old']);
    const next = { ...data, tables: [imported] };
    cache.primeImportedTables(next, [table.id]);
    const prepared = cache.prepare(previous, assignWorkspaceChangeRevisions(previous, next));
    expect(reads).toBe(10_000);
    expect(cache.getOptions(prepared.tables[0], column.id)).toEqual(['Common', 'Rare']);
    expect(prepared.tables[0].columns[0].dynamicOptions?.counts).toBe(originalStatistics.counts);
    expect(prepared.tables[0].columns[0].dynamicOptions?.sourceRevision).toBe(workspaceTableChangeRevision(prepared.tables[0]));
    expect(originalStatistics.sourceRevision).toBe(workspaceTableChangeRevision(table));
    expect(prepared.tables[0].changeRevision).not.toBe(table.changeRevision);

    const edited = prepareTransition(cache, prepared, { type: 'set-cell', rowId: 'r9999', columnId: column.id, before: 'Rare', after: 'Common' });
    expect(edited.tables[0].columns[0].dynamicOptions?.counts.map(item => item.count)).toEqual([6_001, 3_999]);
    expect(originalStatistics.counts.map(item => item.count)).toEqual([6_000, 4_000]);
  });

  it.each(['missing', 'stale', 'parser'] as const)('rebuilds %s import statistics once before assigning a local revision', (kind) => {
    const { table, column, data } = fixture(['["A"]']);
    const saved = ensureTableDynamicOptions(table);
    const importedColumn = { ...saved.columns[0] };
    if (kind === 'missing') importedColumn.dynamicOptions = undefined;
    if (kind === 'stale') importedColumn.dynamicOptions = { ...importedColumn.dynamicOptions!, sourceRevision: 'old' };
    if (kind === 'parser') importedColumn.isMultiple = true;
    let reads = 0;
    const imported = { ...saved, columns: [importedColumn], rows: saved.rows.map(row => ({
      ...row, get values() { reads += 1; return row.values; },
    })) };
    const next = { ...data, tables: [imported] };
    const cache = new WorkspaceDynamicOptionsCache();
    cache.primeImportedTables(next, [table.id]);
    const prepared = cache.prepare(undefined, assignWorkspaceChangeRevisions(undefined, next));
    expect(reads).toBe(1);
    expect(cache.getOptions(prepared.tables[0], column.id)).toEqual([kind === 'parser' ? 'A' : '["A"]']);
  });

  it('rebuilds after a row replacement even when the caller carries old persisted statistics', () => {
    const { table, column, data } = fixture(['A']);
    const initial = { ...data, tables: [ensureTableDynamicOptions(table)] };
    const replacement = { ...initial.tables[0], rows: [{ id: 'r0', name: '新資料', values: { [column.id]: 'B' } }] };
    const cache = new WorkspaceDynamicOptionsCache();
    expect(cache.getOptions(initial.tables[0], column.id)).toEqual(['A']);
    expect(cache.getOptions(replacement, column.id)).toEqual(['B']);
    const prepared = new WorkspaceDynamicOptionsCache().prepare(initial, { ...initial, tables: [replacement] });
    expect(prepared.tables[0].columns[0].dynamicOptions?.counts).toEqual([{ key: 'b', count: 1, spellings: [['B', 1]] }]);
  });

  it('rebuilds on a parser change and removes statistics when dynamic mode is disabled', () => {
    const { column, data } = fixture(['["A"]']);
    const cache = new WorkspaceDynamicOptionsCache();
    const initial = cache.prepare(undefined, data);
    expect(cache.getOptions(initial.tables[0], column.id)).toEqual(['["A"]']);
    const before = initial.tables[0].columns[0];
    const multiple = prepareTransition(cache, initial, { type: 'update-column', before, after: { ...before, isMultiple: true } });
    expect(multiple.tables[0].columns[0].dynamicOptions?.counts.map(item => [item.key, item.count])).toEqual([['a', 1]]);
    const disabled = prepareTransition(cache, multiple, { type: 'update-column', before: multiple.tables[0].columns[0], after: { ...multiple.tables[0].columns[0], inputType: 'text' } });
    expect(disabled.tables[0].columns[0].dynamicOptions).toBeUndefined();
    expect(new WorkspaceDynamicOptionsCache().getOptions(multiple.tables[0], column.id)).toEqual(['A']);
  });

  it('counts rows rather than duplicate tokens and merges case variants', () => {
    const { table, column } = fixture(['Rare', 'Common, common, Common', 'common', null, '', 12], true);
    const options = new WorkspaceDynamicOptionsCache().getOptions(table, column.id);
    expect(options.map(value => value.toLowerCase())).toEqual(['common', 'rare']);
    expect(getDynamicOptions(table, column.id).map(value => value.toLowerCase())).toEqual(['common', 'rare']);
  });

  it('uses occurrence counts even when a rarer option appears first', () => {
    const { table, column } = fixture(['Rare', 'Common', 'Common', 'Common', 'Middle', 'Middle']);
    expect(new WorkspaceDynamicOptionsCache().getOptions(table, column.id)).toEqual(['Common', 'Middle', 'Rare']);
  });

  it('does not rescan 10,000 rows when reopening, changing a cell, or reordering rows', () => {
    const { table, column, data } = fixture([]);
    let reads = 0;
    table.rows = Array.from({ length: 10_000 }, (_, index) => {
      const values = { [column.id]: index < 6_000 ? 'Common' : 'Rare' };
      return { id: `r${index}`, name: `項目 ${index}`, get values() { reads += 1; return values; } };
    });
    const cache = new WorkspaceDynamicOptionsCache();
    const options = cache.getOptions(table, column.id);
    expect(reads).toBe(10_000);
    expect(cache.getOptions(table, column.id)).toBe(options);
    expect(reads).toBe(10_000);
    const action: WorkspaceTableHistoryAction = { type: 'set-cell', rowId: 'r9999', columnId: column.id, before: 'Rare', after: 'Common' };
    const next = applyWorkspaceTableHistoryAction(data, table.id, action, 'redo');
    const beforeUpdate = reads;
    cache.update(data, next, { tableId: table.id, action });
    expect(cache.getOptions(next.tables[0], column.id)).toEqual(['Common', 'Rare']);
    expect(reads).toBe(beforeUpdate);
    const reordered = transition(cache, next, { type: 'reorder-rows', beforeIds: next.tables[0].rows.map(row => row.id), afterIds: next.tables[0].rows.map(row => row.id).reverse() });
    expect(cache.getOptions(reordered.tables[0], column.id)).toEqual(['Common', 'Rare']);
    expect(reads).toBe(beforeUpdate);
  });

  it('does not rescan rows for compact row or column moves', () => {
    const { table, column, data } = fixture([]);
    let reads = 0;
    table.rows = Array.from({ length: 10_000 }, (_, index) => {
      const values = { [column.id]: index < 6_000 ? 'Common' : 'Rare' };
      return { id: `r${index}`, name: `項目 ${index}`, get values() { reads += 1; return values; } };
    });
    const cache = new WorkspaceDynamicOptionsCache();
    expect(cache.getOptions(table, column.id)).toEqual(['Common', 'Rare']);
    const initialReads = reads;
    const rowAction: WorkspaceTableHistoryAction = { type: 'move-row', rowId: 'r0', beforeIndex: 0, afterIndex: 9_999 };
    const movedRows = applyWorkspaceTableHistoryAction(data, table.id, rowAction, 'redo');
    cache.update(data, movedRows, { tableId: table.id, action: rowAction });
    expect(cache.getOptions(movedRows.tables[0], column.id)).toEqual(['Common', 'Rare']);
    const columnAction: WorkspaceTableHistoryAction = { type: 'move-column', columnId: column.id, beforeIndex: 0, afterIndex: 1 };
    const movedColumns = applyWorkspaceTableHistoryAction(movedRows, table.id, columnAction, 'redo');
    cache.update(movedRows, movedColumns, { tableId: table.id, action: columnAction });
    expect(reads).toBe(initialReads);
  });

  it('updates the ranking for batch changes, undo, and redo', () => {
    const { table, column, data } = fixture(['A', 'A', 'B']);
    const cache = new WorkspaceDynamicOptionsCache();
    expect(cache.getOptions(table, column.id)).toEqual(['A', 'B']);
    const action: WorkspaceTableHistoryAction = { type: 'set-cells', columnId: column.id, changes: [
      { rowId: 'r0', before: 'A', after: 'B' }, { rowId: 'r1', before: 'A', after: 'C' },
    ] };
    const changed = transition(cache, data, action);
    expect(cache.getOptions(changed.tables[0], column.id)).toEqual(['B', 'C']);
    const undone = transition(cache, changed, action, 'undo');
    expect(cache.getOptions(undone.tables[0], column.id)).toEqual(['A', 'B']);
    const redone = transition(cache, undone, action);
    expect(cache.getOptions(redone.tables[0], column.id)).toEqual(['B', 'C']);
  });

  it('adds and removes row contributions and drops an option after its last use', () => {
    const { table, column, data } = fixture(['A', 'A', 'B']);
    const cache = new WorkspaceDynamicOptionsCache();
    cache.getOptions(table, column.id);
    const added = transition(cache, data, { type: 'add-row', row: { id: 'new', name: '新增', values: { [column.id]: 'B' } }, index: 0 });
    const removed = transition(cache, added, { type: 'remove-row', row: table.rows[0], index: 1 });
    expect(cache.getOptions(removed.tables[0], column.id)).toEqual(['B', 'A']);
    const cleared = transition(cache, removed, { type: 'set-cell', rowId: 'r1', columnId: column.id, before: 'A', after: null });
    expect(cache.getOptions(cleared.tables[0], column.id)).toEqual(['B']);
  });

  it('rebuilds sparse dynamic options after removing and undoing a column', () => {
    const { table, column, text, data } = fixture(['A', 'A', 'B']);
    table.rows = table.rows.map((row, index) => ({
      ...row,
      values: index === 0 ? { [text.id]: null } : { [column.id]: row.values[column.id], [text.id]: null },
    }));
    const cache = new WorkspaceDynamicOptionsCache();
    expect(cache.getOptions(table, column.id)).toEqual(['A', 'B']);

    const action: WorkspaceTableHistoryAction = {
      type: 'remove-column', column, index: 0, values: { r1: 'A', r2: 'B' },
    };
    const removed = transition(cache, data, action);
    expect(removed.tables[0].columns).toEqual([text]);
    expect(Object.hasOwn(removed.tables[0].rows[0].values, column.id)).toBe(false);

    const restored = transition(cache, removed, action, 'undo');
    expect(restored.tables[0].columns[0].id).toBe(column.id);
    expect(Object.hasOwn(restored.tables[0].rows[0].values, column.id)).toBe(false);
    expect(cache.getOptions(restored.tables[0], column.id)).toEqual(['A', 'B']);
  });

  it('counts pasted new rows once and reverses their contributions on undo', () => {
    const { table, column, data } = fixture(['A', 'B']);
    const cache = new WorkspaceDynamicOptionsCache();
    cache.getOptions(table, column.id);
    const pasted = applyWorkspaceMatrixPaste(table, 'r1', column.id, [['B'], ['B'], ['A']]);
    const action: WorkspaceTableHistoryAction = { type: 'paste-range', changes: pasted.changes, addedRows: pasted.addedRows, addedColumns: pasted.addedColumns };
    const next = { ...data, tables: [pasted.table] };
    cache.update(data, next, { tableId: table.id, action });
    const removedB = transition(cache, next, { type: 'set-cell', rowId: 'r1', columnId: column.id, before: 'B', after: 'A' });
    expect(cache.getOptions(removedB.tables[0], column.id)).toEqual(['A', 'B']);
    const restoredB = transition(cache, removedB, { type: 'set-cell', rowId: 'r1', columnId: column.id, before: 'B', after: 'A' }, 'undo');
    const undone = transition(cache, restoredB, action, 'undo');
    expect(new Set(cache.getOptions(undone.tables[0], column.id))).toEqual(new Set(['A', 'B']));
    const redone = transition(cache, undone, action);
    expect(new Set(cache.getOptions(redone.tables[0], column.id))).toEqual(new Set(['A', 'B']));
    const lowered = transition(cache, redone, { type: 'set-cell', rowId: 'r1', columnId: column.id, before: 'B', after: 'A' });
    expect(cache.getOptions(lowered.tables[0], column.id)).toEqual(['A', 'B']);
    const cleared = transition(cache, lowered, { type: 'set-cell', rowId: pasted.addedRows[0].id, columnId: column.id, before: 'B', after: null });
    expect(cache.getOptions(cleared.tables[0], column.id)).toEqual(['A']);
  });

  it('retains the cache for unrelated edits without adding configured options', () => {
    const { table, column, text, data } = fixture(['A', 'B', 'B']);
    const cache = new WorkspaceDynamicOptionsCache();
    const options = cache.getOptions(table, column.id);
    const next = transition(cache, data, { type: 'set-cell', rowId: 'r0', columnId: text.id, before: null, after: '備註' });
    expect(cache.getOptions(next.tables[0], column.id)).toBe(options);
    expect(next.tables[0].columns).toBe(table.columns);
    expect(column.options).toEqual([]);
  });

  it('rebuilds after a parsing setting change or an unannounced replacement', () => {
    const { table, column, data } = fixture(['["A"]']);
    const cache = new WorkspaceDynamicOptionsCache();
    expect(cache.getOptions(table, column.id)).toEqual(['["A"]']);
    const changed = transition(cache, data, { type: 'update-column', before: column, after: { ...column, isMultiple: true } });
    expect(cache.getOptions(changed.tables[0], column.id)).toEqual(['A']);
    const replacement: WorkspaceTable = { ...changed.tables[0], rows: [{ id: 'r0', name: '新資料', values: { [column.id]: 'B' } }] };
    expect(cache.getOptions(replacement, column.id)).toEqual(['B']);
    cache.update({ ...changed, tables: [replacement] }, { ...changed, tables: [] });
    expect(cache.getOptions(table, column.id)).toEqual(['["A"]']);
  });

  it('keeps row-header options current and chooses a spelling that is still present', () => {
    const { table, data } = fixture(['ignored', 'ignored']);
    table.rowHeader = { ...getRowHeaderColumn(table), inputType: 'dynamic-select' };
    table.rows[0].name = 'Tag';
    table.rows[1].name = 'tag';
    const cache = new WorkspaceDynamicOptionsCache();
    expect(cache.getOptions(table, table.rowHeader.id)).toEqual(['Tag']);
    const next = transition(cache, data, { type: 'set-cell', rowId: 'r0', columnId: table.rowHeader.id, before: 'Tag', after: null });
    expect(cache.getOptions(next.tables[0], table.rowHeader.id)).toEqual(['tag']);
  });
});
