import { afterEach, describe, expect, test, vi } from 'vitest';
import { createNode, createTable } from '../model';
import { exportWorkspaceBackupManifestXlsx, importWorkspaceBackupManifestXlsx, importWorkspaceXlsx } from '../spreadsheet';
import type { WorkspaceData } from '../types';
import { workspaceBackupTableSummary, type WorkspaceBackupSource } from '../workspaceBackupSource';
import { blobBytes } from '../spreadsheetCodec';
import { DRIVE_SNAPSHOT_KEY, summarizeDriveSnapshot, type BeginDriveSnapshot, type DriveSnapshotOperation, type DriveSnapshotState } from '../../shared/driveSnapshots';
import { createInMemoryDrive, blobFromBytes } from './backupTestFixture';
import { createGoogleDriveSnapshotBackup } from './snapshotBackup';
import type { SnapshotCoordinator } from './snapshotCoordinator';

const ROOT = 'snapshot-root';
const LEGACY_STAMP = '0'.repeat(64);
const V2_KEY = 'dynamic-sheet-primary-workspace-v2';

class TestCoordinator implements SnapshotCoordinator {
  readonly operations = new Map<string, DriveSnapshotOperation>();
  readonly cleanupCalls: number[] = [];
  commitCalls = 0;
  revision = 0;
  legacyStamp = LEGACY_STAMP;
  legacyChanged = false;
  failCommitAfterPublish = false;
  failCleanupCount = 0;
  removeOlderOnCleanup = false;
  private sequence = 0;

  state = async (): Promise<DriveSnapshotState> => ({
    accountKey: 'test-account', rootId: ROOT, revision: this.revision,
    legacyStamp: this.legacyStamp, legacyChanged: this.legacyChanged,
    versions: [...this.operations.values()].filter(operation => operation.status === 'committed')
      .sort((left, right) => (right.revision ?? 0) - (left.revision ?? 0)).map(summarizeDriveSnapshot),
  });

  operation = async (id: string) => {
    const operation = this.operations.get(id);
    return operation ? cloneOperation(operation) : null;
  };

  begin = async (input: BeginDriveSnapshot): Promise<DriveSnapshotOperation> => {
    const existing = this.operations.get(input.id);
    if (existing) return cloneOperation(existing);
    if (input.expectedRevision !== this.revision) throw new Error('backup_revision_conflict');
    const fileIds = [
      `snapshot-folder-${++this.sequence}`,
      ...Array.from({ length: input.fileCount }, () => `snapshot-file-${this.sequence}-${this.operations.size}-${Math.random()}`),
    ];
    const operation: DriveSnapshotOperation = {
      id: input.id, expectedRevision: input.expectedRevision, sourceRevision: input.sourceRevision,
      legacyStamp: input.legacyStamp, folderId: fileIds[0], fileIds: fileIds.slice(1),
      status: 'uploading', expiresAt: Date.now() + 60 * 60_000, revision: null,
      committedAt: null, sourceUpdatedAt: input.sourceUpdatedAt, inventory: [],
    };
    this.operations.set(input.id, operation);
    return cloneOperation(operation);
  };

  renew = async (id: string) => {
    const operation = this.operations.get(id);
    if (!operation) throw new Error('backup_operation_not_found');
    operation.expiresAt = Date.now() + 60 * 60_000;
  };

  commit = async (id: string) => {
    this.commitCalls += 1;
    const operation = this.operations.get(id);
    if (!operation) throw new Error('backup_operation_not_found');
    if (operation.revision != null) return cloneOperation(operation);
    operation.status = 'committed'; operation.revision = ++this.revision;
    operation.committedAt = Date.now();
    operation.inventory = operation.fileIds.map((fileId, index) => ({
      id: fileId, size: String(100 + index), md5Checksum: `checksum-${fileId}`,
      modifiedTime: '2026-10-18T00:00:00.000Z',
    }));
    if (this.failCommitAfterPublish) {
      this.failCommitAfterPublish = false;
      throw new Error('lost commit response');
    }
    return cloneOperation(operation);
  };

  restore = async () => { throw new Error('restore not used in this fixture'); };

  cleanup = async () => {
    this.cleanupCalls.push(Date.now());
    if (this.failCleanupCount > 0) { this.failCleanupCount -= 1; throw new Error('cleanup temporarily unavailable'); }
    if (this.removeOlderOnCleanup) {
      const committed = [...this.operations.values()].filter(operation => operation.status === 'committed')
        .sort((left, right) => (right.revision ?? 0) - (left.revision ?? 0));
      committed.slice(1).forEach(operation => this.operations.delete(operation.id));
    }
    return { cleaned: false };
  };
}

