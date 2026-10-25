import { DRIVE_SNAPSHOT_KEY, DRIVE_SNAPSHOT_XLSX } from '../../shared/driveSnapshots';
import { normalizeWorkspace } from '../model';
import { workspaceStructureChangeRevision, workspaceTableChangeRevision } from '../changeRevisions';
import { exportWorkspaceBackupManifestXlsx, exportWorkspaceXlsxAsync, importWorkspaceBackupManifestXlsx, importWorkspaceXlsx } from '../spreadsheet';
import type { WorkspaceData, WorkspaceTable } from '../types';
import {
  createGoogleDriveFolderBackup, DRIVE_MANIFEST_FILE_NAME,
  DRIVE_MANIFEST_FORMAT, DRIVE_MANIFEST_VERSION, RemoteBackupConflictError,
  type DriveWorkspaceManifest, type FolderBackupOptions, type FolderBackupRunOptions, type GoogleDriveFolderBackup,
} from './folderBackup';
import { FOLDER_MIME, GoogleDriveApi } from './googleDriveApi';
import { BackupNotFoundError, type GoogleDriveSingleFileBackup } from './singleFileBackup';
import { createSnapshotJournal, snapshotRevisionDigest } from './snapshotJournal';
import type { BackupMetadata, BackupReceipt, DriveFile } from './types';

export const SNAPSHOT_REVISION_PROPERTY = 'snapshotRevision';
export const SNAPSHOT_PENDING_COMMIT_PROPERTY = 'pendingLocalCommit';
const operationProperty = 'snapshotId';
type Receipt = BackupReceipt & { manifest: DriveWorkspaceManifest; cleanupWarning?: string };

