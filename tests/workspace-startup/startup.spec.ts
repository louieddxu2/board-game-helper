import { expect, test, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

// Serve the actual production build, without D1, user accounts, or external services.
const startServer = async (directory: string) => {
  const state = { documentDelay: 0, workspaceRequests: 0 };
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url!, 'http://localhost').pathname;
    if (pathname === '/workspace') {
      state.workspaceRequests++;
      if (state.documentDelay) await new Promise((done) => setTimeout(done, state.documentDelay));
    }
    if (pathname.startsWith('/api/')) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ user: null, googleClientId: null }));
      return;
    }
    const file = extname(pathname) ? pathname : '/index.html';
    try {
      const body = await readFile(resolve(directory, `.${file}`));
      response.writeHead(200, {
        'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' } as Record<string, string>)[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(body);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  return { server, state, origin: `http://127.0.0.1:${address.port}` };
};

let site: Awaited<ReturnType<typeof startServer>>;
const closeServer = (server: Server) => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); });
test.beforeAll(async () => { site = await startServer(resolve('dist/client')); });
test.afterAll(async () => { await closeServer(site.server); });
test.beforeEach(() => { site.state.documentDelay = 0; });

const waitForOfflineShell = async (page: Page) => {
  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration?.active?.state;
  })).toBe('activated');
};

const seed = async (page: Page, tables = 1, rows = 4, columns = 2, historyEntries = 40) => page.evaluate(async ({ tables, rows, columns, historyEntries }) => {
  const request = indexedDB.open('board-game-helper-workspace');
  request.onupgradeneeded = () => {
    for (const name of ['state', 'meta', 'tables', 'history']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
  };
  const db = await new Promise<IDBDatabase>((done, reject) => { request.onsuccess = () => done(request.result); request.onerror = () => reject(request.error); });
  const transaction = db.transaction(['meta', 'tables', 'history'], 'readwrite');
  transaction.objectStore('meta').put({ version: 1, activeNodeId: 'node-0', bottomNavigationTableIds: [], nodes: Array.from({ length: tables }, (_, index) => ({ id: `node-${index}`, type: 'table', tableId: `table-${index}`, name: `測試表 ${index}`, parentId: null, order: index })) }, 'workspace');
  for (let index = 0; index < tables; index++) {
    transaction.objectStore('tables').put({
      id: `table-${index}`, name: `測試表 ${index}`, rowHeaderName: '項目', updatedAt: Date.now(),
      columns: Array.from({ length: columns }, (_, col) => ({ id: `column-${col}`, name: `欄位 ${col}`, inputType: 'text', overflowMode: 'expand', options: [] })),
      rows: Array.from({ length: rows }, (_, row) => ({ id: `row-${row}`, name: `項目 ${row}`, values: Object.fromEntries(Array.from({ length: columns }, (_, col) => [`column-${col}`, `資料 ${row}-${col}`])) })),
    }, `table-${index}`);
    transaction.objectStore('history').put({ tableId: `table-${index}`, future: [], past: Array.from({ length: historyEntries }, (_, entry) => ({ id: `entry-${index}-${entry}`, tableId: `table-${index}`, label: '歷史編輯', createdAt: Date.now(), action: { type: 'set-cells', columnId: 'column-0', changes: Array.from({ length: rows }, (_, row) => ({ rowId: `row-${row}`, before: '之前', after: `資料 ${row}-0` })) } })) }, `table-${index}`);
  }
  await new Promise<void>((done, reject) => { transaction.oncomplete = () => done(); transaction.onerror = () => reject(transaction.error); });
  db.close();
  localStorage.setItem('board-game-helper-google-drive-backup', JSON.stringify({ lastBackupAt: Date.now(), tableBackups: {}, structureFingerprint: '' }));
}, { tables, rows, columns, historyEntries });

const readTableCell = (page: Page, tableId: string, rowId: string, columnId: string) => page.evaluate(async ({ tableId, rowId, columnId }) => {
  const request = indexedDB.open('board-game-helper-workspace');
  const db = await new Promise<IDBDatabase>((done, reject) => { request.onsuccess = () => done(request.result); request.onerror = () => reject(request.error); });
  const transaction = db.transaction(['tables', 'rowChunks']);
  const table = await new Promise<any>((done, reject) => {
    const get = transaction.objectStore('tables').get(tableId);
    get.onsuccess = () => done(get.result);
    get.onerror = () => reject(get.error);
  });
  const rows = table.rows ?? await new Promise<any[]>((done, reject) => {
    const get = transaction.objectStore('rowChunks').getAll(IDBKeyRange.bound([tableId, ''], [tableId, '\uffff']));
    get.onsuccess = () => done(get.result.flatMap((chunk) => chunk.rows));
    get.onerror = () => reject(get.error);
  });
  db.close();
  const row = rows.find((item: { id: string }) => item.id === rowId);
  return row?.values[columnId] ?? null;
}, { tableId, rowId, columnId });

const visibleVirtualRowIds = (page: Page) => page.locator('.workspace-table tbody tr[data-virtual-row-id]').evaluateAll((items) => items.map((item) => item.getAttribute('data-virtual-row-id')));
// Simulate a busy browser so foreground fallback/paging tests cannot rely on background completion.
const holdIdleWork = (page: Page) => page.addInitScript(() => {
  const callbacks = new Map<number, IdleRequestCallback>();
  let next = 0;
  window.requestIdleCallback = callback => { callbacks.set(++next, callback); return next; };
  window.cancelIdleCallback = id => { callbacks.delete(id); };
  (window as any).releaseWorkspaceIdleWork = () => {
    const pending = [...callbacks.values()]; callbacks.clear();
    for (const callback of pending) callback({ didTimeout: false, timeRemaining: () => 20 });
  };
});
const trackWorkspaceReads = (page: Page) => page.addInitScript(() => {
  const painted = new Set<string>();
  const frame = () => {
    const title = document.querySelector('[aria-label="重新命名表格"]')?.textContent;
    if (title && document.querySelector('tr[data-virtual-row-id]')) painted.add(title);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  (window as any).workspaceReads = [];
  for (const method of ['get', 'getAll', 'getAllKeys'] as const) {
    const original = IDBObjectStore.prototype[method];
    IDBObjectStore.prototype[method] = function (this: IDBObjectStore, ...args: unknown[]) {
      const key = args[0] instanceof IDBKeyRange ? (args[0].lower as unknown[])[0] : args[0];
      (window as any).workspaceReads.push({ store: this.name, method, key, painted: [...painted] });
      return Reflect.apply(original, this, args);
    } as typeof original;
  }
});
const waitForProjection = (page: Page, count: number) => expect.poll(() => page.evaluate(async () => {
  const request = indexedDB.open('board-game-helper-workspace');
  const connection = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result); });
  const get = connection.transaction('tableHeads').objectStore('tableHeads').get('table-0');
  const head = await new Promise<any>(resolve => { get.onsuccess = () => resolve(get.result); }); connection.close();
  return head?.rowCount;
})).toBe(count);

const transposedLabels = async (page: Page) => {
  const headers = await page.locator('.workspace-table thead th[data-row-id] button.workspace-column-name').evaluateAll((items) => items.map((item) => item.textContent?.trim() || ''));
  const filters = await page.locator('.workspace-filterbar-button').evaluateAll((items) => items.map((item) => (item.getAttribute('aria-label') || '').replace(/^篩選\s*/, '')));
  return { headers, filters };
};

