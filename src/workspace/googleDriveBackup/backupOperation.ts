import type { GoogleDriveApi } from './googleDriveApi';
import type { DriveFile } from './types';

export const DRIVE_OPERATION_KIND = 'operation';
const OPERATION_LIFETIME_MS = 60 * 60 * 1000;
export const driveOperationExpiry = (file: DriveFile) => {
  const created = Date.parse(file.createdTime ?? '');
  return Number.isFinite(created) ? created + OPERATION_LIFETIME_MS : Infinity;
};

/** Publish the operation before reading a snapshot, so cleanup can protect in-flight readers. */
export const withDriveBackupOperation = async <T>(api: GoogleDriveApi, root: string, backupKey: string, run: (verify: () => void, operationId: string, verifyRemote: () => Promise<void>) => Promise<T>) => {
  const operation = await api.uploadFile({ parentId: root, name: '備份作業.json', mimeType: 'application/json', body: '{}', appProperties: { backupKey, backupKind: DRIVE_OPERATION_KIND } });
  api.observeCreatedTime(operation.createdTime);
  const expires = driveOperationExpiry(operation);
  const verify = () => { if (api.serverNow() >= expires) throw new Error('備份作業已逾時，請重新執行'); };
  const verifyRemote = async () => {
    const files = await api.findFilesByAppProperty({ key: 'backupKind', value: DRIVE_OPERATION_KIND, parentId: root });
    verify();
    if (!files.some(file => file.id === operation.id)) throw new Error('備份作業已失效，請重新執行');
  };
  let warning: string | undefined;
  let value: T;
  try { verify(); value = await run(verify, operation.id, verifyRemote); }
  finally {
    try { await api.trashFile(operation.id); }
    catch { warning = '作業標記清理失敗，舊版本清理將暫緩並於後續備份重試'; }
  }
  return { value, warning };
};
