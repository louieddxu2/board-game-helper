import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNode, createTable } from '../model';
import { exportWorkspaceBackupManifestXlsx, exportWorkspaceXlsx } from '../spreadsheet';
import type { WorkspaceData } from '../types';
import { GoogleDriveApi, GoogleDriveApiError } from './googleDriveApi';
import { createGoogleDriveFolderBackup, RemoteBackupConflictError } from './folderBackup';
import { manifestParentIds } from './manifestHistory';
import { bytesFromBlob, createInMemoryDrive, type InMemoryDriveFixture, type StoredDriveFile } from './backupTestFixture';

const backupKey = 'property-limit-contract';
const xlsxMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const now = new Date('2026-10-18T04:00:00.000Z');
let testNow = now.getTime();

const driveId = (suffix: string) => `1${suffix.repeat(32)}`;

const createApi = (fixture: InMemoryDriveFixture) => new GoogleDriveApi({
  tokenProvider: { getAccessToken: vi.fn(async () => 'test-token') },
  fetchImpl: fixture.fetchImpl,
});

const createWorkspace = () => {
  const first = { ...createTable('第一表'), updatedAt: 1 };
  const shared = { ...createTable('共享表'), updatedAt: 1 };
  const firstNode = createNode('table', first.name, null, 0, first.id);
  const sharedNode = createNode('table', shared.name, null, 1, shared.id);
  const makeData = (firstName: string, updatedAt: number): WorkspaceData => ({
    version: 1,
    nodes: [{ ...firstNode, name: firstName }, sharedNode],
    tables: [{ ...first, name: firstName, updatedAt }, shared],
    activeNodeId: firstNode.id,
  });
  return { first, shared, firstNode, sharedNode, makeData };
};

const createBackup = (fixture: InMemoryDriveFixture) => createGoogleDriveFolderBackup({
  tokenProvider: { getAccessToken: vi.fn(async () => 'test-token') },
  folderPath: [],
  backupKey,
  retainedVersions: 3,
  fetchImpl: fixture.fetchImpl,
});

const manifestFiles = (fixture: InMemoryDriveFixture) => fixture.liveFiles().filter(file => file.appProperties?.backupKind === 'manifest');

const seedIndependentHeads = async (fixture: InMemoryDriveFixture, workspace: ReturnType<typeof createWorkspace>) => {
  const sharedTableDriveId = driveId('T');
  const sharedData = workspace.makeData('seed-shared', 1);
  fixture.addFile({
    id: sharedTableDriveId,
    name: '共享表.xlsx',
    mimeType: xlsxMimeType,
    parents: ['root'],
    appProperties: { backupKey, backupKind: 'table', localId: workspace.shared.id },
    body: await bytesFromBlob(await exportWorkspaceXlsx(sharedData, sharedData.tables[1])),
  });

  const headIds = [driveId('A'), driveId('B'), driveId('C')];
  for (const [index, headId] of headIds.entries()) {
    const version = index + 1;
    const data = workspace.makeData(`seed-${version}`, version);
    const firstTableDriveId = driveId(String.fromCharCode(68 + index));
    const firstTable = data.tables[0];
    fixture.addFile({
      id: firstTableDriveId,
      name: `${firstTable.name}.xlsx`,
      mimeType: xlsxMimeType,
      parents: ['root'],
      appProperties: { backupKey, backupKind: 'table', localId: workspace.first.id },
      body: await bytesFromBlob(await exportWorkspaceXlsx(data, firstTable)),
    });
    const refs = [
      { id: workspace.first.id, nodeId: workspace.firstNode.id, folderId: null, name: firstTable.name, updatedAt: firstTable.updatedAt, driveFileId: firstTableDriveId, fileName: `${firstTable.name}.xlsx` },
      { id: workspace.shared.id, nodeId: workspace.sharedNode.id, folderId: null, name: workspace.shared.name, updatedAt: workspace.shared.updatedAt, driveFileId: sharedTableDriveId, fileName: '共享表.xlsx' },
    ];
    fixture.addFile({
      id: headId,
      name: 'manifest.xlsx',
      mimeType: xlsxMimeType,
      parents: ['root'],
      createdTime: new Date(now.getTime() + index * 1000).toISOString(),
      modifiedTime: new Date(now.getTime() + index * 1000).toISOString(),
      appProperties: {
        backupKey,
        backupKind: 'manifest',
        backedUpAt: String(now.getTime() + index * 1000),
        sourceUpdatedAt: String(version),
        schemaVersion: '1',
        parentManifestIds: '[]',
      },
      body: await bytesFromBlob(exportWorkspaceBackupManifestXlsx(data, [], refs, version)),
    });
  }
  return { headIds, sharedTableDriveId };
};

const expectDriveBadRequest = async (operation: Promise<unknown>) => {
  await expect(operation).rejects.toBeInstanceOf(GoogleDriveApiError);
  await expect(operation).rejects.toMatchObject({ status: 400 });
};

beforeEach(() => {
  testNow = now.getTime();
  vi.spyOn(Date, 'now').mockImplementation(() => testNow);
});

