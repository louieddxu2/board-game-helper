import type { WorkspaceData, WorkspaceTable } from './types';

const newRevision = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID()
  : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

// Legacy data retains its update marker until its next local mutation.
export const workspaceTableChangeRevision = (table: Pick<WorkspaceTable, 'changeRevision' | 'updatedAt'>) => table.changeRevision ?? `legacy:${table.updatedAt}`;
export const workspaceStructureChangeRevision = (data: WorkspaceData) => data.structureRevision ?? `legacy:${data.updatedAt ?? 0}`;

/** Track immutable mutations without reading or serializing table contents. */
export const assignWorkspaceChangeRevisions = (previous: WorkspaceData | undefined, next: WorkspaceData): WorkspaceData => {
  if (previous === next) return next;
  const previousTables = new Map(previous?.tables.map((table) => [table.id, table]));
  const tables = next.tables.map((table) => previousTables.get(table.id) === table ? table : { ...table, changeRevision: newRevision() });
  const structureChanged = !previous
    || previous.nodes !== next.nodes
    || previous.activeNodeId !== next.activeNodeId
    || previous.bottomNavigationTableIds !== next.bottomNavigationTableIds;
  return {
    ...next,
    tables: tables.some((table, index) => table !== next.tables[index]) ? tables : next.tables,
    structureRevision: structureChanged ? newRevision() : workspaceStructureChangeRevision(previous),
  };
};
