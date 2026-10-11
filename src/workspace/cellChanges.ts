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
  return changed ? nextRows : rows;
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
  return changed ? nextRows : rows;
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
