import type { WorkspaceRow, WorkspaceTable } from './types';
import { WorkspaceStorageIntegrityError } from './rowChunkStorage';
import type { WorkspaceTableWindow } from './rowPageLayout';

export * from './rowPageLayout';
export { planWorkspaceRowPages } from './rowBlockPlanning';

const readOnlyProjection = Symbol('workspace-read-only-window');
export const assertWorkspaceTableComplete = (table: WorkspaceTable) => {
  if (readOnlyProjection in table) throw new WorkspaceStorageIntegrityError('A table window cannot be saved or exported as a complete table');
};
const pendingRows = new WeakSet<WorkspaceRow>();
export const createPendingWorkspaceRow = (index: number): WorkspaceRow => {
  const row: WorkspaceRow = { id: `pending-workspace-row-${index}`, name: null, values: {} };
  pendingRows.add(row);
  return row;
};
export const isPendingWorkspaceRow = (row: WorkspaceRow) => pendingRows.has(row);

/** Used by display code only. Never include the result in WorkspaceData.tables. */
export const workspaceWindowDisplayTable = (window: WorkspaceTableWindow): WorkspaceTable => Object.assign({
  ...window.head.definition, updatedAt: window.head.updatedAt, changeRevision: window.head.changeRevision,
  rows: window.pages.flatMap(page => page.rows),
}, { [readOnlyProjection]: true });
