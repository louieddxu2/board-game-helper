import { cleanDriveBackupHistory } from './backupRetention';
import { withDriveBackupOperation } from './backupOperation';
import { adoptedDriveLegacyBaseline, driveLegacyBaselineForBackup, needsDriveLegacyHistory, findDriveManifestHeads, retainedDriveManifests, DRIVE_BACKUP_FORK_COUNT_PROPERTY, DRIVE_ADOPTED_LEGACY_ID_PROPERTY, DRIVE_ADOPTED_LEGACY_TIME_PROPERTY } from './manifestHistory';
import { manifestParentProperties } from './manifestParents';
export { findDriveManifestHeads, DRIVE_PARENT_MANIFEST_IDS_PROPERTY, DRIVE_BACKUP_FORK_COUNT_PROPERTY } from './manifestHistory';
import { normalizeWorkspace } from '../model';
import { workspaceTableChangeRevision } from '../changeRevisions';
import { exportWorkspaceBackupManifestXlsx, exportWorkspaceXlsxAsync, importWorkspaceBackupManifestXlsx, importWorkspaceXlsx, type WorkspaceBackupFolderRef, type WorkspaceBackupTableFileRef } from '../spreadsheet';
import type { WorkspaceData, WorkspaceNode, WorkspaceTable } from '../types';
import type { WorkspaceBackupSource } from '../workspaceBackupSource';
import type { WorkspaceBackupPhase, WorkspaceBackupProgress } from './backupProgress';
import { assertDriveAppProperties, FOLDER_MIME, GoogleDriveApi } from './googleDriveApi';
import { BackupNotFoundError } from './singleFileBackup';
import type { BackupMetadata, BackupReceipt, DriveFile, GoogleDriveApiOptions } from './types';

export const DRIVE_MANIFEST_FORMAT = 'board-game-helper-drive-manifest';
export const DRIVE_MANIFEST_VERSION = 1;
export const DRIVE_MANIFEST_FILE_NAME = 'manifest.xlsx';
export const DRIVE_BACKUP_KIND_PROPERTY = 'backupKind';
export const DRIVE_LOCAL_ID_PROPERTY = 'localId';
export const DRIVE_MANIFEST_KIND = 'manifest';
export const DRIVE_FOLDER_KIND = 'folder';
export const DRIVE_TABLE_KIND = 'table';
export const DRIVE_XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface DriveWorkspaceFolderRef {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
  driveFolderId: string;
}

export interface DriveWorkspaceTableRef {
  id: string;
  nodeId: string;
  folderId: string | null;
  name: string;
  updatedAt: number;
  changeRevision?: string;
  driveFileId: string;
  fileName: string;
}

export interface DriveWorkspaceManifest {
  format: typeof DRIVE_MANIFEST_FORMAT;
  version: typeof DRIVE_MANIFEST_VERSION;
  backupKey: string;
  updatedAt: number;
  sourceUpdatedAt: number;
  activeNodeId: string | null;
  structureRevision?: string;
  bottomNavigationTableIds?: string[];
  fileLayout?: 'flat';
  nodes: WorkspaceNode[];
  folders: DriveWorkspaceFolderRef[];
  tables: DriveWorkspaceTableRef[];
}

export interface FolderBackupOptions extends GoogleDriveApiOptions {
  folderPath: readonly string[];
  backupKey: string;
  appProperties?: Record<string, string>;
  retainedVersions?: number;
}

export interface GoogleDriveFolderBackup {
  ensureFolder(): Promise<string>;
  findRemoteFile(): Promise<DriveFile | null>;
  backup(data: WorkspaceData, metadata?: BackupMetadata, runOptions?: FolderBackupRunOptions): Promise<BackupReceipt & { manifest: DriveWorkspaceManifest; cleanupWarning?: string }>;
  listRemoteBackups(): Promise<DriveFile[]>;
  restore(selected?: DriveFile): Promise<WorkspaceData>;
  acknowledgeBackup?(fileId: string, persisted?: boolean): void;
  maintain?(): Promise<void>;
}

