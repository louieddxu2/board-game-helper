import { normalizeWorkspace } from '../model';
import type { WorkspaceData, WorkspaceNode, WorkspaceTable } from '../types';
import { FOLDER_MIME, GoogleDriveApi } from './googleDriveApi';
import { BackupNotFoundError } from './singleFileBackup';
import type { BackupMetadata, BackupReceipt, DriveFile, GoogleDriveApiOptions } from './types';

export const DRIVE_MANIFEST_FORMAT = 'board-game-helper-drive-manifest';
export const DRIVE_MANIFEST_VERSION = 1;
export const DRIVE_MANIFEST_FILE_NAME = 'manifest.json';
export const DRIVE_BACKUP_KIND_PROPERTY = 'backupKind';
export const DRIVE_LOCAL_ID_PROPERTY = 'localId';
export const DRIVE_MANIFEST_KIND = 'manifest';
export const DRIVE_FOLDER_KIND = 'folder';
export const DRIVE_TABLE_KIND = 'table';
export const DRIVE_JSON_MIME_TYPE = 'application/json';

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
  nodes: WorkspaceNode[];
  folders: DriveWorkspaceFolderRef[];
  tables: DriveWorkspaceTableRef[];
}

interface DriveTablePayload {
  format: 'board-game-helper-drive-table';
  version: 1;
  exportedAt: number;
  nodeId: string;
  table: WorkspaceTable;
}

export interface FolderBackupOptions extends GoogleDriveApiOptions {
  folderPath: readonly string[];
  backupKey: string;
  appProperties?: Record<string, string>;
}

export interface GoogleDriveFolderBackup {
  ensureFolder(): Promise<string>;
  findRemoteFile(): Promise<DriveFile | null>;
  backup(data: WorkspaceData, metadata?: BackupMetadata): Promise<BackupReceipt & { manifest: DriveWorkspaceManifest }>;
  restore(): Promise<WorkspaceData>;
}

const json = (value: unknown) => JSON.stringify(value, null, 2);
const asObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Google Drive 備份內容格式錯誤');
  return value as Record<string, unknown>;
};

const readJson = async <T>(blob: Blob): Promise<T> => {
  const blobWithOptionalMethods = blob as Blob & { text?: () => Promise<string>; arrayBuffer?: () => Promise<ArrayBuffer> };
  const text = typeof blobWithOptionalMethods.text === 'function'
    ? await blobWithOptionalMethods.text()
    : typeof blobWithOptionalMethods.arrayBuffer === 'function'
      ? new TextDecoder().decode(await blobWithOptionalMethods.arrayBuffer())
      : await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error ?? new Error('無法讀取 Google Drive 備份'));
        reader.readAsText(blob);
      });
  try { return JSON.parse(text) as T; }
  catch {
    if (typeof blobWithOptionalMethods.arrayBuffer !== 'function') throw new Error('無法讀取 Google Drive 備份');
    try { return JSON.parse(new TextDecoder().decode(await blobWithOptionalMethods.arrayBuffer())) as T; }
    catch { throw new Error('Google Drive 備份內容不是有效 JSON'); }
  }
};

