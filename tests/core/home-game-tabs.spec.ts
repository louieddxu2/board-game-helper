import { expect, test, type Page } from '@playwright/test';
import type { RuleCard } from '../../src/shared/types';

type HomeRule = RuleCard & { gameName: string; gameSlug: string };
const names = ['馬可波羅 II：可汗的託付', '馬可波羅', '聖瑪利亞號', '甜蜜國度'];
const rules: HomeRule[] = names.map((gameName, index) => ({
  id: `tab-rule-${index}`, gameId: `tab-game-${index}`, gameName, gameSlug: `tab-game-${index}`,
  statement: `${gameName}常被玩錯的規則。`, commonMistake: '玩錯的方式', status: 'published', importanceCount: 0,
  tags: [{ id: `tab-tag-${index}`, slug: `tab-tag-${index}`, name: '設置' }], sourceLinks: [], createdByNickname: '東東',
}));

const showHome = async (page: Page) => {
  await page.route('**/api/session', route => route.fulfill({ json: { user: null, googleClientId: null, localDevLogin: true } }));
  await page.route('**/api/home', route => route.fulfill({ json: {
    generatedAt: Date.now(), featured: [], featuredRules: rules, recentRules: [], recentRuleIds: [],
  } }));
  await page.route('**/api/tags?*', route => route.fulfill({ json: { tags: rules.flatMap(rule => rule.tags) } }));
  await page.goto('/');
  await expect(page.locator('.home-featured-rail .rule-card')).toHaveCount(rules.length);
};

const truncated = (page: Page, name: string) => page.getByRole('tab', { name, exact: true }).locator('span')
  .evaluate(element => element.scrollWidth > element.clientWidth + 1);

test.describe('mobile game tabs', () => {
  test.use({ viewport: { width: 393, height: 851 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'block' });

  test('names each game above its card instead of on it, and shows the selected name in full', async ({ page }) => {
    await showHome(page);
    await expect(page.getByRole('tab')).toHaveCount(4);
    await expect(page.getByRole('tab', { exact: true, name: names[0] })).toHaveAttribute('aria-selected', 'true');
    expect(await truncated(page, names[0])).toBe(false);
    await expect(page.locator('.home-featured-rail .rule-game-title')).toHaveCount(0);
    await expect(page.locator('.home-rail-dots')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);
  });

  test('stops scrolling exactly when the first or last game is centred, and enlarges only the selected tab', async ({ page }) => {
    await showHome(page);
    const row = page.locator('[role="tablist"]');
    const offset = (index: number) => row.evaluate((element, index) => {
      const box = element.getBoundingClientRect();
      const tab = element.children[index].getBoundingClientRect();
      return tab.left + tab.width / 2 - (box.left + box.width / 2);
    }, index);
    await row.evaluate(element => { element.scrollLeft = -500; });
    expect(Math.abs(await offset(0))).toBeLessThan(1);
    await row.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    expect(Math.abs(await offset(names.length - 1))).toBeLessThan(1);

    const heights = await row.evaluate(element => Array.from(element.children, tab => tab.getBoundingClientRect().height));
    expect(heights[0]).toBeGreaterThan(heights[1]);
    expect(heights.slice(1).every(height => height === heights[1])).toBe(true);
    // The larger selected tab fits inside the row without making it taller than before.
    expect(await row.evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(42);
    expect(heights[0]).toBeLessThanOrEqual(await row.evaluate(element => element.clientHeight));
  });

  test('moves to a tapped game without passing through the others, then opens its rule with the first tap', async ({ page }) => {
    await showHome(page);
    await page.locator('[role="tablist"]').evaluate(list => {
      const seen: string[] = [];
      (window as Window & { selections?: string[] }).selections = seen;
      new MutationObserver(() => {
        const selected = list.querySelector('[aria-selected="true"]')?.textContent ?? '';
        if (seen[seen.length - 1] !== selected) seen.push(selected);
      }).observe(list, { subtree: true, attributes: true, attributeFilter: ['aria-selected'] });
    });
    const rail = page.locator('.home-featured-rail');
    await page.getByRole('tab', { exact: true, name: names[3] }).tap();
    await expect.poll(() => rail.evaluate(element => {
      const step = (element.firstElementChild as HTMLElement).offsetWidth + parseFloat(getComputedStyle(element).columnGap);
      return Math.round(element.scrollLeft / step * 100) / 100;
    })).toBe(3);
    expect(await page.evaluate(() => (window as Window & { selections?: string[] }).selections)).toEqual([names[3]]);
    await expect(page.getByRole('tab', { exact: true, name: names[3] })).toBeInViewport({ ratio: 1 });
    expect(await truncated(page, names[0])).toBe(true);

    const card = page.locator('#rule-tab-rule-3');
    await expect(card).toBeInViewport({ ratio: 0.9 });
    const previousLength = await page.evaluate(() => history.length);
    await card.locator('.statement-text').tap();
    await expect(page).toHaveURL(/\/games\/tab-game-3#rule-tab-rule-3$/);
    expect(await page.evaluate(() => history.length)).toBe(previousLength + 1);
  });

  test('follows a swipe with the tab selection and keeps it in view', async ({ page }) => {
    await showHome(page);
    const rail = page.locator('.home-featured-rail');
    const box = (await rail.boundingBox())!;
    const client = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number) => client.send('Input.dispatchTouchEvent', {
      type, touchPoints: x === undefined ? [] : [{ x, y: box.y + 60, id: 1, radiusX: 1, radiusY: 1, force: 1 }],
    });
    for (const expected of [1, 2]) {
      await touch('touchStart', box.x + box.width - 25);
      await touch('touchMove', box.x + box.width / 2);
      await touch('touchMove', box.x + 25);
      await touch('touchEnd');
      await expect(page.getByRole('tab', { exact: true, name: names[expected] })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('tab', { exact: true, name: names[expected] })).toBeInViewport({ ratio: 1 });
    }
    // A tab tapped right after a swipe still takes effect on the first tap.
    await page.getByRole('tab', { exact: true, name: names[0] }).tap();
    await expect(page.getByRole('tab', { exact: true, name: names[0] })).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => rail.evaluate(element => element.scrollLeft)).toBe(0);
  });

  test('opens a rule from the keyboard although the card has no game name', async ({ page }) => {
    await showHome(page);
    const link = page.locator('#rule-tab-rule-0 .rule-open-link');
    await expect(link).toHaveAttribute('aria-label', `查看完整規則：${names[0]}，${rules[0].statement}`);
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/games\/tab-game-0#rule-tab-rule-0$/);
  });
});

test.describe('tablet portrait', () => {
  test.use({ viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, serviceWorkers: 'block' });

  test('shows two featured games side by side with their names on the cards and the touch navigation kept', async ({ page }) => {
    await showHome(page);
    await expect(page.getByRole('tab')).toHaveCount(0);
    const [first, second] = await page.locator('.home-featured-rail .rule-card').evaluateAll(cards => cards.slice(0, 2).map(card => card.getBoundingClientRect().toJSON()));
    expect(second.top).toBeCloseTo(first.top, 0);
    expect(second.left).toBeGreaterThan(first.right);
    await expect(page.locator('.home-featured-rail .rule-game-title')).toHaveCount(4);
    await expect(page.locator('.mobile-nav')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(768);
  });
});