const cloneOperation = (operation: DriveSnapshotOperation): DriveSnapshotOperation => ({
  ...operation, fileIds: [...operation.fileIds], inventory: operation.inventory.map(file => ({ ...file })),
});

const createWorkspace = () => {
  const tables = ['收藏', '代購'].map((name, index) => {
    const table = createTable(name);
    return {
      ...table, updatedAt: 42 + index, changeRevision: `table-revision-${index}`,
      rows: [{ ...table.rows[0], id: `row-${index}`, name: `項目 ${index}`, values: { [table.columns[0].id]: `內容 ${index}` } }],
    };
  });
  const data: WorkspaceData = {
    version: 1, structureRevision: 'structure-revision',
    nodes: tables.map((table, index) => createNode('table', table.name, null, index, table.id)),
    tables: [], activeNodeId: null, bottomNavigationTableIds: [tables[0].id],
  };
  const readTable = vi.fn(async (id: string) => tables.find(table => table.id === id)!);
  const verify = vi.fn(async () => undefined);
  const source = {
    tables: tables.map(workspaceBackupTableSummary),
    readTable,
    verify,
  } satisfies WorkspaceBackupSource;
  return { data, tables, source };
};

const createService = (drive: ReturnType<typeof createInMemoryDrive>, coordinator: TestCoordinator, storage: StorageLike, legacySingle?: { findRemoteFile: () => Promise<import('./types').DriveFile | null>; restore: (selected?: import('./types').DriveFile) => Promise<Blob> }) => createGoogleDriveSnapshotBackup({
  folderPath: ['新版快照'], backupKey: V2_KEY, retainedVersions: 3,
  tokenProvider: { getAccessToken: async () => 'drive-token' }, fetchImpl: drive.fetchImpl,
  coordinator, storage, ...(legacySingle ? { legacySingle } : {}),
});

interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
const memoryStorage = (): StorageLike => {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
};

const addRoot = (drive: ReturnType<typeof createInMemoryDrive>) => drive.addFile({
  id: ROOT, name: '新版快照', mimeType: 'application/vnd.google-apps.folder', parents: ['root'],
  appProperties: { backupKey: DRIVE_SNAPSHOT_KEY, backupKind: 'root' },
});

