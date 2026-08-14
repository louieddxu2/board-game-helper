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
  });

  it('can paste object names from the first column', () => {
    const table = createTable('測試');
    const result = applyWorkspaceMatrixPaste(table, table.rows[0].id, getRowHeaderColumn(table).id, [['新名稱']]);
    expect(result.table.rows[0].name).toBe('新名稱');
  });

  it('rejects invalid typed cells without partially changing the table', () => {
    const table = createTable('測試');
    const numberColumn = createColumn('數量', 'number');
    table.columns = [numberColumn];
    table.rows = [createRow(table.columns, '甲')];
    const result = applyWorkspaceMatrixPaste(table, table.rows[0].id, numberColumn.id, [['不是數字']]);
    expect(result.table).toBe(table);
    expect(result.invalidCells).toEqual([{ row: 1, column: 1, value: '不是數字' }]);
  });
});
