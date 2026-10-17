import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNode, createTable } from '../model';
import type { WorkspaceData } from '../types';
import { createGoogleDriveFolderBackup } from './folderBackup';
import { DRIVE_PARENT_MANIFEST_IDS_PROPERTY } from './manifestHistory';
import { createInMemoryDrive, type InMemoryDriveFixture } from './backupTestFixture';

const backupKey = 'legacy-retention-contract';
const now = new Date('2026-10-17T12:00:00.000Z');
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

const createBackup = (fixture: InMemoryDriveFixture, retainedVersions?: number) => createGoogleDriveFolderBackup({
  tokenProvider: { getAccessToken: vi.fn(async () => 'test-token') },
  folderPath: [],
  backupKey,
  ...(retainedVersions === undefined ? {} : { retainedVersions }),
  fetchImpl: fixture.fetchImpl,
});

const manifests = (fixture: InMemoryDriveFixture) => fixture.liveFiles().filter(file => file.appProperties?.backupKind === 'manifest');
const tables = (fixture: InMemoryDriveFixture) => fixture.liveFiles().filter(file => file.appProperties?.backupKind === 'table');
const currentManifestProperties = new Set([
  'backupKey',
  'backupKind',
  'backedUpAt',
  'sourceUpdatedAt',
  'schemaVersion',
  DRIVE_PARENT_MANIFEST_IDS_PROPERTY,
]);
const stripFutureLegacyMetadata = (manifest: ReturnType<typeof manifests>[number]) => {
  for (const key of Object.keys(manifest.appProperties ?? {})) {
    if (!currentManifestProperties.has(key)) delete manifest.appProperties![key];
  }
};

const seedMixedHistory = async (fixture: InMemoryDriveFixture, workspace: ReturnType<typeof createWorkspace>) => {
  const seed = createBackup(fixture);
  for (let version = 1; version <= 3; version += 1) {
    await seed.backup(workspace.makeData(`legacy-${version}`, version), { sourceUpdatedAt: version });
    const manifest = manifests(fixture).find(file => file.appProperties?.sourceUpdatedAt === String(version));
    expect(manifest).toBeDefined();
    stripFutureLegacyMetadata(manifest!);
    delete manifest!.appProperties?.[DRIVE_PARENT_MANIFEST_IDS_PROPERTY];
    testNow += 1000;
  }
  const unbounded = createBackup(fixture);
  for (let version = 4; version <= 6; version += 1) {
    await unbounded.backup(workspace.makeData(`versioned-${version}`, version), { sourceUpdatedAt: version }, {
      complete: false,
      tableIds: [workspace.first.id],
    });
    const manifest = manifests(fixture).find(file => file.appProperties?.sourceUpdatedAt === String(version));
    expect(manifest).toBeDefined();
    stripFutureLegacyMetadata(manifest!);
    testNow += 1000;
  }
};

beforeEach(() => {
  testNow = now.getTime();
  vi.spyOn(Date, 'now').mockImplementation(() => testNow);
});

afterEach(() => vi.restoreAllMocks());

