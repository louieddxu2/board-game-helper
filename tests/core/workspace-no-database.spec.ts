import { expect, test } from '@playwright/test';
import { seed, readTableCell } from '../workspace-startup/startupSupport';
import { connectFakeDrive } from '../workspace-startup/driveSupport';
import { createInMemoryDrive } from '../../src/workspace/googleDriveBackup/backupTestFixture';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test('Workspace startup, editing, search, settings, backup and reload never request website data or sessions', async ({ page, context }) => {
  const siteRequests: string[] = [], errors: string[] = [];
  const drive = createInMemoryDrive();
  await connectFakeDrive(page, drive);
  await context.addCookies([{ name: 'wbr_session', value: 'old-website-session', url: 'http://127.0.0.1:' + (process.env.CORE_TEST_PORT ?? '4173') }]);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) siteRequests.push(url.pathname);
  });
  await page.route('**/api/**', async route => {
    if (new URL(route.request().url()).pathname === '/api/workspace-config') {
      await route.fulfill({ json: { googleDriveClientId: 'test-client' } });
    } else await route.abort('blockedbyclient');
  });

  await page.goto('/workspace');
  await expect(page.getByRole('button', { name: '建立表格', exact: true })).toBeVisible();
  expect(siteRequests).toEqual([]);
  await seed(page, 2, 4, 2, 0);
  await page.reload();
  const cell = page.locator('[data-cell-id="row-0:column-0"]');
  await expect(cell).toBeVisible();
  await cell.tap();
  await page.getByRole('dialog').getByRole('textbox').fill('僅儲存於本機');
  await page.locator('.workspace-overlay').tap({ position: { x: 4, y: 4 } });
  await expect.poll(() => readTableCell(page, 'table-0', 'row-0', 'column-0')).toBe('僅儲存於本機');
  await page.getByRole('button', { name: '搜尋', exact: true }).tap();
  await page.getByRole('searchbox').fill('僅儲存於本機');
  await expect(cell).toBeVisible();
  await page.getByRole('button', { name: '清除搜尋與篩選', exact: true }).tap();
  await page.getByRole('button', { name: '設定', exact: true }).tap();
  await expect(page.locator('[aria-label="表格工具列"]')).toBeVisible();
  await page.getByRole('button', { name: '欄位顯示設定', exact: true }).tap();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('.workspace-overlay').tap({ position: { x: 4, y: 4 } });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(siteRequests).toEqual([]);

  await page.getByRole('button', { name: '開啟目錄', exact: true }).tap();
  await page.getByRole('button', { name: '開啟 Google Drive 備份', exact: true }).tap();
  const dialog = page.getByRole('dialog', { name: 'Google Drive 備份' });
  const backup = dialog.getByRole('button', { name: '立即備份', exact: true });
  await expect(backup).toBeEnabled();
  await backup.tap();
  await expect(dialog.getByText('已完成備份', { exact: true })).toBeVisible();
  expect(drive.calls.uploads.some(upload => upload.metadata.appProperties?.backupKind === 'manifest')).toBe(true);
  await page.reload();
  await expect(page.locator('[data-cell-id="row-0:column-0"]')).toHaveText('僅儲存於本機');
  expect(siteRequests).toEqual(['/api/workspace-config']);
  expect(errors).toEqual([]);
});
