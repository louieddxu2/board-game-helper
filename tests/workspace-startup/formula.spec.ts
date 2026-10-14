import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { closeServer, holdIdleWork, seed, startServer } from './startupSupport';

let site: Awaited<ReturnType<typeof startServer>>;
test.beforeAll(async () => { site = await startServer(resolve('dist/client')); });
test.afterAll(async () => closeServer(site.server));
test.beforeEach(async ({ page }) => {
  await page.goto(`${site.origin}/privacy`);
  await seed(page, 1, 260, 3, 0);
  await page.evaluate(async () => {
    const request = indexedDB.open('board-game-helper-workspace');
    const db = await new Promise<IDBDatabase>((done, reject) => { request.onsuccess = () => done(request.result); request.onerror = () => reject(request.error); });
    const tx = db.transaction('tables', 'readwrite'), store = tx.objectStore('tables'), get = store.get('table-0');
    get.onsuccess = () => {
      const table = get.result;
      table.columns.forEach((column: { name: string; inputType: string; numberInputMode: string }, index: number) => { column.name = ['價格', '次數', '平均'][index]; column.inputType = 'number'; column.numberInputMode = 'input'; });
      table.rows.forEach((row: { values: Record<string, number> }) => { row.values = { 'column-0': 1200, 'column-1': 6 }; });
      store.put(table, 'table-0');
    };
    await new Promise<void>((done, reject) => { tx.oncomplete = () => done(); tx.onabort = () => reject(tx.error); });
    db.close();
  });
  await page.goto(`${site.origin}/workspace`);
});

test('mobile formula buttons insert at the caret, save, recalculate and survive reload', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('columnheader', { name: '平均', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '屬性設定' });
  await expect(dialog).toBeFocused();
  const subtypeBoxes = await dialog.locator('.workspace-input-subtype-options > div > button').evaluateAll(buttons => buttons.map(button => {
    const box = button.getBoundingClientRect(); return { top: box.top, left: box.left, right: box.right };
  }));
  expect(subtypeBoxes).toHaveLength(2);
  expect(Math.abs(subtypeBoxes[0].top - subtypeBoxes[1].top)).toBeLessThanOrEqual(1);
  expect(subtypeBoxes[0].right).toBeLessThanOrEqual(subtypeBoxes[1].left);
  await expect(dialog.getByText('數字來源', { exact: true })).toHaveCount(0);
  const sourceHeight = await dialog.getByRole('group', { name: '數字來源', exact: true }).evaluate(group => ({
    group: group.getBoundingClientRect().height,
    button: Math.max(...Array.from(group.querySelectorAll('button'), button => button.getBoundingClientRect().height)),
  }));
  expect(sourceHeight.group).toBeLessThanOrEqual(sourceHeight.button + 2);
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '儲存', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: '自動計算', exact: true }).click();
  const input = dialog.getByRole('textbox', { name: '計算公式' });
  await dialog.getByRole('button', { name: '插入變數 價格' }).tap();
  await dialog.getByRole('button', { name: '插入 ÷' }).tap();
  await dialog.getByRole('button', { name: '插入變數 次數' }).tap();
  await expect(input).toHaveValue('[價格]÷[次數]');
  await input.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(0, 0));
  await dialog.getByRole('button', { name: '插入 (' }).tap();
  await expect(input).toHaveValue('([價格]÷[次數]');
  await input.evaluate((node: HTMLTextAreaElement) => node.setSelectionRange(node.value.length, node.value.length));
  await dialog.getByRole('button', { name: '插入 )' }).tap();
  await expect(input).toHaveValue('([價格]÷[次數])');
  await expect(dialog.getByRole('button', { name: '1', exact: true })).toHaveCount(0);
  await input.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('formula-mobile.png') });
  const box = await dialog.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(390);
  await page.locator('.workspace-overlay').tap({ position: { x: 4, y: 4 } });
  await expect(dialog).toHaveCount(0);
  const calculated = page.locator('[data-cell-id="row-0:column-2"]');
  await expect(calculated).toHaveText('200');
  await expect(calculated).toHaveAttribute('aria-readonly', 'true');
  await calculated.tap();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('[data-cell-id="row-0:column-0"]').tap();
  const editor = page.getByRole('dialog');
  await editor.getByRole('spinbutton').fill('1800');
  await page.locator('.workspace-overlay').tap({ position: { x: 4, y: 4 } });
  await expect(calculated).toHaveText('300');
  await holdIdleWork(page);
  await page.reload();
  await expect(calculated).toHaveText('300');
  await page.locator('[data-cell-id="row-0:column-0"]').tap();
  await page.getByRole('dialog').getByRole('spinbutton').fill('2400');
  await page.locator('.workspace-overlay').tap({ position: { x: 4, y: 4 } });
  await expect(calculated).toHaveText('400');
  expect(errors).toEqual([]);
});

