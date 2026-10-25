import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { createInMemoryDrive } from '../../src/workspace/googleDriveBackup/backupTestFixture';
import { closeServer, readTableCell, seed, startServer } from './startupSupport';
import { connectFakeDrive } from './driveSupport';

let site: Awaited<ReturnType<typeof startServer>>;
test.beforeAll(async () => { site = await startServer(resolve('dist/client')); });
test.afterAll(async () => closeServer(site.server));

test('mobile backups stay at three versions and an older version restores to IndexedDB after preview', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const fixture = createInMemoryDrive();
  await connectFakeDrive(page, fixture);
  await page.goto(`${site.origin}/__workspace-storage-seed`);
  await seed(page, 1, 4, 2, 0);
  await page.goto(`${site.origin}/workspace`);
  const drive = page.getByRole('dialog', { name: 'Google Drive 備份' });
  const openDrive = async () => { await page.getByRole('button', { name: '開啟目錄' }).click(); await page.getByRole('button', { name: '開啟 Google Drive 備份' }).click(); };
  for (let version = 1; version <= 4; version++) {
    await page.locator('[data-cell-id="row-0:column-0"]').click();
    await page.getByRole('dialog').getByRole('textbox').fill(`備份 ${version}`);
    await page.locator('.workspace-overlay').click({ position: { x: 4, y: 4 } });
    await expect.poll(() => readTableCell(page, 'table-0', 'row-0', 'column-0')).toBe(`備份 ${version}`);
    await openDrive();
    await drive.getByRole('button', { name: '立即備份', exact: true }).click();
    await expect(drive.getByText('已完成備份', { exact: true })).toBeVisible();
    await expect.poll(() => fixture.liveFiles().filter(file => file.appProperties?.backupKind === 'manifest').length).toBe(Math.min(version, 3));
    if (version < 4) await page.locator('.workspace-overlay').click({ position: { x: 4, y: 4 } });
  }
  await expect.poll(() => fixture.liveFiles().filter(file => file.appProperties?.backupKind === 'table').length).toBe(3);
  await drive.getByRole('button', { name: '選擇備份還原', exact: true }).click();
  const versions = drive.getByRole('combobox', { name: '選擇備份版本' });
  await expect(versions.locator('option')).toHaveCount(3);
  await versions.selectOption({ index: 2 });
  await expect(drive.getByRole('button', { name: '以本機資料覆蓋雲端' })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('backup-versions-mobile.png') });
  const geometry = await drive.evaluate(element => ({ width: element.getBoundingClientRect().width, contentFits: element.scrollWidth <= element.clientWidth }));
  expect(geometry.width).toBeLessThanOrEqual(390); expect(geometry.contentFits).toBe(true);
  await drive.getByRole('button', { name: '還原此備份', exact: true }).click();
  const preview = page.getByRole('dialog', { name: '匯入整個資料庫' });
  await expect(preview).toBeVisible();
  expect(await readTableCell(page, 'table-0', 'row-0', 'column-0')).toBe('備份 4');
  await preview.getByRole('button', { name: '取代', exact: true }).click();
  await expect(page.locator('td[data-bulk-column-id="column-0"]').first()).toHaveText('備份 2');
  await page.reload();
  await expect(page.locator('td[data-bulk-column-id="column-0"]').first()).toHaveText('備份 2');
  expect(errors).toEqual([]);
});

test('a native two-table backup makes five API calls, or six when retiring one old folder', async ({ page }) => {
  const fixture = createInMemoryDrive();
  const requests: Array<{ method: string; path: string }> = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.url().startsWith('https://www.googleapis.com/') && request.method() !== 'OPTIONS') {
      requests.push({ method: request.method(), path: new URL(request.url()).pathname });
    }
  });
  await connectFakeDrive(page, fixture);
  await page.goto(`${site.origin}/__workspace-storage-seed`);
  await seed(page, 2, 4, 2, 0);
  await page.goto(`${site.origin}/workspace`);
  const dialog = page.getByRole('dialog', { name: 'Google Drive 備份' });
  for (const version of [1, 2, 3, 4]) {
    await page.locator('[data-cell-id="row-0:column-0"]').tap();
    await page.getByRole('dialog').getByRole('textbox').fill(`請求預算 ${version}`);
    await page.locator('.workspace-overlay').tap({ position: { x: 4, y: 4 } });
    await expect.poll(() => readTableCell(page, 'table-0', 'row-0', 'column-0')).toBe(`請求預算 ${version}`);
    await page.getByRole('button', { name: '開啟目錄' }).tap();
    await page.getByRole('button', { name: '開啟 Google Drive 備份' }).tap();
    const button = dialog.getByRole('button', { name: '立即備份', exact: true });
    await expect(button).toBeEnabled();
    requests.length = 0;
    await button.tap();
    await expect(dialog.getByText('已完成備份', { exact: true })).toBeVisible();
    if (version === 4) await expect.poll(() => fixture.calls.trash.length).toBe(1);
    if (version > 1) {
      process.stdout.write(`[native-two-table-requests] ${JSON.stringify({ version, total: requests.length,
        reads: requests.filter(request => request.method === 'GET').length,
        writes: requests.filter(request => request.method === 'POST').length })}\n`);
      expect(requests.filter(request => request.method === 'GET')).toHaveLength(1);
      expect(requests.filter(request => request.method === 'POST')).toHaveLength(4);
      expect(requests).toHaveLength(version === 4 ? 6 : 5);
      expect(fixture.calls.downloads).toEqual([]);
    }
    await page.locator('.workspace-overlay').tap({ position: { x: 4, y: 4 } });
  }
  expect(fixture.liveFiles().filter(file => file.appProperties?.backupKind === 'manifest')).toHaveLength(3);
  expect(errors).toEqual([]);
});