test('a migrated 10k-row table opens without full reads, fills the latest scroll window and resumes the first edit', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${site.origin}/privacy`);
  await seed(page, 2, 10000, 2, 0);
  await page.goto(`${site.origin}/workspace`);
  await expect(page.locator('tr[data-virtual-row-id="row-0"]')).toBeVisible();
  await waitForProjection(page, 10000);
  await holdIdleWork(page);
  await trackWorkspaceReads(page);
  await page.reload();
  const rows = page.locator('.workspace-table tbody tr[data-virtual-row-id]');
  await expect(rows.first()).toHaveAttribute('data-virtual-row-id', 'row-0');
  await page.getByRole('button', { name: '開啟目錄' }).click();
  await expect(page.getByRole('button', { name: /測試表 1/ }).first()).toBeVisible();
  await page.getByRole('button', { name: '關閉目錄', exact: true }).last().click();
  expect(await page.evaluate(() => (window as any).workspaceReads.filter((read: any) => ['tables', 'rowChunks', 'tableState', 'history', 'historyEntries'].includes(read.store)))).toEqual([]);
  const viewport = page.locator('.workspace-table-viewport');
  await viewport.evaluate(element => { element.scrollTop = 1000 * 36; element.scrollTop = 9000 * 36; });
  await expect.poll(async () => (await visibleVirtualRowIds(page)).some(id => Number(id!.slice(4)) >= 8990)).toBe(true);
  expect(await rows.count()).toBeLessThan(80);
  await viewport.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(rows.last()).toHaveAttribute('data-virtual-row-id', 'row-9999');
  const cell = page.locator('td[data-bulk-row-id="row-9999"][data-bulk-column-id="column-0"]');
  await cell.click();
  const editor = page.getByRole('textbox').first();
  await editor.fill('按需載入後的第一次編輯'); await editor.press('Escape');
  await expect(cell).toContainText('按需載入後的第一次編輯');
  await expect.poll(() => readTableCell(page, 'table-0', 'row-9999', 'column-0')).toBe('按需載入後的第一次編輯');
  await expect.poll(() => readTableCell(page, 'table-1', 'row-9999', 'column-0')).toBe('資料 9999-0');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('board-game-helper-workspace-view-state') ?? '{}').tables?.['table-0']?.scrollTop ?? 0)).toBeGreaterThan(9900 * 36);
  await page.reload();
  await expect(cell).toContainText('按需載入後的第一次編輯');
  await page.getByRole('button', { name: '開啟目錄' }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '匯出全部資料', exact: true }).click();
  const download = await downloaded;
  const stream = await download.createReadStream();
  const parts: Buffer[] = [];
  for await (const part of stream!) parts.push(Buffer.from(part));
  const archive = Buffer.concat(parts).toString('utf8');
  expect(archive).toContain('測試表 1'); expect(archive).toContain('資料 9999-0');
  expect(archive).toContain('按需載入後的第一次編輯');
  expect(errors).toEqual([]);
});

test('the visible table hydrates automatically after paint without reading other tables or history', async ({ page }) => {
  await page.goto(`${site.origin}/privacy`);
  await seed(page, 3, 10000, 2, 0);
  await page.goto(`${site.origin}/workspace`);
  await waitForProjection(page, 10000);
  await page.getByRole('button', { name: '開啟目錄' }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '匯出全部資料', exact: true }).click();
  await downloaded;
  await trackWorkspaceReads(page);
  await page.reload();
  await expect(page.locator('tr[data-virtual-row-id="row-0"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).workspaceReads.filter((read: any) => read.store === 'rowChunks' && read.method === 'getAll').length)).toBe(1);
  const reads = await page.evaluate(() => (window as any).workspaceReads as { store: string; method: string; key: string; painted: string[] }[]);
  expect(reads.filter(read => ['tables', 'tableState', 'rowChunks'].includes(read.store) && read.method !== 'getAllKeys').every(read => read.key === 'table-0' && read.painted.includes('測試表 0'))).toBe(true);
  expect(reads.some(read => ['history', 'historyEntries'].includes(read.store))).toBe(false);
  await page.locator('td[data-bulk-row-id="row-0"][data-bulk-column-id="column-0"]').click();
  await page.getByRole('textbox').first().press('Escape');
  await page.getByRole('button', { name: '搜尋', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: '搜尋此表' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).workspaceReads.filter((read: any) => read.store === 'rowChunks' && read.method === 'getAll').length)).toBe(1);
  await page.getByRole('button', { name: '搜尋', exact: true }).click();
  await page.getByRole('button', { name: '開啟目錄' }).click();
  await page.locator('.workspace-tree-row[data-node-id="node-1"] .workspace-tree-name').click();
  await expect(page.getByRole('button', { name: '重新命名表格' })).toHaveText('測試表 1');
  await expect.poll(() => page.evaluate(() => (window as any).workspaceReads.filter((read: any) => read.store === 'rowChunks' && read.method === 'getAll').length)).toBe(2);
  const later = await page.evaluate(() => (window as any).workspaceReads as { store: string; method: string; key: string; painted: string[] }[]);
  const next = later.filter(read => ['tables', 'tableState', 'rowChunks'].includes(read.store) && read.method !== 'getAllKeys' && read.key === 'table-1');
  expect(next.length).toBeGreaterThan(0);
  expect(next.every(read => read.painted.includes('測試表 1'))).toBe(true);
  expect(later.some(read => ['tables', 'tableState', 'rowChunks'].includes(read.store) && read.key === 'table-2')).toBe(false);
  expect(later.some(read => ['history', 'historyEntries'].includes(read.store))).toBe(false);
});

test('background completion keeps the visible variable-height row after a rapid deep scroll', async ({ page }) => {
  await page.goto(`${site.origin}/privacy`);
  await seed(page, 2, 10000, 2, 0);
  await page.evaluate(async () => {
    const request = indexedDB.open('board-game-helper-workspace');
    const connection = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result); });
    const transaction = connection.transaction('tables', 'readwrite');
    const store = transaction.objectStore('tables');
    const get = store.get('table-0');
    const table = await new Promise<any>(resolve => { get.onsuccess = () => resolve(get.result); });
    table.columns[0] = { ...table.columns[0], overflowMode: 'wrap', widthLimitChars: 8, lineLimit: 4 };
    for (let index = 0; index < table.rows.length; index += 7) table.rows[index].values['column-0'] = '多行內容 '.repeat(24);
    store.put(table, 'table-0');
    await new Promise<void>(resolve => { transaction.oncomplete = () => resolve(); }); connection.close();
  });
  await page.goto(`${site.origin}/workspace`);
  await waitForProjection(page, 10000);
  await page.getByRole('button', { name: '開啟目錄' }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '匯出全部資料', exact: true }).click();
  await downloaded;
  await holdIdleWork(page); await trackWorkspaceReads(page); await page.reload();
  const viewport = page.locator('.workspace-table-viewport');
  await expect(page.locator('tr[data-virtual-row-id="row-0"]')).toBeVisible();
  await viewport.evaluate(element => { element.scrollTop = 1000 * 36; element.scrollTop = 9000 * 36; });
  await expect.poll(async () => (await visibleVirtualRowIds(page)).some(id => Number(id!.slice(4)) >= 8990)).toBe(true);
  const anchor = await viewport.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const contentTop = element.querySelector('thead')!.getBoundingClientRect().bottom;
    return [...element.querySelectorAll<HTMLTableRowElement>('tr[data-virtual-row-id]')].find(row => row.getBoundingClientRect().top >= contentTop && row.getBoundingClientRect().bottom <= rect.bottom)!.dataset.virtualRowId!;
  });
  await page.evaluate(() => { (window as any).releaseWorkspaceIdleWork(); });
  await expect.poll(() => page.evaluate(() => (window as any).workspaceReads.filter((read: any) => read.store === 'rowChunks' && read.method === 'getAll').map((read: any) => read.key))).toEqual(['table-0']);
  // Fixed controls wait for hydration without scrolling the target row into view.
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await expect(page.locator('[aria-label="表格工具列"]')).toBeVisible();
  await expect.poll(() => viewport.evaluate((element, id) => {
    const row = element.querySelector<HTMLTableRowElement>(`tr[data-virtual-row-id="${id}"]`);
    if (!row) return false;
    const rect = row.getBoundingClientRect();
    return rect.bottom > element.querySelector('thead')!.getBoundingClientRect().bottom && rect.top < element.getBoundingClientRect().bottom;
  }, anchor)).toBe(true);
  expect(await page.locator('tr[data-virtual-row-id]').count()).toBeLessThan(80);
});

test('navigation cancels a pending background read for the previous table', async ({ page }) => {
  await page.goto(`${site.origin}/privacy`);
  await seed(page, 3, 600, 2, 0);
  await page.goto(`${site.origin}/workspace`);
  await waitForProjection(page, 600);
  await page.getByRole('button', { name: '開啟目錄' }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '匯出全部資料', exact: true }).click();
  await downloaded;
  await holdIdleWork(page); await trackWorkspaceReads(page);
  await page.reload();
  await expect(page.locator('tr[data-virtual-row-id="row-0"]')).toBeVisible();
  await page.getByRole('button', { name: '開啟目錄' }).click();
  await page.locator('.workspace-tree-row[data-node-id="node-1"] .workspace-tree-name').click();
  await expect(page.getByRole('button', { name: '重新命名表格' })).toHaveText('測試表 1');
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    await new Promise(resolve => setTimeout(resolve, 0));
    (window as any).releaseWorkspaceIdleWork();
  });
  await expect.poll(() => page.evaluate(() => (window as any).workspaceReads.filter((read: any) => read.store === 'rowChunks' && read.method === 'getAll').map((read: any) => read.key))).toEqual(['table-1']);
  await expect(page.getByRole('button', { name: '重新命名表格' })).toHaveText('測試表 1');
});

for (const mode of ['loaded', 'paged'] as const) test(`switching to a ${mode} table cancels the previous column draft`, async ({ page }) => {
  await page.goto(`${site.origin}/privacy`);
  await seed(page, 2, 600, 2, 0);
  await page.goto(`${site.origin}/workspace`);
  await waitForProjection(page, 600);
  await page.getByRole('button', { name: '開啟目錄' }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: '匯出全部資料', exact: true }).click();
  await downloaded;
  if (mode === 'paged') { await holdIdleWork(page); await page.reload(); }
  await page.getByRole('columnheader', { name: '欄位 0', exact: true }).click();
  await page.getByRole('textbox', { name: '屬性名稱' }).fill('尚未儲存的舊表設定');
  // Exercise navigation arriving while a draft dialog is already open.
  await page.getByRole('button', { name: '開啟目錄' }).evaluate(element => (element as HTMLButtonElement).click());
  await page.locator('.workspace-tree-row[data-node-id="node-1"] .workspace-tree-name').evaluate(element => (element as HTMLElement).click());
  await expect(page.getByRole('button', { name: '重新命名表格' })).toHaveText('測試表 1');
  await expect(page.getByRole('dialog', { name: '屬性設定' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: '欄位 0', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '開啟目錄' }).click();
  await page.locator('.workspace-tree-row[data-node-id="node-0"] .workspace-tree-name').click();
  await expect(page.getByRole('columnheader', { name: '欄位 0', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('failed saves survive loading another table and retry without losing unloaded rows', async ({ page }) => {
  await page.goto(`${site.origin}/privacy`);
  await seed(page, 2, 600, 2, 0);
  await page.goto(`${site.origin}/workspace`);
  await waitForProjection(page, 600);
  await holdIdleWork(page);
  await page.reload();
  await page.evaluate(() => {
    (window as any).workspaceFailWrites = true;
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<typeof original>) {
      if (this.name === 'rowChunks' && (window as any).workspaceFailWrites) throw new DOMException('Simulated quota', 'QuotaExceededError');
      return Reflect.apply(original, this, args);
    };
  });
  const cell = page.locator('td[data-bulk-row-id="row-0"][data-bulk-column-id="column-0"]');
  await cell.click();
  const editor = page.getByRole('textbox').first();
  await editor.fill('尚未寫入但保留於記憶體'); await editor.press('Escape');
  await expect(cell).toContainText('尚未寫入但保留於記憶體');
  await expect.poll(() => readTableCell(page, 'table-0', 'row-0', 'column-0')).toBe('資料 0-0');
  await page.getByRole('button', { name: '開啟目錄' }).click();
  await page.locator('.workspace-tree-row[data-node-id="node-1"] .workspace-tree-name').click();
  await expect(page.getByRole('button', { name: '重新命名表格' })).toHaveText('測試表 1');
  await page.getByRole('button', { name: '開啟目錄' }).click();
  await page.locator('.workspace-tree-row[data-node-id="node-0"] .workspace-tree-name').click();
  await expect(cell).toContainText('尚未寫入但保留於記憶體');
  await page.evaluate(() => { (window as any).workspaceFailWrites = false; });
  await page.locator('td[data-bulk-row-id="row-1"][data-bulk-column-id="column-0"]').click();
  await editor.fill('重試成功'); await editor.press('Escape');
  await expect.poll(() => readTableCell(page, 'table-0', 'row-0', 'column-0')).toBe('尚未寫入但保留於記憶體');
  await expect.poll(() => readTableCell(page, 'table-0', 'row-1', 'column-0')).toBe('重試成功');
  await expect.poll(() => readTableCell(page, 'table-0', 'row-599', 'column-0')).toBe('資料 599-0');
  await expect.poll(() => readTableCell(page, 'table-1', 'row-599', 'column-0')).toBe('資料 599-0');
});

test('the first long press on a paged table resumes bulk selection and preserves unloaded rows', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${site.origin}/privacy`);
  await seed(page, 2, 600, 2, 0);
  await page.goto(`${site.origin}/workspace`);
  await waitForProjection(page, 600);
  await holdIdleWork(page);
  await page.reload();
  const cell = page.locator('td[data-bulk-row-id="row-0"][data-bulk-column-id="column-0"]');
  await expect(cell).toBeVisible();
  const box = await cell.boundingBox();
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box!.x + box!.width / 2, y: box!.y + box!.height / 2, id: 1 }] });
  await expect(page.getByRole('toolbar', { name: '批次編輯 欄位 0' })).toContainText('已選 1 格');
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.getByRole('button', { name: '開啟 欄位 0 批次輸入' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox').fill('長按後的批次修改');
  await dialog.getByRole('button', { name: '確認', exact: true }).click();
  await expect.poll(() => readTableCell(page, 'table-0', 'row-0', 'column-0')).toBe('長按後的批次修改');
  expect(await readTableCell(page, 'table-0', 'row-599', 'column-0')).toBe('資料 599-0');
  expect(await readTableCell(page, 'table-1', 'row-599', 'column-0')).toBe('資料 599-0');
  expect(errors).toEqual([]);
  await client.detach();
});

