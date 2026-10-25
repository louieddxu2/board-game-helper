import { describe, expect, test, vi } from 'vitest';
import {
  DRIVE_SNAPSHOT_LEASE_MS, DRIVE_SNAPSHOT_ORPHAN_GRACE_MS, DRIVE_SNAPSHOT_XLSX,
  type DriveSnapshotOperation, type DriveSnapshotState,
} from '../../shared/driveSnapshots';
import { createInMemoryDrive, type InMemoryDriveFixture } from './backupTestFixture';
import { createSnapshotCoordinator } from './snapshotCoordinator';
import { DriveSnapshotStore, snapshotTags } from './driveSnapshotStore';
import { FOLDER_MIME, GoogleDriveApi } from './googleDriveApi';

const ROOT = 'safety-root';
const TOKEN = 'safety-drive-token';
const apiFor = (drive: InMemoryDriveFixture, fetchImpl = drive.fetchImpl) => new GoogleDriveApi({
  tokenProvider: { getAccessToken: async () => TOKEN }, fetchImpl,
});
const coordinatorFor = (drive: InMemoryDriveFixture, fetchImpl = drive.fetchImpl) => createSnapshotCoordinator({
  tokenProvider: { getAccessToken: async () => TOKEN }, fetchImpl,
});
const addRoot = (drive: InMemoryDriveFixture) => drive.addFile({ id: ROOT, name: '新版快照', mimeType: FOLDER_MIME,
  parents: ['root'], appProperties: snapshotTags('root') });
const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const beginInput = (state: DriveSnapshotState, id: string, fileCount = 2) => ({ id, rootId: ROOT,
  expectedRevision: state.revision, sourceRevision: `source-${id}`, legacyStamp: state.legacyStamp,
  fileCount, sourceUpdatedAt: 1 });

const uploadSnapshot = async (drive: InMemoryDriveFixture, operation: DriveSnapshotOperation, limit = operation.fileIds.length) => {
  const api = apiFor(drive);
  await api.createFolder(`備份-${operation.id}`, ROOT, snapshotTags('snapshot', operation.id), operation.folderId);
  for (const [index, fileId] of operation.fileIds.slice(0, limit).entries()) {
    await api.uploadFile({ createId: fileId, parentId: operation.folderId, name: index ? `table-${index}.xlsx` : 'manifest.xlsx',
      mimeType: DRIVE_SNAPSHOT_XLSX, body: new Uint8Array([1, 2, 3]), appProperties: snapshotTags(index ? 'table' : 'manifest', operation.id) });
  }
};
const receiptFor = (drive: InMemoryDriveFixture, id: string) => [...drive.files.values()].find(file =>
  file.appProperties?.backupKind === 'receipt' && file.appProperties.snapshotId === id);
const receiptBody = (drive: InMemoryDriveFixture, id: string) => {
  const file = receiptFor(drive, id);
  if (!file?.body) throw new Error(`missing receipt ${id}`);
  return JSON.parse(new TextDecoder().decode(file.body)) as { parents: string[]; operation: DriveSnapshotOperation };
};
const beginAndUpload = async (drive: InMemoryDriveFixture, coordinator: ReturnType<typeof coordinatorFor>, id: string, fileCount = 2, uploadedFileCount = fileCount) => {
  const operation = await coordinator.begin(beginInput(await coordinator.state(ROOT), id, fileCount));
  await uploadSnapshot(drive, operation, uploadedFileCount);
  return operation;
};
const committed = async (drive: InMemoryDriveFixture, coordinator: ReturnType<typeof coordinatorFor>, id: string) => {
  const operation = await beginAndUpload(drive, coordinator, id);
  await coordinator.commit(id);
  return operation;
};

