import { expect, test } from '@playwright/test';
import { seed } from '../workspace-startup/startupSupport';
import { connectFakeDrive } from '../workspace-startup/driveSupport';
import { createInMemoryDrive } from '../../src/workspace/googleDriveBackup/backupTestFixture';
import { createGoogleDriveSnapshotBackup } from '../../src/workspace/googleDriveBackup/snapshotBackup';
import { createNode, createTable, emptyWorkspace } from '../../src/workspace/model';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

for (const retainedSettings of [true, false]) {
  test(`cleared mobile IndexedDB never uploads after connection (settings retained: ${retainedSettings})`, async ({ page }) => {
    const drive = createInMemoryDrive();
    const table = createTable('雲端收藏');
    const cloud = { ...emptyWorkspace(), tables: [table], nodes: [createNode('table', table.name, null, 0, table.id)] };
    // Build cloud files through the current service, without coordinator records or synthetic receipts.
    const service = createGoogleDriveSnapshotBackup({ folderPath: ['BoardGameHelper', '動態表格備份'], backupKey: 'dynamic-sheet-primary-workspace-v2',
      tokenProvider: { getAccessToken: async () => 'test-token' }, fetchImpl: drive.fetchImpl });
    const receipt = await service.backup(cloud);
    const errors: string[] = [], writes: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await connectFakeDrive(page, drive);
    page.on('request', request => {
      if (request.url().startsWith('https://www.googleapis.com/') && ['POST', 'PATCH', 'DELETE'].includes(request.method())) writes.push(request.url());
    });
    await page.goto('/__workspace-storage-seed');
    await seed(page, 2, 4, 1, 0);
    await page.evaluate(file => {
      localStorage.setItem('board-game-helper-google-drive-auto-backup', 'true');
      localStorage.setItem('board-game-helper-google-drive-backup', JSON.stringify({ fileId: file.id, fileName: file.name,
        remoteModifiedTime: file.modifiedTime, lastBackupAt: 1, storageIdentity: 'previous-database', tableCount: 2, tableBackups: {} }));
    }, receipt.file);
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
    await expect(dialog.getByRole('button', { name: '還原此備份', exact: true })).toBeEnabled();
    await expect(dialog.getByRole('button', { name: '立即備份', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: '以本機資料覆蓋雲端', exact: true })).toHaveCount(0);
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
    expect(drive.get(receipt.file.id)?.trashed).not.toBe(true);
    expect(errors).toEqual([]);
  });
}
