import { describe, expect, test } from 'vitest';
import { DRIVE_SNAPSHOT_KEY, DRIVE_SNAPSHOT_XLSX, type DriveSnapshotOperation, type DriveSnapshotState } from '../../shared/driveSnapshots';
import { createInMemoryDrive, type InMemoryDriveFixture } from './backupTestFixture';
import { createSnapshotCoordinator } from './snapshotCoordinator';
import { snapshotTags } from './driveSnapshotStore';
import { GoogleDriveApi, FOLDER_MIME } from './googleDriveApi';

const TOKEN = 'snapshot-coordinator-drive-token';
const ROOT = 'snapshot-coordinator-root';
const apiFor = (drive: InMemoryDriveFixture) => new GoogleDriveApi({ tokenProvider: { getAccessToken: async () => TOKEN }, fetchImpl: drive.fetchImpl });
const coordinatorFor = (drive: InMemoryDriveFixture, fetchImpl = drive.fetchImpl) => createSnapshotCoordinator({ tokenProvider: { getAccessToken: async () => TOKEN }, fetchImpl });
const addRoot = (drive: InMemoryDriveFixture) => drive.addFile({ id: ROOT, name: '新版快照', mimeType: FOLDER_MIME, parents: ['root'], appProperties: snapshotTags('root') });
const beginInput = (state: DriveSnapshotState, id: string, sourceRevision = id) => ({ id, rootId: ROOT, expectedRevision: state.revision, sourceRevision, legacyStamp: state.legacyStamp, fileCount: 2, sourceUpdatedAt: 100 });

const uploadSnapshot = async (drive: InMemoryDriveFixture, operation: DriveSnapshotOperation, tableKind = 'table') => {
  const api = apiFor(drive);
  await api.createFolder(`備份-${operation.id}`, ROOT, snapshotTags('snapshot', operation.id), operation.folderId);
  await api.uploadFile({ createId: operation.fileIds[0], parentId: operation.folderId, name: 'manifest.xlsx', mimeType: DRIVE_SNAPSHOT_XLSX, body: new Uint8Array([1, 2, 3]), appProperties: snapshotTags('manifest', operation.id) });
  await api.uploadFile({ createId: operation.fileIds[1], parentId: operation.folderId, name: 'table.xlsx', mimeType: DRIVE_SNAPSHOT_XLSX, body: new Uint8Array([4, 5, 6]), appProperties: snapshotTags(tableKind, operation.id) });
};

const receiptFor = (drive: InMemoryDriveFixture, id: string) => [...drive.files.values()].find(file => file.appProperties?.backupKind === 'receipt' && file.appProperties.snapshotId === id);
const readReceipt = (drive: InMemoryDriveFixture, id: string) => {
  const receipt = receiptFor(drive, id);
  if (!receipt?.body) throw new Error(`missing receipt ${id}`);
  return JSON.parse(new TextDecoder().decode(receipt.body)) as { parents: string[]; operation: DriveSnapshotOperation };
};
const createCommitted = async (drive: InMemoryDriveFixture, coordinator: ReturnType<typeof coordinatorFor>, id: string) => {
  const operation = await coordinator.begin(beginInput(await coordinator.state(ROOT), id));
  await uploadSnapshot(drive, operation);
  await coordinator.commit(id);
  return operation;
};

