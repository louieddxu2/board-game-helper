import { expect, test } from '@playwright/test';
import { seed } from '../workspace-startup/startupSupport';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

for (const retainedSettings of [true, false]) {
  test(`cleared mobile data warns on connection and never uploads (settings retained: ${retainedSettings})`, async ({ page }, info) => {
    const errors: string[] = [], writes: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      (window as any).google = { accounts: { oauth2: {
        initTokenClient: () => {
          const client = { callback: (_response: unknown) => undefined,
            requestAccessToken: () => client.callback({ access_token: 'synthetic-token', expires_in: 3600 }) };
          return client;
        },
      } } };
    });
    await page.route('**/api/session', route => route.fulfill({ json: { user: null, googleDriveClientId: 'test-client' } }));
    const modifiedTime = '2026-10-25T00:00:00.000Z';
    await page.route('**/api/workspace-backup/**', async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/state')) {
        await route.fulfill({ json: { accountKey: 'synthetic-account', rootId: 'synthetic-root', revision: 1,
          legacyStamp: '0'.repeat(64), legacyChanged: false,
          versions: [{ id: '00000000-0000-4000-8000-000000000001', folderId: 'synthetic-folder',
            manifestId: 'last-good-manifest', modifiedTime, revision: 1, committedAt: 1, sourceUpdatedAt: 1 }] } });
      } else { writes.push(path); await route.fulfill({ status: 503, json: { error: 'unexpected_backup_write' } }); }
    });
    await page.route('https://www.googleapis.com/**', async route => {
      writes.push(`${route.request().method()} Google Drive`);
      await route.fulfill({ status: 503, json: { error: { message: 'unexpected Drive operation' } } });
    });

    await page.goto('/privacy');
    await seed(page, 2, 4, 1, 0);
    await page.evaluate(modifiedTime => {
      localStorage.setItem('board-game-helper-google-drive-auto-backup', 'true');
      localStorage.setItem('board-game-helper-google-drive-backup', JSON.stringify({
        fileId: 'last-good-manifest', fileName: 'manifest.xlsx', remoteModifiedTime: modifiedTime,
        lastBackupAt: 1, storageIdentity: 'previous-database', tableCount: 2, tableBackups: {},
      }));
    }, modifiedTime);
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
    expect(errors).toEqual([]);
  });
}
