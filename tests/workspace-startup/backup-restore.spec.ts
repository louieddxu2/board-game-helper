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
  await page.goto(`${site.origin}/privacy`);
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
    expect(fixture.liveFiles().filter(file => file.appProperties?.backupKind === 'manifest')).toHaveLength(Math.min(version, 3));
    if (version < 4) await page.locator('.workspace-overlay').click({ position: { x: 4, y: 4 } });
  }
  expect(fixture.liveFiles().filter(file => file.appProperties?.backupKind === 'table')).toHaveLength(3);
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
