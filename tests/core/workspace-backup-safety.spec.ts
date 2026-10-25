import { expect, test } from '@playwright/test';
import { seed } from '../workspace-startup/startupSupport';
import { connectFakeDrive } from '../workspace-startup/driveSupport';
import { createInMemoryDrive } from '../../src/workspace/googleDriveBackup/backupTestFixture';
import { createNode, createTable, emptyWorkspace } from '../../src/workspace/model';
import { exportWorkspaceBackupManifestXlsx, exportWorkspaceXlsxAsync } from '../../src/workspace/spreadsheet';
import { blobBytes } from '../../src/workspace/spreadsheetCodec';
import { DRIVE_SNAPSHOT_KEY, DRIVE_SNAPSHOT_XLSX } from '../../src/shared/driveSnapshots';
import { snapshotRevisionDigest } from '../../src/workspace/googleDriveBackup/snapshotJournal';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

// Encode synthetic files in Node; decoding and the actual Drive read flow run in the browser.
const createCloudFixture = async () => {
  const drive = createInMemoryDrive(); const timestamp = Date.now(); const id = crypto.randomUUID();
  const root = drive.addFile({ id: 'synthetic-root', name: '新版快照', mimeType: 'application/vnd.google-apps.folder', parents: ['root'],
    appProperties: { backupKey: DRIVE_SNAPSHOT_KEY, backupKind: 'root', schemaVersion: '4' } });
  const tags = (kind: string) => ({ backupKey: DRIVE_SNAPSHOT_KEY, backupKind: kind, schemaVersion: '4', snapshotId: id });
  const folder = drive.addFile({ id: 'synthetic-folder', name: `備份-${id}`, mimeType: 'application/vnd.google-apps.folder', parents: [root.id], appProperties: tags('snapshot') });
  const table = createTable('雲端收藏'); const node = createNode('table', table.name, null, 0, table.id);
  const cloud = { ...emptyWorkspace(), tables: [table], nodes: [node] };
  const file = drive.addFile({ id: 'synthetic-table', name: '收藏.xlsx', mimeType: DRIVE_SNAPSHOT_XLSX, parents: [folder.id],
    appProperties: { ...tags('table'), localId: table.id }, body: await blobBytes(await exportWorkspaceXlsxAsync(cloud, table)) });
  const refs = [{ id: table.id, nodeId: node.id, folderId: null, name: table.name, updatedAt: table.updatedAt, driveFileId: file.id, fileName: file.name }];
  const manifest = drive.addFile({ id: 'last-good-manifest', name: 'manifest.xlsx', mimeType: DRIVE_SNAPSHOT_XLSX, parents: [folder.id],
    appProperties: tags('manifest'), body: await blobBytes(exportWorkspaceBackupManifestXlsx(cloud, [], refs, timestamp, 'flat')) });
  const operation = { id, expectedRevision: 0, sourceRevision: 'a'.repeat(64), legacyStamp: await snapshotRevisionDigest('[]'),
    folderId: folder.id, fileIds: [manifest.id, file.id], status: 'committed', expiresAt: timestamp + 3_600_000,
    revision: 1, committedAt: timestamp, sourceUpdatedAt: timestamp,
    inventory: [manifest, file].map(item => ({ id: item.id, size: item.size, md5Checksum: item.md5Checksum, modifiedTime: item.modifiedTime })) };
  drive.addFile({ id: 'synthetic-receipt', name: `紀錄-${id}.json`, mimeType: 'application/json', parents: [root.id],
    appProperties: tags('receipt'), body: new TextEncoder().encode(JSON.stringify({ schema: 1, rootId: root.id, parents: [], operation })) });
  return { drive, manifest };
};

for (const retainedSettings of [true, false]) {
  test(`cleared mobile data warns on connection and never uploads (settings retained: ${retainedSettings})`, async ({ page }, info) => {
    const errors: string[] = [], writes: string[] = [], backendCalls: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const { drive, manifest } = await createCloudFixture();
    const modifiedTime = manifest.modifiedTime!;
    await connectFakeDrive(page, drive);
    page.on('request', request => {
      if (request.url().startsWith('https://www.googleapis.com/') && ['POST', 'PATCH', 'DELETE'].includes(request.method())) writes.push(request.url());
    });
    await page.route('**/api/workspace-backup/**', async route => {
      backendCalls.push(route.request().url());
      await route.fulfill({ status: 410, json: { error: 'backup_client_update_required' } });
    });

    await page.goto('/privacy');
    await seed(page, 2, 4, 1, 0);
    await page.evaluate(({ modifiedTime, fileId }) => {
      localStorage.setItem('board-game-helper-google-drive-auto-backup', 'true');
      localStorage.setItem('board-game-helper-google-drive-backup', JSON.stringify({
        fileId, fileName: 'manifest.xlsx', remoteModifiedTime: modifiedTime,
        lastBackupAt: 1, storageIdentity: 'previous-database', tableCount: 2, tableBackups: {},
      }));
    }, { modifiedTime, fileId: manifest.id });
    const session = await page.context().newCDPSession(page);
    await session.send('Storage.clearDataForOrigin', { origin: new URL(page.url()).origin,
      storageTypes: retainedSettings ? 'indexeddb' : 'indexeddb,local_storage' });
    await session.detach();
    await page.clock.install();
    await page.goto('/workspace');
    await expect(page.getByRole('button', { name: '建立表格', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '開啟目錄', exact: true }).tap();
    await page.getByRole('button', { name: '開啟 Google Drive 備份', exact: true }).tap();
    const dialog = page.getByRole('dialog', { name: 'Google Drive 備份' });
    await expect(dialog.getByRole('alert')).toHaveText('本機資料為空，已暫停自動備份。請先還原雲端備份。');
    await expect(dialog.getByText('自動備份已暫停', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '還原此備份', exact: true })).toBeEnabled();
    await expect(dialog.getByRole('button', { name: '以本機資料覆蓋雲端', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: '立即備份', exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('empty-backup-warning-mobile.png') });

    // The first native touch after the dialog becomes operable must work once.
    const close = dialog.getByRole('button', { name: '關閉', exact: true });
    await expect(close).toBeEnabled();
    await close.tap();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: '開啟目錄', exact: true }).tap();
    const automatic = page.getByRole('checkbox', { name: '自動備份', exact: true });
    if (!retainedSettings) await automatic.tap();
    await expect(automatic).toBeChecked();
    await page.getByRole('button', { name: '開啟 Google Drive 備份', exact: true }).tap();
    await expect(dialog.getByRole('alert')).toHaveText('本機資料為空，已暫停自動備份。請先還原雲端備份。');
    await page.clock.fastForward(31 * 60 * 1000);
    expect(writes).toEqual([]);
    expect(backendCalls).toEqual([]);
    expect(errors).toEqual([]);
  });
}
