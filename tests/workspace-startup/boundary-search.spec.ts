import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { closeServer, seed, startServer } from './startupSupport';

let site: Awaited<ReturnType<typeof startServer>>;
test.beforeAll(async () => { site = await startServer(resolve('dist/client')); });
test.afterAll(async () => closeServer(site.server));

const setup = async (page: Page) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${site.origin}/privacy`);
  await seed(page, 1, 250, 2, 0);
  await page.goto(`${site.origin}/workspace`);
  const viewport = page.locator('.workspace-table-viewport');
  await expect(page.getByText('項目 0', { exact: true })).toBeVisible();
  await viewport.evaluate(element => { element.scrollTop = element.scrollHeight - element.clientHeight; });
  await expect(page.getByText('項目 249', { exact: true })).toBeVisible();
  const box = await viewport.boundingBox();
  if (!box) throw new Error('Missing table viewport');
  const clockStart = Date.now();
  await page.clock.install({ time: clockStart });
  await page.clock.pauseAt(clockStart + 1_000);
  const client = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', pull = 0) => client.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x: box.x + box.width - 12, y: box.y + box.height - 80 - pull, id: 1 }],
  });
  return { errors, client, touch, table: page.locator('.workspace-table'), search: page.getByRole('searchbox', { name: '搜尋此表' }) };
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
