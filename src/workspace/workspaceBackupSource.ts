import type { WorkspaceTable } from './types';

/** Backup directories retain revision markers, never table rows. */
export type WorkspaceBackupTableSummary = Pick<WorkspaceTable, 'id' | 'name' | 'updatedAt' | 'changeRevision'>;
export interface WorkspaceBackupSource {
  tables: WorkspaceBackupTableSummary[];
  readTable(tableId: string): Promise<WorkspaceTable>;
  verify(): Promise<void>;
}
export const workspaceBackupTableSummary = ({ id, name, updatedAt, changeRevision }: WorkspaceBackupTableSummary): WorkspaceBackupTableSummary => ({ id, name, updatedAt, changeRevision });
