import { expect, test, type Locator } from '@playwright/test';
import { resolve } from 'node:path';
import { closeServer, seed, startServer } from './startupSupport';

let site: Awaited<ReturnType<typeof startServer>>;
// Read once instead of polling for focus: delayed refocusing must not make a
// broken first interaction pass this release gate.
const expectImmediateFocus = async (target: Locator) => {
  expect(await target.evaluate(element => element === document.activeElement)).toBe(true);
};
test.beforeAll(async () => { site = await startServer(resolve('dist/client')); });
test.afterAll(async () => closeServer(site.server));
test.beforeEach(async ({ page }) => {
  await page.goto(`${site.origin}/__workspace-storage-seed`);
  await seed(page, 1, 4, 3, 0);
  await page.evaluate(async () => {
    const request = indexedDB.open('board-game-helper-workspace');
    const db = await new Promise<IDBDatabase>((done, reject) => { request.onsuccess = () => done(request.result); request.onerror = () => reject(request.error); });
    const transaction = db.transaction('tables', 'readwrite');
    const store = transaction.objectStore('tables');
    const get = store.get('table-0');
    get.onsuccess = () => {
      const table = get.result;
      table.columns[1].inputType = 'number';
      table.columns[1].numberInputMode = 'input';
      table.columns[2].inputType = 'link';
      table.rows[0].values['column-1'] = 1200;
      table.rows[0].values['column-2'] = { url: 'https://example.com/game', label: '原始名稱' };
      store.put(table, 'table-0');
    };
    await new Promise<void>((done, reject) => { transaction.oncomplete = () => done(); transaction.onabort = () => reject(transaction.error); });
    db.close();
  });
  await page.goto(`${site.origin}/workspace`);
});

for (const touch of [true, false]) {
  test.describe(touch ? 'touch input focus' : 'mouse input focus', () => {
    test.use({ isMobile: touch, hasTouch: touch, viewport: { width: touch ? 390 : 1280, height: 844 } });
    const activate = (target: Locator) => touch ? target.tap() : target.click();

    test('renaming focuses and selects the existing name before the first keystroke', async ({ page }) => {
      await activate(page.getByRole('button', { name: '重新命名表格' }));
      const input = page.getByRole('dialog', { name: '重新命名' }).getByRole('textbox');
      await expectImmediateFocus(input);
      expect(await input.evaluate((element: HTMLInputElement) => [element.selectionStart, element.selectionEnd]))
        .toEqual([0, '測試表 0'.length]);
      await page.keyboard.insertText('新名稱');
      await expect(input).toHaveValue('新名稱');
    });

    test('the first tap into a property name selects it without focusing it on open', async ({ page }) => {
      await activate(page.getByRole('columnheader', { name: '欄位 0', exact: true }));
      const dialog = page.getByRole('dialog', { name: '屬性設定' });
      const input = dialog.getByRole('textbox', { name: '屬性名稱' });
      await expectImmediateFocus(dialog);
      await activate(input);
      expect(await input.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd]))
        .toEqual([0, '欄位 0'.length]);
      await page.keyboard.insertText('新屬性');
      await expect(input).toHaveValue('新屬性');
    });

    test('a cell editor focuses and selects its value before the first keystroke', async ({ page }) => {
      await activate(page.locator('td[data-bulk-row-id="row-0"][data-bulk-column-id="column-0"]'));
      const dialog = page.getByRole('dialog', { name: '欄位 0', exact: true });
      const input = dialog.getByRole('textbox');
      await expectImmediateFocus(input);
      expect(await input.evaluate((element: HTMLTextAreaElement) => [element.selectionStart, element.selectionEnd]))
        .toEqual([0, '資料 0-0'.length]);
      await page.keyboard.insertText('替換內容');
      await expect(input).toHaveValue('替換內容');
    });

    test('numeric editing selects the existing number before the first keystroke', async ({ page }) => {
      await activate(page.locator('td[data-bulk-row-id="row-0"][data-bulk-column-id="column-1"]'));
      const input = page.getByRole('dialog', { name: '欄位 1', exact: true }).getByRole('spinbutton');
      await expectImmediateFocus(input);
      await page.keyboard.insertText('7');
      await expect(input).toHaveValue('7');
    });

    test('the stepper also focuses and selects its single numeric field on opening', async ({ page }) => {
      await activate(page.getByRole('columnheader', { name: '欄位 1', exact: true }));
      await activate(page.getByRole('dialog', { name: '屬性設定' }).getByRole('button', { name: '加減1', exact: true }));
      const overlay = page.locator('.workspace-column-dialog-overlay');
      if (touch) await overlay.tap({ position: { x: 4, y: 4 } });
      else await overlay.click({ position: { x: 4, y: 4 } });
      await expect(overlay).toHaveCount(0);
      await activate(page.locator('td[data-bulk-row-id="row-0"][data-bulk-column-id="column-1"]'));
      const input = page.getByRole('dialog', { name: '欄位 1', exact: true }).getByRole('spinbutton');
      await expectImmediateFocus(input);
      await page.keyboard.insertText('7');
      await expect(input).toHaveValue('7');
    });

    test('link fields select their contents on opening and on the first focus into another field', async ({ page }) => {
      await activate(page.locator('td[data-bulk-row-id="row-0"][data-bulk-column-id="column-2"] .workspace-cell-value'));
      const dialog = page.getByRole('dialog', { name: '欄位 2', exact: true });
      const url = dialog.getByRole('textbox', { name: '連結', exact: true });
      await expectImmediateFocus(url);
      await page.keyboard.insertText('https://example.com/new');
      await expect(url).toHaveValue('https://example.com/new');
      const label = dialog.getByRole('textbox', { name: '顯示名稱', exact: true });
      await activate(label);
      await page.keyboard.insertText('新顯示名稱');
      await expect(label).toHaveValue('新顯示名稱');
    });

    test('a second tap into an already focused field keeps the native caret position', async ({ page }) => {
      await activate(page.getByRole('button', { name: '重新命名表格' }));
      const input = page.getByRole('dialog', { name: '重新命名' }).getByRole('textbox');
      await expectImmediateFocus(input);
      await page.keyboard.press('ArrowLeft');
      await activate(input);
      expect(await input.evaluate((element: HTMLInputElement) => element.selectionStart === element.selectionEnd)).toBe(true);
      await page.keyboard.insertText('Z');
      await expect(input).toHaveValue(/Z/u);
      expect((await input.inputValue()).length).toBe('測試表 0'.length + 1);
    });
  });
}
