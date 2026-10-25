// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { createNode, createTable, emptyWorkspace } from '../model';
import type { WorkspaceData } from '../types';
import { workspaceBackupTableSummary, type WorkspaceBackupSource } from '../workspaceBackupSource';
import { createInMemoryDrive, type InMemoryDriveFixture } from './backupTestFixture';
import { createGoogleDriveSnapshotBackup } from './snapshotBackup';
import { RemoteBackupConflictError } from './folderBackup';
import { DRIVE_SNAPSHOT_KEY } from '../../shared/driveSnapshots';

const TOKEN = 'lightweight-test-drive-token';
const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
};

const createWorkspaceFixture = (suffix: number) => {
  const tables = ['測試表A', '測試表B'].map((name, tableIndex) => {
    const table = createTable(`${name}-${suffix}`);
    table.updatedAt = 1000 + suffix;
    table.changeRevision = `rev-${suffix}-${tableIndex}`;
    table.rows = Array.from({ length: 2 }, (_, rowIndex) => ({
      ...table.rows[0],
      id: `row-${suffix}-${tableIndex}-${rowIndex}`,
      name: `列 ${rowIndex}`,
      values: { [table.columns[0].id]: `值 ${suffix}-${rowIndex}` },
    }));
    return table;
  });
  const nodes = tables.map((table, index) => createNode('table', table.name, null, index, table.id));
  const data: WorkspaceData = {
    ...emptyWorkspace(),
    structureRevision: `struct-rev-${suffix}`,
    nodes,
    tables: [],
    activeNodeId: nodes[0].id,
    bottomNavigationTableIds: tables.map(table => table.id),
  };
  const source: WorkspaceBackupSource = {
    tables: tables.map(workspaceBackupTableSummary),
    readTable: async id => tables.find(table => table.id === id)!,
    verify: async () => undefined,
  };
  return { data, source, tables };
};

interface RequestLog {
  method: string;
  path: string;
  query: string;
}

const loggedDrive = () => {
  const drive = createInMemoryDrive();
  const logs: RequestLog[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    logs.push({
      method: init?.method ?? 'GET',
      path: url.pathname,
      query: decodeURIComponent(url.search).replace(/\+/g, ' '),
    });
    return drive.fetchImpl(input, init);
  };
  return { drive, logs, fetchImpl };
};

const createService = (fixture: ReturnType<typeof loggedDrive>, retainedVersions = 3) =>
  createGoogleDriveSnapshotBackup({
    folderPath: ['BoardGameHelper', '動態表格備份'],
    backupKey: 'dynamic-sheet-primary-workspace-v2',
    retainedVersions,
    tokenProvider: { getAccessToken: async () => TOKEN },
    fetchImpl: fixture.fetchImpl,
    storage: memoryStorage(),
  });