test('mobile formula validation stays live, treats blank division as empty, and clears runtime status after correction', async ({ page }, info) => {
  const averageHeader = page.locator('th[data-column-id="column-2"]');
  await averageHeader.tap();
  const dialog = page.getByRole('dialog', { name: '屬性設定' });
  await dialog.getByRole('button', { name: '自動計算', exact: true }).tap();
  const formulaInput = dialog.getByRole('textbox', { name: '計算公式' });

  await formulaInput.fill('[價格] +');
  await expect(formulaInput).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog.locator('.workspace-formula-editor .form-error')).toContainText('需要');
  await expect(dialog.locator('.workspace-formula-editor .form-error')).toBeInViewport();
  const errorLine = await dialog.locator('.workspace-formula-editor .form-error').evaluate(element => ({
    height: element.getBoundingClientRect().height,
    whiteSpace: getComputedStyle(element).whiteSpace,
    fullText: element.textContent,
    title: element.getAttribute('title'),
  }));
  expect(errorLine.height).toBeLessThanOrEqual(28);
  expect(errorLine.whiteSpace).toBe('nowrap');
  expect(errorLine.title).toBe(errorLine.fullText);
  await page.screenshot({ path: info.outputPath('formula-invalid-mobile.png') });

  await formulaInput.fill('[價格] / [次數]');
  await expect(formulaInput).toHaveAttribute('aria-invalid', 'false');
  await expect(dialog.getByRole('status')).toContainText('預覽');
  await page.locator('.workspace-overlay').tap({ position: { x: 4, y: 4 } });

  const calculated = page.locator('[data-cell-id="row-0:column-2"]');
  await expect(calculated).toHaveText('200');
  await expect(calculated).toHaveAttribute('aria-invalid', 'false');

  const editCount = async (value: string) => {
    await page.locator('[data-cell-id="row-0:column-1"]').tap();
    const editor = page.getByRole('dialog');
    await editor.getByRole('spinbutton').fill(value);
    await page.locator('.workspace-overlay').tap({ position: { x: 4, y: 4 } });
  };
  const expectBlankResult = async () => {
    await expect(calculated).toHaveAttribute('aria-label', /平均：空白/);
    await expect(calculated).toHaveAttribute('aria-invalid', 'false');
    await expect(averageHeader).not.toContainText('計算異常');
  };

  await editCount('0');
  await expectBlankResult();
  await page.reload();
  await expectBlankResult();

  await editCount('');
  await expectBlankResult();
  await page.reload();
  await expectBlankResult();

  await editCount('6');
  await expect(calculated).toHaveText('200');
  await page.locator('[data-cell-id="row-0:column-0"]').tap();
  await page.getByRole('dialog').getByRole('spinbutton').fill('1800');
  await page.locator('.workspace-overlay').tap({ position: { x: 4, y: 4 } });
  await expect(calculated).toHaveText('300');

  await averageHeader.tap();
  await page.getByRole('dialog', { name: '屬性設定' }).getByRole('textbox', { name: '計算公式' }).fill('1e308 * 1e308');
  await page.locator('.workspace-overlay').tap({ position: { x: 4, y: 4 } });
  await expect(calculated).toHaveAttribute('aria-invalid', 'true');
  await expect(calculated).toHaveClass(/workspace-formula-invalid/);
  await expect(averageHeader).toContainText('計算異常');
  await averageHeader.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('formula-field-error-mobile.png') });

  await averageHeader.tap();
  await page.getByRole('dialog', { name: '屬性設定' }).getByRole('textbox', { name: '計算公式' }).fill('[價格] / [次數]');
  await page.locator('.workspace-overlay').tap({ position: { x: 4, y: 4 } });
  await expect(calculated).toHaveText('300');
  await expect(calculated).toHaveAttribute('aria-invalid', 'false');
  await expect(averageHeader).not.toContainText('計算異常');
});

test('browser Back leaves formulas intact; dependent source deletion is blocked; closing saves fixed results', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: '屬性設定' });
  await page.getByRole('columnheader', { name: '平均', exact: true }).tap();
  await dialog.getByRole('button', { name: '自動計算', exact: true }).tap();
  await dialog.getByRole('textbox', { name: '計算公式' }).fill('[價格] / [次數]');
  await page.locator('.workspace-overlay').tap({ position: { x: 4, y: 4 } });
  const value = page.locator('[data-cell-id="row-0:column-2"]');
  await expect(value).toHaveText('200');
  await page.getByRole('columnheader', { name: '平均', exact: true }).tap();
  await dialog.getByRole('textbox', { name: '計算公式' }).fill('[價格] +');
  await page.locator('.workspace-overlay').tap({ position: { x: 4, y: 4 } });
  await expect(dialog.getByRole('alert')).toContainText('需要數字');
  await expect(value).toHaveText('200');
  await dialog.getByRole('textbox', { name: '計算公式' }).fill('999');
  await page.goBack();
  await expect(dialog).toHaveCount(0);
  await expect(value).toHaveText('200');
  await page.getByRole('columnheader', { name: '價格', exact: true }).tap();
  await dialog.getByRole('button', { name: '刪除屬性', exact: true }).tap();
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('dialog', { name: '刪除屬性', exact: true })).toHaveCount(0);
  await page.locator('.workspace-overlay').tap({ position: { x: 4, y: 4 } });
  await page.getByRole('columnheader', { name: '平均', exact: true }).tap();
  await dialog.getByRole('button', { name: '手動輸入', exact: true }).tap();
  await page.locator('.workspace-overlay').tap({ position: { x: 4, y: 4 } });
  await expect(value).toHaveText('200');
  await expect(value).toHaveAttribute('aria-readonly', 'false');
  await page.reload();
  await expect(value).toHaveText('200');
});
