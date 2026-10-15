import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { closeServer, seed, startServer, visibleVirtualRowIds } from './startupSupport';

const cream = '#F7EED8';
const blue = '#E8F0F7';

let site: Awaited<ReturnType<typeof startServer>>;
test.beforeAll(async () => { site = await startServer(resolve('dist/client')); });
test.afterAll(async () => { await closeServer(site.server); });
test.beforeEach(() => { site.state.documentDelay = 0; });

const openSeededWorkspace = async (page: Parameters<typeof seed>[0], rows = 4, setup?: () => Promise<void>) => {
  await page.goto(`${site.origin}/privacy`);
  await seed(page, 1, rows, 2, 0);
  await setup?.();
  await page.goto(`${site.origin}/workspace`);
  await expect(page.getByRole('columnheader', { name: '欄位 0', exact: true })).toBeVisible();
};

const setColumnBackground = async (page: Parameters<typeof seed>[0], backgroundColor: string | undefined) => {
  await page.evaluate(async (backgroundColor) => {
    const request = indexedDB.open('board-game-helper-workspace');
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const transaction = db.transaction('tables', 'readwrite');
    const table = await new Promise<any>((resolve, reject) => { const get = transaction.objectStore('tables').get('table-0'); get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error); });
    table.columns[0] = { ...table.columns[0], backgroundColor };
    transaction.objectStore('tables').put(table, 'table-0');
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
    db.close();
  }, backgroundColor);
};

const setColumnValues = async (page: Parameters<typeof seed>[0], values: string[]) => {
  await page.evaluate(async (values) => {
    const request = indexedDB.open('board-game-helper-workspace');
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const transaction = db.transaction('tables', 'readwrite');
    const table = await new Promise<any>((resolve, reject) => { const get = transaction.objectStore('tables').get('table-0'); get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error); });
    table.rows = table.rows.map((row: any, index: number) => ({ ...row, values: { ...row.values, 'column-0': values[index] ?? `資料 ${index}` } }));
    transaction.objectStore('tables').put(table, 'table-0');
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
    db.close();
  }, values);
};

