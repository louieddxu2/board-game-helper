// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { createNode, createTable, emptyWorkspace } from '../model';
import type { WorkspaceData } from '../types';
import { workspaceBackupTableSummary, type WorkspaceBackupSource } from '../workspaceBackupSource';
import { createInMemoryDrive, type InMemoryDriveFixture } from './backupTestFixture';
import { createGoogleDriveSnapshotBackup } from './snapshotBackup';
import { RemoteBackupConflictError } from './folderBackup';
import { DRIVE_SNAPSHOT_KEY } from '../../shared/driveSnapshots';
import { exportWorkspaceBackupManifestXlsx, exportWorkspaceXlsxAsync } from '../spreadsheet';
import { blobBytes } from '../spreadsheetCodec';

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
  test('uses exactly five API calls for a warm two-table backup and creates no cloud coordination files', async () => {
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

    // Second complete backup with an existing root; connection discovery is counted separately.
    fixture.logs.length = 0;
    const remote = await service.findRemoteFile();
    const findRequests = fixture.logs.length;

    fixture.logs.length = 0;
    const second = createWorkspaceFixture(2);
    const secondReceipt = await service.backup(second.data, { sourceUpdatedAt: 2 }, {
      source: second.source,
      expectedRemoteFileId: remote?.id,
    });
    expect(secondReceipt.file.name).toBe('manifest.xlsx');

    // One discovery, one new folder, two table uploads, and the final manifest upload.
    const backupRequests = fixture.logs.length;
    process.stdout.write(`[actual-lightweight-requests] find: ${findRequests}, backup: ${backupRequests}\n`);
    expect(backupRequests).toBe(5);
    expect(findRequests).toBe(1);

    // Again verify zero JSON receipt/lease files
    const allJsonFiles = [...fixture.drive.files.values()].filter(f => f.name.endsWith('.json') || f.mimeType === 'application/json');
    expect(allJsonFiles).toHaveLength(0);
  });

  test('restores two tables with one manifest lookup and three XLSX downloads', async () => {
    const fixture = loggedDrive();
    const service = createService(fixture);
    const data = createWorkspaceFixture(1);
    await service.backup(data.data, { sourceUpdatedAt: 1 }, { source: data.source });

    // Measure restore requests
    fixture.logs.length = 0;
    const restored = await service.restore();
    const restoreRequests = fixture.logs.length;

    expect(restoreRequests).toBe(4);
    expect(restored.nodes).toHaveLength(2);
    expect(restored.tables).toHaveLength(2);
    expect(restored.tables[0].name).toContain('測試表A');
    expect(restored.tables[1].name).toContain('測試表B');
  });

  test('rejects a stale remote version before creating or uploading files', async () => {
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
      id: 'incomplete-folder-1',
      name: '備份-未完成',
      mimeType: 'application/vnd.google-apps.folder',
      parents: [root.id],
      appProperties: { backupKey: DRIVE_SNAPSHOT_KEY, backupKind: 'snapshot' },
      trashed: false,
    });
    fixture.drive.addFile({
      id: 'orphan-table-1',
      name: '孤兒表.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      parents: [incompleteFolder.id],
      appProperties: { backupKey: DRIVE_SNAPSHOT_KEY, backupKind: 'table' },
      trashed: false,
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

  test('keeps three versions and retires one obsolete backup folder with one delete request', async () => {
    const fixture = loggedDrive(); const service = createService(fixture);
    const first = createWorkspaceFixture(1);
    const oldest = await service.backup(first.data, {}, { source: first.source });
    const folder = oldest.file.parents![0];
    fixture.drive.addFile({ id: 'manual-extra', name: '手動放入.txt', parents: [folder], mimeType: 'text/plain', visibleToApp: false });
    for (const suffix of [2, 3]) {
      const next = createWorkspaceFixture(suffix);
      await service.backup(next.data, {}, { source: next.source }); await service.maintain?.();
    }
    await service.maintain?.();
    expect(fixture.drive.liveFiles().filter(file => file.appProperties?.backupKind === 'manifest')).toHaveLength(3);
    fixture.logs.length = 0;
    const remote = await service.findRemoteFile();
    const next = createWorkspaceFixture(4);
    await service.backup(next.data, {}, { source: next.source, expectedRemoteFileId: remote?.id });
    await service.maintain?.();
    expect(fixture.drive.liveFiles().filter(file => file.appProperties?.backupKind === 'manifest')).toHaveLength(3);
    expect(fixture.drive.liveFiles().some(file => file.id === oldest.file.id)).toBe(false);
    expect(fixture.drive.get(folder)?.trashed).toBe(true);
    expect(fixture.drive.liveFiles().some(file => file.id === 'manual-extra')).toBe(false);
    expect(fixture.logs.filter(log => log.method === 'PATCH')).toEqual([
      expect.objectContaining({ path: `/drive/v3/files/${folder}` }),
    ]);
    expect(fixture.drive.liveFiles().filter(file => file.mimeType === 'application/json')).toEqual([]);
  });

  test('keeps independent concurrent backups as separate complete copies', async () => {
    let racing = false; let arrivals = 0; let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    const drive = createInMemoryDrive({ onUpload: async file => {
      if (!racing || !file.name.startsWith('測試表A')) return;
      if (++arrivals === 2) release();
      await ready;
    } });
    const fixture = { drive, logs: [], fetchImpl: drive.fetchImpl };
    const firstService = createService(fixture); const secondService = createService(fixture);
    const initial = createWorkspaceFixture(1);
    const initialBackup = await firstService.backup(initial.data, {}, { source: initial.source });
    await secondService.findRemoteFile();
    const first = createWorkspaceFixture(2); const second = createWorkspaceFixture(3);
    racing = true;
    const [left, right] = await Promise.all([
      firstService.backup(first.data, {}, { source: first.source, expectedRemoteFileId: initialBackup.file.id }),
      secondService.backup(second.data, {}, { source: second.source, expectedRemoteFileId: initialBackup.file.id }),
    ]);
    expect(left.file.id).not.toBe(right.file.id);
    expect(left.file.parents).not.toEqual(right.file.parents);
    expect(drive.liveFiles().filter(file => file.appProperties?.backupKind === 'manifest')).toHaveLength(3);
    expect((await firstService.restore(left.file)).tables[0].name).toBe(first.tables[0].name);
    expect((await secondService.restore(right.file)).tables[0].name).toBe(second.tables[0].name);
  });

  test('does not publish an index when local data changes during the last table upload', async () => {
    let changed = false;
    const drive = createInMemoryDrive({ onUpload: file => { if (file.name.startsWith('測試表B')) changed = true; } });
    const service = createService({ drive, logs: [], fetchImpl: drive.fetchImpl });
    const data = createWorkspaceFixture(1);
    data.source.verify = async () => { if (changed) throw new Error('備份期間已有變更'); };
    await expect(service.backup(data.data, {}, { source: data.source })).rejects.toThrow('備份期間已有變更');
    expect(drive.liveFiles().filter(file => file.appProperties?.backupKind === 'manifest')).toEqual([]);
  });

  test('rejects a table whose XLSX identity differs from the index', async () => {
    const fixture = loggedDrive(); const service = createService(fixture); const data = createWorkspaceFixture(1);
    const receipt = await service.backup(data.data, {}, { source: data.source });
    fixture.drive.setBody(receipt.manifest.tables[0].driveFileId, await blobBytes(await exportWorkspaceXlsxAsync(data.data, data.tables[1])));
    await expect(service.restore(receipt.file)).rejects.toThrow('雲端表格格式或識別不一致');
  });

  test('rejects an index missing one of the directory tables', async () => {
    const fixture = loggedDrive(); const service = createService(fixture); const data = createWorkspaceFixture(1);
    const receipt = await service.backup(data.data, {}, { source: data.source });
    fixture.drive.setBody(receipt.file.id, await blobBytes(exportWorkspaceBackupManifestXlsx(data.data, [], receipt.manifest.tables.slice(0, 1), 1, 'flat')));
    await expect(service.restore(receipt.file)).rejects.toThrow('備份索引與表格對應不一致');
  });

  test.each(['modified', 'moved'])('rejects a selected snapshot that was %s after listing, before downloading it', async change => {
    const fixture = loggedDrive(); const service = createService(fixture); const data = createWorkspaceFixture(1);
    const receipt = await service.backup(data.data, {}, { source: data.source });
    const selected = (await service.listRemoteBackups()).find(file => file.id === receipt.file.id)!;
    if (change === 'modified') fixture.drive.get(selected.id)!.modifiedTime = new Date(Date.parse(selected.modifiedTime!) + 60_000).toISOString();
    else fixture.drive.get(selected.parents![0])!.parents = ['unrelated-user-folder'];
    fixture.logs.length = 0;
    await expect(service.restore(selected)).rejects.toThrow('所選備份已有變更');
    expect(fixture.logs.filter(log => log.query.includes('alt=media'))).toEqual([]);
  });

});
