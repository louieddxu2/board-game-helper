import type { WorkspaceRow } from './types';

const emptyValueIdentities = new WeakMap<WorkspaceRow, object>();

/** Only producers that add/remove empty keys may certify equal stored cell contents. */
export const preserveWorkspaceEmptyRowStorage = (before: WorkspaceRow, after: WorkspaceRow) => {
  const identity = emptyValueIdentities.get(before) ?? {};
  emptyValueIdentities.set(before, identity);
  emptyValueIdentities.set(after, identity);
};

export const sameWorkspaceStoredRow = (left: WorkspaceRow | undefined, right: WorkspaceRow) => left === right
  || Boolean(left && emptyValueIdentities.has(left) && emptyValueIdentities.get(left) === emptyValueIdentities.get(right));

export const sameWorkspaceStoredRows = (left: readonly WorkspaceRow[] | undefined, right: readonly WorkspaceRow[]) =>
  Boolean(left && left.length === right.length && right.every((row, index) => sameWorkspaceStoredRow(left[index], row)));
