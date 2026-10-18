import {
  DRIVE_SNAPSHOT_KEY, DRIVE_SNAPSHOT_XLSX, SnapshotProtocolError,
  type DriveSnapshotOperation, type SnapshotFileSignature,
} from '../../src/shared/driveSnapshots';
import { FOLDER_MIME, GoogleDriveApi, GoogleDriveApiError } from '../../src/workspace/googleDriveBackup/googleDriveApi';
import type { DriveFile } from '../../src/workspace/googleDriveBackup/types';
import { sha256Hex } from '../utils';

export const snapshotLegacyStamp = async (api: GoogleDriveApi, root: string, metadata?: DriveFile) => {
  const parent = (metadata ?? await api.getFile(root)).parents?.[0];
  if (!parent) throw new SnapshotProtocolError('backup_root_invalid', 422);
  const files = await api.listFiles({ query: `'${parent.replace(/'/g, "\\'")}' in parents and trashed = false`, fields: 'id,modifiedTime,appProperties' });
  return sha256Hex(JSON.stringify(files.filter(file => file.appProperties?.backupKey === 'dynamic-sheet-primary-workspace-v1'
    || (file.appProperties?.backupKey === 'dynamic-sheet-primary-workspace-v2' && file.appProperties.backupKind === 'manifest'))
    .map(file => [file.id, file.modifiedTime ?? '']).sort((a, b) => a[0].localeCompare(b[0]))));
};

export const snapshotDriveApi = (token: string, fetchImpl?: typeof fetch) => new GoogleDriveApi({
  tokenProvider: { getAccessToken: async () => token }, fetchImpl,
});

export const assertSnapshotRoot = async (api: GoogleDriveApi, root: string) => {
  const file = await api.getFile(root);
  if (file.trashed || file.ownedByMe !== true || file.mimeType !== FOLDER_MIME
    || file.appProperties?.backupKey !== DRIVE_SNAPSHOT_KEY || file.appProperties?.backupKind !== 'root') {
    throw new SnapshotProtocolError('backup_root_invalid', 422);
  }
  return file;
};

const assertFolder = (file: DriveFile, root: string, op: DriveSnapshotOperation) => {
  if (file.ownedByMe !== true || file.mimeType !== FOLDER_MIME || file.parents?.length !== 1 || file.parents[0] !== root
    || file.appProperties?.backupKey !== DRIVE_SNAPSHOT_KEY || file.appProperties?.snapshotId !== op.id
    || file.appProperties?.backupKind !== 'snapshot') throw new SnapshotProtocolError('backup_snapshot_invalid', 422);
};

const children = (api: GoogleDriveApi, folder: string) => api.listFiles({
  query: `'${folder.replace(/'/g, "\\'")}' in parents and trashed = false`,
  fields: 'id,name,mimeType,parents,modifiedTime,size,md5Checksum,appProperties,ownedByMe,trashed',
});

export const inspectSnapshotFiles = async (api: GoogleDriveApi, root: string, op: DriveSnapshotOperation): Promise<SnapshotFileSignature[]> => {
  const folder = await api.getFile(op.folderId);
  assertFolder(folder, root, op);
  if (folder.trashed) throw new SnapshotProtocolError('backup_snapshot_unavailable');
  const files = await children(api, op.folderId);
  if (files.length !== op.fileIds.length || new Set(op.fileIds).size !== op.fileIds.length) throw new SnapshotProtocolError('backup_snapshot_incomplete', 422);
  const byId = new Map(files.map(file => [file.id, file]));
  return op.fileIds.map((id, index) => {
    const file = byId.get(id);
    if (!file || file.ownedByMe !== true || file.mimeType !== DRIVE_SNAPSHOT_XLSX
      || file.parents?.length !== 1 || file.parents[0] !== op.folderId || !file.md5Checksum || !file.modifiedTime
      || !/^\d+$/.test(file.size ?? '') || Number(file.size) <= 0
      || file.appProperties?.backupKey !== DRIVE_SNAPSHOT_KEY || file.appProperties.snapshotId !== op.id
      || file.appProperties.backupKind !== (index === 0 ? 'manifest' : 'table')) {
      throw new SnapshotProtocolError('backup_snapshot_invalid', 422);
    }
    return { id, size: file.size!, md5Checksum: file.md5Checksum, modifiedTime: file.modifiedTime };
  });
};

export const assertSnapshotUnchanged = (actual: SnapshotFileSignature[], expected: SnapshotFileSignature[]) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new SnapshotProtocolError('backup_snapshot_changed');
};

export const trashSnapshotFolder = async (api: GoogleDriveApi, root: string, op: DriveSnapshotOperation) => {
  let folder: DriveFile;
  try { folder = await api.getFile(op.folderId); }
  catch (error) { if (error instanceof GoogleDriveApiError && error.status === 404) return; throw error; }
  assertFolder(folder, root, op);
  if (folder.trashed) return;
  const files = await children(api, op.folderId);
  const allocated = new Set(op.fileIds);
  // An interrupted candidate may be incomplete, but may never own unknown files.
  if (files.some(file => !allocated.has(file.id) || file.ownedByMe !== true
    || file.mimeType !== DRIVE_SNAPSHOT_XLSX || file.appProperties?.backupKey !== DRIVE_SNAPSHOT_KEY
    || file.appProperties.snapshotId !== op.id)) throw new SnapshotProtocolError('backup_cleanup_unknown_files', 422);
  if (op.revision != null) assertSnapshotUnchanged(await inspectSnapshotFiles(api, root, op), op.inventory);
  await api.trashFile(op.folderId);
};

/** drive.file cannot prove a folder listing includes manually added files.
 * The default therefore deletes only reserved IDs still inside this snapshot,
 * and preserves the folder itself. Work per request is bounded for large sets. */
export const trashKnownSnapshotFiles = async (api: GoogleDriveApi, root: string, op: DriveSnapshotOperation) => {
  let folder: DriveFile;
  try { folder = await api.getFile(op.folderId); }
  catch (error) { if (error instanceof GoogleDriveApiError && error.status === 404) return { complete: true, progress: false }; throw error; }
  assertFolder(folder, root, op);
  if (folder.trashed) return { complete: true, progress: false };
  const allocated = new Map(op.fileIds.map((id, index) => [id, index]));
  const expected = new Map(op.inventory.map(file => [file.id, file]));
  const files = (await children(api, op.folderId)).filter(file => allocated.has(file.id));
  // Validate all visible owned entries before beginning a possibly partial pass.
  for (const file of files) {
    if (file.ownedByMe !== true || file.parents?.length !== 1 || file.parents[0] !== op.folderId
      || file.mimeType !== DRIVE_SNAPSHOT_XLSX || file.appProperties?.backupKey !== DRIVE_SNAPSHOT_KEY
      || file.appProperties.snapshotId !== op.id
      || file.appProperties.backupKind !== (allocated.get(file.id) === 0 ? 'manifest' : 'table')) {
      throw new SnapshotProtocolError('backup_snapshot_changed');
    }
    if (op.revision != null) {
      const signature = expected.get(file.id);
      if (!signature || file.size !== signature.size || file.md5Checksum !== signature.md5Checksum
        || file.modifiedTime !== signature.modifiedTime) throw new SnapshotProtocolError('backup_snapshot_changed');
    }
  }
  const batch = files.slice(0, 20);
  for (const file of batch) await api.trashFile(file.id);
  return { complete: files.length <= batch.length, progress: batch.length > 0 };
};
