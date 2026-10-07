import type { WorkspaceCellValue, WorkspaceRow } from './types';

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
  let changed = false;
  const nextRows = rows.map(row => {
    const values = updates.get(row.id);
    if (!values) return row;
    let next = row;
    for (const [columnId, value] of values) {
      if (sameWorkspaceCellValue(getWorkspaceCellValue(next, columnId, rowHeaderId), value)) continue;
      if (next === row) { next = { ...row }; changed = true; }
      if (columnId === rowHeaderId) next.name = value;
      else {
        if (next.values === row.values) next.values = { ...row.values };
        next.values[columnId] = value;
      }
    }
    return next;
  });
  return changed ? nextRows : rows;
};