describe('browser-to-Drive snapshot coordinator', () => {
  test('uses a Drive root and JSON receipts while keeping the snapshot folder XLSX-only', async () => {
    const drive = createInMemoryDrive(); addRoot(drive);
    const coordinator = coordinatorFor(drive);
    const initial = await coordinator.state(ROOT);
    expect(initial).toMatchObject({ accountKey: `drive:${ROOT}`, rootId: ROOT, revision: 0, versions: [], forkCount: 0 });
    const operation = await coordinator.begin(beginInput(initial, 'coordinator-basic'));
    expect(receiptFor(drive, operation.id)).toMatchObject({ mimeType: 'application/json', parents: [ROOT], appProperties: { backupKey: DRIVE_SNAPSHOT_KEY, backupKind: 'receipt', schemaVersion: '4', snapshotId: operation.id } });
    expect(readReceipt(drive, operation.id).operation.status).toBe('uploading');
    await uploadSnapshot(drive, operation);
    const renewedBefore = operation.expiresAt;
    await coordinator.renew(operation.id);
    expect((await coordinator.operation(operation.id))?.expiresAt).toBeGreaterThanOrEqual(renewedBefore);
    const committed = await coordinator.commit(operation.id);
    expect(committed).toMatchObject({ status: 'committed', inventory: expect.any(Array) });
    expect(await coordinator.operation(operation.id)).toMatchObject({ status: 'committed', revision: 1 });
    expect(await coordinator.state(ROOT)).toMatchObject({ versions: [expect.objectContaining({ id: operation.id, folderId: operation.folderId, manifestId: operation.fileIds[0] })] });
    expect(readReceipt(drive, operation.id).operation.status).toBe('committed');
    expect(drive.liveFiles().filter(file => file.parents?.[0] === operation.folderId)).toHaveLength(2);
    expect(drive.liveFiles().filter(file => file.appProperties?.backupKind === 'receipt')).toHaveLength(1);
  });

  test('blocks an empty begin before reserving IDs or writing a receipt', async () => {
    const drive = createInMemoryDrive(); addRoot(drive); const coordinator = coordinatorFor(drive);
    const before = [...drive.files.keys()]; const state = await coordinator.state(ROOT);
    await expect(coordinator.begin({ ...beginInput(state, 'empty'), fileCount: 1 })).rejects.toMatchObject({ code: 'backup_snapshot_empty', status: 422 });
    expect([...drive.files.keys()]).toEqual(before); expect(drive.calls.uploads).toHaveLength(0);
  });

  test('rejects missing or mis-tagged XLSX files at commit without publishing', async () => {
    const drive = createInMemoryDrive(); addRoot(drive); const coordinator = coordinatorFor(drive); const api = apiFor(drive);
    const operation = await coordinator.begin(beginInput(await coordinator.state(ROOT), 'incomplete'));
    await api.createFolder('備份-incomplete', ROOT, snapshotTags('snapshot', operation.id), operation.folderId);
    await api.uploadFile({ createId: operation.fileIds[0], parentId: operation.folderId, name: 'manifest.xlsx', mimeType: DRIVE_SNAPSHOT_XLSX, body: new Uint8Array([1]), appProperties: snapshotTags('manifest', operation.id) });
    await expect(coordinator.commit(operation.id)).rejects.toMatchObject({ code: 'backup_snapshot_incomplete', status: 422 });
    expect((await coordinator.operation(operation.id))?.status).toBe('uploading');
    const corrupt = await coordinator.begin(beginInput(await coordinator.state(ROOT), 'mis-tagged'));
    await uploadSnapshot(drive, corrupt, 'manifest');
    await expect(coordinator.commit(corrupt.id)).rejects.toMatchObject({ code: 'backup_snapshot_invalid', status: 422 });
    expect((await coordinator.operation(corrupt.id))?.status).toBe('uploading');
  });

  test('keeps independent simultaneous siblings and reports a fork instead of CAS-claiming one head', async () => {
    const drive = createInMemoryDrive(); addRoot(drive);
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let commitPatches = 0;
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH' && String(input).includes('/upload/drive/v3/files/')) {
        commitPatches += 1; if (commitPatches === 2) release(); await gate;
      }
      return drive.fetchImpl(input, init);
    };
    const first = coordinatorFor(drive, fetchImpl); const second = coordinatorFor(drive, fetchImpl);
    const state = await first.state(ROOT);
    const firstOperation = await first.begin(beginInput(state, 'sibling-a', 'source-a'));
    const secondOperation = await second.begin(beginInput(state, 'sibling-b', 'source-b'));
    await Promise.all([uploadSnapshot(drive, firstOperation), uploadSnapshot(drive, secondOperation)]);
    const results = await Promise.allSettled([first.commit(firstOperation.id), second.commit(secondOperation.id)]);
    expect(commitPatches).toBe(2);
    const after = await first.state(ROOT);
    expect(after.forkCount).toBeGreaterThan(1);
    expect(new Set(after.versions.map(version => version.id))).toEqual(new Set([firstOperation.id, secondOperation.id]));
    expect((await first.operation(firstOperation.id))?.status).toBe('committed');
    expect((await first.operation(secondOperation.id))?.status).toBe('committed');
    expect(readReceipt(drive, firstOperation.id).parents).toEqual([]);
    expect(readReceipt(drive, secondOperation.id).parents).toEqual([]);
  });

  test('acquires Drive leases and cleanup preserves active restores, folders, and unknown files', async () => {
    const drive = createInMemoryDrive(); addRoot(drive); const coordinator = coordinatorFor(drive); const operations: DriveSnapshotOperation[] = [];
    for (let index = 0; index < 4; index += 1) operations.push(await createCommitted(drive, coordinator, `retention-${index}`));
    const oldest = operations[0];
    const manual = drive.addFile({ id: 'manual-in-old-snapshot', name: 'notes.txt', mimeType: 'text/plain', parents: [oldest.folderId], body: new Uint8Array([9, 9, 9]) });
    const leaseId = 'restore-retention-lease';
    await coordinator.restore(oldest.id, leaseId, 'acquire');
    await expect(coordinator.cleanup()).resolves.toEqual({ cleaned: false });
    expect(drive.get(oldest.fileIds[0])?.trashed).not.toBe(true); expect(manual.trashed).not.toBe(true);
    await coordinator.restore(oldest.id, leaseId, 'release');
    await expect(coordinator.cleanup()).resolves.toEqual({ cleaned: true });
    for (const fileId of oldest.fileIds) expect(drive.get(fileId)?.trashed).toBe(true);
    expect(drive.get(oldest.folderId)?.trashed).not.toBe(true); expect(manual.trashed).not.toBe(true); expect(receiptFor(drive, oldest.id)?.trashed).toBe(true);
    const retained = await coordinator.state(ROOT);
    expect(retained.versions).toHaveLength(3);
    expect(retained.versions.map(version => version.id)).toEqual(expect.arrayContaining(operations.slice(1).map(op => op.id)));
  });
});
