import type { DriveSnapshotOperation } from '../../shared/driveSnapshots';
import { normalizeWorkspace } from '../model';
import { importWorkspaceBackupManifestXlsx, importWorkspaceXlsx } from '../spreadsheet';
import type { WorkspaceTable } from '../types';
import { DRIVE_MANIFEST_FORMAT, DRIVE_MANIFEST_VERSION, type DriveWorkspaceManifest } from './folderBackup';
import type { GoogleDriveApi } from './googleDriveApi';
import type { SnapshotCoordinator } from './snapshotCoordinator';
import { withSnapshotLease } from './snapshotLease';

export const readSnapshotManifest = async (api: GoogleDriveApi, op: DriveSnapshotOperation): Promise<DriveWorkspaceManifest> => {
  const manifest = await importWorkspaceBackupManifestXlsx(await api.downloadBlob(op.fileIds[0]));
  const refs = manifest.tables;
  const tableNodes = manifest.nodes.filter(node => node.type === 'table');
  if (manifest.fileLayout !== 'flat' || refs.length + 1 !== op.fileIds.length || refs.length !== tableNodes.length
    || new Set(manifest.nodes.map(node => node.id)).size !== manifest.nodes.length
    || new Set(refs.map(ref => ref.id)).size !== refs.length || new Set(refs.map(ref => ref.driveFileId)).size !== refs.length
    || refs.some(ref => !op.fileIds.slice(1).includes(ref.driveFileId) || !tableNodes.some(node => node.id === ref.nodeId && node.tableId === ref.id))) {
    throw new Error('備份索引與表格不一致');
  }
  return { ...manifest, format: DRIVE_MANIFEST_FORMAT, version: DRIVE_MANIFEST_VERSION,
    backupKey: 'dynamic-sheet-primary-workspace-v3', updatedAt: manifest.sourceUpdatedAt };
};

export const restoreSnapshot = async (api: GoogleDriveApi, coordinator: SnapshotCoordinator, op: DriveSnapshotOperation) => {
  const lease = crypto.randomUUID();
  await coordinator.restore(op.id, lease, 'acquire');
  try {
    return await withSnapshotLease(() => coordinator.restore(op.id, lease, 'acquire'), async checkLease => {
      const manifest = await readSnapshotManifest(api, op);
      const tables: WorkspaceTable[] = [];
      for (const ref of manifest.tables) {
        await checkLease();
        const imported = await importWorkspaceXlsx(await api.downloadBlob(ref.driveFileId), { preserveIds: true });
        if (!imported.table || imported.table.id !== ref.id) throw new Error('備份表格識別不一致');
        tables.push(imported.table);
      }
      await checkLease();
      await coordinator.restore(op.id, lease, 'verify');
      return normalizeWorkspace({ version: 1, structureRevision: manifest.structureRevision, nodes: manifest.nodes,
        tables, activeNodeId: manifest.activeNodeId, bottomNavigationTableIds: manifest.bottomNavigationTableIds });
    });
  } finally { await coordinator.restore(op.id, lease, 'release').catch(() => undefined); }
};
