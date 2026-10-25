const messages: Record<string, string> = {
  backup_revision_conflict: '雲端備份已更新，請重新確認版本',
  backup_legacy_changed: '舊版裝置的雲端備份已有變更，請先確認',
  backup_operation_expired: '備份作業已失效，請重新備份',
  backup_snapshot_changed: '所選備份已有變更，請重新選擇',
  backup_snapshot_incomplete: '備份檔尚未完整上傳，請重試',
  backup_snapshot_invalid: '備份檔案驗證失敗',
  backup_snapshot_empty: '本機沒有表格，已停止備份；請先選擇雲端備份還原',
  backup_root_invalid: '備份資料夾無法使用，請檢查 Google Drive',
  backup_snapshot_unavailable: '所選備份已無法使用，請重新選擇',
};
export class SnapshotCoordinatorError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(messages[code] ?? '暫時無法處理雲端備份，請稍後再試');
    this.name = 'SnapshotCoordinatorError';
  }
}
