import { DRIVE_SNAPSHOT_KEY, DRIVE_SNAPSHOT_XLSX, type DriveSnapshotOperation, type DriveSnapshotState, type DriveSnapshotSummary } from '../../shared/driveSnapshots';
import { workspaceStructureChangeRevision, workspaceTableChangeRevision } from '../changeRevisions';
import { exportWorkspaceBackupManifestXlsx, exportWorkspaceXlsxAsync, importWorkspaceXlsx } from '../spreadsheet';
import type { WorkspaceData } from '../types';
import {
  createGoogleDriveFolderBackup, DRIVE_BACKUP_FORK_COUNT_PROPERTY, DRIVE_MANIFEST_FILE_NAME,
  DRIVE_MANIFEST_FORMAT, DRIVE_MANIFEST_VERSION, RemoteBackupConflictError,
  type DriveWorkspaceManifest, type FolderBackupOptions, type FolderBackupRunOptions, type GoogleDriveFolderBackup,
} from './folderBackup';
import { FOLDER_MIME, GoogleDriveApi, GoogleDriveApiError } from './googleDriveApi';
import { BackupNotFoundError, type GoogleDriveSingleFileBackup } from './singleFileBackup';
import { createSnapshotCoordinator, SnapshotCoordinatorError, type SnapshotCoordinator } from './snapshotCoordinator';
import { createSnapshotJournal, snapshotRevisionDigest } from './snapshotJournal';
import { readSnapshotManifest, restoreSnapshot } from './snapshotRestore';
import { withSnapshotLease } from './snapshotLease';
import type { BackupMetadata, BackupReceipt, DriveFile } from './types';

export const SNAPSHOT_REVISION_PROPERTY = 'snapshotRevision';
export const SNAPSHOT_PENDING_COMMIT_PROPERTY = 'pendingLocalCommit';
const operationProperty = 'snapshotId';
type Receipt = BackupReceipt & { manifest: DriveWorkspaceManifest; cleanupWarning?: string };

const manifestFile = (op: DriveSnapshotOperation | DriveSnapshotSummary): DriveFile => ({
  id: 'manifestId' in op ? op.manifestId : op.fileIds[0], name: DRIVE_MANIFEST_FILE_NAME, mimeType: DRIVE_SNAPSHOT_XLSX,
  parents: [op.folderId], createdTime: new Date(op.committedAt ?? 0).toISOString(),
  modifiedTime: 'modifiedTime' in op ? op.modifiedTime : op.inventory[0]?.modifiedTime,
  appProperties: { backupKey: DRIVE_SNAPSHOT_KEY, [operationProperty]: op.id,
    [SNAPSHOT_REVISION_PROPERTY]: String(op.revision), sourceUpdatedAt: String(op.sourceUpdatedAt), backedUpAt: String(op.committedAt ?? 0) },
});

