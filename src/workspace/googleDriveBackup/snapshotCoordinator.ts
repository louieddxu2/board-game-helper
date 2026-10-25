import {
  DRIVE_SNAPSHOT_API, type BeginDriveSnapshot, type DriveSnapshotOperation, type DriveSnapshotState,
} from '../../shared/driveSnapshots';
import type { AccessTokenProvider, FetchLike } from './types';

const messages: Record<string, string> = {
  backup_auth_required: '請重新連結 Google Drive',
  backup_identity_required: '請重新開啟工作區並連結 Google Drive',
  backup_auth_invalid: 'Google Drive 授權不符，請重新連結',
  backup_auth_not_configured: 'Google Drive 備份尚未設定完成',
  backup_auth_unavailable: '暫時無法驗證 Google Drive，請稍後再試',
  backup_revision_conflict: '雲端備份已更新，請重新確認版本',
  backup_legacy_changed: '舊版裝置的雲端備份已有變更，請先確認',
  backup_operation_expired: '備份作業已失效，請重新備份',
  backup_snapshot_changed: '所選備份已有變更，請重新選擇',
  backup_snapshot_incomplete: '備份檔尚未完整上傳，請重試',
  backup_snapshot_invalid: '備份檔案驗證失敗',
  backup_snapshot_empty: '本機沒有表格，已停止備份；請先選擇雲端備份還原',
  backup_root_changed: '備份資料夾已有變更，請重新連結',
  backup_root_invalid: '備份資料夾無法使用，請檢查 Google Drive',
  backup_snapshot_unavailable: '所選備份已無法使用，請重新選擇',
};
export class SnapshotCoordinatorError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(messages[code] ?? '暫時無法處理雲端備份，請稍後再試');
    this.name = 'SnapshotCoordinatorError';
  }
}
const otherCodes = new Set(['backup_service_unavailable', 'backup_drive_unavailable', 'backup_operation_not_found',
  'backup_operation_mismatch', 'backup_request_invalid', 'backup_request_too_large', 'backup_cleanup_unknown_files', 'rate_limited']);

export interface SnapshotCoordinator {
  state(rootId?: string): Promise<DriveSnapshotState>;
  operation(id: string): Promise<DriveSnapshotOperation | null>;
  begin(input: BeginDriveSnapshot): Promise<DriveSnapshotOperation>;
  renew(id: string): Promise<void>;
  commit(id: string): Promise<DriveSnapshotOperation>;
  restore(id: string, leaseId: string, action: 'acquire' | 'verify' | 'release'): Promise<DriveSnapshotOperation>;
  cleanup(): Promise<{ cleaned: boolean }>;
}

export const createSnapshotCoordinator = (options: {
  tokenProvider: AccessTokenProvider; fetchImpl?: FetchLike; baseUrl?: string;
}): SnapshotCoordinator => {
  const request = async <T>(path: string, body?: unknown): Promise<T> => {
    const call = async (forceRefresh = false) => (options.fetchImpl ?? fetch)(`${options.baseUrl ?? DRIVE_SNAPSHOT_API}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${await options.tokenProvider.getAccessToken({ forceRefresh })}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      credentials: 'omit', cache: 'no-store', ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30_000),
    });
    let response = await call();
    if (response.status === 401) response = await call(true);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = result && typeof result === 'object' && typeof result.error === 'string' ? result.error : '';
      throw new SnapshotCoordinatorError(Object.hasOwn(messages, code) || otherCodes.has(code) ? code : 'backup_service_unavailable', response.status);
    }
    return result as T;
  };
  return {
    state: root => request(`/state${root ? `?rootId=${encodeURIComponent(root)}` : ''}`),
    async operation(id) {
      try { return await request(`/operations/${encodeURIComponent(id)}`); }
      catch (error) { if (error instanceof SnapshotCoordinatorError && error.status === 404) return null; throw error; }
    },
    begin: input => request('/begin', input),
    renew: id => request(`/operations/${encodeURIComponent(id)}/renew`, {}),
    commit: id => request(`/operations/${encodeURIComponent(id)}/commit`, {}),
    restore: (id, leaseId, action) => request(`/operations/${encodeURIComponent(id)}/restore`, { leaseId, action }),
    cleanup: () => request('/cleanup', {}),
  };
};
