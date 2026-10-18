export type WorkspaceBackupPhase = 'preparing' | 'checking-remote' | 'reading-directory' | 'preparing-cloud' | 'preparing-folders'
  | 'reading-table' | 'creating-file' | 'uploading-table' | 'table-uploaded' | 'reusing-table'
  | 'saving-index' | 'verifying-index' | 'confirming' | 'cleaning-history' | 'saving-receipt' | 'complete';

/** Counts describe table files already uploaded, including files retained on resume.
 * The in-flight table and the final publication/verification are not counted. */
export interface WorkspaceBackupProgress {
  phase: WorkspaceBackupPhase;
  completedTables?: number;
  totalTables?: number;
  name?: string;
  /** Monotonic progress for one backup attempt, derived from completed work. */
  overallPercent?: number;
}
const phaseLabels: Record<WorkspaceBackupPhase, string> = {
  preparing: '正在準備備份',
  'checking-remote': '正在檢查雲端備份',
  'reading-directory': '正在讀取表格目錄',
  'preparing-cloud': '正在準備雲端備份',
  'preparing-folders': '正在準備資料夾',
  'reading-table': '正在讀取表格',
  'creating-file': '正在產生備份檔',
  'uploading-table': '正在上傳表格',
  'table-uploaded': '表格已上傳',
  'reusing-table': '沿用已有備份',
  'saving-index': '正在儲存備份目錄',
  'verifying-index': '正在檢查備份內容',
  confirming: '正在驗證並完成備份',
  'cleaning-history': '正在清理舊備份',
  'saving-receipt': '正在儲存備份紀錄',
  complete: '備份已完成',
};
export const workspaceBackupProgressLabel = (progress: WorkspaceBackupProgress) => progress.phase === 'complete'
  ? phaseLabels.complete : `${phaseLabels[progress.phase]}${progress.name ? `：${progress.name}` : '…'}`;

const tablePhases = new Set<WorkspaceBackupPhase>(['reading-table', 'creating-file', 'uploading-table', 'table-uploaded', 'reusing-table']);
const tableProgress = (progress: WorkspaceBackupProgress) => {
  const total = progress.totalTables;
  const completed = progress.completedTables ?? 0;
  if (!tablePhases.has(progress.phase) || typeof total !== 'number' || !Number.isInteger(total) || total <= 0 || !Number.isFinite(completed)) return undefined;
  return { total, completed: Math.min(total, Math.max(0, Math.trunc(completed))) };
};

const phasePercent: Record<WorkspaceBackupPhase, number> = {
  preparing: 0, 'checking-remote': 3, 'reading-directory': 8, 'preparing-cloud': 12, 'preparing-folders': 12,
  'reading-table': 15, 'creating-file': 15, 'uploading-table': 15, 'table-uploaded': 15, 'reusing-table': 15,
  'saving-index': 85, 'verifying-index': 90, confirming: 95, 'cleaning-history': 97, 'saving-receipt': 99, complete: 100,
};

/** A work estimate, not elapsed time or uploaded bytes. Final verification and
 * the local receipt have their own budget, so only acknowledged success is 100%. */
export const workspaceBackupProgressValue = (progress: WorkspaceBackupProgress) => {
  if (progress.phase === 'complete') return 100;
  const tables = tableProgress(progress);
  const substep = progress.phase === 'creating-file' ? 1 / 3 : progress.phase === 'uploading-table' ? 2 / 3 : 0;
  const measured = tables
    ? 15 + 70 * Math.min(tables.total, tables.completed + substep) / tables.total
    : phasePercent[progress.phase];
  const previous = typeof progress.overallPercent === 'number' && Number.isFinite(progress.overallPercent) ? progress.overallPercent : 0;
  return Math.min(99, Math.max(0, Math.floor(Math.max(measured, previous))));
};

export const advanceWorkspaceBackupProgress = (previous: WorkspaceBackupProgress | undefined, next: WorkspaceBackupProgress): WorkspaceBackupProgress => ({
  ...next,
  overallPercent: Math.min(next.phase === 'complete' ? 100 : 99,
    Math.max(previous ? workspaceBackupProgressValue(previous) : 0, workspaceBackupProgressValue(next))),
});

export const workspaceBackupProgressCount = (progress: WorkspaceBackupProgress) => {
  const tables = tableProgress(progress);
  return `${workspaceBackupProgressValue(progress)}%${tables ? ` · 已上傳 ${tables.completed} / ${tables.total} 張表格` : ''}`;
};
