import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { closeServer, readTableCell, seed, startServer, visibleVirtualRowIds, waitForOfflineShell } from './startupSupport';
let site: Awaited<ReturnType<typeof startServer>>;
test.beforeAll(async () => { site = await startServer(resolve('dist/client')); });
test.afterAll(async () => { await closeServer(site.server); });
test.beforeEach(() => { site.state.documentDelay = 0; });

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
  // Use a native touch scroll so input, scroll events and measurement frames stay ordered.
  const bounds = (await viewport.boundingBox())!;
  const session = await context.newCDPSession(page);
  await session.send('Input.synthesizeScrollGesture', {
    x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2),
    yDistance: -10000, speed: 20000, gestureSourceType: 'touch',
  });
  await session.detach();
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

test('a legacy transposed flag keeps the normal column filter toolbar bounded and synchronized with horizontal scrolling', async ({ page }) => {
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
      'table-0': { searchQuery: '', searchOpen: true, headerFilters: { 'column:column-0': { includedKeys: null, sort: 'asc' }, 'row:row-0': { includedKeys: [], sort: 'asc' } }, scrollLeft: 0, scrollTop: 0 },
    } }));
  });
  await page.reload();

  const viewport = page.locator('.workspace-table-viewport');
  const toolbar = page.locator('.workspace-filterbar');
  await expect(toolbar).toBeVisible();
  await expect(page.locator('.workspace-table')).not.toHaveClass(/is-transposed/);
  await expect.poll(() => page.locator('.workspace-filterbar-button').count()).toBe(13);
  await expect(page.getByRole('button', { name: '篩選 欄位 0' })).toBeVisible();
  await expect(page.getByRole('button', { name: '篩選 欄位 11' })).toBeVisible();

  const search = page.getByRole('searchbox', { name: '搜尋此表' });
  await search.fill('資料 9999-0');
  await expect(page.locator('.workspace-table tbody th[data-row-id]')).toHaveCount(1);
  await expect(page.locator('.workspace-table tbody th[data-row-id="row-9999"]')).toBeVisible();

  await search.fill('');
  await expect(page.locator('.workspace-appbar-search-count')).toHaveText('10000 / 10000');
  await expect.poll(() => page.locator('.workspace-filterbar-button').count()).toBe(13);
  await toolbar.evaluate((element) => { element.scrollLeft = element.scrollWidth; element.dispatchEvent(new Event('scroll', { bubbles: true })); });
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('.workspace-table-viewport');
    const toolbar = document.querySelector<HTMLElement>('.workspace-filterbar');
    return viewport && toolbar ? Math.abs(viewport.scrollLeft - toolbar.scrollLeft) : Number.POSITIVE_INFINITY;
  })).toBeLessThan(1);
  expect(await page.locator('.workspace-filterbar-button').count()).toBe(13);
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
    const table = await read<{ rows?: Array<{ id: string; values: Record<string, string> }> }>(transaction.objectStore('tables'), 'table-0');
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

test('a legacy transposed flag still uses row virtualization for deep-row editing', async ({ page }) => {
  await page.goto(`${site.origin}/workspace`);
  await expect(page.getByRole('button', { name: '建立表格', exact: true })).toBeVisible();
  await seed(page, 1, 250, 12);
  await page.evaluate(async () => {
    const request = indexedDB.open('board-game-helper-workspace');
    const db = await new Promise<IDBDatabase>((done) => { request.onsuccess = () => done(request.result); });
    const transaction = db.transaction('tables', 'readwrite');
    const store = transaction.objectStore('tables');
    const table = await new Promise<any>((done) => { const get = store.get('table-0'); get.onsuccess = () => done(get.result); });
    store.put({ ...table, transposed: true }, 'table-0');
    await new Promise<void>((done, reject) => { transaction.oncomplete = () => done(); transaction.onerror = () => reject(transaction.error); });
    db.close();
  });
  await page.reload();
  await expect(page.locator('.workspace-table')).not.toHaveClass(/is-transposed/);
  const rows = page.locator('.workspace-table tbody tr[data-virtual-row-id]');
  await expect(rows.first()).toHaveAttribute('data-virtual-row-id', 'row-0');
  expect(await rows.count()).toBeLessThan(40);
  const viewport = page.locator('.workspace-table-viewport');
  await viewport.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(rows.last()).toHaveAttribute('data-virtual-row-id', 'row-249');
  await expect(rows.last()).toBeInViewport();
  expect(await rows.count()).toBeLessThan(40);
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