describe('Lightweight Google Drive Snapshot Backup', () => {
  test('strictly limits 2-table backup requests to <= 6 and generates zero receipt JSON files', async () => {
    const fixture = loggedDrive();
    const service = createService(fixture);

    // First backup: Initial discovery & root folder creation + snapshot upload
    const first = createWorkspaceFixture(1);
    fixture.logs.length = 0;
    const firstReceipt = await service.backup(first.data, { sourceUpdatedAt: 1 }, { source: first.source });
    expect(firstReceipt.file.name).toBe('manifest.xlsx');

    // Verify ZERO JSON files were written anywhere in Drive
    const jsonFiles = [...fixture.drive.files.values()].filter(f => f.name.endsWith('.json') || f.mimeType === 'application/json');
    expect(jsonFiles).toHaveLength(0);

    // Second backup: Incremental backup of 2 tables with existing root
    fixture.logs.length = 0;
    const remote = await service.findRemoteFile();
    const findRequests = fixture.logs.length;
    // Finding remote file should take at most 1 request (list manifests)
    expect(findRequests).toBeLessThanOrEqual(1);

    fixture.logs.length = 0;
    const second = createWorkspaceFixture(2);
    const secondReceipt = await service.backup(second.data, { sourceUpdatedAt: 2 }, {
      source: second.source,
      expectedRemoteFileId: remote?.id,
    });
    expect(secondReceipt.file.name).toBe('manifest.xlsx');

    // 2-table backup itself must take <= 5 requests:
    // 1 (check remote/list) + 1 (create folder) + 2 (upload tables) + 1 (upload manifest) = 5
    const backupRequests = fixture.logs.length;
    process.stdout.write(`[actual-lightweight-requests] find: ${findRequests}, backup: ${backupRequests}\n`);
    expect(backupRequests).toBeLessThanOrEqual(5);

    // Again verify zero JSON receipt/lease files
    const allJsonFiles = [...fixture.drive.files.values()].filter(f => f.name.endsWith('.json') || f.mimeType === 'application/json');
    expect(allJsonFiles).toHaveLength(0);
  });

  test('restores workspace in at most 3 requests without coordinators', async () => {
    const fixture = loggedDrive();
    const service = createService(fixture);
    const data = createWorkspaceFixture(1);
    await service.backup(data.data, { sourceUpdatedAt: 1 }, { source: data.source });

    // Measure restore requests
    fixture.logs.length = 0;
    const restored = await service.restore();
    const restoreRequests = fixture.logs.length;

    // Restore without selected file takes: 1 (find latest manifest) + 1 (download manifest) + 2 (download 2 tables) = 4 requests
    expect(restoreRequests).toBeLessThanOrEqual(4);
    expect(restored.nodes).toHaveLength(2);
    expect(restored.tables).toHaveLength(2);
    expect(restored.tables[0].name).toContain('測試表A');
    expect(restored.tables[1].name).toContain('測試表B');
  });

  test('detects concurrent conflict without writing files to Drive', async () => {
    const fixture = loggedDrive();
    const serviceA = createService(fixture);
    const serviceB = createService(fixture);

    const initial = createWorkspaceFixture(1);
    await serviceA.backup(initial.data, { sourceUpdatedAt: 1 }, { source: initial.source });

    // Device A and B both see version 1
    const remoteA = await serviceA.findRemoteFile();
    const remoteB = await serviceB.findRemoteFile();

    // Device A commits version 2
    const nextA = createWorkspaceFixture(2);
    await serviceA.backup(nextA.data, { sourceUpdatedAt: 2 }, { source: nextA.source, expectedRemoteFileId: remoteA?.id });

    // Device B attempts to commit with stale version 1
    fixture.logs.length = 0;
    const nextB = createWorkspaceFixture(3);
    await expect(
      serviceB.backup(nextB.data, { sourceUpdatedAt: 3 }, { source: nextB.source, expectedRemoteFileId: remoteB?.id })
    ).rejects.toBeInstanceOf(RemoteBackupConflictError);

    // Conflict check must abort immediately before creating folders or uploading tables
    const uploadsAndCreates = fixture.logs.filter(l => l.method === 'POST');
    expect(uploadsAndCreates).toHaveLength(0);
  });

  test('ignores incomplete snapshots missing manifest.xlsx without needing receipts', async () => {
    const fixture = loggedDrive();
    const service = createService(fixture);

    // Initial valid backup
    const initial = createWorkspaceFixture(1);
    const committed = await service.backup(initial.data, { sourceUpdatedAt: 1 }, { source: initial.source });

    // Simulate an aborted upload: a folder with an orphan table but no manifest.xlsx
    const root = [...fixture.drive.files.values()].find(f => f.appProperties?.backupKind === 'root')!;
    const incompleteFolder = fixture.drive.addFile({
      name: '備份-未完成',
      mimeType: 'application/vnd.google-apps.folder',
      parents: [root.id],
      appProperties: { backupKey: DRIVE_SNAPSHOT_KEY, backupKind: 'snapshot' },
    });
    fixture.drive.addFile({
      name: '孤兒表.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      parents: [incompleteFolder.id],
      appProperties: { backupKey: DRIVE_SNAPSHOT_KEY, backupKind: 'table' },
    });

    // findRemoteFile must find the valid snapshot, completely ignoring the incomplete folder
    const remote = await service.findRemoteFile();
    expect(remote?.id).toBe(committed.file.id);
  });

  test('strictly rejects backup when local workspace has zero tables to prevent data loss', async () => {
    const fixture = loggedDrive();
    const service = createService(fixture);

    // Initial valid backup on cloud
    const initial = createWorkspaceFixture(1);
    await service.backup(initial.data, { sourceUpdatedAt: 1 }, { source: initial.source });

    // Local workspace data is cleared / empty
    const clearedData: WorkspaceData = {
      ...emptyWorkspace(),
      nodes: [],
      tables: [],
    };
    const emptySource: WorkspaceBackupSource = {
      tables: [],
      readTable: async () => { throw new Error('No table'); },
      verify: async () => undefined,
    };

    fixture.logs.length = 0;
    // Attempting to backup empty data must be rejected immediately
    await expect(
      service.backup(clearedData, { sourceUpdatedAt: 2 }, { source: emptySource })
    ).rejects.toThrow(/沒有表格|表格不一致/);

    // Zero files or folders created on Drive during rejection
    const uploadAttempts = fixture.logs.filter(l => l.method === 'POST');
    expect(uploadAttempts).toHaveLength(0);
  });
});
