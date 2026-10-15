import { coerceCellValue, displayWorkspaceColumnValue, getRowHeaderColumn, isWorkspaceLinkValue } from './model';
import { getWorkspaceCellValue, type WorkspaceCellChange } from './cellChanges';
import { preserveWorkspaceRowIndexes } from './rowIndexes';
import { finishWorkspaceSteps, runWorkspaceCooperativeSteps } from './workspaceCooperativeWork';
import type { WorkspaceColumn, WorkspaceTable } from './types';
import { normalizeWorkspaceFormula, validateWorkspaceFormulaColumns } from './formula/configuration';
import { createWorkspaceValueReader } from './formula/values';
import { normalizeWorkspaceColumnBackground } from './columnAppearance';

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
  column = { ...column, backgroundColor: normalizeWorkspaceColumnBackground(column.backgroundColor), formula: column.formula ? normalizeWorkspaceFormula(column.formula) : undefined };
  validateWorkspaceFormulaColumns(table.columns.map(item => item.id === column.id ? column : item), isRowHeader ? column : rowHeader);
  const reader = createWorkspaceValueReader();
  const changes: WorkspaceColumnValueChange[] = [];
  let invalidCount = 0;
  let rows = table.rows;
  if (previous.inputType !== column.inputType || Boolean(previous.formula) !== Boolean(column.formula)) for (const [index, row] of table.rows.entries()) {
    const before = getWorkspaceCellValue(row, column.id, rowHeader.id);
    const resolved = reader.read(row, previous, isRowHeader);
    if (previous.formula && !column.formula && resolved.error) throw new Error(`「${column.name}」含有無法計算的結果，請修正公式或來源資料後再切換`);
    // Labels become text; an unnamed link keeps its complete address, including its protocol.
    const value = previous.formula ? resolved.value : before;
    const raw = isWorkspaceLinkValue(value)
      ? value.label.trim() || value.url.trim()
      : displayWorkspaceColumnValue(value, previous);
    const after = column.formula ? null : coerceCellValue(column, raw);
    if (!column.formula && raw.trim() && after === null) invalidCount += 1;
    if (before !== after) {
      changes.push({ rowId: row.id, before, after });
      if (rows === table.rows) rows = table.rows.slice();
      const values = { ...row.values };
      if (column.formula) delete values[column.id];
      else values[column.id] = after;
      rows[index] = isRowHeader ? { ...row, name: after } : { ...row, values };
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
