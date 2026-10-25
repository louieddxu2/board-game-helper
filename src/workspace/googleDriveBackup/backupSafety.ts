import type { WorkspaceData } from '../types';

export type WorkspaceBackupSafety = 'empty' | 'unconfirmed';

export const workspaceHasBackupTables = (data: WorkspaceData) => data.tables.length > 0
  || data.nodes.some(node => node.type === 'table' && node.tableId);

export const workspaceBackupSafetyMessage = (safety: WorkspaceBackupSafety) => safety === 'empty'
  ? '本機資料為空，已暫停自動備份。請先還原雲端備份。'
  : '本機資料尚未確認，已暫停自動備份。請先還原或確認本機資料。';
