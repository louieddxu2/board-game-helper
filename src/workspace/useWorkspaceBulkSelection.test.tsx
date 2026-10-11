import type { RefObject } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyWorkspaceCellChanges } from './cellChanges';
import type { WorkspaceData, WorkspaceRow, WorkspaceTable } from './types';
import { useWorkspaceBulkSelection } from './useWorkspaceBulkSelection';

const column = { id: 'column-1', name: '欄位', inputType: 'text' as const, options: [] };

const tableFor = (rows: WorkspaceRow[]): WorkspaceTable => ({
  id: 'table-1', name: '測試表', rowHeaderName: '物件', columns: [column], rows, updatedAt: 1,
});

const dataFor = (table: WorkspaceTable): WorkspaceData => ({
  version: 1, activeNodeId: 'node-1', tables: [table],
  nodes: [{ id: 'node-1', type: 'table', name: table.name, parentId: null, order: 0, tableId: table.id }],
});

const optionsFor = (table: WorkspaceTable, dataRef: RefObject<WorkspaceData | undefined>, commit = vi.fn()) => ({
  table, setNotice: vi.fn(), setSearchOpen: vi.fn(), setEditBarOpen: vi.fn(), setTableActionsOpen: vi.fn(),
  filteredRows: table.rows, dataRef, commit,
  dialogs: { set: vi.fn(), close: vi.fn() },
});

afterEach(() => cleanup());

describe('workspace bulk selection', () => {
  it('does not build a full row lookup while inactive and follows the latest selected row after replacement', () => {
    const reads: string[] = [];
    const rows = Array.from({ length: 10_000 }, (_, index) => {
      const id = `row-${index}`;
      const row = { name: `項目 ${index}`, values: { [column.id]: null } } as WorkspaceRow;
      Object.defineProperty(row, 'id', { configurable: true, enumerable: true, get: () => { reads.push(id); return id; } });
      return row;
    });
    const table = tableFor(rows);
    const data = dataFor(table);
    const dataRef = { current: data } as RefObject<WorkspaceData | undefined>;
    const props = optionsFor(table, dataRef);
    const view = renderHook((current) => useWorkspaceBulkSelection(current), { initialProps: props });

    expect(reads).toEqual([]);
    act(() => { expect(view.result.current.startBulkSelection('row-9999', column.id)).toBe(true); });
    expect(view.result.current.bulkRows).toHaveLength(1);
    reads.length = 0;

    const updatedRows = applyWorkspaceCellChanges(rows, undefined, [{ rowId: 'row-9999', columnId: column.id, before: null, after: '最新值' }]);
    const updatedTable = tableFor(updatedRows);
    const updatedData = dataFor(updatedTable);
    dataRef.current = updatedData;
    props.table = updatedTable;
    props.filteredRows = updatedRows;
    view.rerender(props);

    expect(view.result.current.bulkRows[0].values[column.id]).toBe('最新值');
    expect(reads.filter((id) => id !== 'row-9999')).toEqual([]);
    expect(reads.length).toBeLessThan(10);
  });

  it('sweeps filtered rows and commits only selected updates without scanning offscreen ids', () => {
    const reads: string[] = [];
    const rows = Array.from({ length: 10_000 }, (_, index) => {
      const id = `row-${index}`;
      const row = { name: `項目 ${index}`, values: { [column.id]: null } } as WorkspaceRow;
      Object.defineProperty(row, 'id', { configurable: true, enumerable: true, get: () => { reads.push(id); return id; } });
      return row;
    });
    const table = tableFor(rows);
    const dataRef = { current: dataFor(table) } as RefObject<WorkspaceData | undefined>;
    const commit = vi.fn();
    const props = optionsFor(table, dataRef, commit);
    const view = renderHook((current) => useWorkspaceBulkSelection(current), { initialProps: props });

    act(() => { view.result.current.startBulkSelection('row-8000', column.id); });
    reads.length = 0;
    act(() => { view.result.current.sweepBulkSelection('row-8000', 'row-8002', column.id); });
    expect(reads.length).toBeLessThan(10);
    expect(view.result.current.bulkSelection?.rowIds.slice(-3)).toEqual(['row-8000', 'row-8001', 'row-8002']);

    const filteredRows = [rows[500], rows[2], rows[501]];
    props.filteredRows = filteredRows;
    view.rerender(props);
    reads.length = 0;
    act(() => { view.result.current.sweepBulkSelection('row-500', 'row-501', column.id); });
    expect(view.result.current.bulkSelection?.rowIds.slice(-3)).toEqual(['row-500', 'row-2', 'row-501']);
    expect([...new Set(reads)].sort()).toEqual(['row-8000', 'row-8001', 'row-8002', 'row-500', 'row-2', 'row-501'].sort());

    reads.length = 0;
    act(() => {
      view.result.current.commitBulkCellUpdates([
        { rowId: 'row-8000', value: '先值' },
        { rowId: 'row-8000', value: '最後值' },
      ]);
    });
    expect(reads.length).toBeLessThan(10);
    expect(commit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: { type: 'set-cells', columnId: column.id, changes: [{ rowId: 'row-8000', before: null, after: '最後值' }] },
    }));
  });
});
