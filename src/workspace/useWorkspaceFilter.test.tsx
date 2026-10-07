import { cleanup, renderHook, waitFor, act } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceColumn, WorkspaceRow, WorkspaceTable } from './types';
import { useWorkspaceFilter } from './useWorkspaceFilter';
import type { HeaderFilterState } from './workspaceShared';

const rowHeader: WorkspaceColumn = { id: 'row-header', name: '項目', inputType: 'text', options: [] };
const hiddenColumn: WorkspaceColumn = { id: 'hidden', name: '隱藏欄位', inputType: 'text', options: [], hidden: true };
const linkColumn: WorkspaceColumn = { id: 'link', name: '連結', inputType: 'link', options: [] };
const dateColumn: WorkspaceColumn = { id: 'date', name: '日期', inputType: 'datetime', options: [], dateOnly: true };
const scoreColumn: WorkspaceColumn = { id: 'score', name: '分數', inputType: 'number', options: [] };

const row = (id: string, name: string, values: Record<string, WorkspaceRow['values'][string]> = {}): WorkspaceRow => ({ id, name, values });
const tableWith = (columns: WorkspaceColumn[], rows: WorkspaceRow[]): WorkspaceTable => ({
  id: 'filter-table', name: '篩選測試', rowHeaderName: rowHeader.name, rowHeader, columns, rows, updatedAt: 1,
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe('workspace filtering', () => {
  it('searches row names, hidden columns, both link fields, and date-only values', async () => {
    const table = tableWith([hiddenColumn, linkColumn, dateColumn], [
      row('name-hit', '名稱命中'),
      row('hidden-hit', '普通', { hidden: '隱藏命中' }),
      row('link-hit', '普通', { link: { label: '官網', url: 'https://example.com/rules' } }),
      row('date-hit', '普通', { date: '2026-08-12T12:14:00.000Z' }),
      row('other', '普通'),
    ]);
    const { result } = renderHook(() => useWorkspaceFilter({ table, rowHeader }));
    const searchFor = async (query: string, expectedId: string) => {
      act(() => result.current.setSearchQuery(query));
      await waitFor(() => expect(result.current.searchedRows.map((item) => item.id)).toEqual([expectedId]));
    };

    await searchFor('名稱命中', 'name-hit');
    await searchFor('隱藏命中', 'hidden-hit');
    await searchFor('官網', 'link-hit');
    await searchFor('example.com/rules', 'link-hit');
    await searchFor('2026/08/12', 'date-hit');
  });

  it('sorts a copy stably without changing the source row order', async () => {
    const sourceRows = [
      row('first', '第一', { score: 1 }),
      row('second', '第二', { score: 1 }),
      row('third', '第三', { score: 2 }),
      row('fourth', '第四', { score: 1 }),
    ];
    const table = tableWith([scoreColumn], sourceRows);
    const { result } = renderHook(() => useWorkspaceFilter({ table, rowHeader }));
    const ascending: HeaderFilterState = { includedKeys: null, sort: 'asc' };

    act(() => result.current.setHeaderFilters({ 'column:score': ascending }));
    await waitFor(() => expect(result.current.filteredRows.map((item) => item.id)).toEqual(['first', 'second', 'fourth', 'third']));

    expect(table.rows).toBe(sourceRows);
    expect(table.rows.map((item) => item.id)).toEqual(['first', 'second', 'third', 'fourth']);
    expect(result.current.filteredRows).not.toBe(sourceRows);
  });
});
