import type { WorkspaceCellValue, WorkspaceRow } from './types';
import { getWorkspaceRowIndexes, preserveWorkspaceRowIndexes } from './rowIndexes';

/** Changes to stored values; derived results are not part of this contract. */
export interface WorkspaceCellChange {
  rowId: string;
  columnId: string;
  before: WorkspaceCellValue;
  after: WorkspaceCellValue;
}

export const sameWorkspaceCellValue = (left: WorkspaceCellValue, right: WorkspaceCellValue) => left === right
  || (left !== null && right !== null && typeof left === 'object' && typeof right === 'object'
    && left.url === right.url && left.label === right.label);

export const getWorkspaceCellValue = (row: WorkspaceRow, columnId: string, rowHeaderId: string | undefined): WorkspaceCellValue =>
  (columnId === rowHeaderId ? row.name : row.values[columnId]) ?? null;

/** Missing keys stay absent in history; explicitly stored empty values remain restorable. */
export const captureWorkspaceColumnValues = (rows: readonly WorkspaceRow[], columnId: string): Record<string, WorkspaceCellValue> => {
  function* entries(): Generator<[string, WorkspaceCellValue]> {
    for (const row of rows) {
      if (Object.hasOwn(row.values, columnId)) yield [row.id, row.values[columnId] ?? null];
    }
  }
  return Object.fromEntries(entries());
};

/** Old dense snapshots still restore every key; sparse snapshots only restore captured rows. */
export const restoreWorkspaceColumnValues = (
  rows: WorkspaceRow[], columnId: string, values: Readonly<Record<string, WorkspaceCellValue>>,
): WorkspaceRow[] => {
  if (!Object.keys(values).length) return rows;
  let changed = false;
  const nextRows = rows.map(row => {
    if (!Object.hasOwn(values, row.id)) return row;
    const value = values[row.id] ?? null;
    if (Object.hasOwn(row.values, columnId) && sameWorkspaceCellValue(row.values[columnId], value)) return row;
    changed = true;
    return { ...row, values: { ...row.values, [columnId]: value } };
  });
  if (!changed) return rows;
  preserveWorkspaceRowIndexes(rows, nextRows);
  return nextRows;
};

/** Remove column keys rather than assigning null; untouched rows retain their identity. */
export const removeWorkspaceColumnValues = (rows: WorkspaceRow[], columnIds: ReadonlySet<string>): WorkspaceRow[] => {
  if (!columnIds.size) return rows;
  let changed = false;
  const nextRows = rows.map(row => {
    let values = row.values;
    for (const columnId of columnIds) {
      if (!Object.hasOwn(values, columnId)) continue;
      if (values === row.values) values = { ...values };
      delete values[columnId];
    }
    if (values === row.values) return row;
    changed = true;
    return { ...row, values };
  });
  if (!changed) return rows;
  preserveWorkspaceRowIndexes(rows, nextRows);
  return nextRows;
};

/** Apply a whole operation, copying each affected row and value object at most once. */
export const applyWorkspaceCellChanges = (
  rows: WorkspaceRow[],
  rowHeaderId: string | undefined,
  changes: readonly WorkspaceCellChange[],
  side: 'before' | 'after' = 'after',
): WorkspaceRow[] => {
  if (!changes.length) return rows;
  const updates = new Map<string, Map<string, WorkspaceCellValue>>();
  for (const change of changes) {
    let values = updates.get(change.rowId);
    if (!values) { values = new Map(); updates.set(change.rowId, values); }
    values.set(change.columnId, change[side]);
  }
  const indexes = getWorkspaceRowIndexes(rows);
  let nextRows = rows;
  for (const [id, values] of updates) {
    const index = indexes.get(id);
    if (index === undefined) continue;
    const row = rows[index];
    let next = row;
    for (const [columnId, value] of values) {
      if (sameWorkspaceCellValue(getWorkspaceCellValue(next, columnId, rowHeaderId), value)) continue;
      if (next === row) next = { ...row };
      if (columnId === rowHeaderId) next.name = value;
      else {
        if (next.values === row.values) next.values = { ...row.values };
        next.values[columnId] = value;
      }
    }
    if (next !== row) {
      if (nextRows === rows) nextRows = rows.slice();
      nextRows[index] = next;
    }
  }
  if (nextRows !== rows) preserveWorkspaceRowIndexes(rows, nextRows);
  return nextRows;
};
