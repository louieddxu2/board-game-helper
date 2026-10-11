import { coerceCellValue, displayWorkspaceColumnValue, getRowHeaderColumn, isWorkspaceLinkValue } from './model';
import { getWorkspaceCellValue, type WorkspaceCellChange } from './cellChanges';
import { preserveWorkspaceRowIndexes } from './rowIndexes';
import { finishWorkspaceSteps, runWorkspaceCooperativeSteps } from './workspaceCooperativeWork';
import type { WorkspaceColumn, WorkspaceTable } from './types';

export type WorkspaceColumnValueChange = Omit<WorkspaceCellChange, 'columnId'>;

export class WorkspaceColumnConversionError extends Error {
  constructor(column: WorkspaceColumn, count: number) {
    super(`「${column.name || '未命名欄位'}」有 ${count} 筆資料無法轉換成${column.inputType === 'number' ? '數字' : '時間'}，未儲存設定`);
    this.name = 'WorkspaceColumnConversionError';
  }
}

/** Called only when a settings draft is saved. A failed conversion leaves the whole table intact. */
export const prepareWorkspaceColumnSave = (table: WorkspaceTable, column: WorkspaceColumn) => finishWorkspaceSteps(prepareWorkspaceColumnSaveSteps(table, column));
export const prepareWorkspaceColumnSaveAsync = (table: WorkspaceTable, column: WorkspaceColumn, checkCurrent: () => void) => runWorkspaceCooperativeSteps(prepareWorkspaceColumnSaveSteps(table, column), checkCurrent);

export function* prepareWorkspaceColumnSaveSteps(table: WorkspaceTable, column: WorkspaceColumn) {
  const rowHeader = getRowHeaderColumn(table);
  const isRowHeader = rowHeader.id === column.id;
  const previous = isRowHeader ? rowHeader : table.columns.find(item => item.id === column.id);
  if (!previous) throw new Error('找不到要儲存的屬性');
  const changes: WorkspaceColumnValueChange[] = [];
  let invalidCount = 0;
  let rows = table.rows;
  if (previous.inputType !== column.inputType) for (const [index, row] of table.rows.entries()) {
    const before = getWorkspaceCellValue(row, column.id, rowHeader.id);
    // Labels become text; an unnamed link keeps its complete address, including its protocol.
    const raw = isWorkspaceLinkValue(before)
      ? before.label.trim() || before.url.trim()
      : displayWorkspaceColumnValue(before, previous);
    const after = coerceCellValue(column, raw);
    if (raw.trim() && after === null) invalidCount += 1;
    if (before !== after) {
      changes.push({ rowId: row.id, before, after });
      if (rows === table.rows) rows = table.rows.slice();
      rows[index] = isRowHeader ? { ...row, name: after } : { ...row, values: { ...row.values, [column.id]: after } };
    }
    if (index % 16 === 15) yield;
  }
  if (invalidCount) throw new WorkspaceColumnConversionError(column, invalidCount);
  if (rows !== table.rows) preserveWorkspaceRowIndexes(table.rows, rows);
  const nextColumn = previous.inputType === column.inputType ? column : { ...column, dynamicOptions: undefined };
  const next: WorkspaceTable = {
    ...table,
    ...(isRowHeader ? { rowHeader: nextColumn, rowHeaderName: column.name }
      : { columns: table.columns.map(item => item.id === column.id ? nextColumn : item) }),
    rows: changes.length ? rows : table.rows,
  };
  return { table: next, changes };
}
