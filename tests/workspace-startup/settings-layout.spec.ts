import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { closeServer, seed, startServer } from './startupSupport';
import { chooseWorkspaceSetting } from './settingsSupport';

let site: Awaited<ReturnType<typeof startServer>>;
test.beforeAll(async () => { site = await startServer(resolve('dist/client')); });
test.afterAll(async () => { await closeServer(site.server); });

for (const width of [320, 390]) {
  test.describe(`${width}px property settings`, () => {
    test.use({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true });

    test('accepts the first tap and keeps long option lists usable in a short viewport', async ({ page }, info) => {
      await page.goto(`${site.origin}/privacy`);
      await seed(page, 1, 4, 2, 0);
      await page.evaluate(async () => {
        const request = indexedDB.open('board-game-helper-workspace');
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const tx = db.transaction('tables', 'readwrite');
        const store = tx.objectStore('tables'), get = store.get('table-0');
        get.onsuccess = () => {
          const table = get.result;
          table.columns[0].inputType = 'select';
          table.columns[0].options = Array.from({ length: 20 }, (_, index) => `選項 ${index + 1}`);
          store.put(table, 'table-0');
        };
        await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
        db.close();
      });
      await page.goto(`${site.origin}/workspace`);
      await page.getByRole('columnheader', { name: '欄位 0', exact: true }).tap();
      const dialog = page.getByRole('dialog', { name: '屬性設定' });
      const center = dialog.getByRole('button', { name: '置中', exact: true });
      await center.evaluate(button => {
        button.dataset.clickCount = '0';
        button.addEventListener('click', () => { button.dataset.clickCount = String(Number(button.dataset.clickCount) + 1); });
      });
      await center.tap();
      await expect(center).toHaveAttribute('aria-pressed', 'true');
      await expect(center).toHaveAttribute('data-click-count', '1');
      await expect(dialog.getByRole('textbox', { name: '屬性名稱' })).not.toBeFocused();

      await page.setViewportSize({ width, height: 400 });
      await dialog.getByRole('textbox', { name: '固定選項 20', exact: true }).scrollIntoViewIfNeeded();
      await dialog.getByRole('button', { name: '移除固定選項 20', exact: true }).tap();
      await expect(dialog.getByRole('textbox', { name: /^固定選項 \d+$/ })).toHaveCount(19);
      await expect(dialog.getByRole('textbox', { name: '固定選項 19', exact: true })).toHaveValue('選項 19');
      const dimensions = await dialog.evaluate(element => {
        const box = element.getBoundingClientRect();
        const panel = element.querySelector<HTMLElement>('.workspace-column-config-panel')!;
        const rail = element.querySelector<HTMLElement>('.workspace-column-config-rail')!.getBoundingClientRect();
        const panelBox = panel.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, panelHeight: panel.clientHeight, contentHeight: panel.scrollHeight, overflow: panel.scrollWidth - panel.clientWidth, railRight: rail.right, panelLeft: panelBox.left, railTop: rail.top, panelTop: panelBox.top };
      });
      expect(dimensions.left).toBeGreaterThanOrEqual(0);
      expect(dimensions.right).toBeLessThanOrEqual(width);
      expect(dimensions.top).toBeGreaterThanOrEqual(0);
      expect(dimensions.bottom).toBeLessThanOrEqual(400);
      expect(dimensions.panelHeight).toBeGreaterThan(42);
      expect(dimensions.contentHeight).toBeGreaterThan(dimensions.panelHeight);
      expect(dimensions.overflow).toBe(0);
      expect(dimensions.railRight).toBeLessThanOrEqual(dimensions.panelLeft + 1);
      expect(Math.abs(dimensions.railTop - dimensions.panelTop)).toBeLessThanOrEqual(1);
      await expect(dialog.locator('select')).toHaveCount(0);
      await chooseWorkspaceSetting(dialog, '輸入類型', '數字');
      await dialog.getByRole('button', { name: '公式', exact: true }).tap();
      const formula = dialog.getByRole('textbox', { name: '計算公式' });
      await formula.fill('10 / 3');
      await chooseWorkspaceSetting(dialog, '四捨五入小數位數', '小數 2 位');
      await expect(formula).not.toBeFocused();
      const rounding = dialog.getByRole('combobox', { name: '四捨五入小數位數' });
      await rounding.press('End');
      const lastOption = dialog.getByRole('option', { name: '小數 12 位', exact: true });
      await expect(lastOption).toBeInViewport();
      const menuBox = await dialog.getByRole('listbox', { name: '四捨五入小數位數' }).boundingBox();
      expect(menuBox!.x).toBeGreaterThanOrEqual(0);
      expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(width);
      expect(menuBox!.y).toBeGreaterThanOrEqual(0);
      expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(400);
      await rounding.press('Escape');
      await expect(dialog.getByRole('listbox')).toHaveCount(0);
      await expect(dialog).toBeVisible();
      await expect(rounding).toHaveText('小數 2 位');
      await expect(dialog.locator('select')).toHaveCount(0);
      await page.screenshot({ path: info.outputPath('short-viewport-settings.png') });
    });
  });
}
