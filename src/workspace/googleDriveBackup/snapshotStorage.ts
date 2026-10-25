import { DRIVE_SNAPSHOT_KEY, DRIVE_SNAPSHOT_XLSX } from '../../shared/driveSnapshots';
import { importWorkspaceBackupManifestXlsx, type ImportedWorkspaceBackupManifest } from '../spreadsheet';
import type { WorkspaceNode } from '../types';
import { DRIVE_MANIFEST_FILE_NAME } from './folderBackup';
import { GoogleDriveApi } from './googleDriveApi';
import type { DriveFile } from './types';

export const SNAPSHOT_METADATA_FIELDS = 'id,name,mimeType,parents,createdTime,modifiedTime,size,md5Checksum,appProperties,ownedByMe,trashed';
/** One projected metadata listing; older unscoped manifests remain readable. */
export const listSnapshotManifests = async (api: GoogleDriveApi, root: string) => {
  const manifests = await api.findFilesByAppProperty({ key: 'backupKind', value: 'manifest', mimeType: DRIVE_SNAPSHOT_XLSX, fields: SNAPSHOT_METADATA_FIELDS });
  return manifests.filter(file => !file.trashed && file.ownedByMe === true && file.name === DRIVE_MANIFEST_FILE_NAME
    && file.parents?.length === 1 && file.parents[0] !== root && Boolean(file.appProperties?.snapshotId)
    && file.appProperties?.backupKey === DRIVE_SNAPSHOT_KEY
    && (!file.appProperties.snapshotRoot || file.appProperties.snapshotRoot === root));
};

export const validateSnapshotManifest = (manifest: ImportedWorkspaceBackupManifest) => {
  const nodes = manifest.nodes as WorkspaceNode[];
  const tables = nodes.filter(node => node.type === 'table');
  const refs = manifest.tables;
  if (!refs.length || tables.length !== refs.length || new Set(nodes.map(node => node.id)).size !== nodes.length
    || new Set(refs.map(ref => ref.id)).size !== refs.length || new Set(refs.map(ref => ref.driveFileId)).size !== refs.length
    || tables.some(node => !node.tableId || !refs.some(ref => ref.id === node.tableId && ref.nodeId === node.id && ref.folderId === node.parentId))
    || refs.some(ref => !ref.driveFileId)) throw new Error('備份索引與表格對應不一致');
  return { ...manifest, nodes };
};

export const readSnapshotManifest = async (api: GoogleDriveApi, file: DriveFile) =>
  validateSnapshotManifest(await importWorkspaceBackupManifestXlsx(await api.downloadBlob(file.id)));

/** Retire one obsolete app-managed snapshot folder with one request.
 * Older unscoped snapshots remain read-only; never trash the backup root. */
export const cleanSnapshotVersions = async (api: GoogleDriveApi, root: string, manifests: DriveFile[], limit?: number) => {
  if (!limit || manifests.length <= limit) return;
  const removed = new Set<string>();
  for (const manifest of manifests.slice(limit)) {
    const folder = manifest.parents?.[0];
    if (!folder || folder === root || removed.has(folder) || manifest.ownedByMe !== true
      || manifest.appProperties?.backupKey !== DRIVE_SNAPSHOT_KEY || manifest.appProperties.snapshotRoot !== root
      || !manifest.appProperties.snapshotId || !(Number(manifest.appProperties.snapshotRevision) > 0)) continue;
    try {
      await api.trashFile(folder);
      removed.add(folder);
    } catch { /* Preserve questionable history; a cleanup failure never invalidates a new backup. */ }
  }
};
