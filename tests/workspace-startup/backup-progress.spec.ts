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
  let heldConfirmation: { finish(missing: boolean): void } | undefined;
  let manifestUploaded = false;
  const fixture = createInMemoryDrive({
    onUpload: async file => {
      if (file.appProperties?.backupKind === 'table') await new Promise<void>((resolve, reject) => { heldTable = { file, resolve, reject }; });
      if (file.appProperties?.backupKind === 'manifest') manifestUploaded = true;
    },
    onList: async (query, files) => {
      if (!manifestUploaded || !query.includes(' in parents') || !query.includes("key='backupKey'")) return;
      await new Promise<void>(resolve => { heldConfirmation = { finish(missing) { manifestUploaded = false; if (missing) files.splice(0); resolve(); } }; });
    },
  });
  await connectFakeDrive(page, fixture);
  await page.goto(`${site.origin}/privacy`);
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
  await expect(dialog.getByText('已連結 Google Drive')).toBeVisible();
  await dialog.getByRole('button', { name: '立即備份' }).click();
  return {
    dialog, longName, errors,
    tableId: () => heldTable?.file.appProperties?.localId,
    async finishTable(fail = false) {
      if (!heldTable) throw new Error('No held table upload');
      const pending = heldTable;
      heldTable = undefined;
      if (fail) pending.reject(new Error('測試上傳失敗'));
      else pending.resolve();
    },
    async finishConfirmation(missing = false) {
      if (!heldConfirmation) throw new Error('No held remote confirmation');
      heldConfirmation.finish(missing);
    },
  };
};

test('shows each table upload and final confirmation on mobile without overflow or early completion', async ({ page }) => {
  const backup = await setup(page);
  await expect.poll(backup.tableId).toBe('table-0');
  await expect(backup.dialog.getByRole('status')).toContainText(`正在上傳表格：${backup.longName}`);
  await expect(backup.dialog.getByRole('status')).toContainText('已處理 0 / 2 張表格');
  await expect(backup.dialog.getByRole('progressbar')).toHaveAttribute('value', '0');
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
  await expect(backup.dialog.getByRole('progressbar')).toHaveAttribute('value', '1');
  await backup.finishTable();
  await expect(backup.dialog.getByRole('status')).toContainText('正在確認雲端備份');
  await expect(backup.dialog.getByRole('status')).toContainText('已處理 2 / 2 張表格');
  await expect(backup.dialog.getByRole('progressbar')).not.toHaveAttribute('value');
  await expect(backup.dialog.getByText('備份進行中')).toBeVisible();
  await backup.finishConfirmation();
  await expect(backup.dialog.getByRole('progressbar')).toHaveCount(0);
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

test('keeps the previous completion record when the uploaded backup cannot be confirmed', async ({ page }) => {
  const backup = await setup(page);
  const previousRecord = await page.evaluate(() => localStorage.getItem('board-game-helper-google-drive-backup'));
  await expect.poll(backup.tableId).toBe('table-0');
  await backup.finishTable();
  await expect.poll(backup.tableId).toBe('table-1');
  await backup.finishTable();
  await expect(backup.dialog.getByRole('status')).toContainText('正在確認雲端備份');
  await backup.finishConfirmation(true);
  await expect(backup.dialog.getByRole('alert')).toHaveText('備份檔已上傳，但無法確認雲端備份，請稍後尋找雲端備份');
  await expect(backup.dialog.getByRole('progressbar')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('board-game-helper-google-drive-backup'))).toBe(previousRecord);
  expect(backup.errors).toEqual([]);
});
