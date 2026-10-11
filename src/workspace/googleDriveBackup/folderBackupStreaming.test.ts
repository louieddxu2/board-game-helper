import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createNode, createTable } from '../model';
import { exportWorkspaceBackupManifestXlsx, importWorkspaceBackupManifestXlsx, importWorkspaceXlsx } from '../spreadsheet';
import type { WorkspaceData } from '../types';
import { workspaceBackupTableSummary, type WorkspaceBackupSource } from '../workspaceBackupSource';
import { createGoogleDriveFolderBackup } from './folderBackup';
import type { WorkspaceBackupProgress } from './backupProgress';

const api = vi.hoisted(() => ({ findFilesByAppProperty: vi.fn(), uploadFile: vi.fn(), downloadBlob: vi.fn() }));
vi.mock('./googleDriveApi', () => ({ FOLDER_MIME: 'application/vnd.google-apps.folder', GoogleDriveApi: class {
  ensureFolderPath = async () => 'root';
  findFilesByAppProperty = api.findFilesByAppProperty;
  uploadFile = api.uploadFile;
  downloadBlob = api.downloadBlob;
} }));

beforeEach(() => {
  vi.clearAllMocks();
  api.findFilesByAppProperty.mockResolvedValue([]);
  api.uploadFile.mockImplementation(async ({ name }: { name: string }) => ({ id: `file-${name}`, name }));
});
const fixture = () => {
  const tables = ['第一表', '第二表'].map((name, index) => {
    const table = createTable(name);
    return { ...table, updatedAt: 42 + index, changeRevision: `revision-${index}`, rows: [{ id: `row-${index}`, name: `項目 ${index}`, values: { [table.columns[0].id]: `內容 ${index}` } }] };
  });
  const data: WorkspaceData = { version: 1, structureRevision: 'structure', nodes: tables.map((table, index) => createNode('table', table.name, null, index, table.id)), tables: [], activeNodeId: null, bottomNavigationTableIds: [tables[1].id] };
  const source: WorkspaceBackupSource = { tables: tables.map(workspaceBackupTableSummary), readTable: vi.fn(async id => tables.find(table => table.id === id)!), verify: vi.fn(async () => undefined) };
  const service = createGoogleDriveFolderBackup({ folderPath: [], backupKey: 'test', tokenProvider: { getAccessToken: async () => 'token' } });
  return { tables, data, source, service };
};

describe('transient table backups', () => {
  it('finishes uploading one table before reading the next and preserves the exchange format', async () => {
    const { tables, data, source, service } = fixture();
    const progress: WorkspaceBackupProgress[] = [];
    const events: string[] = [];
    source.readTable = vi.fn(async id => { events.push(`read:${id}`); return tables.find(table => table.id === id)!; });
    let finishFirst!: () => void;
    const firstUpload = new Promise<void>(resolve => { finishFirst = resolve; });
    const bodies = new Map<string, Blob>();
    api.uploadFile.mockImplementation(async ({ name, body, appProperties }: { name: string; body: Blob; appProperties: Record<string, string> }) => {
      const id = appProperties.localId ?? 'manifest';
      events.push(`upload:${id}`);
      bodies.set(id, body);
      if (id === tables[0].id) await firstUpload;
      events.push(`done:${id}`);
      return { id: `file-${id}`, name };
    });
    const upload = service.backup(data, {}, { source, onProgress: value => progress.push(value) });
    await vi.waitFor(() => expect(events).toContain(`upload:${tables[0].id}`));
    expect(source.readTable).toHaveBeenCalledTimes(1);
    expect(progress.at(-1)).toEqual({ phase: 'uploading-table', name: tables[0].name, completedTables: 0, totalTables: 2 });
    finishFirst();
    const receipt = await upload;
    expect(progress.map(item => [item.phase, item.completedTables])).toEqual([
      ['checking-remote', 0], ['reading-table', 0], ['creating-file', 0], ['uploading-table', 0],
      ['reading-table', 1], ['creating-file', 1], ['uploading-table', 1], ['saving-index', 2], ['confirming', 2],
    ]);
    expect(events).toEqual(tables.flatMap(table => [`read:${table.id}`, `upload:${table.id}`, `done:${table.id}`]).concat(['upload:manifest', 'done:manifest']));
    for (const table of tables) {
      const imported = (await importWorkspaceXlsx(bodies.get(table.id)!, { preserveIds: true })).table!;
      expect(imported.id).toBe(table.id);
      expect(imported.rows.map(row => ({ name: row.name, values: row.values }))).toEqual(table.rows.map(row => ({ name: row.name, values: row.values })));
      expect(imported.changeRevision).toBe(table.changeRevision);
    }
    const manifest = await importWorkspaceBackupManifestXlsx(bodies.get('manifest')!);
    expect(manifest.nodes).toEqual(data.nodes);
    expect(manifest.bottomNavigationTableIds).toEqual(data.bottomNavigationTableIds);
    expect(manifest.tables.map(table => table.driveFileId)).toEqual(receipt.manifest.tables.map(table => table.driveFileId));
    expect(data.tables).toEqual([]);
  });

  it('reuses unselected remote table files without reading their rows', async () => {
    const { tables, data, source, service } = fixture();
    const refs = tables.map((table, index) => ({ ...workspaceBackupTableSummary(table), nodeId: data.nodes[index].id, folderId: null, driveFileId: `old-${table.id}`, fileName: `${table.name}.xlsx` }));
    api.findFilesByAppProperty.mockResolvedValue([{ id: 'old-manifest', name: 'manifest.xlsx', appProperties: { backupKey: 'test', backupKind: 'manifest' } }]);
    api.downloadBlob.mockResolvedValue(exportWorkspaceBackupManifestXlsx(data, [], refs, 42));
    const onProgress = vi.fn();
    const receipt = await service.backup(data, {}, { source, complete: false, tableIds: [tables[0].id], onProgress });
    expect(source.readTable).toHaveBeenCalledExactlyOnceWith(tables[0].id);
    expect(receipt.manifest.tables[1].driveFileId).toBe(refs[1].driveFileId);
    expect(onProgress).toHaveBeenCalledWith({ phase: 'reusing-table', name: tables[1].name, completedTables: 2, totalTables: 2 });
  });

  it.each(['read', 'upload', 'verify'] as const)('keeps the previous manifest intact when %s fails', async failure => {
    const { tables, data, source, service } = fixture();
    if (failure === 'read') source.readTable = vi.fn(async id => { if (id === tables[1].id) throw new Error('read failed'); return tables[0]; });
    if (failure === 'upload') api.uploadFile.mockRejectedValueOnce(new Error('upload failed'));
    if (failure === 'verify') source.verify = vi.fn(async () => { if (api.uploadFile.mock.calls.length === 2) throw new Error('verify failed'); });
    const onProgress = vi.fn();
    await expect(service.backup(data, {}, { source, onProgress })).rejects.toThrow(`${failure} failed`);
    expect(api.uploadFile.mock.calls.some(([request]) => request.appProperties.backupKind === 'manifest')).toBe(false);
    expect(onProgress.mock.calls.some(([progress]) => progress.phase === 'confirming')).toBe(false);
  });
});
