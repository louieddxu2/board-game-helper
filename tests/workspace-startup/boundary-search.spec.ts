import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { closeServer, seed, startServer } from './startupSupport';

let site: Awaited<ReturnType<typeof startServer>>;
test.beforeAll(async () => { site = await startServer(resolve('dist/client')); });
test.afterAll(async () => closeServer(site.server));

const setup = async (page: Page, atBottom = true) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${site.origin}/privacy`);
  await seed(page, 1, 250, 2, 0);
  await page.goto(`${site.origin}/workspace`);
  const viewport = page.locator('.workspace-table-viewport');
  await expect(page.getByText('項目 0', { exact: true })).toBeVisible();
  await viewport.evaluate((element, atBottom) => { element.scrollTop = (element.scrollHeight - element.clientHeight) * (atBottom ? 1 : 0.5); }, atBottom);
  await expect(page.getByText(atBottom ? '項目 249' : '項目 124', { exact: true })).toBeInViewport();
  const box = await viewport.boundingBox();
  if (!box) throw new Error('Missing table viewport');
  const clockStart = Date.now();
  await page.clock.install({ time: clockStart });
  await page.clock.pauseAt(clockStart + 1_000);
  const client = await page.context().newCDPSession(page);
  const touchAt = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number, id = 1) => client.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x, y, id, radiusX: 1, radiusY: 1, force: 1 }],
  });
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', pull = 0) => touchAt(type, box.x + box.width - 12, box.y + box.height - 80 - pull);
  const tap = async (x: number, y: number, id = 2) => {
    await touchAt('touchStart', x, y, id);
    await page.clock.runFor(35);
    await touchAt('touchEnd', x, y, id);
    await page.clock.runFor(16);
  };
  const cellPoint = async () => {
    const point = await viewport.evaluate(element => {
      const viewportBox = element.getBoundingClientRect();
      const cells = Array.from(element.querySelectorAll<HTMLElement>('td[data-bulk-column-id="column-0"]'));
      for (const cell of cells) {
        const box = cell.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
        if (y < viewportBox.top + viewportBox.height / 2 || y > viewportBox.bottom - 80) continue;
        if (document.elementFromPoint(x, y)?.closest('td') === cell) return { x, y };
      }
      return null;
    });
    if (!point) throw new Error('Missing hit-testable cell inside the table viewport');
    return point;
  };
  return { errors, client, touch, tap, touchAt, cellPoint, table: page.locator('.workspace-table'), viewport, search: page.getByRole('searchbox', { name: '搜尋此表' }), editor: page.locator('.workspace-value-dialog') };
};

test('starts the search countdown only after an upward pull reaches the visible bounce limit', async ({ page }) => {
  const gesture = await setup(page);
  await gesture.touch('touchStart');
  await gesture.touch('touchMove', 24);
  await page.clock.runFor(700);
  await expect(gesture.search).toHaveCount(0);
  await expect(gesture.table).toHaveCSS('--workspace-bounce-y', '-8.4px');
  await gesture.touch('touchMove', 90);
  await expect(gesture.table).toHaveCSS('--workspace-bounce-y', '-30.0px');
  await page.clock.runFor(499);
  await expect(gesture.search).toHaveCount(0);
  await page.clock.runFor(1);
  await expect(gesture.search).toBeVisible();
  await gesture.touch('touchEnd');
  expect(gesture.errors).toEqual([]);
  await gesture.client.detach();
});

test('starts a fresh countdown after retreating and reaching the limit again', async ({ page }) => {
  const gesture = await setup(page);
  await gesture.touch('touchStart');
  await gesture.touch('touchMove', 90);
  await expect(gesture.table).toHaveCSS('--workspace-bounce-y', '-30.0px');
  await page.clock.runFor(300);
  await gesture.touch('touchMove', 40);
  await expect(gesture.table).toHaveCSS('--workspace-bounce-y', '-14.0px');
  await page.clock.runFor(700);
  await expect(gesture.search).toHaveCount(0);
  await gesture.touch('touchMove', 110);
  await expect(gesture.table).toHaveCSS('--workspace-bounce-y', '-30.0px');
  await page.clock.runFor(499);
  await expect(gesture.search).toHaveCount(0);
  await page.clock.runFor(1);
  await expect(gesture.search).toBeVisible();
  await gesture.touch('touchEnd');
  expect(gesture.errors).toEqual([]);
  await gesture.client.detach();
});

test('does not open search when the finger lifts before the countdown completes', async ({ page }) => {
  const gesture = await setup(page);
  await gesture.touch('touchStart');
  await gesture.touch('touchMove', 90);
  await expect(gesture.table).toHaveCSS('--workspace-bounce-y', '-30.0px');
  await page.clock.runFor(499);
  await gesture.touch('touchEnd');
  await page.clock.runFor(600);
  await expect(gesture.search).toHaveCount(0);
  expect(gesture.errors).toEqual([]);
  await gesture.client.detach();
});

test('native touch tap control opens an untouched visible cell', async ({ page }) => {
  const gesture = await setup(page);
  const cell = page.locator('td[data-bulk-row-id="row-249"][data-bulk-column-id="column-0"]');
  const box = await cell.boundingBox();
  if (!box) throw new Error('Missing bottom data cell');
  await gesture.tap(box.x + box.width / 2, box.y + box.height / 2, 1);
  await expect(gesture.editor).toBeVisible();
  await gesture.client.detach();
});

test('opens the first fresh touch tap after a short bottom-boundary pull release', async ({ page }) => {
  const gesture = await setup(page);
  const cell = page.locator('td[data-bulk-row-id="row-249"][data-bulk-column-id="column-0"]');
  await expect(cell).toBeVisible();
  await gesture.touch('touchStart');
  await gesture.touch('touchMove', 90);
  await expect(gesture.table).toHaveCSS('--workspace-bounce-y', '-30.0px');
  await gesture.touch('touchEnd');
  await page.clock.runFor(80);
  await expect(gesture.search).toHaveCount(0);
  await expect(gesture.editor).toHaveCount(0);
  const box = await cell.boundingBox();
  if (!box) throw new Error('Missing bottom data cell');
  await gesture.tap(box.x + box.width / 2, box.y + box.height / 2, 1);
  await expect(gesture.editor).toBeVisible();
  expect(gesture.errors).toEqual([]);
  await gesture.client.detach();
});

test('does not open an editor from an interior pan and accepts the next fresh touch tap', async ({ page }) => {
  const gesture = await setup(page, false);
  const source = await gesture.cellPoint();
  const before = await gesture.viewport.evaluate(element => element.scrollTop);
  await gesture.touchAt('touchStart', source.x, source.y, 1);
  await gesture.touchAt('touchMove', source.x, source.y - 80, 1);
  await gesture.touchAt('touchEnd', source.x, source.y - 80, 1);
  await page.clock.runFor(80);
  expect(await gesture.viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(before);
  await expect(gesture.editor).toHaveCount(0);
  const target = await gesture.cellPoint();
  await gesture.tap(target.x, target.y);
  await expect(gesture.editor).toBeVisible();
  expect(gesture.errors).toEqual([]);
  await gesture.client.detach();
});