export interface FolderBackupRunOptions {
  onProgress?(progress: WorkspaceBackupProgress): void;
  source?: WorkspaceBackupSource;
  tableIds?: string[];
  complete?: boolean;
  expectedRemoteFileId?: string | null;
  expectedRemoteModifiedTime?: string | null;
  allowLegacyChange?: boolean;
  expectedLegacyStamp?: string;
}

export class RemoteBackupConflictError extends Error {
  readonly remoteFile: DriveFile | null;

  constructor(remoteFile: DriveFile | null) {
    super('雲端備份已在其他裝置變更，請先載入雲端版本或明確選擇覆蓋');
    this.name = 'RemoteBackupConflictError';
    this.remoteFile = remoteFile;
  }
}

const parentOf = (node: WorkspaceNode, nodes: Map<string, WorkspaceNode>) => node.parentId ? nodes.get(node.parentId) : undefined;

const folderDepth = (node: WorkspaceNode, nodes: Map<string, WorkspaceNode>, visiting = new Set<string>()): number => {
  if (!node.parentId) return 0;
  if (visiting.has(node.id)) throw new Error('工作區資料夾結構包含循環');
  const parent = nodes.get(node.parentId);
  if (!parent || parent.type !== 'folder') throw new Error(`找不到資料夾父層：${node.name}`);
  visiting.add(node.id);
  return folderDepth(parent, nodes, visiting) + 1;
};

