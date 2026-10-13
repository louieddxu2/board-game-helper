import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNode, createTable } from '../model';
import { exportWorkspaceXlsx } from '../spreadsheet';
import type { WorkspaceData } from '../types';
import { createGoogleDriveFolderBackup } from './folderBackup';
import { bytesFromBlob, createInMemoryDrive, type InMemoryDriveFixture } from './backupTestFixture';

const backupKey = 'restore-contract';
const now = new Date('2026-10-13T12:00:00.000Z');
let testNow = now.getTime();

const createWorkspace = () => {
  const first = { ...createTable('舊版本'), updatedAt: 1 };
  const second = { ...createTable('共享表'), updatedAt: 1 };
  const firstNode = createNode('table', first.name, null, 0, first.id);
  const secondNode = createNode('table', second.name, null, 1, second.id);
  const makeData = (firstName: string, updatedAt: number): WorkspaceData => ({
    version: 1,
    nodes: [{ ...firstNode, name: firstName }, secondNode],
    tables: [{ ...first, name: firstName, updatedAt }, second],
    activeNodeId: firstNode.id,
  });
  return { first, second, makeData };
};

const createBackup = (fixture: InMemoryDriveFixture) => createGoogleDriveFolderBackup({
  tokenProvider: { getAccessToken: vi.fn(async () => 'test-token') },
  folderPath: [],
  backupKey,
  retainedVersions: 3,
  fetchImpl: fixture.fetchImpl,
});

beforeEach(() => {
  testNow = now.getTime();
  vi.spyOn(Date, 'now').mockImplementation(() => testNow);
});

afterEach(() => vi.restoreAllMocks());

describe('folder backup restore contract', () => {
  it('restores an explicitly selected older version instead of the newest head', async () => {
    const fixture = createInMemoryDrive();
    const backup = createBackup(fixture);
    const workspace = createWorkspace();
    await backup.backup(workspace.makeData('舊版本', 1), { sourceUpdatedAt: 1 });
    testNow += 1000;
    await backup.backup(workspace.makeData('最新版本', 2), { sourceUpdatedAt: 2 });

    const versions = await backup.listRemoteBackups();
    expect(versions).toHaveLength(2);
    expect(await backup.restore()).toMatchObject({ tables: expect.arrayContaining([expect.objectContaining({ name: '最新版本' })]) });
    expect(await backup.restore(versions[1])).toMatchObject({ tables: expect.arrayContaining([expect.objectContaining({ name: '舊版本' })]) });
  });

  it('rejects selected metadata that changed after listing without downloading a manifest', async () => {
    const fixture = createInMemoryDrive();
    const backup = createBackup(fixture);
    const workspace = createWorkspace();
    await backup.backup(workspace.makeData('舊版本', 1), { sourceUpdatedAt: 1 });
    testNow += 1000;
    await backup.backup(workspace.makeData('最新版本', 2), { sourceUpdatedAt: 2 });
    const selected = (await backup.listRemoteBackups())[1];
    const downloadsBefore = fixture.calls.downloads.length;

    await expect(backup.restore({ ...selected, modifiedTime: '2026-10-13T12:00:99.000Z' })).rejects.toThrow('所選備份已有變更');
    expect(fixture.calls.downloads).toHaveLength(downloadsBefore);
  });

  it('rejects a table payload whose embedded ID differs from the selected manifest without returning partial data', async () => {
    const fixture = createInMemoryDrive();
    const backup = createBackup(fixture);
    const workspace = createWorkspace();
    await backup.backup(workspace.makeData('舊版本', 1), { sourceUpdatedAt: 1 });
    testNow += 1000;
    const receipt = await backup.backup(workspace.makeData('最新版本', 2), { sourceUpdatedAt: 2 });
    const selected = (await backup.listRemoteBackups())[0];
    const tableRef = receipt.manifest.tables.find(table => table.id === workspace.first.id);
    expect(tableRef).toBeDefined();

    const mismatched = { ...workspace.first, id: 'table-from-another-backup', name: '錯誤表格' };
    const mismatchedBody = await exportWorkspaceXlsx(workspace.makeData('最新版本', 2), mismatched);
    fixture.setBody(tableRef!.driveFileId, await bytesFromBlob(mismatchedBody));

    await expect(backup.restore(selected)).rejects.toThrow('格式或識別不一致');
  });
});
