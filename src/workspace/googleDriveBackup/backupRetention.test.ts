import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNode, createTable } from '../model';
import type { WorkspaceData } from '../types';
import { createGoogleDriveFolderBackup, RemoteBackupConflictError } from './folderBackup';
import { DRIVE_OPERATION_KIND } from './backupOperation';
import { createInMemoryDrive, type InMemoryDriveFixture } from './backupTestFixture';

const backupKey = 'retention-contract';
const xlsxMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const now = new Date('2026-10-13T10:00:00.000Z');
let testNow = now.getTime();

const createWorkspace = () => {
  const first = { ...createTable('第一表'), updatedAt: 1 };
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

const createBackup = (fixture: InMemoryDriveFixture, retainedVersions = 3) => createGoogleDriveFolderBackup({
  tokenProvider: { getAccessToken: vi.fn(async () => 'test-token') },
  folderPath: [],
  backupKey,
  retainedVersions,
  fetchImpl: fixture.fetchImpl,
});

const manifests = (fixture: InMemoryDriveFixture) => fixture.liveFiles().filter(file => file.appProperties?.backupKind === 'manifest');
const tables = (fixture: InMemoryDriveFixture) => fixture.liveFiles().filter(file => file.appProperties?.backupKind === 'table');
const manifestLists = (query: string) => query.includes(`mimeType = '${xlsxMimeType}'`);

beforeEach(() => {
  testNow = now.getTime();
  vi.spyOn(Date, 'now').mockImplementation(() => testNow);
});

afterEach(() => vi.restoreAllMocks());

describe('folder backup retention contract', () => {
  it('bounds successful snapshots to the retained ancestry and restores every retained snapshot with shared tables', async () => {
    const fixture = createInMemoryDrive();
    const backup = createBackup(fixture, 3);
    const workspace = createWorkspace();

    await backup.backup(workspace.makeData('snapshot-1', 1), { sourceUpdatedAt: 1 });
    for (let version = 2; version <= 5; version += 1) {
      testNow += 1000;
      await backup.backup(workspace.makeData(`snapshot-${version}`, version), { sourceUpdatedAt: version }, {
        complete: false,
        tableIds: [workspace.first.id],
      });
    }

    const retained = await backup.listRemoteBackups();
    expect(retained).toHaveLength(3);
    expect(retained.map(file => file.appProperties?.sourceUpdatedAt)).toEqual(['5', '4', '3']);
    expect(manifests(fixture)).toHaveLength(3);
    expect(tables(fixture).filter(file => file.appProperties?.localId === workspace.second.id)).toHaveLength(1);

    const restoredNames = [] as string[];
    for (const selected of retained) {
      const restored = await backup.restore(selected);
      restoredNames.push(restored.tables.find(table => table.id === workspace.first.id)?.name ?? '');
      expect(restored.tables.find(table => table.id === workspace.second.id)?.name).toBe('共享表');
    }
    expect(restoredNames).toEqual(['snapshot-5', 'snapshot-4', 'snapshot-3']);
  });

  it.each(['table', 'manifest'] as const)('does not clean history when the %s upload fails', async failure => {
    let fail = false;
    const fixture = createInMemoryDrive({
      shouldFailUpload: request => {
        if (!fail) return undefined;
        if (failure === 'table' && request.metadata.appProperties?.backupKind === 'table') {
          fail = false;
          return 'table upload failed';
        }
        if (failure === 'manifest' && request.metadata.appProperties?.backupKind === 'manifest') {
          fail = false;
          return 'manifest upload failed';
        }
        return undefined;
      },
    });
    const backup = createBackup(fixture, 3);
    const workspace = createWorkspace();
    await backup.backup(workspace.makeData('before-failure', 1), { sourceUpdatedAt: 1 });
    const previous = (await backup.findRemoteFile())!;
    const previousTableIds = new Set(tables(fixture).map(file => file.id));
    fail = true;

    await expect(backup.backup(workspace.makeData('failed-upload', 2), { sourceUpdatedAt: 2 })).rejects.toThrow(`${failure} upload failed`);

    expect(fixture.get(previous.id)?.trashed).not.toBe(true);
    expect((await backup.findRemoteFile())?.id).toBe(previous.id);
    if (failure === 'manifest') {
      const orphan = tables(fixture).find(file => !previousTableIds.has(file.id));
      expect(orphan).toBeDefined();
      expect(orphan?.trashed).not.toBe(true);
    }
  });

  it('removes an orphaned table only after a later committed backup', async () => {
    let failManifest = false;
    const fixture = createInMemoryDrive({
      shouldFailUpload: request => {
        if (failManifest && request.metadata.appProperties?.backupKind === 'manifest') {
          failManifest = false;
          return 'manifest upload failed';
        }
        return undefined;
      },
    });
    const backup = createBackup(fixture, 3);
    const workspace = createWorkspace();
    await backup.backup(workspace.makeData('stable', 1), { sourceUpdatedAt: 1 });
    const before = new Set(tables(fixture).map(file => file.id));
    failManifest = true;
    await expect(backup.backup(workspace.makeData('failed', 2), { sourceUpdatedAt: 2 })).rejects.toThrow('manifest upload failed');

    const orphan = tables(fixture).find(file => !before.has(file.id));
    expect(orphan).toBeDefined();
    expect(orphan?.trashed).not.toBe(true);
    expect(manifests(fixture)).toHaveLength(1);

    await backup.backup(workspace.makeData('committed', 3), { sourceUpdatedAt: 3 });
    expect(fixture.get(orphan!.id)?.trashed).toBe(true);
    expect((await backup.findRemoteFile())?.appProperties?.sourceUpdatedAt).toBe('3');
    await expect(backup.restore()).resolves.toMatchObject({ tables: expect.arrayContaining([expect.objectContaining({ name: 'committed' })]) });
  });

  it('defers cleanup while another operation marker is active and retries on a later backup', async () => {
    const fixture = createInMemoryDrive();
    const backup = createBackup(fixture, 1);
    const workspace = createWorkspace();
    await backup.backup(workspace.makeData('first', 1), { sourceUpdatedAt: 1 });
    const previous = (await backup.findRemoteFile())!;
    const active = fixture.addFile({
      id: 'operation-active',
      name: '備份作業.json',
      mimeType: 'application/json',
      parents: [previous.parents?.[0] ?? 'root'],
      appProperties: { backupKey, backupKind: DRIVE_OPERATION_KIND },
      createdTime: new Date(now.getTime()).toISOString(),
      modifiedTime: new Date(now.getTime()).toISOString(),
    });

    const deferred = await backup.backup(workspace.makeData('second', 2), { sourceUpdatedAt: 2 });
    expect(deferred.cleanupWarning).toContain('另一個備份');
    expect(fixture.get(previous.id)?.trashed).not.toBe(true);
    expect(fixture.get(active.id)?.trashed).not.toBe(true);

    active.trashed = true;
    const retried = await backup.backup(workspace.makeData('third', 3), { sourceUpdatedAt: 3 });
    expect(retried.cleanupWarning).toBeUndefined();
    expect(fixture.get(previous.id)?.trashed).toBe(true);
  });

  it('cleans expired operation markers while allowing a successful snapshot to commit', async () => {
    const fixture = createInMemoryDrive();
    const backup = createBackup(fixture, 1);
    const workspace = createWorkspace();
    await backup.backup(workspace.makeData('first', 1), { sourceUpdatedAt: 1 });
    const previous = (await backup.findRemoteFile())!;
    const expired = fixture.addFile({
      id: 'operation-expired',
      name: '備份作業.json',
      mimeType: 'application/json',
      parents: [previous.parents?.[0] ?? 'root'],
      appProperties: { backupKey, backupKind: DRIVE_OPERATION_KIND },
      createdTime: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
      modifiedTime: new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    });

    const receipt = await backup.backup(workspace.makeData('second', 2), { sourceUpdatedAt: 2 });
    expect(receipt.cleanupWarning).toBeUndefined();
    expect(fixture.get(expired.id)?.trashed).toBe(true);
    expect(fixture.get(previous.id)?.trashed).toBe(true);
  });

  it('aborts an operation whose marker is already expired and trashes that marker', async () => {
    const fixture = createInMemoryDrive({
      onUpload: file => {
        if (file.appProperties?.backupKind === DRIVE_OPERATION_KIND) {
          file.createdTime = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
        }
      },
    });
    const backup = createBackup(fixture, 3);
    const workspace = createWorkspace();

    await expect(backup.backup(workspace.makeData('expired', 1), { sourceUpdatedAt: 1 })).rejects.toThrow('備份作業已逾時');
    const operation = [...fixture.files.values()].find(file => file.appProperties?.backupKind === DRIVE_OPERATION_KIND);
    expect(operation).toBeDefined();
    expect(operation?.trashed).toBe(true);
    expect(manifests(fixture)).toHaveLength(0);
  });

  it('returns a cleanup warning while keeping the committed head usable, then retries cleanup', async () => {
    let failId: string | undefined;
    const fixture = createInMemoryDrive({
      shouldFailTrash: file => {
        if (file.id !== failId) return undefined;
        failId = undefined;
        return 'cleanup failed';
      },
    });
    const backup = createBackup(fixture, 1);
    const workspace = createWorkspace();
    await backup.backup(workspace.makeData('first', 1), { sourceUpdatedAt: 1 });
    const oldHead = (await backup.findRemoteFile())!;
    failId = oldHead.id;

    const receipt = await backup.backup(workspace.makeData('second', 2), { sourceUpdatedAt: 2 });
    expect(receipt.cleanupWarning).toContain('清理失敗');
    expect(fixture.get(oldHead.id)?.trashed).not.toBe(true);
    await expect(backup.restore()).resolves.toMatchObject({ tables: expect.arrayContaining([expect.objectContaining({ name: 'second' })]) });

    await backup.backup(workspace.makeData('third', 3), { sourceUpdatedAt: 3 });
    expect(fixture.get(oldHead.id)?.trashed).toBe(true);
  });

  it('defers cleanup when a retained manifest metadata record changes during cleanup', async () => {
    let ownedListCount = 0;
    let mutateDuringSecondCleanup = false;
    let mutated = false;
    const fixture = createInMemoryDrive({
      onList: (query, files) => {
        if (!query.includes("key='backupKey'") || query.includes(' in parents') || query.includes('mimeType')) return;
        ownedListCount += 1;
        if (!mutateDuringSecondCleanup || mutated || ownedListCount !== 4) return;
        const retained = files
          .filter(file => file.appProperties?.backupKind === 'manifest')
          .sort((left, right) => Number(right.appProperties?.backedUpAt ?? 0) - Number(left.appProperties?.backedUpAt ?? 0))[0];
        if (!retained) throw new Error('missing retained manifest in cleanup fixture');
        retained.modifiedTime = new Date(testNow + 1000).toISOString();
        mutated = true;
      },
    });
    const backup = createBackup(fixture, 1);
    const workspace = createWorkspace();
    await backup.backup(workspace.makeData('first', 1), { sourceUpdatedAt: 1 });
    const oldHead = (await backup.findRemoteFile())!;
    mutateDuringSecondCleanup = true;
    testNow += 1000;

    const receipt = await backup.backup(workspace.makeData('second', 2), { sourceUpdatedAt: 2 });
    expect(mutated).toBe(true);
    expect(receipt.cleanupWarning).toContain('暫緩舊版本清理');
    expect(fixture.get(oldHead.id)?.trashed).not.toBe(true);
  });

  it('does not trash or wait for same-key files and operations below a different Drive root', async () => {
    const fixture = createInMemoryDrive();
    const backup = createBackup(fixture, 1);
    const workspace = createWorkspace();
    const foreignFolder = fixture.addFile({
      id: 'foreign-folder',
      name: 'Other Root Folder',
      mimeType: 'application/vnd.google-apps.folder',
      parents: ['other-root'],
      appProperties: { backupKey, backupKind: 'folder', localId: 'foreign-folder-local' },
    });
    const foreignTable = fixture.addFile({
      id: 'foreign-table',
      name: 'Other Root Table.xlsx',
      mimeType: xlsxMimeType,
      parents: [foreignFolder.id],
      appProperties: { backupKey, backupKind: 'table', localId: 'foreign-table-local' },
      body: new Uint8Array([1, 2, 3]),
    });
    const foreignOperations = ['active', 'expired'].map((kind, index) => fixture.addFile({
      id: `foreign-operation-${kind}`, name: '備份作業.json', mimeType: 'application/json', parents: ['other-root'],
      createdTime: new Date(testNow - index * 2 * 60 * 60 * 1000).toISOString(),
      appProperties: { backupKey, backupKind: DRIVE_OPERATION_KIND },
    }));

    await backup.backup(workspace.makeData('first', 1), { sourceUpdatedAt: 1 });
    const oldHead = (await backup.findRemoteFile())!;
    testNow += 1000;
    const receipt = await backup.backup(workspace.makeData('second', 2), { sourceUpdatedAt: 2 });

    expect(receipt.cleanupWarning).toBeUndefined();
    expect(fixture.get(oldHead.id)?.trashed).toBe(true);
    expect(fixture.get(foreignFolder.id)?.trashed).not.toBe(true);
    expect(fixture.get(foreignTable.id)?.trashed).not.toBe(true);
    for (const operation of foreignOperations) expect(fixture.get(operation.id)?.trashed).not.toBe(true);
  });

  it('detects a newer head during the precommit check', async () => {
    let manifestListCount = 0;
    const fixture = createInMemoryDrive({
      onList: (_query, files) => {
        if (!manifestLists(_query)) return;
        manifestListCount += 1;
        if (manifestListCount !== 2) return;
        const competitor = fixture.addFile({
          id: 'competitor-precommit',
          name: 'manifest.xlsx',
          mimeType: xlsxMimeType,
          parents: ['root'],
          appProperties: { backupKey, backupKind: 'manifest', backedUpAt: '999', parentManifestIds: '[]' },
        });
        files.push(competitor);
      },
    });
    const backup = createBackup(fixture, 3);
    const workspace = createWorkspace();

    await expect(backup.backup(workspace.makeData('precommit-race', 1), { sourceUpdatedAt: 1 })).rejects.toBeInstanceOf(RemoteBackupConflictError);
    expect(manifests(fixture).map(file => file.id)).toEqual(['competitor-precommit']);
  });

  it('detects a competing head during final confirmation after publishing the manifest', async () => {
    let manifestListCount = 0;
    const fixture = createInMemoryDrive({
      onList: (_query, files) => {
        if (!manifestLists(_query)) return;
        manifestListCount += 1;
        if (manifestListCount !== 3) return;
        const competitor = fixture.addFile({
          id: 'competitor-final',
          name: 'manifest.xlsx',
          mimeType: xlsxMimeType,
          parents: ['root'],
          appProperties: { backupKey, backupKind: 'manifest', backedUpAt: '999', parentManifestIds: '[]' },
        });
        files.push(competitor);
      },
    });
    const backup = createBackup(fixture, 3);
    const workspace = createWorkspace();

    await expect(backup.backup(workspace.makeData('final-race', 1), { sourceUpdatedAt: 1 })).rejects.toBeInstanceOf(RemoteBackupConflictError);
    expect(manifests(fixture).map(file => file.id)).toEqual(expect.arrayContaining(['competitor-final']));
    expect(manifests(fixture)).toHaveLength(2);
  });
});
