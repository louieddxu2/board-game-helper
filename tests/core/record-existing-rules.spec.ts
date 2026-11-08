import { expect, test, type Page } from '@playwright/test';
import type { GameDetail } from '../../src/shared/types';

test.use({ viewport: { width: 373, height: 754 }, deviceScaleFactor: 2.9, isMobile: true, hasTouch: true, serviceWorkers: 'block' });

const game: GameDetail = {
  id: 'drawer-game', slug: 'drawer-game', displayName: '聖瑪利亞號', ruleCount: 3, updatedAt: 1, aliases: [],
  rules: [
    { id: 'drawer-rule-1', gameId: 'drawer-game', statement: '起始有的那片Town Hall不算是城市（不算入某些以城市為目標的計分條件）。', status: 'published', importanceCount: 0, tags: [], sourceLinks: [] },
    { id: 'drawer-rule-2', gameId: 'drawer-game', statement: '大教堂只能蓋在自己城市的旁邊，不能蓋在別人的城市旁。', status: 'published', importanceCount: 2, tags: [], sourceLinks: [] },
    { id: 'drawer-rule-3', gameId: 'drawer-game', statement: '船隻移動時不能穿越其他玩家的船，但可以停在同一格。', status: 'published', importanceCount: 1, tags: [], sourceLinks: [] },
  ],
};

const openRecordPage = async (page: Page) => {
  await page.route('**/api/session', (route) => route.fulfill({ json: {
    user: { id: 'drawer-editor', roles: ['editor'], maskedEmail: 'e***r@example.com', nickname: '東東', showNickname: true },
    googleClientId: null, localDevLogin: false,
  } }));
  await page.route(/\/api\/games\/drawer-game(\?.*)?$/, (route) => route.fulfill({ json: { game, rulesComplete: true } }));
  await page.route('**/api/tags?*', (route) => route.fulfill({ json: { tags: [] } }));
  await page.goto('/add?game=drawer-game');
  const open = page.getByRole('button', { name: '對照既有規則 3' });
  await expect(open).toBeVisible();
  return open;
};

const drawer = (page: Page) => page.getByRole('dialog', { name: '聖瑪利亞號・既有 3 條規則' });
// The drawer slides in; gestures are measured from where it rests.
const settled = async (page: Page) => {
  const panel = drawer(page);
  await expect(panel).toBeVisible();
  await panel.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  return panel;
};

test('opens beside the draft at 85% width, ranks the resembling rule first and expands a rule in place', { tag: '@ui' }, async ({ page }) => {
  const open = await openRecordPage(page);
  const headingHeight = await page.locator('.list-heading').evaluate((element) => element.getBoundingClientRect().height);
  expect(headingHeight).toBeLessThan(44);
  await page.getByLabel('正確規則 *').fill('起始那片 Town Hall 不算城市');
  await open.tap();
  const panel = await settled(page);
  expect(await panel.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(Math.round(373 * 0.85));
  const items = panel.locator('.existing-rule');
  await expect(items.first()).toContainText('可能與第 1 條相似');
  await expect(items.nth(1)).toContainText('大教堂');
  const firstHeight = await items.nth(1).evaluate((element) => element.getBoundingClientRect().height);
  await items.nth(1).tap();
  await expect(items.nth(1)).toHaveAttribute('aria-expanded', 'true');
  expect(await items.nth(1).evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(firstHeight);
  await expect(page).toHaveURL(/\/add\?game=drawer-game$/);
});

for (const way of ['swipe', 'backdrop', 'back'] as const) {
  test(`closes with a ${way} and takes the first tap on the form right after`, async ({ page }) => {
    const open = await openRecordPage(page);
    await open.tap();
    const panel = await settled(page);
    if (way === 'swipe') {
      const box = (await panel.boundingBox())!;
      const client = await page.context().newCDPSession(page);
      const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number) => client.send('Input.dispatchTouchEvent', {
        type, touchPoints: x === undefined ? [] : [{ x, y: box.y + 200, id: 1, radiusX: 1, radiusY: 1, force: 1 }],
      });
      await touch('touchStart', box.x + 40);
      await touch('touchMove', box.x + 90);
      await touch('touchMove', box.x + 160);
      await touch('touchEnd');
    } else if (way === 'backdrop') {
      await page.touchscreen.tap(20, 300);
    } else {
      await page.goBack();
    }
    await expect(panel).toHaveCount(0);
    await expect(page).toHaveURL(/\/add\?game=drawer-game$/);
    const field = page.getByLabel('正確規則 *');
    await field.tap();
    await expect(field).toBeFocused();
  });
}

test('keeps a vertical scroll of the list from closing the drawer', async ({ page }) => {
  const open = await openRecordPage(page);
  await open.tap();
  const panel = await settled(page);
  const box = (await panel.boundingBox())!;
  const client = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number, y?: number) => client.send('Input.dispatchTouchEvent', {
    type, touchPoints: x === undefined ? [] : [{ x, y: y!, id: 1, radiusX: 1, radiusY: 1, force: 1 }],
  });
  await touch('touchStart', box.x + 60, box.y + 400);
  await touch('touchMove', box.x + 100, box.y + 300);
  await touch('touchMove', box.x + 120, box.y + 150);
  await touch('touchEnd');
  await expect(panel).toBeVisible();
});