test('a previously unvisited workspace opens offline and edits, undo, and saves remain local', async ({ page, context }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${site.origin}/privacy`);
  await expect(page.getByRole('heading', { name: '實際保存什麼，以及為什麼' })).toBeVisible();
  await waitForOfflineShell(page);
  await seed(page, 2);
  await context.setOffline(true);
  await page.goto(`${site.origin}/workspace`);
  await expect(page.getByRole('button', { name: '重新命名表格' })).toHaveText('測試表 0');
  const cell = page.locator('td[data-bulk-column-id="column-0"]').first();
  await cell.click();
  const editor = page.getByRole('textbox').first();
  await editor.fill('離線編輯');
  await editor.press('Escape');
  await expect(cell).toContainText('離線編輯');
  await page.getByRole('button', { name: '展開快速操作' }).click();
  await page.getByRole('button', { name: '上一動', exact: true }).click();
  await expect(cell).toContainText('資料 0-0');
  await page.getByRole('button', { name: '下一動', exact: true }).click();
  await expect(cell).toContainText('離線編輯');
  await expect.poll(() => readTableCell(page, 'table-0', 'row-0', 'column-0')).toBe('離線編輯');
  await page.reload();
  await expect(cell).toContainText('離線編輯');
  await page.screenshot({ path: info.outputPath('offline-workspace.png') });
  expect(errors).toEqual([]);
});

test('column settings wait for explicit name editing and keep keyboard navigation inside the dialog', async ({ page }, info) => {
  await page.goto(`${site.origin}/privacy`);
  await seed(page, 1, 4, 2, 0);
  await page.goto(`${site.origin}/workspace`);
  await page.getByRole('columnheader', { name: '欄位 0', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '屬性設定' });
  const name = dialog.getByRole('textbox', { name: '屬性名稱' });
  await expect(dialog).toBeFocused();
  await expect(name).not.toBeFocused();
  await expect(dialog.getByRole('group', { name: '輸入類型' }).getByRole('button', { name: '文字', pressed: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '置左', pressed: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('column-settings.png') });
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: '數字', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: '刪除屬性' })).toBeFocused();
  await name.click();
  await expect(name).toBeFocused();
  await name.fill('收藏分類');
  await page.locator('.workspace-column-dialog-overlay').click({ position: { x: 4, y: 4 } });
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: '收藏分類' })).toBeVisible();
});

test('closing a pointer-opened editor does not outline a toolbar button, while keyboard focus remains visible', async ({ page }) => {
  await page.goto(`${site.origin}/privacy`);
  await seed(page);
  await page.goto(`${site.origin}/workspace`);
  await expect.poll(() => page.evaluate(() => document.activeElement === document.body)).toBe(true);

  const menuButton = page.getByRole('button', { name: '開啟目錄' });
  const titleButton = page.getByRole('button', { name: '重新命名表格' });
  await page.locator('td[data-bulk-row-id="row-0"][data-bulk-column-id="column-0"]').click();
  await page.locator('.workspace-overlay').click({ position: { x: 4, y: 4 } });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(menuButton).not.toBeFocused();

  await titleButton.click();
  await page.locator('.workspace-overlay').click({ position: { x: 4, y: 4 } });
  await expect(titleButton).toBeFocused();
  await expect(titleButton).toHaveCSS('outline-style', 'none');

  await page.keyboard.press('Tab');
  const searchButton = page.getByRole('button', { name: '搜尋', exact: true });
  await expect(searchButton).toBeFocused();
  await expect(searchButton).toHaveCSS('outline-style', 'solid');

  await page.keyboard.press('Shift+Tab');
  await titleButton.press('Enter');
  await page.getByRole('dialog').getByRole('textbox').press('Escape');
  await expect(titleButton).toBeFocused();
  await expect(titleButton).toHaveCSS('outline-style', 'solid');
});

test('pointer-opened action dialogs focus the dialog surface and keyboard-opened dialogs focus an action', async ({ page }) => {
  await page.goto(`${site.origin}/privacy`);
  await seed(page);
  await page.goto(`${site.origin}/workspace`);

  await page.getByRole('button', { name: '開啟目錄' }).click();
  const nodeActions = page.getByRole('button', { name: '開啟測試表 0操作' });
  await nodeActions.click();
  const dialog = page.getByRole('dialog');
  const renameAction = dialog.getByRole('button', { name: '重新命名' });
  await expect(dialog).toBeFocused();
  await expect(dialog).toHaveCSS('outline-style', 'none');
  await expect(renameAction).not.toBeFocused();
  await dialog.getByRole('button', { name: '關閉' }).click();
  await expect(nodeActions).toBeFocused();
  await expect(nodeActions).toHaveCSS('outline-style', 'none');

  await nodeActions.press('Enter');
  await expect(renameAction).toBeFocused();
  await expect(renameAction).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Escape');
  await expect(nodeActions).toBeFocused();
  await expect(nodeActions).toHaveCSS('outline-style', 'solid');
});

test('a pointer-opened filter restores its trigger even when the browser leaves search focused during the tap', async ({ page }) => {
  await page.goto(`${site.origin}/privacy`);
  await seed(page);
  await page.goto(`${site.origin}/workspace`);

  await page.getByRole('button', { name: '搜尋', exact: true }).click();
  const search = page.getByRole('searchbox', { name: '搜尋此表' });
  await expect(search).toBeFocused();
  const filterButton = page.getByRole('button', { name: '篩選 欄位 0' });
  await filterButton.evaluate((button) => {
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('.workspace-overlay').click({ position: { x: 4, y: 4 } });
  await expect(filterButton).toBeFocused();
  await expect(search).not.toBeFocused();
});

test('a keyboard action-to-editor transition returns to its original directory trigger', async ({ page }) => {
  await page.goto(`${site.origin}/privacy`);
  await seed(page);
  await page.goto(`${site.origin}/workspace`);

  await page.getByRole('button', { name: '開啟目錄' }).click();
  const nodeActions = page.getByRole('button', { name: '開啟測試表 0操作' });
  await nodeActions.focus();
  await nodeActions.press('Enter');
  await page.getByRole('dialog').getByRole('button', { name: '重新命名' }).press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.getByRole('dialog').getByRole('textbox').press('Escape');
  await expect(nodeActions).toBeFocused();
});

test('a large offline table renders a bounded row window and retains the other tables after editing', async ({ page, context }) => {
  await page.goto(`${site.origin}/workspace`);
  await waitForOfflineShell(page);
  await seed(page, 8, 250, 12);
  await context.setOffline(true);
  await page.reload();
  const rows = page.locator('.workspace-table tbody tr[data-virtual-row-id]');
  await expect(rows.first()).toHaveAttribute('data-virtual-row-id', 'row-0');
  expect(await rows.count()).toBeLessThan(80);
  const viewport = page.locator('.workspace-table-viewport');
  await viewport.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(rows.last()).toHaveAttribute('data-virtual-row-id', 'row-249');
  await expect(rows.last()).toBeInViewport();
  expect(await rows.count()).toBeLessThan(80);
  await page.locator('td[data-bulk-row-id="row-249"][data-bulk-column-id="column-0"]').click();
  const editor = page.getByRole('textbox').first();
  await editor.fill('底部修改');
  await editor.press('Escape');
  await expect(page.locator('td[data-bulk-row-id="row-249"][data-bulk-column-id="column-0"]')).toContainText('底部修改');
  await expect.poll(() => page.evaluate(async () => {
    const request = indexedDB.open('board-game-helper-workspace');
    const db = await new Promise<IDBDatabase>((done) => { request.onsuccess = () => done(request.result); });
    const transaction = db.transaction('tables');
    const keys = await new Promise<IDBValidKey[]>((done) => { const get = transaction.objectStore('tables').getAllKeys(); get.onsuccess = () => done(get.result); });
    db.close();
    return keys.length;
  })).toBe(8);
  await page.reload();
  await expect(page.getByRole('button', { name: '重新命名表格' })).toHaveText('測試表 0');
  await page.getByRole('button', { name: '開啟目錄' }).click();
  await expect(page.getByRole('button', { name: /測試表 7/ }).first()).toBeVisible();
});

test('variable-height rows keep visible content while scrolling and zooming', async ({ page }) => {
  await page.goto(`${site.origin}/workspace`);
  await expect(page.getByRole('button', { name: '建立表格', exact: true })).toBeVisible();
  await seed(page, 1, 250, 2);
  await page.evaluate(async () => {
    const request = indexedDB.open('board-game-helper-workspace');
    const db = await new Promise<IDBDatabase>((done) => { request.onsuccess = () => done(request.result); });
    const transaction = db.transaction('tables', 'readwrite');
    const store = transaction.objectStore('tables');
    const table = await new Promise<any>((done) => { const get = store.get('table-0'); get.onsuccess = () => done(get.result); });
    table.columns[0].overflowMode = 'wrap';
    table.columns[0].widthLimitChars = 8;
    table.columns[0].lineLimit = 4;
    for (let index = 0; index < table.rows.length; index += 3) table.rows[index].values['column-0'] = '較長的多行內容 '.repeat(20);
    store.put(table, 'table-0');
    await new Promise<void>((done) => { transaction.oncomplete = () => done(); });
    db.close();
  });
  await page.reload();
  const rows = page.locator('.workspace-table tbody tr[data-virtual-row-id]');
  await expect(rows.first()).toHaveAttribute('data-virtual-row-id', 'row-0');
  expect(await rows.first().evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(40);
  const viewport = page.locator('.workspace-table-viewport');
  const hasVisibleRow = () => viewport.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return [...element.querySelectorAll<HTMLTableRowElement>('tbody tr[data-virtual-row-id]')]
      .some((row) => { const rowRect = row.getBoundingClientRect(); return rowRect.bottom > rect.top && rowRect.top < rect.bottom; });
  });
  for (const fraction of [0.25, 0.5, 0.75, 1]) {
    await viewport.evaluate((element, at) => { element.scrollTop = element.scrollHeight * at; }, fraction);
    await expect.poll(hasVisibleRow).toBe(true);
    expect(await rows.count()).toBeLessThan(80);
  }
  await viewport.dispatchEvent('wheel', { ctrlKey: true, deltaY: -100 });
  await expect(page.locator('.workspace-table')).toHaveCSS('--workspace-text-scale', '1.2');
  await expect.poll(hasVisibleRow).toBe(true);
});

test('a 10,000-row expandable table keeps the final edit mounted and round-trips it through history', async ({ page }) => {
  await page.goto(`${site.origin}/workspace`);
  await expect(page.getByRole('button', { name: '建立表格', exact: true })).toBeVisible();
  await seed(page, 1, 10_000, 2, 0);
  await page.reload();

  const rows = page.locator('.workspace-table tbody tr[data-virtual-row-id]');
  await expect(rows.first()).toHaveAttribute('data-virtual-row-id', 'row-0');
  expect(await rows.count()).toBeLessThan(80);
  const viewport = page.locator('.workspace-table-viewport');
  await viewport.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(rows.last()).toHaveAttribute('data-virtual-row-id', 'row-9999');
  await expect(rows.last()).toBeInViewport();

  const cell = page.locator('td[data-bulk-row-id="row-9999"][data-bulk-column-id="column-0"]');
  await cell.click();
  const editor = page.getByRole('textbox').first();
  await editor.fill('最後一列的超長內容，讓可展開欄寬重新量測並保留底部錨點');
  await editor.press('Escape');
  await expect(cell).toContainText('最後一列的超長內容');
  await expect(rows.last()).toBeInViewport();
  await expect.poll(() => readTableCell(page, 'table-0', 'row-9999', 'column-0')).toBe('最後一列的超長內容，讓可展開欄寬重新量測並保留底部錨點');

  await page.getByRole('button', { name: '展開快速操作' }).click();
  await page.getByRole('button', { name: '上一動', exact: true }).click();
  await expect(cell).toContainText('資料 9999-0');
  await expect.poll(() => readTableCell(page, 'table-0', 'row-9999', 'column-0')).toBe('資料 9999-0');
  await page.getByRole('button', { name: '下一動', exact: true }).click();
  await expect(cell).toContainText('最後一列的超長內容');
  await expect.poll(() => readTableCell(page, 'table-0', 'row-9999', 'column-0')).toBe('最後一列的超長內容，讓可展開欄寬重新量測並保留底部錨點');
});

test('10,000 variable-height rows keep the mid-scroll row identity after zoom measurement', async ({ page }) => {
  await page.goto(`${site.origin}/workspace`);
  await expect(page.getByRole('button', { name: '建立表格', exact: true })).toBeVisible();
  await seed(page, 1, 10_000, 2, 0);
  await page.evaluate(async () => {
    const request = indexedDB.open('board-game-helper-workspace');
    const db = await new Promise<IDBDatabase>((done, reject) => { request.onsuccess = () => done(request.result); request.onerror = () => reject(request.error); });
    const transaction = db.transaction('tables', 'readwrite');
    const store = transaction.objectStore('tables');
    const table = await new Promise<any>((done, reject) => { const get = store.get('table-0'); get.onsuccess = () => done(get.result); get.onerror = () => reject(get.error); });
    table.columns[0].overflowMode = 'wrap';
    table.columns[0].widthLimitChars = 8;
    table.columns[0].lineLimit = 4;
    for (let index = 0; index < table.rows.length; index += 7) table.rows[index].values['column-0'] = '多行內容 '.repeat(24);
    store.put(table, 'table-0');
    await new Promise<void>((done, reject) => { transaction.oncomplete = () => done(); transaction.onerror = () => reject(transaction.error); });
    db.close();
  });
  await page.reload();

  const viewport = page.locator('.workspace-table-viewport');
  const rows = page.locator('.workspace-table tbody tr[data-virtual-row-id]');
  await expect(rows.first()).toHaveAttribute('data-virtual-row-id', 'row-0');
  await viewport.evaluate((element) => { element.scrollTop = element.scrollHeight * 0.5; });
  await expect.poll(async () => (await visibleVirtualRowIds(page)).length).toBeGreaterThan(0);
  await page.evaluate(async () => { for (let frame = 0; frame < 16; frame++) await new Promise(requestAnimationFrame); });
  const anchorId = await viewport.evaluate((element) => {
    const viewportRect = element.getBoundingClientRect();
    return [...element.querySelectorAll<HTMLTableRowElement>('tbody tr[data-virtual-row-id]')]
      .find((row) => { const rect = row.getBoundingClientRect(); return rect.top < viewportRect.bottom && rect.bottom > viewportRect.top; })
      ?.dataset.virtualRowId ?? '';
  });
  expect(anchorId).toMatch(/^row-\d+$/);

  await viewport.dispatchEvent('wheel', { ctrlKey: true, deltaY: -100 });
  await expect(page.locator('.workspace-table')).toHaveCSS('--workspace-text-scale', '1.2');
  await expect.poll(() => viewport.evaluate((element, id) => {
    const viewportRect = element.getBoundingClientRect();
    const row = element.querySelector<HTMLTableRowElement>(`tbody tr[data-virtual-row-id="${id}"]`);
    if (!row) return false;
    const rect = row.getBoundingClientRect();
    return rect.bottom > viewportRect.top && rect.top < viewportRect.bottom;
  }, anchorId)).toBe(true);
  expect(await rows.count()).toBeLessThan(80);
});

test('a transposed 10,000-row table bounds its filter toolbar and tracks visible object labels during search and horizontal scroll', async ({ page }) => {
  await page.goto(`${site.origin}/workspace`);
  await expect(page.getByRole('button', { name: '建立表格', exact: true })).toBeVisible();
  await seed(page, 1, 10_000, 12, 0);
  await page.evaluate(async () => {
    const request = indexedDB.open('board-game-helper-workspace');
    const db = await new Promise<IDBDatabase>((done, reject) => { request.onsuccess = () => done(request.result); request.onerror = () => reject(request.error); });
    const transaction = db.transaction('tables', 'readwrite');
    const store = transaction.objectStore('tables');
    const table = await new Promise<any>((done, reject) => { const get = store.get('table-0'); get.onsuccess = () => done(get.result); get.onerror = () => reject(get.error); });
    store.put({ ...table, transposed: true }, 'table-0');
    await new Promise<void>((done, reject) => { transaction.oncomplete = () => done(); transaction.onerror = () => reject(transaction.error); });
    db.close();
    localStorage.setItem('board-game-helper-workspace-view-state', JSON.stringify({ version: 1, tables: {
      'table-0': { searchQuery: '', searchOpen: true, headerFilters: { 'row:row-0': { includedKeys: null, sort: 'asc' } }, scrollLeft: 0, scrollTop: 0 },
    } }));
  });
  await page.reload();

  const viewport = page.locator('.workspace-table-viewport');
  const toolbar = page.locator('.workspace-filterbar');
  await expect(toolbar).toBeVisible();
  await expect.poll(() => page.locator('.workspace-filterbar-button').count()).toBeLessThan(40);
  await expect.poll(async () => (await transposedLabels(page)).filters).toEqual(expect.arrayContaining(['項目 0']));
  const initialLabels = await transposedLabels(page);
  expect(initialLabels.filters).toEqual(initialLabels.headers);

  const search = page.getByRole('searchbox', { name: '搜尋此表' });
  await search.fill('資料 9999-0');
  await expect.poll(async () => (await transposedLabels(page)).headers).toEqual(['項目 9999']);
  await expect.poll(async () => (await transposedLabels(page)).filters).toEqual(['項目 9999']);

  await search.fill('');
  await expect(page.locator('.workspace-appbar-search-count')).toHaveText('10000 / 10000');
  await expect.poll(() => page.locator('.workspace-filterbar-button').count()).toBeLessThan(40);
  await toolbar.evaluate((element) => { element.scrollLeft = element.scrollWidth; element.dispatchEvent(new Event('scroll', { bubbles: true })); });
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('.workspace-table-viewport');
    const toolbar = document.querySelector<HTMLElement>('.workspace-filterbar');
    return viewport && toolbar ? Math.abs(viewport.scrollLeft - toolbar.scrollLeft) : Number.POSITIVE_INFINITY;
  })).toBeLessThan(1);
  await expect.poll(async () => (await transposedLabels(page)).headers).toEqual(expect.arrayContaining(['項目 9999']));
  const endLabels = await transposedLabels(page);
  expect(endLabels.filters).toEqual(endLabels.headers);
  expect(await page.locator('.workspace-filterbar-button').count()).toBeLessThan(40);
});

test('stored scroll restoration is scoped per table and does not carry one table bottom to another', async ({ page }) => {
  await page.goto(`${site.origin}/workspace`);
  await expect(page.getByRole('button', { name: '建立表格', exact: true })).toBeVisible();
  await seed(page, 2, 250, 2, 0);
  await page.evaluate(() => {
    localStorage.setItem('board-game-helper-workspace-view-state', JSON.stringify({ version: 1, tables: {
      'table-0': { searchQuery: '', searchOpen: false, headerFilters: {}, scrollLeft: 0, scrollTop: 6000 },
      'table-1': { searchQuery: '', searchOpen: false, headerFilters: {}, scrollLeft: 0, scrollTop: 72 },
    } }));
  });
  await page.reload();

  const viewport = page.locator('.workspace-table-viewport');
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(5000);
  await expect.poll(() => visibleVirtualRowIds(page)).toContain('row-166');
  await viewport.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => viewport.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(2);

  await page.getByRole('button', { name: '開啟目錄' }).click();
  await page.locator('.workspace-tree-row[data-node-id="node-1"] .workspace-tree-name-text').click();
  await expect(page.getByRole('button', { name: '重新命名表格' })).toHaveText('測試表 1');
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(50);
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeLessThan(1000);
  await expect.poll(() => visibleVirtualRowIds(page)).toContain('row-2');
});

test('an on-demand table failure cannot prevent editing or delete other tables on disk', async ({ page }) => {
  await page.goto(`${site.origin}/workspace`);
  await expect(page.getByRole('button', { name: '建立表格', exact: true })).toBeVisible();
  await seed(page, 8);
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (this: IDBObjectStore, ...args: unknown[]) {
      if (this.name === 'tables' && args[0] === 'table-1' && !sessionStorage.getItem('workspace-test-full-read-failed')) {
        sessionStorage.setItem('workspace-test-full-read-failed', '1');
        throw new Error('Simulated delayed full-table read');
      }
      return Reflect.apply(original, this, args);
    };
  });
  await page.reload();
  await expect(page.locator('td[data-bulk-row-id="row-0"][data-bulk-column-id="column-0"]')).toBeVisible();
  await page.getByRole('button', { name: '開啟目錄' }).click();
  await page.getByRole('button', { name: /測試表 1/ }).first().click();
  await expect(page.getByRole('status').filter({ hasText: '資料讀取失敗' })).toBeVisible();
  await page.getByRole('button', { name: '關閉目錄', exact: true }).last().click();
  await page.locator('td[data-bulk-row-id="row-0"][data-bulk-column-id="column-0"]').click();
  const editor = page.getByRole('textbox').first();
  await editor.fill('先改目前表格');
  await editor.press('Escape');
  await expect.poll(() => page.evaluate(async () => {
    const request = indexedDB.open('board-game-helper-workspace');
    const db = await new Promise<IDBDatabase>((done) => { request.onsuccess = () => done(request.result); });
    const transaction = db.transaction('tables');
    const keys = await new Promise<IDBValidKey[]>((done) => { const get = transaction.objectStore('tables').getAllKeys(); get.onsuccess = () => done(get.result); });
    db.close();
    return keys.length;
  })).toBe(8);
  await page.reload();
  await expect(page.locator('td[data-bulk-row-id="row-0"][data-bulk-column-id="column-0"]')).toContainText('先改目前表格');
  await page.getByRole('button', { name: '開啟目錄' }).click();
  await expect(page.getByRole('button', { name: /測試表 7/ }).first()).toBeVisible();
});

test('pinned tables load on demand at the mobile bottom edge without reading unrelated tables', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${site.origin}/workspace`);
  await expect(page.getByRole('button', { name: '建立表格', exact: true })).toBeVisible();
  await seed(page, 3, 4, 2, 0);
  await page.evaluate(async () => {
    const request = indexedDB.open('board-game-helper-workspace');
    const db = await new Promise<IDBDatabase>(done => { request.onsuccess = () => done(request.result); });
    const transaction = db.transaction('meta', 'readwrite');
    const get = transaction.objectStore('meta').get('workspace');
    get.onsuccess = () => transaction.objectStore('meta').put({ ...get.result, bottomNavigationTableIds: ['table-1'] }, 'workspace');
    await new Promise<void>(done => { transaction.oncomplete = () => done(); });
    db.close();
  });
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (this: IDBObjectStore, ...args: unknown[]) {
      if (this.name === 'tables' && args[0] === 'table-2' && !sessionStorage.getItem('workspace-test-after-pins-failed')) {
        sessionStorage.setItem('workspace-test-after-pins-failed', '1');
        throw new Error('Simulated later background read failure');
      }
      return Reflect.apply(original, this, args);
    };
  });
  await page.reload();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const bar = page.getByRole('navigation', { name: '常用表格' });
  await expect(bar).toBeVisible();
  const geometry = await bar.evaluate(element => ({ bottom: element.getBoundingClientRect().bottom, top: element.getBoundingClientRect().top, height: window.innerHeight, tableBottom: document.querySelector('.workspace-table-viewport')!.getBoundingClientRect().bottom }));
  expect(Math.abs(geometry.bottom - geometry.height)).toBeLessThan(2);
  expect(geometry.tableBottom).toBeLessThanOrEqual(geometry.top + 1);
  await bar.getByRole('button', { name: '開啟表格 測試表 1' }).click();
  await expect(page.getByRole('button', { name: '重新命名表格' })).toHaveText('測試表 1');
  const cell = page.locator('td[data-bulk-row-id="row-0"][data-bulk-column-id="column-0"]');
  await cell.click();
  const editor = page.getByRole('textbox').first();
  await editor.fill('常用表格先編輯');
  await editor.press('Escape');
  await expect.poll(() => readTableCell(page, 'table-1', 'row-0', 'column-0')).toBe('常用表格先編輯');
  expect(await page.evaluate(() => sessionStorage.getItem('workspace-test-after-pins-failed'))).toBeNull();
  await page.getByRole('button', { name: '開啟目錄' }).click();
  await page.getByRole('button', { name: /測試表 2/ }).first().click();
  await expect(page.getByRole('status').filter({ hasText: '資料讀取失敗' })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新命名表格' })).toHaveText('測試表 1');
  await page.reload();
  await expect(cell).toContainText('常用表格先編輯');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('an older offline tab cannot overwrite a newer table, and explicit deletion still removes it', async ({ page, context }) => {
  await page.goto(`${site.origin}/workspace`);
  await waitForOfflineShell(page);
  await seed(page);
  await page.reload();
  await expect(page.locator('td[data-bulk-row-id="row-0"][data-bulk-column-id="column-0"]')).toContainText('資料 0-0');

  const peer = await context.newPage();
  await peer.goto(`${site.origin}/workspace`);
  await expect(peer.getByRole('button', { name: '重新命名表格' })).toHaveText('測試表 0');
  await context.setOffline(true);
  await peer.getByRole('button', { name: '開啟目錄' }).click();
  await peer.getByRole('button', { name: '新增表格' }).click();
  await peer.getByRole('button', { name: '建立空白表格' }).click();
  await peer.getByRole('textbox', { name: '表格名稱' }).fill('第二分頁新表');
  await peer.getByRole('textbox', { name: '表格名稱' }).press('Enter');

  const readStorage = () => page.evaluate(async () => {
    const request = indexedDB.open('board-game-helper-workspace');
    const db = await new Promise<IDBDatabase>((done) => { request.onsuccess = () => done(request.result); });
    const transaction = db.transaction(['meta', 'tables', 'history', 'rowChunks']);
    const read = <T>(store: IDBObjectStore, key: string) => new Promise<T>((done) => { const get = store.get(key); get.onsuccess = () => done(get.result); });
    const meta = await read<{ nodes: Array<{ name: string }> }>(transaction.objectStore('meta'), 'workspace');
    const storage = await read<{ storageRevision: string }>(transaction.objectStore('meta'), 'storage');
    const table = await read<{ rows?: Array<{ id: string; values: Record<string, string> }>; rowOrder?: string[] }>(transaction.objectStore('tables'), 'table-0');
    const rows = table.rows ?? await new Promise<any[]>((done) => { const get = transaction.objectStore('rowChunks').getAll(IDBKeyRange.bound(['table-0', ''], ['table-0', '\uffff'])); get.onsuccess = () => done(get.result.flatMap((chunk) => chunk.rows)); });
    const history = await read<{ past: unknown[] }>(transaction.objectStore('history'), 'table-0');
    const keys = await new Promise<IDBValidKey[]>((done) => { const get = transaction.objectStore('tables').getAllKeys(); get.onsuccess = () => done(get.result); });
    db.close();
    return { revision: storage.storageRevision, names: meta.nodes.map((node) => node.name), keys: keys.length, value: rows.find(row => row.id === 'row-0').values['column-0'], history: history.past.length };
  });
  await expect.poll(async () => (await readStorage()).names).toContain('第二分頁新表');
  const peerRevision = (await readStorage()).revision;

  await page.locator('td[data-bulk-row-id="row-0"][data-bulk-column-id="column-0"]').click();
  const editor = page.getByRole('textbox').first();
  await editor.fill('舊分頁編輯');
  await editor.press('Escape');
  await expect(page.getByRole('alert')).toContainText('另一個分頁已更新本機資料');
  expect(await readStorage()).toEqual({ revision: peerRevision, names: ['測試表 0', '第二分頁新表'], keys: 2, value: '資料 0-0', history: 40 });

  await peer.getByRole('button', { name: '開啟目錄' }).click();
  await peer.getByRole('button', { name: '開啟第二分頁新表操作' }).click();
  await peer.getByRole('button', { name: '刪除' }).click();
  await peer.getByRole('button', { name: '確認' }).click();
  await expect.poll(async () => (await readStorage()).keys).toBe(1);
  expect((await readStorage()).names).toEqual(['測試表 0']);
});

test('a large transposed table draws only the visible object columns', async ({ page }) => {
  await page.goto(`${site.origin}/workspace`);
  await expect(page.getByRole('button', { name: '建立表格', exact: true })).toBeVisible();
  await seed(page, 1, 250, 12);
  await page.evaluate(async () => {
    const request = indexedDB.open('board-game-helper-workspace');
    const db = await new Promise<IDBDatabase>((done) => { request.onsuccess = () => done(request.result); });
    const transaction = db.transaction('tables', 'readwrite');
    const store = transaction.objectStore('tables');
    const table = await new Promise<any>((done) => { const get = store.get('table-0'); get.onsuccess = () => done(get.result); });
    await new Promise<void>((done) => { const put = store.put({ ...table, transposed: true }, 'table-0'); put.onsuccess = () => done(); });
    db.close();
  });
  await page.reload();
  const headers = page.locator('.workspace-table thead th[data-row-id]');
  await expect(headers.first()).toHaveAttribute('data-row-id', 'row-0');
  expect(await headers.count()).toBeLessThan(40);
  const viewport = page.locator('.workspace-table-viewport');
  await viewport.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await expect(headers.last()).toHaveAttribute('data-row-id', 'row-249');
  await expect(headers.last()).toBeInViewport();
  expect(await headers.count()).toBeLessThan(40);
  await page.locator('td[data-bulk-row-id="row-249"][data-bulk-column-id="column-0"]').click();
  const editor = page.getByRole('textbox').first();
  await editor.fill('橫向修改');
  await editor.press('Escape');
  await expect(page.locator('td[data-bulk-row-id="row-249"][data-bulk-column-id="column-0"]')).toContainText('橫向修改');
});

test('normal column widths follow every rendered row and exclude unrendered long values', async ({ page }) => {
  await page.goto(`${site.origin}/privacy`);
  await seed(page, 1, 10000, 2, 0);
  await page.evaluate(async () => {
    const request = indexedDB.open('board-game-helper-workspace');
    const db = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result); });
    const transaction = db.transaction('tables', 'readwrite');
    const store = transaction.objectStore('tables');
    const get = store.get('table-0');
    get.onsuccess = () => {
      const table = get.result;
      table.rows[150].values['column-0'] = 'W'.repeat(200);
      store.put(table, 'table-0');
    };
    await new Promise<void>(resolve => { transaction.oncomplete = () => resolve(); });
    db.close();
  });
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.measureText;
    (window as unknown as { measuredBeforeRows: number }).measuredBeforeRows = 0;
    CanvasRenderingContext2D.prototype.measureText = function (text) {
      if (!document.querySelector('tr[data-virtual-row-id]')) (window as unknown as { measuredBeforeRows: number }).measuredBeforeRows++;
      return original.call(this, text);
    };
  });
  await page.goto(`${site.origin}/workspace`);
  const firstColumn = page.locator('.workspace-table colgroup col').nth(1);
  await expect(page.locator('tr[data-virtual-row-id="row-0"]')).toBeVisible();
  await expect.poll(() => firstColumn.evaluate(element => element.getBoundingClientRect().width)).toBeLessThan(400);
  expect(await page.evaluate(() => (window as unknown as { measuredBeforeRows: number }).measuredBeforeRows)).toBeLessThan(150);
  const viewport = page.locator('.workspace-table-viewport');
  await viewport.evaluate(element => { element.scrollTop = 36 * 150; });
  await expect(page.locator('tr[data-virtual-row-id="row-150"]')).toBeAttached();
  await expect.poll(() => firstColumn.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(1500);
  await viewport.evaluate(element => { element.scrollTop = 0; });
  await expect(page.locator('tr[data-virtual-row-id="row-150"]')).toHaveCount(0);
  await expect.poll(() => firstColumn.evaluate(element => element.getBoundingClientRect().width)).toBeLessThan(400);
  expect(await page.locator('tr[data-virtual-row-id]').count()).toBeLessThan(80);
});

