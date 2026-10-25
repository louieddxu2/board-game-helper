import { DRIVE_SNAPSHOT_KEY, DRIVE_SNAPSHOT_XLSX, type DriveSnapshotOperation, type SnapshotFileSignature } from '../../shared/driveSnapshots';
import { FOLDER_MIME, GoogleDriveApi } from './googleDriveApi';
import { SnapshotCoordinatorError } from './snapshotErrors';
import { snapshotRevisionDigest } from './snapshotJournal';
import type { DriveFile } from './types';

export const snapshotChildren = (api: GoogleDriveApi, folder: string) => api.listFiles({
  query: `'${folder.replace(/'/g, "\\'")}' in parents and trashed = false`,
  fields: 'id,name,mimeType,parents,createdTime,modifiedTime,size,md5Checksum,appProperties,ownedByMe,trashed',
});

export const assertSnapshotRoot = (file: DriveFile) => {
  if (file.trashed || file.ownedByMe !== true || file.mimeType !== FOLDER_MIME
    || file.appProperties?.backupKey !== DRIVE_SNAPSHOT_KEY || file.appProperties.backupKind !== 'root') {
    throw new SnapshotCoordinatorError('backup_root_invalid', 422);
  }
  return file;
};

export const snapshotLegacyStamp = async (api: GoogleDriveApi, roots: DriveFile[]) => {
  const files = (await Promise.all([...new Set(roots.flatMap(root => root.parents ?? []))].map(parent => snapshotChildren(api, parent)))).flat();
  return snapshotRevisionDigest(JSON.stringify(files.filter(file => file.appProperties?.backupKey === 'dynamic-sheet-primary-workspace-v1'
    || (file.appProperties?.backupKey === 'dynamic-sheet-primary-workspace-v2' && file.appProperties.backupKind === 'manifest'))
    .map(file => [file.id, file.modifiedTime ?? '']).sort((a, b) => a[0].localeCompare(b[0]))));
};

export const inspectSnapshotFiles = async (api: GoogleDriveApi, root: string, op: DriveSnapshotOperation): Promise<SnapshotFileSignature[]> => {
  const folder = await api.getFile(op.folderId);
  if (folder.trashed || folder.ownedByMe !== true || folder.mimeType !== FOLDER_MIME || folder.parents?.length !== 1
    || folder.parents[0] !== root || folder.appProperties?.backupKey !== DRIVE_SNAPSHOT_KEY
    || folder.appProperties.snapshotId !== op.id || folder.appProperties.backupKind !== 'snapshot') {
    throw new SnapshotCoordinatorError('backup_snapshot_unavailable', 409);
  }
  const allocated = new Set(op.fileIds);
  const files = (await snapshotChildren(api, op.folderId)).filter(file => allocated.has(file.id));
  if (files.length !== op.fileIds.length || new Set(op.fileIds).size !== op.fileIds.length) {
    throw new SnapshotCoordinatorError('backup_snapshot_incomplete', 422);
  }
  const byId = new Map(files.map(file => [file.id, file]));
  return op.fileIds.map((id, index) => {
    const file = byId.get(id);
    if (!file || file.ownedByMe !== true || file.mimeType !== DRIVE_SNAPSHOT_XLSX || file.parents?.length !== 1
      || file.parents[0] !== op.folderId || !file.md5Checksum || !file.modifiedTime || !/^\d+$/.test(file.size ?? '') || Number(file.size) <= 0
      || file.appProperties?.backupKey !== DRIVE_SNAPSHOT_KEY || file.appProperties.snapshotId !== op.id
      || file.appProperties.backupKind !== (index === 0 ? 'manifest' : 'table')) {
      throw new SnapshotCoordinatorError('backup_snapshot_invalid', 422);
    }
    return { id, size: file.size!, md5Checksum: file.md5Checksum, modifiedTime: file.modifiedTime };
  });
};

export const assertSnapshotUnchanged = (actual: SnapshotFileSignature[], expected: SnapshotFileSignature[]) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new SnapshotCoordinatorError('backup_snapshot_changed', 409);
};
