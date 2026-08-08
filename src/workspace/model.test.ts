import { describe, expect, it } from 'vitest';
import { createColumn, createRow, createTable, emptyWorkspace, getDynamicOptions, removeNodeAndDescendants } from './model';
import type { WorkspaceData } from './types';

describe('workspace model', () => {
  it('derives dynamic options in first-seen order without empty or duplicate values', () => {
    const table = createTable('收藏');
    const column = createColumn('狀態', 'dynamic-select');
    table.columns.push(column);
    table.rows = [
      { id: 'r1', values: { [column.id]: '已擁有' } },
      { id: 'r2', values: { [column.id]: '想要' } },
      { id: 'r3', values: { [column.id]: '已擁有' } },
      { id: 'r4', values: { [column.id]: null } },
    ];
    expect(getDynamicOptions(table, column.id)).toEqual(['已擁有', '想要']);
  });

  it('creates rows with an empty cell for every current column', () => {
    const columns = [createColumn('名稱'), createColumn('數量', 'number')];
    expect(createRow(columns).values).toEqual({ [columns[0].id]: null, [columns[1].id]: null });
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
        { id: 'data-a', name: '表 A', columns: [], rows: [], updatedAt: 0 },
        { id: 'data-root', name: '表 Root', columns: [], rows: [], updatedAt: 0 },
      ],
      activeNodeId: 'table-a',
    };
    const result = removeNodeAndDescendants(data, 'folder-a');
    expect(result.nodes.map((node) => node.id)).toEqual(['table-root']);
    expect(result.tables.map((table) => table.id)).toEqual(['data-root']);
    expect(result.activeNodeId).toBeNull();
  });
});
