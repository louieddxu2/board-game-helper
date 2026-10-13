import { afterEach, expect, it, vi } from 'vitest';
import { GoogleDriveApi } from './googleDriveApi';
import { withDriveBackupOperation } from './backupOperation';
import { createGoogleDriveFolderBackup } from './folderBackup';
import { createInMemoryDrive } from './backupTestFixture';
import { createNode, createTable, emptyWorkspace } from '../model';

afterEach(() => vi.restoreAllMocks());

it('uses the server-created timestamp when Date is not exposed and the device clock is ahead', async () => {
  const serverTime = Date.parse('2026-10-13T12:00:00Z');
  vi.spyOn(Date, 'now').mockReturnValue(serverTime + 5 * 60 * 60 * 1000);
  const marker = { id: 'lease', name: '作業', createdTime: new Date(serverTime).toISOString() };
  const api = new GoogleDriveApi({ tokenProvider: { getAccessToken: async () => 'token' }, fetchImpl: async (_input, init) => init?.method === 'PATCH'
    ? new Response(null, { status: 204 }) : new Response(JSON.stringify(init?.method === 'POST' ? marker : { files: [marker] })) });
  const result = await withDriveBackupOperation(api, 'root', 'test', async (verify, _id, verifyRemote) => { verify(); await verifyRemote(); return 'complete'; });
  expect(result.value).toBe('complete');
  expect(api.serverNow()).toBeGreaterThanOrEqual(serverTime);
  expect(api.serverNow()).toBeLessThan(serverTime + 60_000);
});

it('refuses to publish after its operation marker disappears while a table is uploading', async () => {
  const fixture = createInMemoryDrive({ onUpload: file => {
    if (file.appProperties?.backupKind === 'table') for (const marker of fixture.liveFiles()) if (marker.appProperties?.backupKind === 'operation') marker.trashed = true;
  } });
  const table = createTable('表格'), node = createNode('table', table.name, null, 0, table.id);
  const data = { ...emptyWorkspace(), tables: [table], nodes: [node], activeNodeId: node.id };
  const service = createGoogleDriveFolderBackup({ folderPath: [], backupKey: 'test', retainedVersions: 3, tokenProvider: { getAccessToken: async () => 'token' }, fetchImpl: fixture.fetchImpl });
  await expect(service.backup(data)).rejects.toThrow('備份作業已失效');
  expect(fixture.liveFiles().filter(file => file.appProperties?.backupKind === 'manifest')).toEqual([]);
});