describe('legacy manifest retention compatibility', () => {
  it.each([false, true])('keeps a single versioned ancestry when Drive returns files in %s order', async reverse => {
    let reverseListing = false;
    const fixture = createInMemoryDrive({
      onList: (query, files) => {
        if (reverseListing && query.includes("key='backupKey'")) files.reverse();
      },
    });
    const workspace = createWorkspace();
    await seedMixedHistory(fixture, workspace);
    expect(manifests(fixture)).toHaveLength(6);

    reverseListing = reverse;
    const cleanup = createBackup(fixture, 3);
    const receipt = await cleanup.backup(workspace.makeData('versioned-7', 7), { sourceUpdatedAt: 7 }, {
      complete: false,
      tableIds: [workspace.first.id],
    });

    expect(receipt.cleanupWarning).toBeUndefined();
    expect(manifests(fixture)).toHaveLength(3);
    const retained = await cleanup.listRemoteBackups();
    expect(retained).toHaveLength(3);
    expect(retained.map(file => file.appProperties?.sourceUpdatedAt)).toEqual(['7', '6', '5']);
    expect(tables(fixture).filter(file => file.appProperties?.localId === workspace.second.id)).toHaveLength(1);

    const restoredNames: string[] = [];
    for (const selected of retained) {
      const restored = await cleanup.restore(selected);
      restoredNames.push(restored.tables.find(table => table.id === workspace.first.id)?.name ?? '');
      expect(restored.tables.find(table => table.id === workspace.second.id)?.name).toBe('共享表');
    }
    expect(restoredNames).toEqual(['versioned-7', 'versioned-6', 'versioned-5']);

    const head = await cleanup.findRemoteFile();
    expect(head?.appProperties?.backupForkCount).toBe('1');
    await expect(cleanup.backup(workspace.makeData('versioned-8', 8), { sourceUpdatedAt: 8 }, {
      expectedRemoteFileId: head?.id,
      expectedRemoteModifiedTime: head?.modifiedTime,
      complete: false,
      tableIds: [workspace.first.id],
    })).resolves.toMatchObject({ cleanupWarning: undefined });
  });

  it.each([false, true])('does not expose an older legacy root after its versioned child is partially cleaned (%s order)', async reverse => {
    let reverseListing = false;
    const fixture = createInMemoryDrive({
      onList: (query, files) => {
        if (reverseListing && query.includes("key='backupKey'")) files.reverse();
      },
    });
    const workspace = createWorkspace();
    await seedMixedHistory(fixture, workspace);
    const versioned = manifests(fixture).find(file => file.appProperties?.sourceUpdatedAt === '4');
    const parentId = JSON.parse(versioned!.appProperties?.[DRIVE_PARENT_MANIFEST_IDS_PROPERTY] ?? '[]')[0] as string;
    const parent = fixture.get(parentId);
    expect(parent).toBeDefined();
    parent!.modifiedTime = new Date(testNow).toISOString();
    parent!.trashed = true;
    reverseListing = reverse;

    const backup = createBackup(fixture, 3);
    const head = await backup.findRemoteFile();
    expect(head?.appProperties?.backupForkCount).toBe('1');
    await expect(backup.backup(workspace.makeData('versioned-7', 7), { sourceUpdatedAt: 7 }, {
      expectedRemoteFileId: head?.id,
      expectedRemoteModifiedTime: head?.modifiedTime,
      complete: false,
      tableIds: [workspace.first.id],
    })).resolves.toMatchObject({ cleanupWarning: undefined });
  });

  it.each(['new-index', 'changed-ancestry', 'removed-index', 'active-operation'])('stops mid-cleanup for a real %s change', async change => {
    let armed = false;
    let changed = false;
    const fixture = createInMemoryDrive({
      onList: (query, files) => {
        if (!armed || changed || !query.includes("key='backupKey'") || query.includes(' in parents') || query.includes('mimeType')) return;
        if (!fixture.calls.trash.some(id => fixture.get(id)?.appProperties?.backupKind === 'manifest')) return;
        changed = true;
        if (change === 'new-index') {
          files.push(fixture.addFile({ id: 'competitor', name: 'manifest.xlsx', parents: ['root'],
            appProperties: { backupKey, backupKind: 'manifest', parentManifestIds: '[]' } }));
        } else if (change === 'active-operation') {
          files.push(fixture.addFile({ id: 'other-operation', name: '備份作業.json', parents: ['root'],
            appProperties: { backupKey, backupKind: 'operation' } }));
        } else {
          const target = files.find(file => file.appProperties?.sourceUpdatedAt === '5')!;
          if (change === 'changed-ancestry') target.appProperties!.parentManifestIds = '["another-parent"]';
          else { target.trashed = true; files.splice(files.indexOf(target), 1); }
        }
      },
    });
    const workspace = createWorkspace();
    await seedMixedHistory(fixture, workspace);
    const originalTables = tables(fixture).map(file => file.id);
    armed = true;

    const receipt = await createBackup(fixture, 3).backup(workspace.makeData('versioned-7', 7), { sourceUpdatedAt: 7 });

    expect(changed).toBe(true);
    expect(receipt.cleanupWarning).toContain('雲端作業已有變更');
    expect(fixture.calls.trash.filter(id => fixture.get(id)?.appProperties?.backupKind === 'manifest')).toHaveLength(1);
    expect(originalTables.every(id => !fixture.get(id)?.trashed)).toBe(true);
    expect(fixture.get(receipt.file.id)?.trashed).not.toBe(true);
  });
});
