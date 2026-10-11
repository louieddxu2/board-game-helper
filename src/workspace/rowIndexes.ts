import type { WorkspaceRow } from './types';

const indexesByRows = new WeakMap<readonly WorkspaceRow[], ReadonlyMap<string, number>>();

/** Positions belong to an immutable row array, including flattened display windows. */
export const getWorkspaceRowIndexes = (rows: readonly WorkspaceRow[]): ReadonlyMap<string, number> => {
  let indexes = indexesByRows.get(rows);
  if (!indexes) {
    const built = new Map<string, number>();
    for (let index = 0; index < rows.length; index++) built.set(rows[index].id, index);
    indexes = built;
    indexesByRows.set(rows, indexes);
  }
  return indexes;
};

/** Only value-edit producers call this; they cannot change row IDs or their order. */
export const preserveWorkspaceRowIndexes = (before: readonly WorkspaceRow[], after: readonly WorkspaceRow[]) => {
  const indexes = indexesByRows.get(before);
  if (indexes && before.length === after.length) indexesByRows.set(after, indexes);
};

export const getWorkspaceRow = (rows: readonly WorkspaceRow[], id: string): WorkspaceRow | undefined => {
  const index = getWorkspaceRowIndexes(rows).get(id);
  return index === undefined ? undefined : rows[index];
};