export const createGoogleDriveSnapshotBackup = (options: FolderBackupOptions & {
  coordinator?: any;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  legacySingle?: Pick<GoogleDriveSingleFileBackup, 'findRemoteFile' | 'restore'>;
}): GoogleDriveFolderBackup => {
  const api = new GoogleDriveApi(options);
  const legacy = createGoogleDriveFolderBackup({ ...options, retainedVersions: undefined });
  let storage = options.storage;
  try { storage ??= typeof window === 'undefined' ? undefined : window.localStorage; } catch { /* Blocked storage */ }
  const journal = createSnapshotJournal(storage);
  const receipts = new Map<string, { account: string; id: string }>();
  const acknowledged = new Set<string>();
  let cachedRootId: string | null = null;
  let pending: Promise<Receipt> | null = null;

  const tags = (kind: string, id?: string, localId?: string) => ({
    backupKey: DRIVE_SNAPSHOT_KEY,
    backupKind: kind,
    schemaVersion: '4',
    workspaceFormat: 'dynamic-sheet-v1',
    ...(id ? { [operationProperty]: id } : {}),
    ...(localId ? { localId } : {}),
  });

  const legacyFile = async () => {
    const folder = await legacy.findRemoteFile();
    if (folder) return folder;
    const single = await options.legacySingle?.findRemoteFile();
    return single ? { ...single, appProperties: { ...single.appProperties, legacySingle: 'true' } } : null;
  };

  const ensureFolder = async () => {
    if (cachedRootId) return cachedRootId;
    const parent = await api.ensureFolderPath(options.folderPath);
    const candidates = await api.findFilesByAppProperty({ key: 'backupKey', value: DRIVE_SNAPSHOT_KEY, parentId: parent, mimeType: FOLDER_MIME });
    for (const candidate of candidates) {
      if (candidate.appProperties?.backupKind === 'root' && !candidate.trashed) return (cachedRootId = candidate.id);
    }
    const created = await api.createFolder('新版快照', parent, tags('root'));
    return (cachedRootId = created.id);
  };

  const findManifests = async (rootId: string) => {
    const candidates = await api.findFilesByAppProperty({
      key: 'backupKind',
      value: 'manifest',
      mimeType: DRIVE_SNAPSHOT_XLSX,
    });
    const valid = candidates.filter(file => file.appProperties?.backupKey === DRIVE_SNAPSHOT_KEY && !file.trashed
      && file.parents?.length === 1 && file.parents[0] !== rootId);
    valid.sort((a, b) => (Number(b.appProperties?.[SNAPSHOT_REVISION_PROPERTY] ?? 0)) - (Number(a.appProperties?.[SNAPSHOT_REVISION_PROPERTY] ?? 0))
      || (b.modifiedTime ?? '').localeCompare(a.modifiedTime ?? '')
      || (b.createdTime ?? '').localeCompare(a.createdTime ?? ''));
    return valid;
  };

  const findRemoteFile = async () => {
    const root = await ensureFolder();
    const manifests = await findManifests(root);
    if (manifests[0]) {
      const file = manifests[0];
      const accountKey = `drive:${root}`;
      const saved = journal.read(accountKey);
      if (saved && file.appProperties?.[operationProperty] === saved.id && !acknowledged.has(saved.id)) {
        return { ...file, appProperties: { ...file.appProperties, [SNAPSHOT_PENDING_COMMIT_PROPERTY]: 'true' } };
      }
      return file;
    }
    return legacyFile();
  };

  const listRemoteBackups = async () => {
    const root = await ensureFolder();
    const manifests = await findManifests(root);
    const legacyBackups = await legacy.listRemoteBackups();
    return [...manifests, ...legacyBackups];
  };

  const cleanObsoleteVersions = async (root: string, manifests: DriveFile[]) => {
    if (!options.retainedVersions || manifests.length < options.retainedVersions) return;
    const obsolete = manifests.slice(options.retainedVersions - 1);
    for (const item of obsolete) {
      const folderId = item.parents?.[0];
      if (folderId && folderId !== root) {
        try { await api.trashFile(folderId); } catch { /* ignore */ }
      }
    }
  };

  const restore = async (selected?: DriveFile): Promise<WorkspaceData> => {
    let manifestFile = selected;
    if (!manifestFile) manifestFile = await findRemoteFile() ?? undefined;
    if (!manifestFile) throw new BackupNotFoundError(DRIVE_SNAPSHOT_KEY);
    if (manifestFile.appProperties?.legacySingle === 'true' && options.legacySingle) {
      const imported = await importWorkspaceXlsx(await options.legacySingle.restore(manifestFile));
      if (!imported.data) throw new Error('不是完整的 Workspace 備份');
      return imported.data;
    }
    if (manifestFile.appProperties?.backupKey !== DRIVE_SNAPSHOT_KEY) {
      return legacy.restore(manifestFile);
    }
    const blob = await api.downloadBlob(manifestFile.id);
    const manifest = await importWorkspaceBackupManifestXlsx(blob);
    const tables: WorkspaceTable[] = [];
    for (const ref of manifest.tables) {
      const tableBlob = await api.downloadBlob(ref.driveFileId);
      const imported = await importWorkspaceXlsx(tableBlob, { preserveIds: true });
      if (!imported.table) throw new Error(`雲端表格格式或識別不一致：${ref.name}`);
      tables.push(imported.table);
    }
    return normalizeWorkspace({
      version: 1,
      structureRevision: manifest.structureRevision,
      nodes: manifest.nodes as any,
      tables,
      activeNodeId: manifest.activeNodeId,
      bottomNavigationTableIds: manifest.bottomNavigationTableIds,
    });
  };

  const performBackup = async (data: WorkspaceData, metadata: BackupMetadata, run: FolderBackupRunOptions): Promise<Receipt> => {
    const summaries = run.source?.tables ?? data.tables;
    const summaryById = new Map(summaries.map(table => [table.id, table]));
    const nodes = data.nodes.filter(node => node.type === 'table' && node.tableId);
    if (!nodes.length || new Set(nodes.map(node => node.tableId)).size !== nodes.length || nodes.length !== summaries.length
      || nodes.some(node => !summaryById.has(node.tableId!))) throw new Error('沒有表格，已停止備份');

    run.onProgress?.({ phase: 'preparing-cloud' });
    const root = await ensureFolder();
    const accountKey = `drive:${root}`;
    const manifests = await findManifests(root);
    const previous = manifests[0] ?? await legacyFile();

    // Conflict detection before creating folders or uploading files
    if ('expectedRemoteFileId' in run && (previous?.id ?? null) !== (run.expectedRemoteFileId ?? null)) {
      throw new RemoteBackupConflictError(previous);
    }
    if (run.expectedRemoteModifiedTime && previous?.modifiedTime !== run.expectedRemoteModifiedTime) {
      throw new RemoteBackupConflictError(previous);
    }

    const snapshotId = crypto.randomUUID();
    const sourceRevision = await snapshotRevisionDigest(JSON.stringify({
      structure: workspaceStructureChangeRevision(data),
      nodes: data.nodes,
      active: data.activeNodeId,
      navigation: data.bottomNavigationTableIds,
      tables: summaries.map(table => [table.id, table.name, table.updatedAt, workspaceTableChangeRevision(table)]),
    }));
    journal.write(accountKey, { id: snapshotId, sourceRevision });

    const sourceUpdatedAt = Number(metadata.sourceUpdatedAt ?? Math.max(data.updatedAt ?? 0, ...summaries.map(table => table.updatedAt)));
    const snapshotFolder = await api.createFolder(`備份-${snapshotId}`, root, tags('snapshot', snapshotId));

    const refs: DriveWorkspaceManifest['tables'] = [];
    const usedNames = new Set(['manifest.xlsx']);
    let completedTables = 0;
    const report = (phase: Parameters<NonNullable<FolderBackupRunOptions['onProgress']>>[0]['phase'], name?: string) =>
      run.onProgress?.({ phase, name, completedTables, totalTables: nodes.length });

    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      const summary = summaryById.get(node.tableId!)!;
      const base = (summary.name || node.name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\.{2,}/g, ' ').replace(/\.+$/, '').trim() || '表格';
      let fileName = `${base}.xlsx`;
      for (let suffix = 2; usedNames.has(fileName); suffix += 1) fileName = `${base}-${suffix}.xlsx`;
      usedNames.add(fileName);

      report('reading-table', summary.name);
      const table = run.source ? await run.source.readTable(summary.id) : data.tables.find(item => item.id === summary.id);
      if (!table || table.id !== summary.id) throw new Error('找不到備份表格');

      report('creating-file', summary.name);
      const body = await exportWorkspaceXlsxAsync(data, table);
      await run.source?.verify();

      report('uploading-table', summary.name);
      const file = await api.uploadFile({
        parentId: snapshotFolder.id,
        name: fileName,
        mimeType: DRIVE_SNAPSHOT_XLSX,
        body,
        appProperties: tags('table', snapshotId, table.id),
      });

      refs.push({
        id: summary.id,
        nodeId: node.id,
        folderId: node.parentId,
        name: summary.name,
        updatedAt: summary.updatedAt,
        changeRevision: workspaceTableChangeRevision(summary),
        driveFileId: file.id,
        fileName,
      });
      completedTables += 1;
      report('table-uploaded', summary.name);
    }

    report('saving-index');
    const folders = data.nodes.filter(node => node.type === 'folder').map(node => ({ ...node, driveFolderId: '' }));
    const manifest: DriveWorkspaceManifest = {
      format: DRIVE_MANIFEST_FORMAT,
      version: DRIVE_MANIFEST_VERSION,
      backupKey: DRIVE_SNAPSHOT_KEY,
      sourceUpdatedAt,
      updatedAt: sourceUpdatedAt,
      fileLayout: 'flat',
      structureRevision: workspaceStructureChangeRevision(data),
      nodes: data.nodes,
      activeNodeId: data.activeNodeId,
      bottomNavigationTableIds: data.bottomNavigationTableIds,
      folders,
      tables: refs,
    };

    const previousRevision = Number(previous?.appProperties?.[SNAPSHOT_REVISION_PROPERTY] ?? 0);
    const revision = previousRevision + 1;
    const uploadedManifest = await api.uploadFile({
      parentId: snapshotFolder.id,
      name: DRIVE_MANIFEST_FILE_NAME,
      mimeType: DRIVE_SNAPSHOT_XLSX,
      body: exportWorkspaceBackupManifestXlsx({ ...data, structureRevision: manifest.structureRevision }, folders, refs, sourceUpdatedAt, 'flat'),
      appProperties: {
        ...tags('manifest', snapshotId),
        [SNAPSHOT_REVISION_PROPERTY]: String(revision),
        sourceUpdatedAt: String(sourceUpdatedAt),
        backedUpAt: String(Date.now()),
      },
    });

    report('confirming');
    receipts.set(uploadedManifest.id, { account: accountKey, id: snapshotId });
    void cleanObsoleteVersions(root, manifests);

    return {
      file: uploadedManifest,
      manifest,
      backupKey: DRIVE_SNAPSHOT_KEY,
      parentId: root,
      sourceUpdatedAt,
    };
  };

  const backup = (data: WorkspaceData, metadata: BackupMetadata = {}, run: FolderBackupRunOptions = {}): Promise<Receipt> => {
    if (pending) return pending;
    pending = performBackup(data, metadata, run).finally(() => { pending = null; });
    return pending;
  };

  return {
    ensureFolder,
    findRemoteFile,
    listRemoteBackups,
    restore,
    backup,
    acknowledgeBackup(fileId: string, persisted = true) {
      const saved = receipts.get(fileId);
      if (saved) {
        acknowledged.add(saved.id);
        if (acknowledged.size > 128) acknowledged.delete(acknowledged.values().next().value!);
        if (persisted) journal.clear(saved.account, saved.id);
        receipts.delete(fileId);
      }
    },
    maintain: async () => {
      const root = await ensureFolder();
      const manifests = await findManifests(root);
      await cleanObsoleteVersions(root, manifests);
    },
  };
};
