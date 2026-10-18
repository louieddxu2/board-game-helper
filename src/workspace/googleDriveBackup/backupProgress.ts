export type WorkspaceBackupPhase = 'preparing' | 'checking-remote' | 'reading-directory' | 'preparing-folders'
  | 'reading-table' | 'creating-file' | 'uploading-table' | 'table-uploaded' | 'reusing-table' | 'saving-index' | 'confirming' | 'cleaning-history';

/** Counts describe table files already uploaded, including files retained on resume.
 * The in-flight table and the final publication/verification are not counted. */
export interface WorkspaceBackupProgress {
  phase: WorkspaceBackupPhase;
  completedTables?: number;
  totalTables?: number;
  name?: string;
}
const phaseLabels: Record<WorkspaceBackupPhase, string> = {
  preparing: '正在準備備份',
  'checking-remote': '正在檢查雲端備份',
  'reading-directory': '正在讀取表格目錄',
  'preparing-folders': '正在準備資料夾',
  'reading-table': '正在讀取表格',
  'creating-file': '正在產生備份檔',
  'uploading-table': '正在上傳表格',
  'table-uploaded': '表格已上傳',
  'reusing-table': '沿用已有備份',
  'saving-index': '正在儲存備份目錄',
  confirming: '正在驗證並完成備份',
  'cleaning-history': '正在清理舊備份',
};
export const workspaceBackupProgressLabel = (progress: WorkspaceBackupProgress) => `${phaseLabels[progress.phase]}${progress.name ? `：${progress.name}` : '…'}`;

const tablePhases = new Set<WorkspaceBackupPhase>(['reading-table', 'creating-file', 'uploading-table', 'table-uploaded', 'reusing-table']);
const tableProgress = (progress: WorkspaceBackupProgress) => {
  const total = progress.totalTables;
  const completed = progress.completedTables ?? 0;
  if (!tablePhases.has(progress.phase) || typeof total !== 'number' || !Number.isInteger(total) || total <= 0 || !Number.isFinite(completed)) return undefined;
  return { total, completed: Math.min(total, Math.max(0, Math.trunc(completed))) };
};

export const workspaceBackupProgressCount = (progress: WorkspaceBackupProgress) => {
  const tables = tableProgress(progress);
  return tables ? `已上傳 ${tables.completed} / ${tables.total} 張表格` : '';
};
export const workspaceBackupProgressValue = (progress: WorkspaceBackupProgress) => tableProgress(progress)?.completed;
