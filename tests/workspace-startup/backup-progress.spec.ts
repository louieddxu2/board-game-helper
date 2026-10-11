import { expect, test, type Page, type Route } from '@playwright/test';
import { resolve } from 'node:path';
import { closeServer, seed, startServer } from './startupSupport';

let site: Awaited<ReturnType<typeof startServer>>;
test.beforeAll(async () => { site = await startServer(resolve('dist/client')); });
test.afterAll(async () => closeServer(site.server));

interface FakeDriveFile { id: string; name: string; mimeType: string; parents?: string[]; appProperties?: Record<string, string> }
const setup = async (page: Page) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    (window as any).google = { accounts: { oauth2: {
      initTokenClient: () => {
        const client = { callback: (_response: unknown) => undefined, requestAccessToken: () => client.callback({ access_token: 'test-token', expires_in: 3600 }) };
        return client;
      },
      revoke: (_token: string, done: () => void) => done(),
    } } };
  });
  await page.route('**/api/session', route => route.fulfill({ json: { user: null, googleDriveClientId: 'test-client' } }));
  const files = new Map<string, FakeDriveFile>();
  let nextId = 0;
  let heldTable: { route: Route; file: FakeDriveFile } | undefined;
  let heldConfirmation: { route: Route; files: FakeDriveFile[] } | undefined;
  let manifestUploaded = false;
  const json = (route: Route, value: unknown, status = 200) => route.fulfill({ status, json: value, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS' } });
  await page.route('https://www.googleapis.com/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') { await json(route, {}); return; }
    if (url.pathname.startsWith('/upload/')) {
      const metadata = request.postDataBuffer()?.toString().match(/Content-Type: application\/json; charset=UTF-8\r\n\r\n(\{[\s\S]*?\})\r\n--/)?.[1];
      if (!metadata) throw new Error('Missing upload metadata');
      const file = { ...JSON.parse(metadata), id: `file-${++nextId}` } as FakeDriveFile;
      if (file.appProperties?.backupKind === 'table') { heldTable = { route, file }; return; }
      files.set(file.id, file);
      manifestUploaded = true;
      await json(route, file);
      return;
    }
    if (request.method() === 'POST') {
      const file = { ...request.postDataJSON(), id: `folder-${++nextId}` } as FakeDriveFile;
      files.set(file.id, file);
      await json(route, file);
      return;
    }
    const query = url.searchParams.get('q') ?? '';
    const property = query.match(/key='([^']+)' and value='([^']+)'/);
    const name = query.match(/name = '([^']+)'/);
    const parent = query.match(/'([^']+)' in parents/);
    const found = [...files.values()].filter(file => (!property || file.appProperties?.[property[1]] === property[2]) && (!name || file.name === name[1]) && (!parent || file.parents?.includes(parent[1])));
    if (manifestUploaded && query.includes('dynamic-sheet-primary-workspace-v2')) { heldConfirmation = { route, files: found }; return; }
    await json(route, { files: found });
  });
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
      if (fail) await json(pending.route, { error: { message: '測試上傳失敗' } }, 500);
      else { files.set(pending.file.id, pending.file); await json(pending.route, pending.file); }
    },
    async finishConfirmation() {
      if (!heldConfirmation) throw new Error('No held remote confirmation');
      await json(heldConfirmation.route, { files: heldConfirmation.files });
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
