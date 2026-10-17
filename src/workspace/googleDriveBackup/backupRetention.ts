import { importWorkspaceBackupManifestXlsx } from '../spreadsheet';
import type { GoogleDriveApi } from './googleDriveApi';
import type { DriveFile } from './types';
import { DRIVE_OPERATION_KIND, driveOperationExpiry } from './backupOperation';
import { findDriveManifestHeads, retainedDriveManifests } from './manifestHistory';

export const WORKSPACE_BACKUP_RETAINED_VERSIONS = 3;
const sameManifest = (current: DriveFile, previous: DriveFile) => {
  const properties = current.appProperties ?? {};
  const priorProperties = previous.appProperties ?? {};
  return current.modifiedTime === previous.modifiedTime && current.mimeType === previous.mimeType
    && JSON.stringify(current.parents ?? []) === JSON.stringify(previous.parents ?? [])
    && Object.keys(properties).length === Object.keys(priorProperties).length
    && Object.entries(properties).every(([key, value]) => priorProperties[key] === value);
};
export const cleanDriveBackupHistory = async ({ api, root, backupKey, headId, limit, operationId, verify }: {
  api: GoogleDriveApi; root: string; backupKey: string; headId: string; limit: number; operationId: string; verify(): void;
}): Promise<string | undefined> => {
  const listOwned = async () => (await api.findFilesByAppProperty({ key: 'backupKey', value: backupKey })).filter(file => file.appProperties?.backupKey === backupKey);
  const manifestFiles = (files: DriveFile[]) => files.filter(file => file.appProperties?.backupKind === 'manifest' && file.parents?.includes(root));
  let files = await listOwned();
  const initial = manifestFiles(files);
  const heads = findDriveManifestHeads(initial);
  if (heads.length !== 1 || heads[0].id !== headId) return '雲端備份已有變更，這次暫緩舊版本清理';
  const kept = retainedDriveManifests(initial, headId, limit);
  const keepIds = new Set(kept.map(file => file.id));
  const old = initial.filter(file => !keepIds.has(file.id));
  const initialById = new Map(initial.map(file => [file.id, file]));
  const removedIds = new Set<string>();
  const protectedTables = new Set<string>();
  const folders = new Set([root]);
  // Only index payloads are loaded; cleanup never downloads table contents.
  const ownedFolders = files.filter(file => file.appProperties?.backupKind === 'folder');
  for (;;) {
    const before = folders.size;
    for (const file of ownedFolders) if (file.parents?.some(parent => folders.has(parent))) folders.add(file.id);
    if (folders.size === before) break;
  }
  for (const file of kept) {
    const manifest = await importWorkspaceBackupManifestXlsx(await api.downloadBlob(file.id));
    for (const table of manifest.tables) {
      if (!table.driveFileId) throw new Error('備份索引缺少表格檔案識別，未清理舊版本');
      protectedTables.add(table.driveFileId);
    }
  }
  const stable = async () => {
    verify();
    files = await listOwned();
    if (!files.some(file => file.id === operationId)) return false;
    const operations = files.filter(file => file.appProperties?.backupKind === DRIVE_OPERATION_KIND && file.id !== operationId && file.parents?.includes(root));
    if (operations.some(file => driveOperationExpiry(file) > api.serverNow())) return false;
    const live = manifestFiles(files);
    const liveIds = new Set(live.map(file => file.id));
    // Our own deletions can expose old ancestry. Validate the original snapshot instead.
    return live.every(file => {
      const previous = initialById.get(file.id);
      return previous !== undefined && sameManifest(file, previous);
    }) && initial.every(file => removedIds.has(file.id) || liveIds.has(file.id));
  };
  if (!await stable()) return '雲端備份已有變更，或另一個備份／還原正在進行，這次暫緩舊版本清理';
  // Remove obsolete indexes first. A failed index cleanup must not remove its table files.
  for (const file of old) {
    if (!await stable()) return '雲端作業已有變更，這次暫緩舊版本清理';
    await api.trashFile(file.id);
    removedIds.add(file.id);
  }
  const candidates = files.filter(file => file.appProperties?.backupKind === 'table' && file.mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' && file.appProperties.localId && !protectedTables.has(file.id) && file.parents?.some(parent => folders.has(parent)));
  for (const file of candidates) {
    if (!await stable()) return '雲端作業已有變更，這次暫緩舊版本清理';
    await api.trashFile(file.id);
  }
  for (const file of files.filter(file => file.appProperties?.backupKind === DRIVE_OPERATION_KIND && file.id !== operationId && file.parents?.includes(root) && driveOperationExpiry(file) <= api.serverNow())) await api.trashFile(file.id);
};
