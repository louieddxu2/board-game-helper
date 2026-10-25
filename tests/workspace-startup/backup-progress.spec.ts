import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { createInMemoryDrive, type StoredDriveFile } from '../../src/workspace/googleDriveBackup/backupTestFixture';
import { connectFakeDrive } from './driveSupport';
import { closeServer, seed, startServer } from './startupSupport';

let site: Awaited<ReturnType<typeof startServer>>;
test.beforeAll(async () => { site = await startServer(resolve('dist/client')); });
test.afterAll(async () => closeServer(site.server));

const setup = async (page: Page) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let heldTable: { file: StoredDriveFile; resolve(): void; reject(error: Error): void } | undefined;
  let heldManifest: { resolve(): void; reject(error: Error): void } | undefined;
  const fixture = createInMemoryDrive({
    onUpload: async file => {
      if (file.appProperties?.backupKind === 'table') await new Promise<void>((resolve, reject) => { heldTable = { file, resolve, reject }; });
      if (file.appProperties?.backupKind === 'manifest') await new Promise<void>((resolve, reject) => { heldManifest = { resolve, reject }; });
    },
  });
  await connectFakeDrive(page, fixture);
  await page.goto(`${site.origin}/__workspace-storage-seed`);
  await seed(page, 2, 250, 2, 0);
  const longName = '收藏表格與很長的名稱'.repeat(8);
  await page.evaluate(async longName => {
    const connection = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('board-game-helper-workspace'); request.onsuccess = () => resolve(request.result); });
    const transaction = connection.transaction(['tables', 'meta'], 'readwrite');
    const tableRequest = transaction.objectStore('tables').get('table-0');
    tableRequest.onsuccess = () => transaction.objectStore('tables').put({ ...tableRequest.result, name: longName }, 'table-0');
    const metaRequest = transaction.objectStore('meta').get('workspace');
    metaRequest.onsuccess = () => transaction.objectStore('meta').put({ ...metaRequest.result, nodes: metaRequest.result.nodes.map((node: { tableId: string }) => node.tableId === 'table-0' ? { ...node, name: longName } : node) }, 'workspace');
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
    connection.close();
  }, longName);
  await page.goto(`${site.origin}/workspace`);
  await page.getByRole('button', { name: '開啟目錄' }).click();
  await page.getByRole('button', { name: '開啟 Google Drive 備份' }).click();
  const dialog = page.getByRole('dialog', { name: 'Google Drive 備份' });
  await expect(dialog.getByRole('button', { name: '立即備份' })).toBeEnabled();
  await dialog.getByRole('button', { name: '立即備份' }).click();
  return {
    dialog, longName, errors,
    tableId: () => heldTable?.file.appProperties?.localId,
    manifestPending: () => Boolean(heldManifest),
    async finishTable(fail = false) {
      if (!heldTable) throw new Error('No held table upload');
      const pending = heldTable;
      heldTable = undefined;
      if (fail) pending.reject(new Error('測試上傳失敗'));
      else pending.resolve();
    },
    async finishManifest(fail = false) {
      if (!heldManifest) throw new Error('No held manifest upload');
      const pending = heldManifest; heldManifest = undefined;
      if (fail) pending.reject(new Error('測試索引上傳失敗'));
      else pending.resolve();
    },
  };
};

test('shows table progress and completes only after the final manifest upload succeeds', async ({ page }) => {
  const backup = await setup(page);
  await expect.poll(backup.tableId).toBe('table-0');
  await expect(backup.dialog.getByRole('status')).toContainText(`正在上傳表格：${backup.longName}`);
  await expect(backup.dialog.getByRole('status')).toContainText('已上傳 0 / 2 張表格');
  const progress = backup.dialog.getByRole('progressbar');
  const firstPercent = Number(await progress.getAttribute('value'));
  expect(firstPercent).toBeGreaterThan(0); expect(firstPercent).toBeLessThan(100);
  const geometry = await backup.dialog.evaluate(element => {
    const box = element.getBoundingClientRect();
    const progress = element.querySelector('.workspace-google-drive-progress')!;
    return { left: box.left, right: box.right, viewport: window.innerWidth, fits: progress.scrollWidth <= progress.clientWidth };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0); expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.fits).toBe(true);
  await page.screenshot({ path: 'test-results/backup-progress-mobile.png' });
  await backup.finishTable();
  await expect.poll(backup.tableId).toBe('table-1');
  await expect(backup.dialog.getByRole('status')).toContainText('正在上傳表格：測試表 1');
  await expect(backup.dialog.getByRole('status')).toContainText('已上傳 1 / 2 張表格');
  const secondPercent = Number(await progress.getAttribute('value'));
  expect(secondPercent).toBeGreaterThan(firstPercent); expect(secondPercent).toBeLessThan(100);
  await backup.finishTable();
  await expect.poll(backup.manifestPending).toBe(true);
  await expect(backup.dialog.getByRole('status')).toContainText('正在儲存備份目錄');
  await expect(backup.dialog.getByRole('status')).not.toContainText('張表格');
  const confirmingPercent = Number(await progress.getAttribute('value'));
  expect(confirmingPercent).toBeGreaterThan(secondPercent); expect(confirmingPercent).toBeLessThan(100);
  await expect(backup.dialog.getByText('備份進行中')).toBeVisible();
  await backup.finishManifest();
  await expect(progress).toHaveAttribute('value', '100');
  await expect(backup.dialog.getByText('已完成備份', { exact: true })).toBeVisible();
  expect(backup.errors).toEqual([]);
});

test('replaces an interrupted upload with its error and re-enables backup', async ({ page }) => {
  const backup = await setup(page);
  await expect.poll(backup.tableId).toBe('table-0');
  await expect(backup.dialog.getByRole('progressbar')).toBeVisible();
  await backup.finishTable(true);
  await expect(backup.dialog.getByRole('alert')).toHaveText('測試上傳失敗');
  await expect(backup.dialog.getByRole('progressbar')).toHaveCount(0);
  await expect(backup.dialog.getByRole('button', { name: '立即備份' })).toBeEnabled();
  expect(backup.errors).toEqual([]);
});

test('keeps the previous completion record when the final manifest upload fails', async ({ page }) => {
  const backup = await setup(page);
  const previousRecord = await page.evaluate(() => localStorage.getItem('board-game-helper-google-drive-backup'));
  await expect.poll(backup.tableId).toBe('table-0');
  await backup.finishTable();
  await expect.poll(backup.tableId).toBe('table-1');
  await backup.finishTable();
  await expect.poll(backup.manifestPending).toBe(true);
  await expect(backup.dialog.getByRole('status')).toContainText('正在儲存備份目錄');
  await backup.finishManifest(true);
  await expect(backup.dialog.getByRole('alert')).toHaveText('測試索引上傳失敗');
  await expect(backup.dialog.getByRole('progressbar')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('board-game-helper-google-drive-backup'))).toBe(previousRecord);
  expect(backup.errors).toEqual([]);
});