test('cached navigation does not request a slow document or load unrelated site code', async ({ page }) => {
  await page.goto(`${site.origin}/workspace`);
  await waitForOfflineShell(page);
  await seed(page);
  site.state.documentDelay = 2500;
  const before = site.state.workspaceRequests;
  await page.reload();
  await expect(page.locator('.workspace-table')).toBeVisible();
  expect(site.state.workspaceRequests).toBe(before);
  const resources = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name));
  expect(resources.some((name) => /\/api\/|\/assets\/api-|\/assets\/SiteLayout-/.test(name))).toBe(false);
});

test('an installed PWA restores its table before loading homepage modules', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true });
    localStorage.setItem('wrong-board-game-pwa-last-route', '/workspace');
  });
  await page.goto(`${site.origin}/`);
  await expect(page.getByRole('button', { name: '建立表格', exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/workspace');
  const resources = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name));
  expect(resources.some((name) => /\/api\/|\/assets\/(?:api-|SiteLayout-|HomePage-)/.test(name))).toBe(false);
});

test('reports repeat startup timing with many local tables on a throttled mobile viewport', async ({ page, context }, info) => {
  const client = await context.newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  let timingInstalled = false;
  const measure = async (origin: string, virtualized: boolean) => {
    await page.goto(`${origin}/workspace`);
    await expect(page.locator('.workspace-page')).toBeVisible();
    await waitForOfflineShell(page);
    await seed(page, 8, 250, 12);
    if (!timingInstalled) await page.addInitScript(() => {
      const timing = { firstPaintAt: 0, drawerAt: 0, fullDrawerAt: 0 };
      Object.assign(window, { __workspaceStartupTiming: timing });
      let scheduled = false;
      const observeFirstRow = new MutationObserver(() => {
        if (scheduled || !document.querySelector('.workspace-table tbody tr')) return;
        scheduled = true;
        observeFirstRow.disconnect();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          timing.firstPaintAt = performance.now();
          const tryOpen = () => {
            if (document.querySelector('aside.workspace-drawer')) {
              timing.drawerAt = performance.now();
              const waitForFullDrawer = () => {
                if (document.querySelector('.workspace-drawer-create')) { timing.fullDrawerAt = performance.now(); return; }
                window.setTimeout(waitForFullDrawer, 16);
              };
              waitForFullDrawer();
              return;
            }
            document.querySelector<HTMLButtonElement>('button[aria-label="開啟目錄"]')?.click();
            window.setTimeout(tryOpen, 16);
          };
          tryOpen();
        }));
      });
      observeFirstRow.observe(document, { childList: true, subtree: true });
    });
    timingInstalled = true;
    const samples: number[] = [];
    const drawerSamples: number[] = [];
    const fullDrawerSamples: number[] = [];
    for (let index = 0; index < 5; index++) {
      await page.reload();
      if (virtualized) {
        await expect(page.locator('.workspace-table tbody tr[data-virtual-row-id]').first()).toHaveAttribute('data-virtual-row-id', 'row-0');
        expect(await page.locator('.workspace-table tbody tr[data-virtual-row-id]').count()).toBeLessThan(80);
      } else await expect(page.locator('.workspace-table tbody tr')).toHaveCount(250);
      await expect(page.getByRole('complementary', { name: 'Workspace 目錄' })).toBeVisible();
      await expect(page.getByRole('button', { name: '新增表格' })).toBeVisible();
      await expect.poll(() => page.evaluate(() => (window as unknown as { __workspaceStartupTiming: { fullDrawerAt: number } }).__workspaceStartupTiming.fullDrawerAt)).toBeGreaterThan(0);
      const timing = await page.evaluate(() => (window as unknown as { __workspaceStartupTiming: { firstPaintAt: number; drawerAt: number; fullDrawerAt: number } }).__workspaceStartupTiming);
      expect(timing.firstPaintAt).toBeGreaterThan(0);
      expect(timing.drawerAt).toBeGreaterThan(0);
      expect(timing.fullDrawerAt).toBeGreaterThan(0);
      samples.push(timing.firstPaintAt);
      drawerSamples.push(timing.drawerAt);
      fullDrawerSamples.push(timing.fullDrawerAt);
    }
    return { samples: samples.map(Math.round), medianMs: Math.round([...samples].sort((a, b) => a - b)[2]), drawerSamples: drawerSamples.map(Math.round), drawerMedianMs: Math.round([...drawerSamples].sort((a, b) => a - b)[2]), fullDrawerSamples: fullDrawerSamples.map(Math.round), fullDrawerMedianMs: Math.round([...fullDrawerSamples].sort((a, b) => a - b)[2]) };
  };
  const current = await measure(site.origin, true);
  let baseline: Awaited<ReturnType<typeof measure>> | undefined;
  if (process.env.WORKSPACE_BASELINE_DIR) {
    const previous = await startServer(resolve(process.env.WORKSPACE_BASELINE_DIR));
    try { baseline = await measure(previous.origin, false); } finally { await closeServer(previous.server); }
  }
  const result = { viewport: '390x844', cpuSlowdown: 4, tables: 8, rowsPerTable: 250, columnsPerTable: 12, current, baseline };
  console.log(JSON.stringify(result));
  await info.attach('startup-timing', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
});