const parentOf = (node: WorkspaceNode, nodes: Map<string, WorkspaceNode>) => node.parentId ? nodes.get(node.parentId) : undefined;

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

  const findRemoteFile = async () => (await findTagged(DRIVE_MANIFEST_KIND, undefined, await ensureFolder(), DRIVE_JSON_MIME_TYPE))[0] ?? null;

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

  const performBackup = async (data: WorkspaceData, metadata: BackupMetadata = {}) => {
    const root = await ensureFolder();
    const previousFile = await findRemoteFile();
    const previous = previousFile ? await readJson<DriveWorkspaceManifest>(await api.downloadBlob(previousFile.id)).catch(() => undefined) : undefined;
    const previousFolders = new Map((previous?.folders ?? []).map((item) => [item.id, item]));
    const previousTables = new Map((previous?.tables ?? []).map((item) => [item.id, item]));
    const nodeMap = new Map(data.nodes.map((node) => [node.id, node]));
    const driveFolderIds = new Map<string, string>();
    const folders: DriveWorkspaceFolderRef[] = [];

    for (const node of data.nodes.filter((item) => item.type === 'folder')) {
      const parentNode = parentOf(node, nodeMap);
      const parentDriveId = parentNode ? driveFolderIds.get(parentNode.id) : root;
      if (!parentDriveId) throw new Error(`找不到資料夾父層：${node.name}`);
      const folder = await ensureFolderNode(node, parentDriveId, previousFolders.get(node.id));
      driveFolderIds.set(node.id, folder.id);
      folders.push({ id: node.id, name: node.name, parentId: node.parentId, order: node.order, driveFolderId: folder.id });
    }

    const tableRefs: DriveWorkspaceTableRef[] = [];
    for (const node of data.nodes.filter((item) => item.type === 'table')) {
      if (!node.tableId) continue;
      const table = data.tables.find((item) => item.id === node.tableId);
      if (!table) throw new Error(`找不到表格資料：${node.name}`);
      const parentNode = parentOf(node, nodeMap);
      const parentId = parentNode ? driveFolderIds.get(parentNode.id) : root;
      if (!parentId) throw new Error(`找不到表格父層：${node.name}`);
      const previousTable = previousTables.get(table.id);
      let file = previousTable?.driveFileId
        ? (await findTagged(DRIVE_TABLE_KIND, table.id, undefined, DRIVE_JSON_MIME_TYPE))[0]
        : undefined;
      if (!file) file = (await findTagged(DRIVE_TABLE_KIND, table.id, parentId, DRIVE_JSON_MIME_TYPE))[0];
      const fileName = `${table.name || node.name || table.id}.json`;
      const payload: DriveTablePayload = { format: 'board-game-helper-drive-table', version: 1, exportedAt: Date.now(), nodeId: node.id, table };
      if (file?.parents?.[0] && file.parents[0] !== parentId) file = await api.moveFile(file.id, parentId, file.parents[0]);
      file = await api.uploadFile({ fileId: file?.id, parentId: file ? undefined : parentId, name: fileName, mimeType: DRIVE_JSON_MIME_TYPE, body: json(payload), appProperties: taggedProperties(DRIVE_TABLE_KIND, table.id) });
      tableRefs.push({ id: table.id, nodeId: node.id, folderId: node.parentId, name: table.name, updatedAt: table.updatedAt, driveFileId: file.id, fileName });
    }

    const activeIds = new Set(folders.map((item) => item.id));
    for (const folder of previous?.folders ?? []) if (!activeIds.has(folder.id)) await api.trashFile(folder.driveFolderId);
    const activeTableIds = new Set(tableRefs.map((item) => item.id));
    for (const table of previous?.tables ?? []) if (!activeTableIds.has(table.id)) await api.trashFile(table.driveFileId);

    const fallbackUpdatedAt = Math.max(0, ...data.tables.map((table) => table.updatedAt)) || Date.now();
    const sourceUpdatedAt = typeof metadata.sourceUpdatedAt === 'number' ? metadata.sourceUpdatedAt : Number(metadata.sourceUpdatedAt ?? fallbackUpdatedAt);
    const manifest: DriveWorkspaceManifest = {
      format: DRIVE_MANIFEST_FORMAT,
      version: DRIVE_MANIFEST_VERSION,
      backupKey: options.backupKey,
      updatedAt: Date.now(),
      sourceUpdatedAt,
      activeNodeId: data.activeNodeId,
      nodes: data.nodes,
      folders,
      tables: tableRefs,
    };
    const appProperties = { ...taggedProperties(DRIVE_MANIFEST_KIND), ...(metadata.appProperties ?? {}), backedUpAt: String(Date.now()), sourceUpdatedAt: String(sourceUpdatedAt), schemaVersion: String(DRIVE_MANIFEST_VERSION) };
    const file = await api.uploadFile({ fileId: previousFile?.id, parentId: previousFile ? undefined : root, name: DRIVE_MANIFEST_FILE_NAME, mimeType: DRIVE_JSON_MIME_TYPE, body: json(manifest), appProperties });
    return { file, backupKey: options.backupKey, parentId: root, sourceUpdatedAt: metadata.sourceUpdatedAt, manifest };
  };

  return {
    ensureFolder,
    findRemoteFile,
    backup(data, metadata) {
      if (!backupPromise) backupPromise = performBackup(data, metadata).finally(() => { backupPromise = null; });
      return backupPromise;
    },
    async restore() {
      const manifestFile = await findRemoteFile();
      if (!manifestFile) throw new BackupNotFoundError(options.backupKey);
      const manifest = asObject(await readJson<unknown>(await api.downloadBlob(manifestFile.id)));
      if (manifest.format !== DRIVE_MANIFEST_FORMAT || manifest.version !== DRIVE_MANIFEST_VERSION || manifest.backupKey !== options.backupKey) throw new Error('Google Drive 備份版本不相容');
      if (!Array.isArray(manifest.nodes) || !Array.isArray(manifest.tables)) throw new Error('Google Drive 備份目錄不完整');
      const refs = Array.isArray(manifest.tables) ? manifest.tables as DriveWorkspaceTableRef[] : [];
      const tables: WorkspaceTable[] = [];
      for (const ref of refs) {
        const file = (await findTagged(DRIVE_TABLE_KIND, ref.id, undefined, DRIVE_JSON_MIME_TYPE))[0];
        if (!file) throw new Error(`找不到雲端表格：${ref.name}`);
        const payload = asObject(await readJson<unknown>(await api.downloadBlob(file.id)));
        if (payload.format !== 'board-game-helper-drive-table' || payload.version !== 1 || !payload.table) throw new Error(`雲端表格格式錯誤：${ref.name}`);
        tables.push(payload.table as WorkspaceTable);
      }
      return normalizeWorkspace({ version: 1, nodes: manifest.nodes as WorkspaceNode[], tables, activeNodeId: typeof manifest.activeNodeId === 'string' ? manifest.activeNodeId : null });
    },
  };
};
