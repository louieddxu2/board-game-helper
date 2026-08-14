import { GoogleDriveApi } from './googleDriveApi';
import type { BackupMetadata, BackupReceipt, DriveBody, DriveFile, SingleFileBackupOptions } from './types';

export const BACKUP_KEY_PROPERTY = 'backupKey';
export const BACKED_UP_AT_PROPERTY = 'backedUpAt';
export const SOURCE_UPDATED_AT_PROPERTY = 'sourceUpdatedAt';

export class BackupNotFoundError extends Error {
  readonly backupKey: string;
  constructor(backupKey: string) {
    super(`找不到 Google Drive 備份：${backupKey}`);
    this.name = 'BackupNotFoundError';
    this.backupKey = backupKey;
  }
}

export interface GoogleDriveSingleFileBackup {
  ensureFolder(): Promise<string>;
  findRemoteFile(): Promise<DriveFile | null>;
  backup(body: DriveBody, metadata?: BackupMetadata): Promise<BackupReceipt>;
  restore(): Promise<Blob>;
}

export const createGoogleDriveSingleFileBackup = (options: SingleFileBackupOptions): GoogleDriveSingleFileBackup => {
  if (!options.backupKey.trim()) throw new Error('backupKey 不可為空白');
  if (!options.fileName.trim()) throw new Error('fileName 不可為空白');
  if (!options.mimeType.trim()) throw new Error('mimeType 不可為空白');
  const api = new GoogleDriveApi(options);
  let folderId: string | null = null;
  let folderPromise: Promise<string> | null = null;
  let backupPromise: Promise<BackupReceipt> | null = null;
  const ensureFolder = async () => {
    if (folderId) return folderId;
    if (!folderPromise) {
      folderPromise = api.ensureFolderPath(options.folderPath).then((id) => { folderId = id; return id; }).finally(() => { folderPromise = null; });
    }
    return folderPromise;
  };
  const findRemoteFile = async () => {
    const parentId = await ensureFolder();
    return api.findFileByAppProperty({ key: BACKUP_KEY_PROPERTY, value: options.backupKey, parentId, mimeType: options.mimeType });
  };
  const performBackup = async (body: DriveBody, metadata: BackupMetadata = {}): Promise<BackupReceipt> => {
    const parentId = await ensureFolder();
    const existing = await findRemoteFile();
    const appProperties: Record<string, string> = {
      ...(options.appProperties ?? {}),
      ...(metadata.appProperties ?? {}),
      [BACKUP_KEY_PROPERTY]: options.backupKey,
      [BACKED_UP_AT_PROPERTY]: String(Date.now()),
    };
    if (metadata.sourceUpdatedAt !== undefined) appProperties[SOURCE_UPDATED_AT_PROPERTY] = String(metadata.sourceUpdatedAt);
    const file = await api.uploadFile({ fileId: existing?.id, parentId, name: options.fileName, mimeType: options.mimeType, body, appProperties });
    return { file, backupKey: options.backupKey, parentId, sourceUpdatedAt: metadata.sourceUpdatedAt };
  };
  return {
    ensureFolder,
    findRemoteFile,
    backup(body, metadata) {
      if (!backupPromise) backupPromise = performBackup(body, metadata).finally(() => { backupPromise = null; });
      return backupPromise;
    },
    async restore() {
      const file = await findRemoteFile();
      if (!file) throw new BackupNotFoundError(options.backupKey);
      return api.downloadBlob(file.id);
    },
  };
};
