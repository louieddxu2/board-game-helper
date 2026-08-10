import { describe, expect, it } from 'vitest';
import { createColumn, createRow, createTable, emptyWorkspace, formatMultiSelectValues, formatWorkspaceDateTime, getDynamicOptions, moveNode, normalizeWorkspace, normalizeWorkspaceDateTime, parseMultiSelectValues, removeNodeAndDescendants } from './model';
import type { WorkspaceData } from './types';

describe('workspace model', () => {
  it('derives dynamic options in first-seen order without empty or duplicate values', () => {
    const table = createTable('收藏');
    const column = createColumn('狀態', 'dynamic-select');
    table.columns.push(column);
    table.rows = [
      { id: 'r1', name: '項目 1', values: { [column.id]: '已擁有' } },
      { id: 'r2', name: '項目 2', values: { [column.id]: '想要' } },
      { id: 'r3', name: '項目 3', values: { [column.id]: '已擁有' } },
      { id: 'r4', name: '項目 4', values: { [column.id]: null } },
    ];
    expect(getDynamicOptions(table, column.id)).toEqual(['已擁有', '想要']);
  });

  it('creates rows with an empty cell for every current column', () => {
    const columns = [createColumn('名稱'), createColumn('數量', 'number')];
    expect(createRow(columns).values).toEqual({ [columns[0].id]: null, [columns[1].id]: null });
  });

  it('parses and formats multi-select values seamlessly', () => {
    expect(parseMultiSelectValues('蘋果, 香蕉, 橘子')).toEqual(['蘋果', '香蕉', '橘子']);
    expect(parseMultiSelectValues('蘋果、香蕉、橘子')).toEqual(['蘋果', '香蕉', '橘子']);
    expect(parseMultiSelectValues('["A", "B"]')).toEqual(['A', 'B']);
    expect(formatMultiSelectValues(['紅', '黃'])).toBe('紅, 黃');
  });

  it('normalizes date-time values for storage and formats them in Traditional Chinese', () => {
    const normalized = normalizeWorkspaceDateTime('2024-02-03T14:05');
    expect(normalized).toMatch(/^2024-02-03T/);
    expect(formatWorkspaceDateTime(normalized)).toMatch(/^\d+年\d+月\d+日\d+點\d{2}分$/);
    expect(normalizeWorkspaceDateTime('不是時間')).toBeNull();
  });

  it('collects clean individual options in getDynamicOptions even when values contain delimiters', () => {
    const table = createTable('測試表');
    table.columns.push(createColumn('標籤', 'dynamic-select'));
    table.rows.push(createRow(table.columns));
    table.rows.push(createRow(table.columns));
    table.rows[0].values[table.columns[0].id] = '蘋果, 香蕉';
    table.rows[1].values[table.columns[0].id] = '香蕉、橘子';

    const options = getDynamicOptions(table, table.columns[0].id);
    expect(options).toEqual(['蘋果', '香蕉', '橘子']);
  });

  it('upgrades a legacy first column into an editable text property without losing row names', () => {
    const legacy: WorkspaceData = {
      ...emptyWorkspace(),
      tables: [{ id: 'legacy', name: '舊表格', rowHeaderName: '遊戲', columns: [], rows: [{ id: 'row', name: '花火', values: {} }], updatedAt: 0 }],
    };

    const normalized = normalizeWorkspace(legacy);

    expect(normalized.tables[0].rowHeader).toMatchObject({ name: '遊戲', inputType: 'text', overflowMode: 'expand' });
    expect(normalized.tables[0].rows[0].name).toBe('花火');
  });

  it('removes a folder, its descendants, and linked tables only', () => {
    const data: WorkspaceData = {
      ...emptyWorkspace(),
      nodes: [
        { id: 'folder-a', type: 'folder', name: 'A', parentId: null, order: 0 },
        { id: 'folder-b', type: 'folder', name: 'B', parentId: 'folder-a', order: 0 },
        { id: 'table-a', type: 'table', name: '表 A', parentId: 'folder-b', order: 0, tableId: 'data-a' },
        { id: 'table-root', type: 'table', name: '表 Root', parentId: null, order: 1, tableId: 'data-root' },
      ],
      tables: [
        { id: 'data-a', name: '表 A', rowHeaderName: '項目', columns: [], rows: [], updatedAt: 0 },
        { id: 'data-root', name: '表 Root', rowHeaderName: '項目', columns: [], rows: [], updatedAt: 0 },
      ],
      activeNodeId: 'table-a',
    };
    const result = removeNodeAndDescendants(data, 'folder-a');
    expect(result.nodes.map((node) => node.id)).toEqual(['table-root']);
    expect(result.tables.map((table) => table.id)).toEqual(['data-root']);
    expect(result.activeNodeId).toBe('table-root');
  });

  it('clears the active node when the last table is removed', () => {
    const table = createTable('唯一表格');
    const data: WorkspaceData = {
      ...emptyWorkspace(),
      nodes: [{ id: 'only-table', type: 'table', name: table.name, parentId: null, order: 0, tableId: table.id }],
      tables: [table],
      activeNodeId: 'only-table',
    };
    expect(removeNodeAndDescendants(data, 'only-table').activeNodeId).toBeNull();
  });

  it('moves nodes into folders while preventing descendant cycles', () => {
    const data = {
      ...emptyWorkspace(),
      nodes: [
        { id: 'folder-a', type: 'folder' as const, name: 'A', parentId: null, order: 0 },
        { id: 'folder-b', type: 'folder' as const, name: 'B', parentId: 'folder-a', order: 0 },
        { id: 'table-a', type: 'table' as const, name: '表格', parentId: null, order: 1, tableId: 'table-a' },
      ],
    };
    expect(moveNode(data, 'table-a', 'folder-b').nodes.find((node) => node.id === 'table-a')?.parentId).toBe('folder-b');
    expect(moveNode(data, 'folder-a', 'folder-b')).toBe(data);
  });
});
