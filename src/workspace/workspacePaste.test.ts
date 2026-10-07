import { describe, expect, it } from 'vitest';
import { createColumn, createRow, createTable, getRowHeaderColumn } from './model';
import { applyWorkspaceMatrixPaste, parseWorkspaceClipboard } from './workspacePaste';

describe('workspace rectangular paste', () => {
  it('parses spreadsheet tabs, rows, and quoted line breaks', () => {
    expect(parseWorkspaceClipboard('甲\t"乙\n二"\r\n丙\t丁\r\n')).toEqual([['甲', '乙\n二'], ['丙', '丁']]);
  });

  it('pastes from the selected cell and expands only the necessary rows and columns', () => {
    const table = createTable('測試');
    const firstColumn = table.columns[0];
    const firstRow = table.rows[0];
    const result = applyWorkspaceMatrixPaste(table, firstRow.id, firstColumn.id, [['1', '甲'], ['2', '乙']]);
    expect(result.invalidCells).toEqual([]);
    expect(result.addedRows).toHaveLength(1);
    expect(result.addedColumns).toHaveLength(1);
    expect(result.table.rows[0].values[firstColumn.id]).toBe('1');
    expect(result.table.rows[1].values[result.table.columns[1].id]).toBe('乙');
    expect(result.addedRows[0]).toBe(result.table.rows[1]);
    expect(result.addedRows[0].values[firstColumn.id]).toBe('2');
  });

  it('can paste object names from the first column', () => {
    const table = createTable('測試');
    const result = applyWorkspaceMatrixPaste(table, table.rows[0].id, getRowHeaderColumn(table).id, [['新名稱']]);
    expect(result.table.rows[0].name).toBe('新名稱');
  });

  it('does not report an unchanged link paste as a cell change', () => {
    const table = createTable('測試');
    const linkColumn = { ...table.columns[0], inputType: 'link' as const };
    const link = { url: 'https://example.com/game', label: '' };
    const linkTable = { ...table, columns: [linkColumn], rows: [{ ...table.rows[0], values: { [linkColumn.id]: link } }] };
    const result = applyWorkspaceMatrixPaste(linkTable, linkTable.rows[0].id, linkColumn.id, [[link.url]]);

    expect(result.changes).toEqual([]);
    expect(result.addedRows).toEqual([]);
    expect(result.addedColumns).toEqual([]);
  });

  it('rejects invalid typed cells without partially changing the table', () => {
    const table = createTable('測試');
    const numberColumn = createColumn('數量', 'number');
    table.columns = [numberColumn];
    table.rows = [createRow(table.columns, '甲')];
    const result = applyWorkspaceMatrixPaste(table, table.rows[0].id, numberColumn.id, [['12'], ['不是數字']]);
    expect(result.table).toBe(table);
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].values[numberColumn.id]).toBeNull();
    expect(result.changes).toEqual([]);
    expect(result.addedRows).toEqual([]);
    expect(result.addedColumns).toEqual([]);
    expect(result.invalidCells).toEqual([{ row: 2, column: 1, value: '不是數字' }]);
  });
});
