import { normalizeWorkspace } from '../model';
import { workspaceTableChangeRevision } from '../changeRevisions';
import { exportWorkspaceBackupManifestXlsx, exportWorkspaceXlsxAsync, importWorkspaceBackupManifestXlsx, importWorkspaceXlsx, type WorkspaceBackupFolderRef, type WorkspaceBackupTableFileRef } from '../spreadsheet';
import type { WorkspaceData, WorkspaceNode, WorkspaceTable } from '../types';
import type { WorkspaceBackupSource } from '../workspaceBackupSource';
import type { WorkspaceBackupPhase, WorkspaceBackupProgress } from './backupProgress';
import { FOLDER_MIME, GoogleDriveApi } from './googleDriveApi';
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
export const DRIVE_PARENT_MANIFEST_IDS_PROPERTY = 'parentManifestIds';
export const DRIVE_BACKUP_FORK_COUNT_PROPERTY = 'backupForkCount';
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
  nodes: WorkspaceNode[];
  folders: DriveWorkspaceFolderRef[];
  tables: DriveWorkspaceTableRef[];
}

export interface FolderBackupOptions extends GoogleDriveApiOptions {
  folderPath: readonly string[];
  backupKey: string;
  appProperties?: Record<string, string>;
}

export interface GoogleDriveFolderBackup {
  ensureFolder(): Promise<string>;
  findRemoteFile(): Promise<DriveFile | null>;
  backup(data: WorkspaceData, metadata?: BackupMetadata, runOptions?: FolderBackupRunOptions): Promise<BackupReceipt & { manifest: DriveWorkspaceManifest }>;
  restore(): Promise<WorkspaceData>;
}

export interface FolderBackupRunOptions {
  onProgress?(progress: WorkspaceBackupProgress): void;
  source?: WorkspaceBackupSource;
  tableIds?: string[];
  complete?: boolean;
  expectedRemoteFileId?: string | null;
  expectedRemoteModifiedTime?: string | null;
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

const sortManifestFiles = (files: DriveFile[]) => [...files].sort((left, right) => {
  const backedUpDifference = Number(right.appProperties?.backedUpAt ?? 0) - Number(left.appProperties?.backedUpAt ?? 0);
  if (backedUpDifference) return backedUpDifference;
  return String(right.modifiedTime ?? right.createdTime ?? '').localeCompare(String(left.modifiedTime ?? left.createdTime ?? ''));
});

const manifestParentIds = (file: DriveFile): string[] => {
  const serialized = file.appProperties?.[DRIVE_PARENT_MANIFEST_IDS_PROPERTY];
  if (serialized === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(serialized);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

export const findDriveManifestHeads = (files: DriveFile[]): DriveFile[] => {
  const sorted = sortManifestFiles(files);
  const versioned = sorted.filter((file) => file.appProperties?.[DRIVE_PARENT_MANIFEST_IDS_PROPERTY] !== undefined);
  if (versioned.length === 0) return sorted.slice(0, 1);
  const referencedIds = new Set(versioned.flatMap(manifestParentIds));
  const heads = versioned.filter((file) => !referencedIds.has(file.id));
  const latestLegacy = sorted.find((file) => file.appProperties?.[DRIVE_PARENT_MANIFEST_IDS_PROPERTY] === undefined);
  if (latestLegacy && !referencedIds.has(latestLegacy.id)) heads.push(latestLegacy);
  return sortManifestFiles(heads);
};

export const createGoogleDriveFolderBackup = (options: FolderBackupOptions): GoogleDriveFolderBackup => {
  if (!options.backupKey.trim()) throw new Error('backupKey 不可為空白');
  const api = new GoogleDriveApi(options);
  let rootId: string | null = null;
  let rootPromise: Promise<string> | null = null;
  let backupPromise: Promise<BackupReceipt & { manifest: DriveWorkspaceManifest }> | null = null;

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
    const files = await findTagged(DRIVE_MANIFEST_KIND, undefined, await ensureFolder(), DRIVE_XLSX_MIME_TYPE);
    const heads = findDriveManifestHeads(files);
    const selected = heads[0]
      ? { ...heads[0], appProperties: { ...heads[0].appProperties, [DRIVE_BACKUP_FORK_COUNT_PROPERTY]: String(heads.length) } }
      : null;
    return { heads, selected };
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

  const performBackup = async (data: WorkspaceData, metadata: BackupMetadata = {}, runOptions: FolderBackupRunOptions = {}): Promise<BackupReceipt & { manifest: DriveWorkspaceManifest }> => {
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
    const parentManifestIds = 'expectedRemoteFileId' in runOptions
      ? previousFile ? [previousFile.id] : []
      : remoteState.heads.map((file) => file.id);
    const appProperties = { ...taggedProperties(DRIVE_MANIFEST_KIND), ...(metadata.appProperties ?? {}), backedUpAt: String(Date.now()), sourceUpdatedAt: String(sourceUpdatedAt), schemaVersion: String(DRIVE_MANIFEST_VERSION), [DRIVE_PARENT_MANIFEST_IDS_PROPERTY]: JSON.stringify(parentManifestIds) };
    const manifestFolderRefs: WorkspaceBackupFolderRef[] = folders.map((folder) => ({ ...folder }));
    const manifestTableRefs: WorkspaceBackupTableFileRef[] = tableRefs.map((table) => ({ ...table }));
    report('saving-index');
    await runOptions.source?.verify();
    const file = await api.uploadFile({ parentId: root, name: DRIVE_MANIFEST_FILE_NAME, mimeType: DRIVE_XLSX_MIME_TYPE, body: exportWorkspaceBackupManifestXlsx(data, manifestFolderRefs, manifestTableRefs, sourceUpdatedAt), appProperties });
    report('confirming');
    const committedState = await findRemoteState();
    if (committedState.heads.length > 1) throw new RemoteBackupConflictError(committedState.selected);
    return { file, backupKey: options.backupKey, parentId: root, sourceUpdatedAt: metadata.sourceUpdatedAt, manifest };
  };

  return {
    ensureFolder,
    findRemoteFile,
    backup(data, metadata, runOptions) {
      const currentBackup = backupPromise ?? performBackup(data, metadata, runOptions).finally(() => { backupPromise = null; });
      backupPromise = currentBackup;
      return currentBackup;
    },
    async restore() {
      const manifestFile = await findRemoteFile();
      if (!manifestFile) throw new BackupNotFoundError(options.backupKey);
      const manifest = await importWorkspaceBackupManifestXlsx(await api.downloadBlob(manifestFile.id));
      const refs = manifest.tables;
      const tables: WorkspaceTable[] = [];
      for (const ref of refs) {
        const imported = await importWorkspaceXlsx(await api.downloadBlob(ref.driveFileId), { preserveIds: true });
        if (!imported.table) throw new Error(`雲端表格格式錯誤：${ref.name}`);
        tables.push(imported.table);
      }
      return normalizeWorkspace({ version: 1, structureRevision: manifest.structureRevision, nodes: manifest.nodes as WorkspaceNode[], tables, activeNodeId: manifest.activeNodeId, bottomNavigationTableIds: manifest.bottomNavigationTableIds });
    },
  };
};