test.describe('mobile column appearance', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('chooses a pastel with a real tap, closes, persists on reload, and resets to default', async ({ page }, info) => {
    await openSeededWorkspace(page);
    await page.getByRole('columnheader', { name: '欄位 0', exact: true }).tap();
    const dialog = page.getByRole('dialog', { name: '屬性設定' });
    const trigger = dialog.getByRole('button', { name: '欄位底色' });
    await trigger.tap();
    const menu = page.getByRole('menu', { name: '欄位底色選單' });
    await expect(menu.getByRole('menuitem', { name: '淡藍' })).toBeVisible();
    await page.screenshot({ path: info.outputPath('appearance-mobile.png'), fullPage: true });
    await menu.getByRole('menuitem', { name: '淡藍' }).tap();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await page.locator('.workspace-column-dialog-overlay').tap({ position: { x: 4, y: 4 } });
    await expect(dialog).toHaveCount(0);

    const header = page.getByRole('columnheader', { name: '欄位 0', exact: true });
    await expect.poll(() => header.evaluate((element) => getComputedStyle(element).getPropertyValue('--workspace-column-background').trim())).toBe(blue);
    const firstCell = page.locator('td[data-bulk-row-id="row-0"][data-bulk-column-id="column-0"]');
    await expect.poll(() => header.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(232, 240, 247)');
    await expect.poll(() => firstCell.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(232, 240, 247)');
    await page.screenshot({ path: info.outputPath('appearance-table-mobile.png'), fullPage: true });
    await page.reload();
    await expect(header).toBeVisible();
    await expect.poll(() => header.evaluate((element) => getComputedStyle(element).getPropertyValue('--workspace-column-background').trim())).toBe(blue);

    await header.tap();
    const resetDialog = page.getByRole('dialog', { name: '屬性設定' });
    await resetDialog.getByRole('button', { name: '欄位底色' }).tap();
    await page.getByRole('menu', { name: '欄位底色選單' }).getByRole('menuitem', { name: '預設' }).tap();
    await page.locator('.workspace-column-dialog-overlay').tap({ position: { x: 4, y: 4 } });
    await expect(resetDialog).toHaveCount(0);
    await expect.poll(() => header.evaluate((element) => getComputedStyle(element).getPropertyValue('--workspace-column-background').trim())).toBe('');
    await page.reload();
    await expect(header).toBeVisible();
    await expect.poll(() => header.evaluate((element) => getComputedStyle(element).getPropertyValue('--workspace-column-background').trim())).toBe('');
  });

  test('does not turn a forced mouse hover or stray finger release into an editor', async ({ page }) => {
    await openSeededWorkspace(page, 4, () => setColumnBackground(page, blue));
    const cell = page.locator('td[data-bulk-row-id="row-0"][data-bulk-column-id="column-0"]');
    await expect(cell).toBeVisible();
    const before = await cell.evaluate((element) => getComputedStyle(element).backgroundColor);
    await cell.hover();
    expect(await cell.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(before);
    const box = await cell.boundingBox();
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box!.x + box!.width / 2, y: box!.y + box!.height / 2, id: 9 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box!.x + box!.width / 2 + 36, y: box!.y + box!.height / 2 + 24, id: 9 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await client.detach();
    expect(await cell.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(before);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

test.describe('desktop appearance', () => {
  test.use({ viewport: { width: 1200, height: 800 }, isMobile: false, hasTouch: false });

  test('desktop hover remains available and the palette/configuration is reviewable', async ({ page }, info) => {
    await openSeededWorkspace(page, 4, () => setColumnBackground(page, cream));
    const cell = page.locator('td[data-bulk-row-id="row-0"][data-bulk-column-id="column-0"]');
    const before = await cell.evaluate((element) => getComputedStyle(element).backgroundColor);
    await cell.hover();
    await expect.poll(() => cell.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(before);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await cell.click();
    await expect(cell).toHaveClass(/is-editing/);
    await expect.poll(() => cell.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(255, 247, 220)');
    await page.locator('.workspace-overlay').click({ position: { x: 4, y: 4 } });
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('columnheader', { name: '欄位 0', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '屬性設定' });
    await dialog.getByRole('button', { name: '欄位底色' }).click();
    await page.screenshot({ path: info.outputPath('appearance-palette.png'), fullPage: true });
    await expect(page.getByRole('menu', { name: '欄位底色選單' })).toBeVisible();
    await page.locator('.workspace-column-dialog-overlay').click({ position: { x: 4, y: 4 } });
    await expect(dialog).toHaveCount(0);
  });
});

test('logical row parity stays stable through virtual windows and follows filtered or sorted order', async ({ page }) => {
  const values = Array.from({ length: 260 }, (_, index) => index === 0 ? 'z' : index === 1 ? 'a' : `b${String(index).padStart(3, '0')}`);
  await openSeededWorkspace(page, values.length, () => setColumnValues(page, values));
  const rows = page.locator('tr[data-virtual-row-id]');
  const viewport = page.locator('.workspace-table-viewport');
  await expect(rows.first()).toHaveAttribute('data-virtual-row-id', 'row-0');
  await expect(rows.first()).toHaveAttribute('data-row-parity', 'even');
  const stripe = await rows.nth(1).locator('td[data-bulk-column-id="column-0"]').evaluate((element) => getComputedStyle(element).backgroundImage);
  expect(stripe).toContain('linear-gradient');
  await viewport.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect.poll(() => visibleVirtualRowIds(page)).toContain('row-259');
  await expect(rows.last()).toHaveAttribute('data-row-parity', 'odd');
  await viewport.evaluate((element) => { element.scrollTop = 0; });
  await expect(rows.first()).toHaveAttribute('data-virtual-row-id', 'row-0');
  await expect(rows.first()).toHaveAttribute('data-row-parity', 'even');

  await page.getByRole('button', { name: '搜尋', exact: true }).click();
  await page.getByRole('button', { name: '篩選 欄位 0' }).click();
  const filterDialog = page.getByRole('dialog');
  await filterDialog.getByRole('button', { name: '升冪' }).click();
  await page.locator('.workspace-overlay').click({ position: { x: 4, y: 4 } });
  await expect.poll(() => visibleVirtualRowIds(page)).not.toContain('row-0');
  await expect(rows.first()).toHaveAttribute('data-row-parity', 'even');
  await expect(rows.nth(1)).toHaveAttribute('data-row-parity', 'odd');

  await page.getByRole('button', { name: '篩選 欄位 0' }).click();
  await page.getByRole('dialog').getByRole('searchbox', { name: '搜尋欄位 0的值' }).fill('z');
  await page.locator('.workspace-overlay').click({ position: { x: 4, y: 4 } });
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute('data-virtual-row-id', 'row-0');
  await expect(rows.first()).toHaveAttribute('data-row-parity', 'even');
});

test('a formula error status wins over a configured column background', async ({ page }) => {
  await page.goto(`${site.origin}/privacy`);
  await seed(page, 1, 4, 2, 0);
  await page.evaluate(async (backgroundColor) => {
    const request = indexedDB.open('board-game-helper-workspace');
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const transaction = db.transaction('tables', 'readwrite');
    const table = await new Promise<any>((resolve, reject) => { const get = transaction.objectStore('tables').get('table-0'); get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error); });
    table.columns[0] = { ...table.columns[0], inputType: 'number', backgroundColor, formula: { version: 1, expression: '1e308 * 1e308', variables: {} } };
    transaction.objectStore('tables').put(table, 'table-0');
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
    db.close();
  }, cream);
  await page.goto(`${site.origin}/workspace`);
  const header = page.locator('th[data-column-id="column-0"]');
  const cell = page.locator('td[data-bulk-row-id="row-0"][data-bulk-column-id="column-0"]');
  const oddCell = page.locator('td[data-bulk-row-id="row-1"][data-bulk-column-id="column-0"]');
  await expect(header).toHaveClass(/workspace-formula-invalid/);
  await expect(cell).toHaveClass(/workspace-formula-invalid/);
  await expect(cell).toHaveAttribute('aria-invalid', 'true');
  await expect(oddCell).toHaveClass(/workspace-formula-invalid/);
  await expect.poll(() => header.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(248, 228, 223)');
  await expect.poll(() => cell.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(248, 228, 223)');
  await expect.poll(() => oddCell.evaluate((element) => ({ background: getComputedStyle(element).backgroundColor, image: getComputedStyle(element).backgroundImage }))).toEqual({ background: 'rgb(248, 228, 223)', image: 'none' });
});
