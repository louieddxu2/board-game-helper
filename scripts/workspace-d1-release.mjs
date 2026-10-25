export const WORKSPACE_D1_REMOVAL_MIGRATION = '0116_remove_workspace_backup_coordination.sql';

export const deferWorkspaceD1Removal = pending => {
  if (!pending.includes(WORKSPACE_D1_REMOVAL_MIGRATION)) return false;
  if (pending.length !== 1) throw new Error('Workspace 資料移除必須獨立發布；請先處理其他待套用 migration。');
  return true;
};

/** Do not remove server records until the deployed client no longer depends on them. */
export const assertWorkspaceD1RemovalReady = async (origin, fetchImpl = fetch) => {
  for (const [path, method] of [['/api/workspace-backup/state', 'GET'], ['/api/workspace/project', 'POST']]) {
    const response = await fetchImpl(`${origin}${path}`, { method, cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(10_000) });
    const value = await response.json().catch(() => null);
    if (response.status !== 410 || value?.error !== 'backup_client_update_required'
      || response.headers.has('x-d1-rows-read') || response.headers.has('x-d1-rows-written')) {
      throw new Error('正式站尚未停用 Workspace D1 API；拒絕刪除紀錄，請先發布不依賴 D1 的版本。');
    }
  }
  const config = await fetchImpl(`${origin}/api/workspace-config`, { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(10_000) });
  const value = await config.json().catch(() => null);
  if (!config.ok || typeof value?.googleDriveClientId !== 'string' || !value.googleDriveClientId.trim()
    || config.headers.has('x-d1-rows-read') || config.headers.has('x-d1-rows-written')) {
    throw new Error('正式站 Workspace 公開設定尚未就緒；拒絕刪除紀錄。');
  }
};