afterEach(() => vi.restoreAllMocks());

describe('Google Drive appProperties limits', () => {
  it('counts UTF-8 bytes for the 124-byte key/value boundary', async () => {
    const fixture = createInMemoryDrive();
    const api = createApi(fixture);
    const exact = { ['k'.repeat(100)]: '你'.repeat(8) };
    const overflow = { ['k'.repeat(100)]: '你'.repeat(9) };

    await expect(api.uploadFile({ parentId: 'root', name: 'exact.xlsx', mimeType: xlsxMimeType, body: new Uint8Array(), appProperties: exact })).resolves.toMatchObject({ name: 'exact.xlsx' });
    expect(Object.keys(overflow)[0].length + Object.values(overflow)[0].length).toBeLessThan(124);
    await expectDriveBadRequest(api.uploadFile({ parentId: 'root', name: 'overflow.xlsx', mimeType: xlsxMimeType, body: new Uint8Array(), appProperties: overflow }));
    expect(fixture.liveFiles().map(file => file.name)).toEqual(['exact.xlsx']);
  });

  it('rejects more than thirty private properties before folder creation', async () => {
    const fixture = createInMemoryDrive();
    const api = createApi(fixture);
    const properties = Object.fromEntries(Array.from({ length: 31 }, (_, index) => [`key-${index}`, 'value']));

    await expectDriveBadRequest(api.createFolder('too-many-properties', 'root', properties));
    expect(fixture.liveFiles()).toHaveLength(0);
  });

  it('rejects oversized metadata updates without mutating the existing file', async () => {
    const fixture = createInMemoryDrive();
    const api = createApi(fixture);
    const file = fixture.addFile({ id: 'existing-file', name: 'existing.xlsx', mimeType: xlsxMimeType, parents: ['root'], appProperties: { safe: 'yes' } });
    const before: StoredDriveFile = { ...file, parents: [...(file.parents ?? [])], appProperties: { ...file.appProperties } };
    const overflow = { ['k'.repeat(100)]: '你'.repeat(9) };

    await expectDriveBadRequest(api.updateFileMetadata(file.id, { appProperties: overflow }));
    expect(fixture.get(file.id)).toEqual(before);
  });
});

describe('forked backup metadata contract', () => {
  it.each(['bytes', 'property-count'])('rejects invalid %s metadata before uploading table files', async limit => {
    const fixture = createInMemoryDrive();
    const workspace = createWorkspace();
    const properties = limit === 'bytes'
      ? { oversized: '字'.repeat(41) }
      : Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`extra-${index}`, 'value']));

    await expectDriveBadRequest(createBackup(fixture).backup(workspace.makeData('invalid', 1), { appProperties: properties }));

    expect(fixture.calls.uploads.filter(upload => upload.metadata.appProperties?.backupKind === 'table')).toHaveLength(0);
    expect(fixture.liveFiles()).toHaveLength(0);
  });

  it('rejects an expected-id backup on a true fork, then merges all parents and continues automatically', async () => {
    const fixture = createInMemoryDrive();
    const workspace = createWorkspace();
    const seeded = await seedIndependentHeads(fixture, workspace);
    const backup = createBackup(fixture);
    const current = await backup.findRemoteFile();
    expect(current?.id).toBe(seeded.headIds[2]);

    await expect(backup.backup(workspace.makeData('automatic-conflict', 4), { sourceUpdatedAt: 4 }, {
      expectedRemoteFileId: current?.id,
      expectedRemoteModifiedTime: current?.modifiedTime,
    })).rejects.toBeInstanceOf(RemoteBackupConflictError);

    testNow += 1000;
    const merged = await backup.backup(workspace.makeData('merged', 4), { sourceUpdatedAt: 4 }, {
      complete: false,
      tableIds: [workspace.first.id],
    });
    expect(manifestParentIds(merged.file)).toHaveLength(3);
    expect(manifestParentIds(merged.file)).toEqual(expect.arrayContaining(seeded.headIds));
    expect(merged.manifest.tables.find(table => table.id === workspace.shared.id)?.driveFileId).toBe(seeded.sharedTableDriveId);

    const retained = await backup.listRemoteBackups();
    expect(retained).toHaveLength(3);
    const restoredNames: string[] = [];
    for (const selected of retained) {
      const restored = await backup.restore(selected);
      restoredNames.push(restored.tables.find(table => table.id === workspace.first.id)?.name ?? '');
      expect(restored.tables.find(table => table.id === workspace.shared.id)).toBeDefined();
    }
    expect(restoredNames).toHaveLength(3);

    testNow += 1000;
    const mergedHead = await backup.findRemoteFile();
    await expect(backup.backup(workspace.makeData('next', 5), { sourceUpdatedAt: 5 }, {
      expectedRemoteFileId: mergedHead?.id,
      expectedRemoteModifiedTime: mergedHead?.modifiedTime,
      complete: false,
      tableIds: [workspace.first.id],
    })).resolves.toMatchObject({ cleanupWarning: undefined });
    expect(manifestFiles(fixture)).toHaveLength(3);
  });
});
