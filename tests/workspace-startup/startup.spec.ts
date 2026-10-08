import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { closeServer, holdIdleWork, readTableCell, seed, startServer, trackWorkspaceReads, visibleVirtualRowIds, waitForOfflineShell, waitForProjection } from './startupSupport';
let site: Awaited<ReturnType<typeof startServer>>;
test.beforeAll(async () => { site = await startServer(resolve('dist/client')); });
test.afterAll(async () => { await closeServer(site.server); });
test.beforeEach(() => { site.state.documentDelay = 0; });

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
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('board-game-helper-workspace-view-state:scroll:table-0') ?? '{}').scrollTop ?? 0)).toBeGreaterThan(9900 * 36);
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
  await expect.poll(() => page.evaluate(() => (window as any).workspaceReads.filter((read: any) => read.store === 'rowChunks' && read.method === 'get').length)).toBe(40);
  const reads = await page.evaluate(() => (window as any).workspaceReads as { store: string; method: string; key: string; painted: string[] }[]);
  expect(reads.filter(read => ['tables', 'tableState', 'rowChunks'].includes(read.store) && read.method !== 'getAllKeys').every(read => read.key === 'table-0' && read.painted.includes('測試表 0'))).toBe(true);
  expect(reads.some(read => ['history', 'historyEntries'].includes(read.store))).toBe(false);
  await page.locator('td[data-bulk-row-id="row-0"][data-bulk-column-id="column-0"]').click();
  await page.getByRole('textbox').first().press('Escape');
  await page.getByRole('button', { name: '搜尋', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: '搜尋此表' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).workspaceReads.filter((read: any) => read.store === 'rowChunks' && read.method === 'get').length)).toBe(40);
  await page.getByRole('button', { name: '搜尋', exact: true }).click();
  await page.getByRole('button', { name: '開啟目錄' }).click();
  await page.locator('.workspace-tree-row[data-node-id="node-1"] .workspace-tree-name').click();
  await expect(page.getByRole('button', { name: '重新命名表格' })).toHaveText('測試表 1');
  await expect.poll(() => page.evaluate(() => (window as any).workspaceReads.filter((read: any) => read.store === 'rowChunks' && read.method === 'get').length)).toBe(80);
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
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (this: IDBObjectStore, ...args: Parameters<typeof original>) {
      const request = Reflect.apply(original, this, args) as IDBRequest;
      const stores = this.transaction.objectStoreNames;
      const isFinalMetadataCheck = this.name === 'meta' && args[0] === 'storage' && stores.length === 1 && stores[0] === 'meta';
      if (isFinalMetadataCheck) {
        // The one-store metadata read is the final revision check after all canonical batches,
        // normalization, and snapshot work have completed.
        request.addEventListener('success', () => {
          const element = document.querySelector('.workspace-table-viewport')!;
          const rect = element.getBoundingClientRect();
          // Header cells are sticky; the thead box itself scrolls above the viewport.
          const contentTop = Math.max(rect.top, ...[...element.querySelectorAll('thead th')].map(cell => cell.getBoundingClientRect().bottom));
          (window as any).workspaceHydrationAnchor = [...element.querySelectorAll<HTMLTableRowElement>('tr[data-virtual-row-id]')].find(row => row.getBoundingClientRect().top >= contentTop && row.getBoundingClientRect().bottom <= rect.bottom)?.dataset.virtualRowId;
        }, { once: true });
        this.transaction.addEventListener('complete', () => {
          requestAnimationFrame(() => requestAnimationFrame(() => { (window as any).workspaceHydrationPainted = true; }));
        }, { once: true });
      }
      return request;
    } as typeof original;
  });
  await page.evaluate(() => { (window as any).releaseWorkspaceIdleWork(); });
  await expect.poll(() => page.evaluate(() => (window as any).workspaceReads.filter((read: any) => read.store === 'rowChunks' && read.method === 'get').map((read: any) => read.key))).toHaveLength(40);
  expect(await page.evaluate(() => [...new Set((window as any).workspaceReads.filter((read: any) => read.store === 'rowChunks' && read.method === 'get').map((read: any) => read.key))])).toEqual(['table-0']);
  await expect.poll(() => page.evaluate(() => (window as any).workspaceHydrationPainted)).toBe(true);
  const anchor = await page.evaluate(() => (window as any).workspaceHydrationAnchor as string | undefined);
  expect(anchor).toBeDefined();
  await expect.poll(() => viewport.evaluate((element, id) => {
    const row = element.querySelector<HTMLTableRowElement>(`tr[data-virtual-row-id="${id}"]`);
    if (!row) return false;
    const rect = row.getBoundingClientRect();
    const viewportRect = element.getBoundingClientRect();
    const contentTop = Math.max(viewportRect.top, ...[...element.querySelectorAll('thead th')].map(cell => cell.getBoundingClientRect().bottom));
    return rect.bottom > contentTop && rect.top < viewportRect.bottom;
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
  await expect.poll(() => page.evaluate(() => (window as any).workspaceReads.filter((read: any) => read.store === 'rowChunks' && read.method === 'get').map((read: any) => read.key))).toHaveLength(3);
  expect(await page.evaluate(() => [...new Set((window as any).workspaceReads.filter((read: any) => read.store === 'rowChunks' && read.method === 'get').map((read: any) => read.key))])).toEqual(['table-1']);
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
