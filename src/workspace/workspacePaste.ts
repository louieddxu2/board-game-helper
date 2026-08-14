import { coerceCellValue, createColumn, createRow, getRowHeaderColumn } from './model';
import type { WorkspaceCellValue, WorkspaceColumn, WorkspaceRow, WorkspaceTable } from './types';

export type WorkspacePasteCellChange = {
  rowId: string;
  columnId: string;
  before: WorkspaceCellValue;
  after: WorkspaceCellValue;
};

export type WorkspacePasteResult = {
  table: WorkspaceTable;
  changes: WorkspacePasteCellChange[];
  addedRows: WorkspaceRow[];
  addedColumns: WorkspaceColumn[];
  invalidCells: Array<{ row: number; column: number; value: string }>;
};

export const parseWorkspaceClipboard = (text: string): string[][] => {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  if (!normalized) return [];
  const rows: string[][] = [[]];
  let value = '';
  let quoted = false;
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === '"') {
      if (quoted && normalized[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (!quoted && character === '\t') {
      rows.at(-1)!.push(value);
      value = '';
    } else if (!quoted && character === '\n') {
      rows.at(-1)!.push(value);
      rows.push([]);
      value = '';
    } else value += character;
  }
  rows.at(-1)!.push(value);
  return rows;
};

const sameValue = (left: WorkspaceCellValue, right: WorkspaceCellValue) => JSON.stringify(left) === JSON.stringify(right);

export const applyWorkspaceMatrixPaste = (
  table: WorkspaceTable,
  startRowId: string,
  startColumnId: string,
  matrix: string[][],
): WorkspacePasteResult => {
  const rowHeader = getRowHeaderColumn(table);
  const startRowIndex = table.rows.findIndex((row) => row.id === startRowId);
  const startColumnIndex = [rowHeader, ...table.columns].findIndex((column) => column.id === startColumnId);
  if (startRowIndex < 0 || startColumnIndex < 0 || matrix.length === 0) {
    return { table, changes: [], addedRows: [], addedColumns: [], invalidCells: [] };
  }

  const width = Math.max(0, ...matrix.map((row) => row.length));
  const addedColumns: WorkspaceColumn[] = [];
  const columns = [...table.columns];
  while (startColumnIndex + width > columns.length + 1) {
    const column = createColumn(`屬性 ${columns.length + 1}`);
    columns.push(column);
    addedColumns.push(column);
  }
  const allColumns = [rowHeader, ...columns];
  const addedRows: WorkspaceRow[] = [];
  const rows = table.rows.map((row) => ({ ...row, values: { ...row.values } }));
  while (startRowIndex + matrix.length > rows.length) {
    const row = createRow(columns, `物件 ${rows.length + 1}`);
    rows.push(row);
    addedRows.push(row);
  }

  const invalidCells: WorkspacePasteResult['invalidCells'] = [];
  const changes: WorkspacePasteCellChange[] = [];
  matrix.forEach((sourceRow, rowOffset) => sourceRow.forEach((raw, columnOffset) => {
    const row = rows[startRowIndex + rowOffset];
    const column = allColumns[startColumnIndex + columnOffset];
    if (!row || !column) return;
    const after = coerceCellValue(column, raw);
    if (raw.trim() && after === null && (column.inputType === 'number' || column.inputType === 'datetime')) {
      invalidCells.push({ row: rowOffset + 1, column: columnOffset + 1, value: raw });
      return;
    }
    const before = column.id === rowHeader.id ? row.name : row.values[column.id] ?? null;
    if (sameValue(before, after)) return;
    changes.push({ rowId: row.id, columnId: column.id, before, after });
    if (column.id === rowHeader.id) row.name = after;
    else row.values[column.id] = after;
  }));

  if (invalidCells.length) return { table, changes: [], addedRows: [], addedColumns: [], invalidCells };
  return {
    table: { ...table, columns, rows, updatedAt: Date.now() },
    changes,
    addedRows,
    addedColumns,
    invalidCells,
  };
};
