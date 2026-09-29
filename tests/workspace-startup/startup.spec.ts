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

const seed = async (page: Page, tables = 1, rows = 4, columns = 2) => page.evaluate(async ({ tables, rows, columns }) => {
  const request = indexedDB.open('board-game-helper-workspace', 3);
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
    transaction.objectStore('history').put({ tableId: `table-${index}`, future: [], past: Array.from({ length: 40 }, (_, entry) => ({ id: `entry-${index}-${entry}`, tableId: `table-${index}`, label: '歷史編輯', createdAt: Date.now(), action: { type: 'set-cells', columnId: 'column-0', changes: Array.from({ length: rows }, (_, row) => ({ rowId: `row-${row}`, before: '之前', after: `資料 ${row}-0` })) } })) }, `table-${index}`);
  }
  await new Promise<void>((done, reject) => { transaction.oncomplete = () => done(); transaction.onerror = () => reject(transaction.error); });
  db.close();
  localStorage.setItem('board-game-helper-google-drive-backup', JSON.stringify({ lastBackupAt: Date.now(), tableBackups: {}, structureFingerprint: '' }));
}, { tables, rows, columns });

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
  await expect.poll(() => page.evaluate(async () => {
    const request = indexedDB.open('board-game-helper-workspace', 3);
    const db = await new Promise<IDBDatabase>((done) => { request.onsuccess = () => done(request.result); });
    const tableRequest = db.transaction('tables').objectStore('tables').get('table-0');
    const table = await new Promise<any>((done) => { tableRequest.onsuccess = () => done(tableRequest.result); });
    db.close();
    return table.rows[0].values['column-0'];
  })).toBe('離線編輯');
  await page.reload();
  await expect(cell).toContainText('離線編輯');
  await page.screenshot({ path: info.outputPath('offline-workspace.png') });
  expect(errors).toEqual([]);
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
    const request = indexedDB.open('board-game-helper-workspace', 3);
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
  await seed(page, 1, 250, 2);
  await page.evaluate(async () => {
    const request = indexedDB.open('board-game-helper-workspace', 3);
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

test('an edit during active-table-only loading cannot delete the tables still on disk', async ({ page }) => {
  await page.goto(`${site.origin}/workspace`);
  await expect(page.getByRole('button', { name: '建立表格', exact: true })).toBeVisible();
  await seed(page, 8);
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.getAll;
    IDBObjectStore.prototype.getAll = function (this: IDBObjectStore, ...args: unknown[]) {
      if (this.name === 'tables' && !sessionStorage.getItem('workspace-test-full-read-failed')) {
        sessionStorage.setItem('workspace-test-full-read-failed', '1');
        throw new Error('Simulated delayed full-table read');
      }
      return Reflect.apply(original, this, args);
    };
  });
  await page.reload();
  await expect(page.locator('td[data-bulk-row-id="row-0"][data-bulk-column-id="column-0"]')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('其他表格讀取失敗');
  await page.locator('td[data-bulk-row-id="row-0"][data-bulk-column-id="column-0"]').click();
  const editor = page.getByRole('textbox').first();
  await editor.fill('先改目前表格');
  await editor.press('Escape');
  await expect.poll(() => page.evaluate(async () => {
    const request = indexedDB.open('board-game-helper-workspace', 3);
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
    const request = indexedDB.open('board-game-helper-workspace', 3);
    const db = await new Promise<IDBDatabase>((done) => { request.onsuccess = () => done(request.result); });
    const transaction = db.transaction(['meta', 'tables', 'history']);
    const read = <T>(store: IDBObjectStore, key: string) => new Promise<T>((done) => { const get = store.get(key); get.onsuccess = () => done(get.result); });
    const meta = await read<{ storageRevision?: string; nodes: Array<{ name: string }> }>(transaction.objectStore('meta'), 'workspace');
    const table = await read<{ rows: Array<{ values: Record<string, string> }> }>(transaction.objectStore('tables'), 'table-0');
    const history = await read<{ past: unknown[] }>(transaction.objectStore('history'), 'table-0');
    const keys = await new Promise<IDBValidKey[]>((done) => { const get = transaction.objectStore('tables').getAllKeys(); get.onsuccess = () => done(get.result); });
    db.close();
    return { revision: meta.storageRevision, names: meta.nodes.map((node) => node.name), keys: keys.length, value: table.rows[0].values['column-0'], history: history.past.length };
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
    const request = indexedDB.open('board-game-helper-workspace', 3);
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