describe('Drive snapshot safety boundaries', () => {
  test.each([false, true])('expired orphan cleanup batches over 20 files without consuming parents (live head: %s)', async liveHead => {
    let now = Date.now(); const drive = createInMemoryDrive({ now: () => now }); addRoot(drive);
    const coordinator = coordinatorFor(drive);
    const head = liveHead ? await committed(drive, coordinator, 'live-head') : undefined;
    const orphan = await beginAndUpload(drive, coordinator, 'expired-orphan', 25);
    expect(orphan.fileIds).toHaveLength(25);
    now += DRIVE_SNAPSHOT_LEASE_MS + DRIVE_SNAPSHOT_ORPHAN_GRACE_MS + 5_000;

    await expect(coordinator.cleanup()).resolves.toEqual({ cleaned: true });
    expect(orphan.fileIds.filter(id => drive.get(id)?.trashed).length).toBe(20);
    expect(receiptBody(drive, orphan.id).operation.status).toBe('deleting');
    expect(receiptBody(drive, orphan.id).parents).toEqual(head ? [head.id] : []);
    if (head) expect((await coordinator.state(ROOT)).versions.map(version => version.id)).toContain(head.id);
    else expect((await coordinator.state(ROOT)).versions).toHaveLength(0);

    await expect(coordinator.cleanup()).resolves.toEqual({ cleaned: true });
    expect(orphan.fileIds.every(id => drive.get(id)?.trashed)).toBe(true);
    expect(receiptFor(drive, orphan.id)?.trashed).not.toBe(true);
    expect(receiptFor(drive, orphan.id)?.appProperties).toMatchObject({ snapshotAbandoned: 'true', snapshotDeleting: 'true' });
    expect(receiptBody(drive, orphan.id).operation.status).toBe('deleted');
    if (head) expect((await coordinator.state(ROOT)).versions.map(version => version.id)).toContain(head.id);
    else expect((await coordinator.state(ROOT)).versions).toHaveLength(0);
  });

  test('a delayed renew metadata PATCH cannot revert a concurrently committed receipt', async () => {
    const drive = createInMemoryDrive(); addRoot(drive); let holdRenew = false;
    const renewStarted = deferred(); const releaseRenew = deferred();
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      const contentType = new Headers(init?.headers).get('content-type') ?? '';
      if (holdRenew && init?.method === 'PATCH' && contentType.startsWith('application/json') && String(input).includes('/drive/v3/files/') && !String(input).includes('/upload/')) {
        holdRenew = false; renewStarted.resolve(); await releaseRenew.promise;
      }
      return drive.fetchImpl(input, init);
    };
    const coordinator = coordinatorFor(drive, fetchImpl); const operation = await beginAndUpload(drive, coordinator, 'renew-race');
    holdRenew = true;
    const renewal = coordinator.renew(operation.id); await renewStarted.promise;
    await expect(coordinator.commit(operation.id)).resolves.toMatchObject({ status: 'committed' });
    releaseRenew.resolve(); await renewal;
    expect(await coordinator.operation(operation.id)).toMatchObject({ status: 'committed' });
    expect(receiptFor(drive, operation.id)?.appProperties).toMatchObject({ backupKind: 'receipt', schemaVersion: '4' });
    expect(receiptFor(drive, operation.id)?.appProperties?.snapshotDeleting).not.toBe('true');
    expect(receiptBody(drive, operation.id).operation.status).toBe('committed');
  });

  test('snapshotDeleting survives a delayed committed-body upload and makes the operation unavailable', async () => {
    const drive = createInMemoryDrive(); addRoot(drive); const coordinator = coordinatorFor(drive);
    const operation = await committed(drive, coordinator, 'deletion-marker');
    const receipt = receiptFor(drive, operation.id)!; const api = apiFor(drive); const store = new DriveSnapshotStore(api);
    await api.updateFileMetadata(receipt.id, { appProperties: { snapshotDeleting: 'true' } });
    const record = (await store.records([drive.get(ROOT)!])).find(item => item.operation.id === operation.id)!;
    expect(record.operation.status).toBe('deleting');
    let holdBody = true; const bodyStarted = deferred(); const releaseBody = deferred();
    const delayedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const contentType = new Headers(init?.headers).get('content-type') ?? '';
      if (holdBody && init?.method === 'PATCH' && contentType.startsWith('multipart/related') && String(input).includes('/upload/drive/v3/files/')) {
        holdBody = false; bodyStarted.resolve(); await releaseBody.promise;
      }
      return drive.fetchImpl(input, init);
    };
    const delayedStore = new DriveSnapshotStore(apiFor(drive, delayedFetch));
    const delayedWrite = delayedStore.write({ ...record, operation: { ...record.operation, status: 'committed' } });
    await bodyStarted.promise;
    expect((await coordinator.operation(operation.id))?.status).toBe('deleting');
    const tableDownloads = drive.calls.downloads.filter(id => operation.fileIds.includes(id)).length;
    await expect(coordinator.restore(operation.id, 'blocked-restore', 'verify')).rejects.toMatchObject({ code: 'backup_snapshot_unavailable', status: 409 });
    expect(drive.calls.downloads.filter(id => operation.fileIds.includes(id)).length).toBe(tableDownloads);
    releaseBody.resolve();
    await expect(delayedWrite).resolves.toMatchObject({ operation: { status: 'deleting' } });
    expect((await coordinator.operation(operation.id))?.status).toBe('deleting');
  });

  test('rejects mismatched begin replay IDs and malformed receipt JSON', async () => {
    const drive = createInMemoryDrive(); addRoot(drive); const coordinator = coordinatorFor(drive);
    const state = await coordinator.state(ROOT); const operation = await coordinator.begin(beginInput(state, 'replay-id'));
    await expect(coordinator.begin({ ...beginInput(state, operation.id), sourceRevision: 'different-source' })).rejects.toMatchObject({ code: 'backup_snapshot_invalid', status: 422 });
    const receipt = receiptFor(drive, operation.id)!; drive.setBody(receipt.id, new TextEncoder().encode('{malformed'));
    await expect(coordinator.operation(operation.id)).rejects.toMatchObject({ code: 'backup_snapshot_invalid', status: 422 });
  });

  test('restore after deletion marking fails before table download, while an active lease protects cleanup', async () => {
    const drive = createInMemoryDrive(); addRoot(drive); let holdTrash = false; let trashHeld = false;
    const trashStarted = deferred(); const releaseTrash = deferred();
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      const contentType = new Headers(init?.headers).get('content-type') ?? '';
      const body = String(init?.body ?? '');
      if (holdTrash && !trashHeld && init?.method === 'PATCH' && contentType.startsWith('application/json') && body.includes('"trashed":true') && String(input).includes('/drive/v3/files/')) {
        trashHeld = true; trashStarted.resolve(); await releaseTrash.promise;
      }
      return drive.fetchImpl(input, init);
    };
    const coordinator = coordinatorFor(drive, fetchImpl); const operations: DriveSnapshotOperation[] = [];
    for (let index = 0; index < 4; index += 1) operations.push(await committed(drive, coordinator, `restore-race-${index}`));
    const oldest = operations[0];
    await coordinator.restore(oldest.id, 'active-lease', 'acquire');
    await expect(coordinator.cleanup()).resolves.toEqual({ cleaned: false });
    expect(oldest.fileIds.every(id => !drive.get(id)?.trashed)).toBe(true);
    await coordinator.restore(oldest.id, 'active-lease', 'release');

    holdTrash = true; const cleanup = coordinator.cleanup(); await trashStarted.promise;
    expect(receiptFor(drive, oldest.id)?.appProperties?.snapshotDeleting).toBe('true');
    const tableDownloads = drive.calls.downloads.filter(id => oldest.fileIds.includes(id)).length;
    await expect(coordinator.restore(oldest.id, 'after-deletion', 'acquire')).rejects.toMatchObject({ code: 'backup_snapshot_unavailable', status: 409 });
    expect(drive.calls.downloads.filter(id => oldest.fileIds.includes(id)).length).toBe(tableDownloads);
    releaseTrash.resolve(); await expect(cleanup).resolves.toEqual({ cleaned: true });
    expect(oldest.fileIds.every(id => drive.get(id)?.trashed)).toBe(true);
  });

  test('keeps a deleted orphan tombstone and removes a late reserved-file upload on retry', async () => {
    let now = Date.now(); const drive = createInMemoryDrive({ now: () => now }); addRoot(drive); const coordinator = coordinatorFor(drive);
    const orphan = await beginAndUpload(drive, coordinator, 'late-reserved', 3, 2);
    const lateId = orphan.fileIds[2]; now += DRIVE_SNAPSHOT_LEASE_MS + DRIVE_SNAPSHOT_ORPHAN_GRACE_MS + 5_000;
    await expect(coordinator.cleanup()).resolves.toEqual({ cleaned: true });
    const tombstone = receiptFor(drive, orphan.id)!;
    expect(tombstone.trashed).not.toBe(true);
    expect(tombstone.appProperties).toMatchObject({ snapshotAbandoned: 'true' });
    expect(receiptBody(drive, orphan.id).operation.status).toBe('deleted');

    const api = apiFor(drive);
    await api.uploadFile({ createId: lateId, parentId: orphan.folderId, name: 'late-table.xlsx', mimeType: DRIVE_SNAPSHOT_XLSX,
      body: new Uint8Array([7, 8, 9]), appProperties: snapshotTags('table', orphan.id) });
    expect((await coordinator.operation(orphan.id))?.status).toBe('deleting');
    await expect(coordinator.cleanup()).resolves.toEqual({ cleaned: true });
    expect(drive.get(lateId)?.trashed).toBe(true);
    expect((await coordinator.state(ROOT)).versions).toHaveLength(0);
  });

  test('rejects a deleting receipt body that lacks the monotonic deletion marker', async () => {
    const drive = createInMemoryDrive(); addRoot(drive); const coordinator = coordinatorFor(drive);
    const operation = await committed(drive, coordinator, 'deleting-without-marker');
    const receipt = receiptFor(drive, operation.id)!; const value = receiptBody(drive, operation.id);
    value.operation.status = 'deleting'; drive.setBody(receipt.id, new TextEncoder().encode(JSON.stringify(value)));
    await expect(coordinator.operation(operation.id)).rejects.toMatchObject({ code: 'backup_snapshot_invalid', status: 422 });
  });

  test('rejects deleting inventory IDs outside the allocated file IDs', async () => {
    const drive = createInMemoryDrive(); addRoot(drive); const coordinator = coordinatorFor(drive);
    const operation = await committed(drive, coordinator, 'deleting-inventory-outside');
    const receipt = receiptFor(drive, operation.id)!; const value = receiptBody(drive, operation.id);
    value.operation.status = 'deleting'; value.operation.inventory[0] = { ...value.operation.inventory[0], id: 'outside-allocation' };
    drive.setBody(receipt.id, new TextEncoder().encode(JSON.stringify(value)));
    await apiFor(drive).updateFileMetadata(receipt.id, { appProperties: { snapshotDeleting: 'true' } });
    await expect(coordinator.operation(operation.id)).rejects.toMatchObject({ code: 'backup_snapshot_invalid', status: 422 });
  });

  const invalidLeaseCases: Array<[string, { appProperties: Record<string, string>; ownedByMe: boolean; mimeType: string }]> = [
    ['mis-tagged', { appProperties: { backupKey: 'other-app', backupKind: 'restore-lease' }, ownedByMe: true, mimeType: 'application/json' }],
    ['unowned', { appProperties: snapshotTags('restore-lease'), ownedByMe: false, mimeType: 'application/json' }],
    ['non-json', { appProperties: snapshotTags('restore-lease'), ownedByMe: true, mimeType: 'text/plain' }],
  ];

  test.each(invalidLeaseCases)('ignores %s restore leases during cleanup and never overwrites or trashes them', async (_label, properties) => {
    const drive = createInMemoryDrive(); addRoot(drive); const coordinator = coordinatorFor(drive);
    const operations: DriveSnapshotOperation[] = [];
    for (let index = 0; index < 4; index += 1) operations.push(await committed(drive, coordinator, `invalid-lease-${index}`));
    const oldest = operations[0]; const leaseId = 'invalid-lease-id';
    const fakeLease = drive.addFile({ id: `fake-${_label}`, name: 'not-a-valid-lease', mimeType: properties.mimeType,
      parents: [ROOT], appProperties: { ...properties.appProperties, snapshotId: oldest.id, leaseId, expiresAt: String(Date.now() + DRIVE_SNAPSHOT_LEASE_MS) },
      ownedByMe: properties.ownedByMe, body: new Uint8Array([1, 2, 3]) });
    const before = { ...fakeLease.appProperties }; await coordinator.restore(oldest.id, leaseId, 'acquire');
    expect(fakeLease.appProperties).toEqual(before); expect(fakeLease.trashed).not.toBe(true);
    const validLease = drive.liveFiles().find(file => file.appProperties?.backupKind === 'restore-lease' && file.appProperties.leaseId === leaseId && file.id !== fakeLease.id);
    expect(validLease).toBeDefined(); await coordinator.restore(oldest.id, leaseId, 'release');
    expect(fakeLease.appProperties).toEqual(before); expect(fakeLease.trashed).not.toBe(true);
    await expect(coordinator.cleanup()).resolves.toEqual({ cleaned: true });
    expect(fakeLease.trashed).not.toBe(true);
  });

  test.each([
    ['device clock ahead', 7 * 24 * 60 * 60 * 1000],
    ['device clock behind', -7 * 24 * 60 * 60 * 1000],
  ])('anchors receipt expiry to Drive createdTime when the Date header is hidden (%s)', async (_label, skew) => {
    const serverNow = Date.UTC(2030, 0, 1, 12, 0, 0); const old = new Date(Date.UTC(2000, 0, 1)).toISOString();
    const drive = createInMemoryDrive({ now: () => serverNow });
    drive.addFile({ id: ROOT, name: '新版快照', mimeType: FOLDER_MIME, parents: ['root'], createdTime: old, modifiedTime: old, appProperties: snapshotTags('root') });
    const stripDate = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await drive.fetchImpl(input, init); const headers = new Headers(response.headers); headers.delete('date');
      const body = response.status === 204 ? undefined : await response.arrayBuffer();
      return new Response(body, { status: response.status, headers });
    };
    const coordinator = coordinatorFor(drive, stripDate); const dateNow = vi.spyOn(Date, 'now').mockReturnValue(serverNow + skew);
    try {
      const operation = await coordinator.begin(beginInput(await coordinator.state(ROOT), `clock-${_label}`));
      const expected = serverNow + DRIVE_SNAPSHOT_LEASE_MS;
      expect(operation.expiresAt).toBeGreaterThanOrEqual(expected - 2_000);
      expect(operation.expiresAt).toBeLessThanOrEqual(expected + 2_000);
      const reloaded = await coordinator.operation(operation.id);
      expect(reloaded?.expiresAt).toBeGreaterThanOrEqual(expected - 2_000);
      expect(reloaded?.expiresAt).toBeLessThanOrEqual(expected + 2_000);
      await expect(coordinator.renew(operation.id)).resolves.toBeUndefined();
      const renewed = await coordinator.operation(operation.id);
      expect(renewed?.expiresAt).toBeGreaterThanOrEqual(expected - 2_000);
      expect(renewed?.expiresAt).toBeLessThanOrEqual(expected + 2_000);
      expect(renewed?.expiresAt).not.toBe(Date.parse(old) + DRIVE_SNAPSHOT_LEASE_MS);
      expect(renewed?.expiresAt).not.toBe(serverNow + skew + DRIVE_SNAPSHOT_LEASE_MS);
    } finally { dateNow.mockRestore(); }
  });
});