export const createGoogleDriveFolderBackup = (options: FolderBackupOptions): GoogleDriveFolderBackup => {
  if (!options.backupKey.trim()) throw new Error('backupKey 不可為空白');
  if (options.retainedVersions !== undefined && (!Number.isInteger(options.retainedVersions) || options.retainedVersions < 1)) throw new Error('備份保留數量必須是正整數');
  const api = new GoogleDriveApi(options);
  let rootId: string | null = null;
  let rootPromise: Promise<string> | null = null;
  let backupPromise: Promise<BackupReceipt & { manifest: DriveWorkspaceManifest; cleanupWarning?: string }> | null = null;

  const ensureFolder = async () => {
    if (rootId) return rootId;
    if (!rootPromise) {
      rootPromise = api.ensureFolderPath(options.folderPath).then((id) => { rootId = id; return id; }).finally(() => { rootPromise = null; });
    }
    return rootPromise;
  };

  const taggedProperties = (kind: string, localId?: string) => ({
    ...(options.appProperties ?? {}),
    backupKey: options.backupKey,
    [DRIVE_BACKUP_KIND_PROPERTY]: kind,
    ...(localId ? { [DRIVE_LOCAL_ID_PROPERTY]: localId } : {}),
  });

  const findTagged = (kind: string, localId?: string, parentId?: string, mimeType?: string) => {
    const key = localId ? DRIVE_LOCAL_ID_PROPERTY : 'backupKey';
    const value = localId ?? options.backupKey;
    return api.findFilesByAppProperty({ key, value, parentId, mimeType }).then((files) => files.filter((file) => file.appProperties?.backupKey === options.backupKey && file.appProperties?.[DRIVE_BACKUP_KIND_PROPERTY] === kind));
  };

  const findRemoteState = async () => {
    const root = await ensureFolder();
    const files = await findTagged(DRIVE_MANIFEST_KIND, undefined, root, DRIVE_XLSX_MIME_TYPE);
    const historical = needsDriveLegacyHistory(files)
      ? (await api.findFilesByAppProperty({ key: DRIVE_BACKUP_KIND_PROPERTY, value: DRIVE_MANIFEST_KIND, parentId: root, mimeType: DRIVE_XLSX_MIME_TYPE, trashed: true }))
        .filter(file => file.appProperties?.backupKey === options.backupKey)
      : [];
    const legacyBaseline = adoptedDriveLegacyBaseline(files, historical);
    const heads = findDriveManifestHeads(files, legacyBaseline);
    const selected = heads[0]
      ? { ...heads[0], appProperties: { ...heads[0].appProperties, [DRIVE_BACKUP_FORK_COUNT_PROPERTY]: String(heads.length) } }
      : null;
    return { files, heads, selected, legacyBaseline };
  };
  const findRemoteFile = async () => (await findRemoteState()).selected;

  const ensureFolderNode = async (node: WorkspaceNode, parentId: string, previous: DriveWorkspaceFolderRef | undefined) => {
    let file = previous?.driveFolderId
      ? (await findTagged(DRIVE_FOLDER_KIND, node.id, undefined, FOLDER_MIME))[0]
      : undefined;
    if (!file) file = (await findTagged(DRIVE_FOLDER_KIND, node.id, parentId, FOLDER_MIME))[0];
    if (!file) file = await api.createFolder(node.name || '未命名資料夾', parentId, taggedProperties(DRIVE_FOLDER_KIND, node.id));
    else {
      const currentParent = file.parents?.[0];
      if (currentParent && currentParent !== parentId) file = await api.moveFile(file.id, parentId, currentParent);
      if (file.name !== node.name) file = await api.updateFileMetadata(file.id, { name: node.name });
    }
    return file;
  };

  // A separate call frame drops the temporary rows and XLSX after this upload finishes.
  const uploadTable = async (data: WorkspaceData, tableId: string, nodeName: string, parentId: string, source: WorkspaceBackupSource | undefined, report: (phase: WorkspaceBackupPhase, name?: string) => void) => {
    report('reading-table', nodeName);
    const table = source ? await source.readTable(tableId) : data.tables.find(item => item.id === tableId);
    if (!table || table.id !== tableId) throw new Error(`找不到表格資料：${nodeName}`);
    const fileName = `${table.name || nodeName || table.id}.xlsx`;
    report('creating-file', table.name || nodeName);
    const body = await exportWorkspaceXlsxAsync(data, table);
    await source?.verify();
    report('uploading-table', table.name || nodeName);
    const file = await api.uploadFile({ parentId, name: fileName, mimeType: DRIVE_XLSX_MIME_TYPE, body, appProperties: taggedProperties(DRIVE_TABLE_KIND, table.id) });
    return { id: table.id, name: table.name, updatedAt: table.updatedAt, changeRevision: workspaceTableChangeRevision(table), driveFileId: file.id, fileName };
  };

  const performBackup = async (data: WorkspaceData, metadata: BackupMetadata = {}, runOptions: FolderBackupRunOptions = {}, operation?: { id: string; verify(): void; verifyRemote(): Promise<void> }): Promise<BackupReceipt & { manifest: DriveWorkspaceManifest; cleanupWarning?: string }> => {
    const tableNodes = data.nodes.filter(node => node.type === 'table' && node.tableId);
    let completedTables = 0;
    const report = (phase: WorkspaceBackupPhase, name?: string) => runOptions.onProgress?.({ phase, name, completedTables, totalTables: tableNodes.length });
    report('checking-remote');
    const root = await ensureFolder();
    const remoteState = await findRemoteState();
    const previousFile = remoteState.selected;
    if ('expectedRemoteFileId' in runOptions) {
      const idChanged = (previousFile?.id ?? null) !== (runOptions.expectedRemoteFileId ?? null);
      const timeChanged = runOptions.expectedRemoteModifiedTime != null
        && previousFile?.modifiedTime != null
        && previousFile.modifiedTime !== runOptions.expectedRemoteModifiedTime;
      if (remoteState.heads.length > 1 || idChanged || timeChanged) throw new RemoteBackupConflictError(previousFile);
    }
    const previous = previousFile ? await importWorkspaceBackupManifestXlsx(await api.downloadBlob(previousFile.id)).catch(() => undefined) : undefined;
    const previousFolders = new Map((previous?.folders ?? []).map((item) => [item.id, item]));
    const previousTables = new Map((previous?.tables ?? []).map((item) => [item.id, item]));
    const tables = runOptions.source?.tables ?? data.tables;
    const fallbackUpdatedAt = Math.max(0, ...tables.map((table) => table.updatedAt)) || Date.now();
    const sourceUpdatedAt = typeof metadata.sourceUpdatedAt === 'number' ? metadata.sourceUpdatedAt : Number(metadata.sourceUpdatedAt ?? fallbackUpdatedAt);
    const parentManifestIds = 'expectedRemoteFileId' in runOptions
      ? previousFile ? [previousFile.id] : []
      : remoteState.heads.map(file => file.id);
    const legacyBaseline = driveLegacyBaselineForBackup(remoteState.heads, remoteState.legacyBaseline);
    const appProperties = {
      ...taggedProperties(DRIVE_MANIFEST_KIND), ...(metadata.appProperties ?? {}),
      backedUpAt: String(Date.now()), sourceUpdatedAt: String(sourceUpdatedAt), schemaVersion: String(DRIVE_MANIFEST_VERSION),
      ...manifestParentProperties(parentManifestIds),
      ...(legacyBaseline ? {
        [DRIVE_ADOPTED_LEGACY_ID_PROPERTY]: legacyBaseline.id,
        [DRIVE_ADOPTED_LEGACY_TIME_PROPERTY]: new Date(legacyBaseline.time).toISOString(),
      } : {}),
    };
    assertDriveAppProperties(appProperties);
    const nodeMap = new Map(data.nodes.map((node) => [node.id, node]));
    const driveFolderIds = new Map<string, string>();
    const folders: DriveWorkspaceFolderRef[] = [];

    const folderNodes = data.nodes
      .filter((item) => item.type === 'folder')
      .sort((left, right) => folderDepth(left, nodeMap) - folderDepth(right, nodeMap));
    for (const node of folderNodes) {
      report('preparing-folders', node.name);
      const parentNode = parentOf(node, nodeMap);
      const parentDriveId = parentNode ? driveFolderIds.get(parentNode.id) : root;
      if (!parentDriveId) throw new Error(`找不到資料夾父層：${node.name}`);
      const folder = await ensureFolderNode(node, parentDriveId, previousFolders.get(node.id));
      driveFolderIds.set(node.id, folder.id);
      folders.push({ id: node.id, name: node.name, parentId: node.parentId, order: node.order, driveFolderId: folder.id });
    }

    const tableRefs: DriveWorkspaceTableRef[] = [];
    const selectedTableIds = new Set(runOptions.tableIds ?? tables.map((table) => table.id));
    for (const node of tableNodes) {
      if (!node.tableId) continue;
      operation?.verify();
      const table = tables.find((item) => item.id === node.tableId);
      if (!table) throw new Error(`找不到表格資料：${node.name}`);
      const parentNode = parentOf(node, nodeMap);
      const parentId = parentNode ? driveFolderIds.get(parentNode.id) : root;
      if (!parentId) throw new Error(`找不到表格父層：${node.name}`);
      const previousTable = previousTables.get(table.id);
      if (!selectedTableIds.has(table.id) && previousTable) {
        tableRefs.push({ id: previousTable.id, nodeId: node.id, folderId: node.parentId, name: previousTable.name, updatedAt: previousTable.updatedAt, changeRevision: previousTable.changeRevision, driveFileId: previousTable.driveFileId, fileName: previousTable.fileName });
        completedTables += 1;
        report('reusing-table', table.name);
        continue;
      }
      tableRefs.push({ ...await uploadTable(data, table.id, node.name, parentId, runOptions.source, report), nodeId: node.id, folderId: node.parentId });
      completedTables += 1;
    }

    const manifest: DriveWorkspaceManifest = {
      format: DRIVE_MANIFEST_FORMAT,
      version: DRIVE_MANIFEST_VERSION,
      backupKey: options.backupKey,
      updatedAt: sourceUpdatedAt,
      sourceUpdatedAt,
      activeNodeId: data.activeNodeId,
      structureRevision: data.structureRevision,
      nodes: data.nodes,
      folders,
      tables: tableRefs,
    };
    const manifestFolderRefs: WorkspaceBackupFolderRef[] = folders.map((folder) => ({ ...folder }));
    const manifestTableRefs: WorkspaceBackupTableFileRef[] = tableRefs.map((table) => ({ ...table }));
    report('saving-index');
    await runOptions.source?.verify();
    operation?.verify();
    await operation?.verifyRemote();
    const beforeCommit = await findRemoteState();
    if (beforeCommit.heads.length !== remoteState.heads.length || beforeCommit.heads.some(file => !remoteState.heads.some(prior => prior.id === file.id && prior.modifiedTime === file.modifiedTime))) throw new RemoteBackupConflictError(beforeCommit.selected);
    const file = await api.uploadFile({ parentId: root, name: DRIVE_MANIFEST_FILE_NAME, mimeType: DRIVE_XLSX_MIME_TYPE, body: exportWorkspaceBackupManifestXlsx(data, manifestFolderRefs, manifestTableRefs, sourceUpdatedAt), appProperties });
    report('confirming');
    const committedState = await findRemoteState();
    if (committedState.heads.length > 1 || (committedState.selected && committedState.selected.id !== file.id)) throw new RemoteBackupConflictError(committedState.selected);
    if (!committedState.selected) throw new Error('備份檔已上傳，但無法確認雲端備份，請稍後尋找雲端備份');
    let cleanupWarning: string | undefined;
    if (options.retainedVersions && operation) {
      report('cleaning-history');
      try { cleanupWarning = await cleanDriveBackupHistory({ api, root, backupKey: options.backupKey, headId: file.id, limit: options.retainedVersions, operationId: operation.id, verify: operation.verify }); }
      catch (error) { cleanupWarning = `備份已完成，但舊版本清理失敗：${error instanceof Error ? error.message : '請稍後重試'}`; }
    }
    return { file, backupKey: options.backupKey, parentId: root, sourceUpdatedAt: metadata.sourceUpdatedAt, manifest, ...(cleanupWarning ? { cleanupWarning } : {}) };
  };

  const listRemoteBackups = async () => {
    const state = await findRemoteState();
    if (!state.selected) return [];
    return retainedDriveManifests(state.files, state.selected.id, options.retainedVersions ?? 3).map(file => file.id === state.selected!.id ? state.selected! : file);
  };
  const restore = async (selected?: DriveFile, verify: () => void = () => undefined, verifyRemote: () => Promise<void> = async () => undefined) => {
    const state = await findRemoteState();
    const manifestFile = selected ? state.files.find(file => file.id === selected.id) : state.selected;
    if (!manifestFile) throw new BackupNotFoundError(options.backupKey);
    if (selected?.modifiedTime && manifestFile.modifiedTime !== selected.modifiedTime) throw new Error('所選備份已有變更，請重新尋找後再還原');
    const manifest = await importWorkspaceBackupManifestXlsx(await api.downloadBlob(manifestFile.id));
    const tables: WorkspaceTable[] = [];
    for (const ref of manifest.tables) {
      verify();
      if (!ref.driveFileId || !manifest.nodes.some(node => node.type === 'table' && node.id === ref.nodeId && node.tableId === ref.id)) throw new Error(`雲端備份索引錯誤：${ref.name}`);
      const imported = await importWorkspaceXlsx(await api.downloadBlob(ref.driveFileId), { preserveIds: true });
      if (!imported.table || imported.table.id !== ref.id) throw new Error(`雲端表格格式或識別不一致：${ref.name}`);
      tables.push(imported.table);
    }
    if (manifest.nodes.some(node => node.type === 'table' && !manifest.tables.some(ref => ref.id === node.tableId && ref.nodeId === node.id))) throw new Error('雲端備份索引缺少表格');
    verify();
    await verifyRemote();
    return normalizeWorkspace({ version: 1, structureRevision: manifest.structureRevision, nodes: manifest.nodes as WorkspaceNode[], tables, activeNodeId: manifest.activeNodeId, bottomNavigationTableIds: manifest.bottomNavigationTableIds });
  };
  return {
    ensureFolder, findRemoteFile, listRemoteBackups,
    backup(data, metadata, runOptions) {
      const run = async () => {
        if (!options.retainedVersions) return performBackup(data, metadata, runOptions);
        const result = await withDriveBackupOperation(api, await ensureFolder(), options.backupKey, (verify, id, verifyRemote) => performBackup(data, metadata, runOptions, { verify, id, verifyRemote }));
        return { ...result.value, cleanupWarning: result.value.cleanupWarning ?? result.warning };
      };
      const currentBackup = backupPromise ?? run().finally(() => { backupPromise = null; });
      backupPromise = currentBackup;
      return currentBackup;
    },
    async restore(selected) {
      if (!options.retainedVersions) return restore(selected);
      return (await withDriveBackupOperation(api, await ensureFolder(), options.backupKey, (verify, _id, verifyRemote) => restore(selected, verify, verifyRemote))).value;
    },
  };
};
