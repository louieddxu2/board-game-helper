export type WorkspaceBackupPhase = 'preparing' | 'checking-remote' | 'reading-directory' | 'preparing-folders'
  | 'reading-table' | 'creating-file' | 'uploading-table' | 'reusing-table' | 'saving-index' | 'confirming';

/** Counts describe processed tables, including remote files reused by automatic backup. */
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
  'reusing-table': '沿用已有備份',
  'saving-index': '正在完成備份',
  confirming: '正在確認雲端備份',
};
export const workspaceBackupProgressLabel = (progress: WorkspaceBackupProgress) => `${phaseLabels[progress.phase]}${progress.name ? `：${progress.name}` : '…'}`;
export const workspaceBackupProgressCount = (progress: WorkspaceBackupProgress) => progress.totalTables === undefined ? '' : `已處理 ${progress.completedTables ?? 0} / ${progress.totalTables} 張表格`;
export const workspaceBackupProgressValue = (progress: WorkspaceBackupProgress) => progress.totalTables && ['reading-table', 'creating-file', 'uploading-table', 'reusing-table'].includes(progress.phase)
  ? progress.completedTables ?? 0 : undefined;