describe('independent Drive snapshot backups', () => {
  afterEach(() => vi.restoreAllMocks());

  test('reads each source table, writes a complete XLSX snapshot and round-trips table and manifest contents', async () => {
    const drive = createInMemoryDrive(); addRoot(drive);
    const coordinator = new TestCoordinator(); const { data, tables, source } = createWorkspace();
    const service = createService(drive, coordinator, memoryStorage());
    const receipt = await service.backup(data, {}, { source });

    expect(source.readTable).toHaveBeenCalledTimes(tables.length);
    expect(source.readTable.mock.calls.map(([id]) => id)).toEqual(tables.map(table => table.id));
    expect(source.verify).toHaveBeenCalled();
    const snapshotFiles = [...drive.files.values()].filter(file => file.appProperties?.snapshotId === receipt.file.appProperties?.snapshotId);
    expect(snapshotFiles.filter(file => file.appProperties?.backupKind === 'table')).toHaveLength(tables.length);
    for (const table of tables) {
      const file = snapshotFiles.find(candidate => candidate.appProperties?.localId === table.id)!;
      const imported = (await importWorkspaceXlsx(blobFromBytes(file.body), { preserveIds: true })).table!;
      expect(imported.id).toBe(table.id);
      expect(imported.rows[0].values).toEqual(table.rows[0].values);
      expect(imported.changeRevision).toBe(table.changeRevision);
    }
    const manifestFile = snapshotFiles.find(file => file.appProperties?.backupKind === 'manifest')!;
    const manifest = await importWorkspaceBackupManifestXlsx(blobFromBytes(manifestFile.body));
    expect(manifest.tables.map(table => table.id)).toEqual(tables.map(table => table.id));
    expect(manifest.fileLayout).toBe('flat');
  });

  test('rejects a corrupted uploaded manifest before publishing the snapshot', async () => {
    let drive!: ReturnType<typeof createInMemoryDrive>;
    let corrupted = false;
    drive = createInMemoryDrive({ onUpload: async (file) => {
      if (corrupted || file.appProperties?.backupKind !== 'manifest') return;
      corrupted = true;
      const parsed = await importWorkspaceBackupManifestXlsx(blobFromBytes(file.body));
      const changed = exportWorkspaceBackupManifestXlsx({
        version: 1, structureRevision: parsed.structureRevision, nodes: parsed.nodes, tables: [],
        activeNodeId: parsed.activeNodeId, bottomNavigationTableIds: parsed.bottomNavigationTableIds,
      }, parsed.folders, parsed.tables, parsed.sourceUpdatedAt + 1, 'flat');
      drive.setBody(file.id, await blobBytes(changed));
    }});
    addRoot(drive);
    const coordinator = new TestCoordinator(); const fixture = createWorkspace();
    const service = createService(drive, coordinator, memoryStorage());

    await expect(service.backup(fixture.data, {}, { source: fixture.source })).rejects.toThrow('備份索引驗證失敗');
    expect(coordinator.commitCalls).toBe(0);
    expect([...coordinator.operations.values()].every(operation => operation.status === 'uploading')).toBe(true);
  });

  test('gives each complete snapshot its own immutable folder and table files', async () => {
    const drive = createInMemoryDrive(); addRoot(drive);
    const coordinator = new TestCoordinator(); const fixture = createWorkspace();
    const service = createService(drive, coordinator, memoryStorage());
    const first = await service.backup(fixture.data, {}, { source: fixture.source });
    service.acknowledgeBackup?.(first.file.id);
    const second = await service.backup(fixture.data, {}, { source: fixture.source });
    const firstOp = [...coordinator.operations.values()].find(operation => operation.id === first.file.appProperties?.snapshotId)!;
    const secondOp = [...coordinator.operations.values()].find(operation => operation.id === second.file.appProperties?.snapshotId)!;
    expect(firstOp.folderId).not.toBe(secondOp.folderId);
    expect(secondOp.fileIds.some(fileId => firstOp.fileIds.includes(fileId))).toBe(false);
    expect(drive.calls.uploads.filter(upload => upload.metadata.appProperties?.backupKind === 'table')).toHaveLength(4);
  });

  test('recovers a lost commit response from the journal after a service reload without uploading again', async () => {
    const drive = createInMemoryDrive(); addRoot(drive);
    const coordinator = new TestCoordinator(); coordinator.failCommitAfterPublish = true;
    const fixture = createWorkspace(); const storage = memoryStorage();
    const first = createService(drive, coordinator, storage);
    const receipt = await first.backup(fixture.data, {}, { source: fixture.source });
    const uploadCount = drive.calls.uploads.length;
    const reloaded = createService(drive, coordinator, storage);
    const recovered = await reloaded.backup(fixture.data, {}, { source: fixture.source });
    expect(recovered.file.id).toBe(receipt.file.id);
    expect(drive.calls.uploads).toHaveLength(uploadCount);
  });

  test('does not block the next automatic backup when cleanup fails', async () => {
    const drive = createInMemoryDrive(); addRoot(drive);
    const coordinator = new TestCoordinator(); coordinator.failCleanupCount = 1;
    const fixture = createWorkspace(); const service = createService(drive, coordinator, memoryStorage());
    const first = await service.backup(fixture.data, {}, { source: fixture.source });
    service.acknowledgeBackup?.(first.file.id);
    await expect(service.backup(fixture.data, {}, { source: fixture.source })).resolves.toBeDefined();
    expect(coordinator.revision).toBe(2);
    expect(coordinator.cleanupCalls.length).toBeGreaterThanOrEqual(2);
  });

  test('keeps own cleanup from becoming a conflict but rejects a real remote head change', async () => {
    const drive = createInMemoryDrive(); addRoot(drive);
    const coordinator = new TestCoordinator(); coordinator.removeOlderOnCleanup = true;
    const fixture = createWorkspace(); const service = createService(drive, coordinator, memoryStorage());
    const first = await service.backup(fixture.data, {}, { source: fixture.source });
    service.acknowledgeBackup?.(first.file.id);
    const second = await service.backup(fixture.data, {}, { source: fixture.source, expectedRemoteFileId: first.file.id });
    service.acknowledgeBackup?.(second.file.id);
    await expect(service.backup(fixture.data, {}, { source: fixture.source, expectedRemoteFileId: second.file.id })).resolves.toBeDefined();
    const uploadsBeforeConflict = drive.calls.uploads.length;
    const externalId = '00000000-0000-4000-8000-000000009999';
    coordinator.operations.set(externalId, {
      id: externalId, expectedRevision: coordinator.revision, sourceRevision: 'f'.repeat(64), legacyStamp: LEGACY_STAMP,
      folderId: 'external-folder', fileIds: ['external-manifest', 'external-table'], status: 'committed', expiresAt: Date.now() + 60_000,
      revision: coordinator.revision + 1, committedAt: Date.now(), sourceUpdatedAt: Date.now(), inventory: [],
    });
    coordinator.revision += 1;
    await expect(service.backup(fixture.data, {}, { source: fixture.source, expectedRemoteFileId: second.file.id })).rejects.toThrow('雲端備份已在其他裝置變更');
    expect(drive.calls.uploads).toHaveLength(uploadsBeforeConflict);
  });

  test('falls back to an existing v2 manifest while the new snapshot set is empty', async () => {
    const drive = createInMemoryDrive(); addRoot(drive);
    const legacy = drive.addFile({
      id: 'legacy-manifest', name: 'manifest.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      parents: [ROOT], appProperties: { backupKey: V2_KEY, backupKind: 'manifest' }, body: new Uint8Array([1, 2, 3]),
    });
    const coordinator = new TestCoordinator(); const service = createService(drive, coordinator, memoryStorage());
    expect(await service.findRemoteFile()).toMatchObject({ id: legacy.id, appProperties: { backupKey: V2_KEY, backupKind: 'manifest' } });
  });

  test('uses the optional v1 single-file reader only after the v2 folder is empty', async () => {
    const drive = createInMemoryDrive(); addRoot(drive);
    const legacyFile = { id: 'legacy-v1', name: '玩錯動態表格-備份.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      appProperties: { backupKey: 'dynamic-sheet-primary-workspace-v1', workspaceFormat: 'dynamic-sheet-v1', schemaVersion: '1' } };
    const findRemoteFile = vi.fn(async () => legacyFile);
    const restore = vi.fn(async () => blobFromBytes());
    const service = createService(drive, new TestCoordinator(), memoryStorage(), { findRemoteFile, restore });

    await expect(service.findRemoteFile()).resolves.toMatchObject({ id: 'legacy-v1', appProperties: { legacySingle: 'true' } });
    await expect(service.listRemoteBackups()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'legacy-v1', appProperties: expect.objectContaining({ legacySingle: 'true' }) }),
    ]));
    expect(findRemoteFile).toHaveBeenCalled();
  });

  test('requires the selected v1 legacy baseline for a forced migration and leaves that backup untouched', async () => {
    const drive = createInMemoryDrive(); addRoot(drive);
    const baseline = 'v1-baseline';
    const legacyFile = { id: 'legacy-v1', name: '玩錯動態表格-備份.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      appProperties: { backupKey: 'dynamic-sheet-primary-workspace-v1', legacyStamp: baseline } };
    const findRemoteFile = vi.fn(async () => legacyFile);
    const coordinator = new TestCoordinator(); coordinator.legacyStamp = baseline; coordinator.legacyChanged = true;
    const fixture = createWorkspace(); const service = createService(drive, coordinator, memoryStorage(), { findRemoteFile, restore: async () => blobFromBytes() });

    await expect(service.backup(fixture.data, {}, { source: fixture.source, allowLegacyChange: true, expectedLegacyStamp: 'different-baseline' }))
      .rejects.toThrow('雲端備份已在其他裝置變更');
    await expect(service.backup(fixture.data, {}, { source: fixture.source, allowLegacyChange: true, expectedLegacyStamp: baseline })).resolves.toBeDefined();
    expect(findRemoteFile).toHaveBeenCalled();
    expect(legacyFile.appProperties.legacyStamp).toBe(baseline);
  });

  test('acknowledging a receipt in memory avoids repeated recovery while a persisted journal survives reload', async () => {
    const drive = createInMemoryDrive(); addRoot(drive);
    const coordinator = new TestCoordinator(); const fixture = createWorkspace(); const storage = memoryStorage();
    const service = createService(drive, coordinator, storage);
    const first = await service.backup(fixture.data, {}, { source: fixture.source });
    service.acknowledgeBackup?.(first.file.id, false);
    expect(storage.getItem('board-game-helper-drive-snapshot-pending:test-account')).toContain(first.file.appProperties?.snapshotId);
    fixture.source.tables[0] = { ...fixture.source.tables[0], changeRevision: 'changed-after-quota-failure', updatedAt: 43 };

    const second = await service.backup(fixture.data, {}, { source: fixture.source });
    expect(second.file.id).not.toBe(first.file.id);
    expect(coordinator.commitCalls).toBe(2);

    const reloaded = createService(drive, coordinator, storage);
    const recovered = await reloaded.backup(fixture.data, {}, { source: fixture.source });
    expect(recovered.file.id).toBe(second.file.id);
    expect(coordinator.commitCalls).toBe(2);
  });
});
