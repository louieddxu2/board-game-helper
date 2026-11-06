import { expect, test, type Page } from '@playwright/test';
import type { RuleCard } from '../../src/shared/types';

test.use({ viewport: { width: 393, height: 851 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'block' });

type HomeRule = RuleCard & { gameName: string; gameSlug: string };
const rule = (index: number): HomeRule => ({
  id: `rail-rule-${index}`, gameId: `rail-game-${index}`, gameName: `測試遊戲 ${index}`, gameSlug: `rail-game-${index}`,
  statement: `第 ${index} 款遊戲常被玩錯的規則。`, commonMistake: '玩錯的方式', status: 'published', importanceCount: 0, sourceLinks: [],
});

const showHome = async (page: Page) => {
  await page.route('**/api/session', (route) => route.fulfill({ json: { user: null, googleClientId: null, localDevLogin: true } }));
  await page.route('**/api/home', (route) => route.fulfill({ json: {
    generatedAt: Date.now(), featured: [], featuredRules: [1, 2].map(rule), recentRules: [rule(4), rule(5)], recentRuleIds: [],
  } }));
  await page.goto('/');
  await expect(page.locator('.home-featured-rail .rule-card')).toHaveCount(2);
};

test('swipes through fixed height featured games, then takes the first tap on a card once', async ({ page }) => {
  await showHome(page);
  const rail = page.locator('.home-featured-rail');
  const geometry = await rail.evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, height: element.getBoundingClientRect().height,
    cards: Array.from(element.querySelectorAll('.rule-card'), card => card.getBoundingClientRect().height) }));
  expect(geometry.scrollWidth).toBeGreaterThan(geometry.clientWidth);
  // The window holds a six-line card plus the 看更多 row, so these shorter first cards show whole.
  for (const card of geometry.cards) expect(card + 56).toBeLessThanOrEqual(geometry.height + 0.5);
  // Its height follows the six-line design, not the screen.
  await page.setViewportSize({ width: 393, height: 600 });
  await expect.poll(() => rail.evaluate(element => element.getBoundingClientRect().height)).toBeCloseTo(geometry.height, 0);
  await page.setViewportSize({ width: 393, height: 851 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);

  const client = await page.context().newCDPSession(page);
  const box = (await rail.boundingBox())!;
  const y = box.y + 40;
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number) => client.send('Input.dispatchTouchEvent', {
    type, touchPoints: x === undefined ? [] : [{ x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 }],
  });
  await touch('touchStart', box.x + box.width - 30);
  await touch('touchMove', box.x + box.width - 150);
  await touch('touchMove', box.x + 40);
  await touch('touchEnd');
  await expect.poll(() => rail.evaluate((element) => element.scrollLeft)).toBeGreaterThan(100);
  await expect(page.getByRole('tab', { name: '測試遊戲 2' })).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => scrollX)).toBe(0);

  const second = page.locator('#rule-rail-rule-2').getByRole('button', { name: /將這條規則標為重要/ });
  await expect(second).toBeInViewport({ ratio: 1 });
  await second.tap();
  await expect(page.getByRole('status')).toContainText('登入後即可將規則標為重要。');
  await expect(page.getByRole('status')).toHaveCount(1);
});

for (const input of ['tap', 'click'] as const) {
  test(`opens a recent rule on its game page with one ${input}`, async ({ page }) => {
    await showHome(page);
    const row = page.locator('.home-recent-list').getByRole('link', { name: /測試遊戲 5/ });
    await expect(row).toHaveAttribute('href', '/games/rail-game-5#rule-rail-rule-5');
    if (input === 'tap') await row.tap(); else await row.click();
    await expect(page).toHaveURL(/\/games\/rail-game-5#rule-rail-rule-5$/);
  });
}