export const createGoogleDriveSnapshotBackup = (options: FolderBackupOptions & {
  coordinator?: SnapshotCoordinator;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  legacySingle?: Pick<GoogleDriveSingleFileBackup, 'findRemoteFile' | 'restore'>;
}): GoogleDriveFolderBackup => {
  const api = new GoogleDriveApi(options);
  const coordinator = options.coordinator ?? createSnapshotCoordinator(options);
  const legacy = createGoogleDriveFolderBackup({ ...options, retainedVersions: undefined });
  let storage = options.storage;
  try { storage ??= typeof window === 'undefined' ? undefined : window.localStorage; } catch { /* Blocked storage uses the memory journal. */ }
  const journal = createSnapshotJournal(storage);
  let lastState: DriveSnapshotState | undefined;
  let pending: Promise<Receipt> | null = null;
  let maintenance: Promise<void> | null = null;
  const receipts = new Map<string, { account: string; id: string }>();
  const acknowledged = new Set<string>();
  const state = async (root?: string) => (lastState = await coordinator.state(root));
  const tags = (kind: string, id?: string, localId?: string) => ({ backupKey: DRIVE_SNAPSHOT_KEY, backupKind: kind,
    schemaVersion: '4', workspaceFormat: 'dynamic-sheet-v1',
    ...(id ? { snapshotId: id } : {}), ...(localId ? { localId } : {}) });

  const cleanup = async () => {
    // Each request handles one known obsolete folder; no scan/download of table contents.
    for (let index = 0; index < 3; index += 1) {
      try { if (!(await coordinator.cleanup()).cleaned) break; }
      catch (error) {
        if (error instanceof SnapshotCoordinatorError && ['backup_snapshot_changed', 'backup_cleanup_unknown_files'].includes(error.code)) continue;
        throw error;
      }
    }
  };
  const maintain = () => {
    if (!maintenance) maintenance = cleanup().catch(() => undefined).finally(() => { maintenance = null; });
    return maintenance;
  };
  const ensureFolder = async () => {
    const current = await state();
    if (current.rootId) return current.rootId;
    const parent = await api.ensureFolderPath(options.folderPath);
    const candidates = await api.findFilesByAppProperty({ key: 'backupKey', value: DRIVE_SNAPSHOT_KEY, parentId: parent, mimeType: FOLDER_MIME });
    for (const candidate of candidates) {
      const file = await api.getFile(candidate.id);
      if (file.ownedByMe === true && !file.trashed && file.appProperties?.backupKind === 'root') return file.id;
    }
    // Never claim a folder merely because it has the same display name.
    return (await api.createFolder('新版快照', parent, tags('root'))).id;
  };
  const headFile = (current: DriveSnapshotState): DriveFile | null => {
    const head = current.versions[0];
    if (!head) return null;
    const file = manifestFile(head);
    file.appProperties = { ...file.appProperties, legacyStamp: current.legacyStamp,
      ...((current.forkCount ?? 0) > 1 ? { [DRIVE_BACKUP_FORK_COUNT_PROPERTY]: String(current.forkCount) } : {}),
      ...(current.legacyChanged ? { [DRIVE_BACKUP_FORK_COUNT_PROPERTY]: '2' } : {}),
      ...(journal.read(current.accountKey)?.id === head.id && !acknowledged.has(head.id) ? { [SNAPSHOT_PENDING_COMMIT_PROPERTY]: 'true' } : {}) };
    return file;
  };
  const legacyFile = async () => {
    const folder = await legacy.findRemoteFile();
    if (folder) return folder;
    const single = await options.legacySingle?.findRemoteFile();
    return single ? { ...single, appProperties: { ...single.appProperties, legacySingle: 'true' } } : null;
  };
  const findRemoteFile = async () => {
    const current = await state();
    return headFile(current) ?? legacyFile();
  };
  const receipt = async (op: DriveSnapshotOperation, root: string): Promise<Receipt> => {
    const manifest = await readSnapshotManifest(api, op);
    if (lastState) receipts.set(op.fileIds[0], { account: lastState.accountKey, id: op.id });
    return { file: manifestFile(op), backupKey: DRIVE_SNAPSHOT_KEY, parentId: root, sourceUpdatedAt: op.sourceUpdatedAt, manifest };
  };
  const assertOwned = (file: DriveFile, op: DriveSnapshotOperation, parent: string, kind: string, localId?: string) => {
    if (file.trashed || file.parents?.length !== 1 || file.parents[0] !== parent || file.appProperties?.backupKey !== DRIVE_SNAPSHOT_KEY
      || file.appProperties.snapshotId !== op.id || file.appProperties.backupKind !== kind
      || (localId && file.appProperties.localId !== localId)) throw new Error('備份檔案識別不一致');
    return file;
  };
  const getExisting = async (id: string) => {
    try { return await api.getFile(id); }
    catch (error) { if (error instanceof GoogleDriveApiError && error.status === 404) return null; throw error; }
  };
  const createOnce = async (id: string, create: () => Promise<DriveFile>) => {
    try { return await create(); }
    catch (error) { if (error instanceof GoogleDriveApiError && error.status === 409) return api.getFile(id); throw error; }
  };

  const perform = async (data: WorkspaceData, metadata: BackupMetadata = {}, run: FolderBackupRunOptions = {}): Promise<Receipt> => {
    const summaries = run.source?.tables ?? data.tables;
    const summaryById = new Map(summaries.map(table => [table.id, table]));
    const nodes = data.nodes.filter(node => node.type === 'table' && node.tableId);
    if (!nodes.length || new Set(nodes.map(node => node.tableId)).size !== nodes.length || nodes.length !== summaries.length
      || nodes.some(node => !summaryById.has(node.tableId!))) throw new Error('備份目錄與表格不一致或沒有表格，已停止備份');
    run.onProgress?.({ phase: 'preparing-cloud' });
    const root = await ensureFolder();
    const current = await state(root);
    const previous = headFile(current) ?? await legacyFile();
    const saved = journal.read(current.accountKey);
    const prior = saved ? await coordinator.operation(saved.id) : null;
    // Recover a confirmed Drive commit before creating another snapshot, including after a reload.
    if (prior?.status === 'committed' && !acknowledged.has(prior.id) && current.versions[0]?.id === prior.id) {
      run.onProgress?.({ phase: 'confirming' });
      return receipt(prior, root);
    }
    const expected = run.expectedRemoteFileId;
    if (('expectedRemoteFileId' in run && (previous?.id ?? null) !== (expected ?? null))
      || (run.expectedRemoteModifiedTime && previous?.modifiedTime !== run.expectedRemoteModifiedTime)
      || (current.legacyChanged && !run.allowLegacyChange)
      || (run.expectedLegacyStamp && current.legacyStamp !== run.expectedLegacyStamp)) throw new RemoteBackupConflictError(previous);
    const sourceRevision = await snapshotRevisionDigest(JSON.stringify({ structure: workspaceStructureChangeRevision(data),
      nodes: data.nodes, active: data.activeNodeId, navigation: data.bottomNavigationTableIds,
      tables: summaries.map(table => [table.id, table.name, table.updatedAt, workspaceTableChangeRevision(table)]) }));
    const sourceUpdatedAt = Number(metadata.sourceUpdatedAt ?? Math.max(data.updatedAt ?? 0, ...summaries.map(table => table.updatedAt)));
    const resume = prior?.status === 'uploading' && prior.sourceRevision === sourceRevision && prior.expectedRevision === current.revision
      && prior.legacyStamp === current.legacyStamp && prior.expiresAt > Date.now();
    const id = resume ? prior.id : crypto.randomUUID();
    journal.write(current.accountKey, { id, sourceRevision });
    const op = resume ? prior : await coordinator.begin({ id, rootId: root, expectedRevision: current.revision, sourceRevision,
      fileCount: nodes.length + 1, sourceUpdatedAt, legacyStamp: current.legacyStamp, allowLegacyChange: run.allowLegacyChange });
    return withSnapshotLease(() => coordinator.renew(op.id), async keepAlive => {
      const folder = resume ? await getExisting(op.folderId) : null;
      assertOwned(folder ?? await createOnce(op.folderId, () => api.createFolder(`備份-${op.id}`, root, tags('snapshot', op.id), op.folderId)), op, root, 'snapshot');
      const refs: DriveWorkspaceManifest['tables'] = [];
      const usedNames = new Set(['manifest.xlsx']);
      let completedTables = 0;
      const report = (phase: Parameters<NonNullable<FolderBackupRunOptions['onProgress']>>[0]['phase'], name?: string) => run.onProgress?.({ phase, name, completedTables, totalTables: nodes.length });
      // Separate call frame prevents retaining each table's rows and XLSX across uploads.
      const uploadTable = async (index: number, fileName: string) => {
        const node = nodes[index];
        const summary = summaryById.get(node.tableId!)!;
        const fileId = op.fileIds[index + 1];
        const existing = resume ? await getExisting(fileId) : null;
        if (existing) return assertOwned(existing, op, op.folderId, 'table', summary.id);
        report('reading-table', summary.name);
        const table = run.source ? await run.source.readTable(summary.id) : data.tables.find(item => item.id === summary.id);
        if (!table || table.id !== summary.id) throw new Error('找不到備份表格');
        report('creating-file', summary.name);
        const body = await exportWorkspaceXlsxAsync(data, table);
        await run.source?.verify();
        report('uploading-table', summary.name);
        return assertOwned(await createOnce(fileId, () => api.uploadFile({ createId: fileId, parentId: op.folderId,
          name: fileName, mimeType: DRIVE_SNAPSHOT_XLSX, body, appProperties: tags('table', op.id, table.id) })), op, op.folderId, 'table', table.id);
      };
      for (let index = 0; index < nodes.length; index += 1) {
        await keepAlive();
        const node = nodes[index];
        const summary = summaryById.get(node.tableId!)!;
        const base = (summary.name || node.name).replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\.{2,}/g, ' ').replace(/\.+$/, '').trim() || '表格';
        let fileName = `${base}.xlsx`;
        for (let suffix = 2; usedNames.has(fileName); suffix += 1) fileName = `${base}-${suffix}.xlsx`;
        usedNames.add(fileName);
        const file = await uploadTable(index, fileName);
        refs.push({ id: summary.id, nodeId: node.id, folderId: node.parentId, name: summary.name,
          updatedAt: summary.updatedAt, changeRevision: workspaceTableChangeRevision(summary), driveFileId: file.id, fileName });
        completedTables += 1;
        report('table-uploaded', summary.name);
      }
      await run.source?.verify();
      await keepAlive();
      report('saving-index');
      const folders = data.nodes.filter(node => node.type === 'folder').map(node => ({ ...node, driveFolderId: '' }));
      const manifest: DriveWorkspaceManifest = { format: DRIVE_MANIFEST_FORMAT, version: DRIVE_MANIFEST_VERSION,
        backupKey: DRIVE_SNAPSHOT_KEY, sourceUpdatedAt, updatedAt: sourceUpdatedAt, fileLayout: 'flat',
        structureRevision: workspaceStructureChangeRevision(data), nodes: data.nodes, activeNodeId: data.activeNodeId,
        bottomNavigationTableIds: data.bottomNavigationTableIds, folders, tables: refs };
      const existingIndex = resume ? await getExisting(op.fileIds[0]) : null;
      assertOwned(existingIndex ?? await createOnce(op.fileIds[0], () => api.uploadFile({ createId: op.fileIds[0], parentId: op.folderId,
        name: DRIVE_MANIFEST_FILE_NAME, mimeType: DRIVE_SNAPSHOT_XLSX,
        body: exportWorkspaceBackupManifestXlsx({ ...data, structureRevision: manifest.structureRevision }, folders, refs, sourceUpdatedAt, 'flat'), appProperties: tags('manifest', op.id) })), op, op.folderId, 'manifest');
      // Decode the uploaded index, including a resumed index, before it can become official.
      report('verifying-index');
      const verified = await readSnapshotManifest(api, op);
      const signature = (value: DriveWorkspaceManifest) => JSON.stringify({
        source: value.sourceUpdatedAt, structure: value.structureRevision, active: value.activeNodeId,
        navigation: value.bottomNavigationTableIds ?? [],
        nodes: value.nodes.map(node => [node.id, node.type, node.name, node.parentId, node.order, node.tableId ?? '']),
        tables: value.tables.map(ref => [ref.id, ref.nodeId, ref.folderId, ref.name, ref.updatedAt, ref.changeRevision, ref.driveFileId, ref.fileName]),
      });
      if (signature(verified) !== signature(manifest)) throw new Error('備份索引驗證失敗');
      await run.source?.verify();
      report('confirming');
      let committed: DriveSnapshotOperation;
      try { committed = await coordinator.commit(op.id); }
      catch (error) {
        if (error instanceof SnapshotCoordinatorError && ['backup_revision_conflict', 'backup_legacy_changed'].includes(error.code)) throw error;
        // A lost HTTP response is not evidence that the conditional commit failed.
        const recovered = await coordinator.operation(op.id).catch(() => null);
        if (recovered?.status !== 'committed') throw error;
        committed = recovered;
      }
      void maintain();
      receipts.set(committed.fileIds[0], { account: current.accountKey, id: committed.id });
      return { file: manifestFile(committed), manifest, backupKey: DRIVE_SNAPSHOT_KEY, parentId: root, sourceUpdatedAt };
    });
  };

  return {
    ensureFolder, findRemoteFile, maintain,
    acknowledgeBackup(fileId, persisted = true) {
      const saved = receipts.get(fileId);
      if (saved) {
        acknowledged.add(saved.id);
        if (acknowledged.size > 128) acknowledged.delete(acknowledged.values().next().value!);
        if (persisted) journal.clear(saved.account, saved.id);
        receipts.delete(fileId);
      }
    },
    async listRemoteBackups() {
      const current = await state();
      const single = await options.legacySingle?.findRemoteFile();
      return [...current.versions.map(op => manifestFile(op)), ...await legacy.listRemoteBackups(),
        ...(single ? [{ ...single, appProperties: { ...single.appProperties, legacySingle: 'true' } }] : [])];
    },
    async restore(selected) {
      const current = await state();
      const id = selected?.appProperties?.[operationProperty] ?? (!selected ? current.versions[0]?.id : undefined);
      const op = id ? await coordinator.operation(id) : null;
      if (!op) {
        const fallback = selected ?? await legacyFile();
        if (fallback?.appProperties?.legacySingle === 'true' && options.legacySingle) {
          const imported = await importWorkspaceXlsx(await options.legacySingle.restore(fallback));
          if (!imported.data) throw new Error('不是完整的 Workspace 備份');
          return imported.data;
        }
        return legacy.restore(fallback ?? undefined);
      }
      if (op.status !== 'committed') throw new BackupNotFoundError(DRIVE_SNAPSHOT_KEY);
      const file = manifestFile(op);
      if (selected && (selected.id !== file.id || selected.modifiedTime !== file.modifiedTime)) throw new Error('所選備份已有變更，請重新選擇');
      return restoreSnapshot(api, coordinator, op);
    },
    backup(data, metadata, run) {
      if (pending) return pending;
      const execute = async () => {
        try { return await perform(data, metadata, run); }
        catch (error) {
          // A changed root is retried only after refreshing Drive discovery.
          if (error instanceof SnapshotCoordinatorError && error.code === 'backup_root_changed') return perform(data, metadata, run);
          throw error;
        }
      };
      pending = execute().catch(async error => {
        if (error instanceof SnapshotCoordinatorError && ['backup_revision_conflict', 'backup_legacy_changed'].includes(error.code)) {
          const current = await state().catch(() => lastState);
          throw new RemoteBackupConflictError(current ? headFile(current) : null);
        }
        throw error;
      }).finally(() => { pending = null; });
      return pending;
    },
  };
};
