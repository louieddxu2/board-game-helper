import { DRIVE_SNAPSHOT_KEY, DRIVE_SNAPSHOT_XLSX } from '../../shared/driveSnapshots';
import { importWorkspaceBackupManifestXlsx, type ImportedWorkspaceBackupManifest } from '../spreadsheet';
import type { WorkspaceNode } from '../types';
import { DRIVE_MANIFEST_FILE_NAME } from './folderBackup';
import { FOLDER_MIME, GoogleDriveApi } from './googleDriveApi';
import { findDriveManifestHeads, retainedDriveManifests } from './manifestHistory';
import type { DriveFile } from './types';

export const SNAPSHOT_METADATA_FIELDS = 'id,name,mimeType,parents,createdTime,modifiedTime,size,md5Checksum,appProperties,ownedByMe,trashed';
const belongsTo = (file: DriveFile, parent: string, kind: string, snapshotId?: string) => !file.trashed
  && file.ownedByMe === true && file.parents?.length === 1 && file.parents[0] === parent
  && file.appProperties?.backupKey === DRIVE_SNAPSHOT_KEY && file.appProperties.backupKind === kind
  && (!snapshotId || file.appProperties.snapshotId === snapshotId);

/** Two projected metadata listings (paginated by Drive), without historical XLSX downloads. */
export const listSnapshotManifests = async (api: GoogleDriveApi, root: string) => {
  const [folders, manifests] = await Promise.all([
    api.findFilesByAppProperty({ key: 'backupKind', value: 'snapshot', parentId: root, mimeType: FOLDER_MIME, fields: SNAPSHOT_METADATA_FIELDS }),
    api.findFilesByAppProperty({ key: 'backupKind', value: 'manifest', mimeType: DRIVE_SNAPSHOT_XLSX, fields: SNAPSHOT_METADATA_FIELDS }),
  ]);
  const byId = new Map(folders.filter(file => belongsTo(file, root, 'snapshot')).map(file => [file.id, file]));
  return manifests.filter(file => {
    const folder = byId.get(file.parents?.[0] ?? '');
    return folder && Boolean(folder.appProperties?.snapshotId) && file.name === DRIVE_MANIFEST_FILE_NAME
      && belongsTo(file, folder.id, 'manifest', folder.appProperties?.snapshotId);
  });
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

/** Old coordinator snapshots have no snapshotRevision property and remain read-only.
 * Delete only the indexed app files; never trash a folder that may contain unseen user files. */
export const cleanSnapshotVersions = async (api: GoogleDriveApi, root: string, manifests: DriveFile[], limit?: number) => {
  const heads = findDriveManifestHeads(manifests);
  if (!limit || heads.length !== 1 || manifests.length <= limit) return;
  const retained = new Set(retainedDriveManifests(manifests, heads[0].id, limit).map(file => file.id));
  for (const manifest of manifests.filter(file => !retained.has(file.id) && Number(file.appProperties?.snapshotRevision) > 0)) {
    try {
      const folder = await api.getFile(manifest.parents![0]);
      const snapshotId = manifest.appProperties?.snapshotId;
      if (!snapshotId || folder.mimeType !== FOLDER_MIME || !belongsTo(folder, root, 'snapshot', snapshotId)) continue;
      const [index, files] = await Promise.all([
        readSnapshotManifest(api, manifest),
        api.listFiles({ query: `'${folder.id.replace(/'/g, "\\'")}' in parents and trashed = false`, fields: SNAPSHOT_METADATA_FIELDS }),
      ]);
      const expected = [{ id: manifest.id, kind: 'manifest', localId: undefined },
        ...index.tables.map(ref => ({ id: ref.driveFileId, kind: 'table', localId: ref.id }))];
      const owned = expected.map(ref => ({ ref, file: files.find(file => file.id === ref.id) }));
      if (owned.some(({ ref, file }) => !file || file.mimeType !== DRIVE_SNAPSHOT_XLSX || !belongsTo(file, folder.id, ref.kind, snapshotId)
        || (ref.localId && file.appProperties?.localId !== ref.localId)
        || !file.modifiedTime || !manifest.modifiedTime || file.modifiedTime > manifest.modifiedTime)) continue;
      // Removing the index first makes an interrupted cleanup unavailable for restore.
      for (const { file } of owned) await api.trashFile(file!.id);
    } catch { /* Preserve questionable history; a cleanup failure never invalidates a new backup. */ }
  }
};
