import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { closeServer, readTableCell, seed, startServer } from './startupSupport';
import { chooseWorkspaceSetting } from './settingsSupport';
let site: Awaited<ReturnType<typeof startServer>>;
test.beforeAll(async () => { site = await startServer(resolve('dist/client')); });
test.afterAll(async () => { await closeServer(site.server); });
test.beforeEach(() => { site.state.documentDelay = 0; });

test('a saved 10k-row conversion persists numeric values and rebuilds dynamic choices after reload', async ({ page }) => {
  await page.goto(`${site.origin}/privacy`);
  await seed(page, 1, 10_000, 2, 0);
  await page.evaluate(async () => {
    const request = indexedDB.open('board-game-helper-workspace');
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const transaction = db.transaction('tables', 'readwrite');
    const store = transaction.objectStore('tables');
    const get = store.get('table-0');
    get.onsuccess = () => {
      const table = get.result;
      table.rows.forEach((row: { values: Record<string, string> }, index: number) => { row.values['column-0'] = String(index % 2); });
      store.put(table, 'table-0');
    };
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error); });
    db.close();
  });
  await page.goto(`${site.origin}/workspace`);
  await page.getByRole('columnheader', { name: '欄位 0', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '屬性設定' });
  await chooseWorkspaceSetting(dialog, '輸入類型', '數字');
  await page.locator('.workspace-column-dialog-overlay').click({ position: { x: 4, y: 4 } });
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => readTableCell(page, 'table-0', 'row-9999', 'column-0')).toBe(1);
  expect(await readTableCell(page, 'table-0', 'row-0', 'column-0')).toBe(0);

  await page.getByRole('columnheader', { name: '欄位 0', exact: true }).click();
  await chooseWorkspaceSetting(dialog, '輸入類型', '動態列表');
  await page.locator('.workspace-column-dialog-overlay').click({ position: { x: 4, y: 4 } });
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => readTableCell(page, 'table-0', 'row-9999', 'column-0')).toBe('1');
  await page.reload();
  await page.locator('td[data-bulk-row-id="row-0"][data-bulk-column-id="column-0"]').click();
  await expect(page.getByRole('option', { name: '0', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: '1', exact: true })).toBeVisible();
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
  await expect(dialog.getByRole('combobox', { name: '輸入類型' })).toHaveText('文字');
  await expect(dialog.getByRole('button', { name: '置左', pressed: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('column-settings.png') });
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: '推擠寬度', exact: true })).toBeFocused();
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
