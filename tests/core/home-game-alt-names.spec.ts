import { expect, test, type Page } from '@playwright/test';
import type { RuleCard } from '../../src/shared/types';

type HomeRule = RuleCard & { gameName: string; gameSlug: string };
const games = [
  { gameName: '馬可波羅 II：可汗的託付', englishName: 'Marco Polo II: In the Service of the Khan' },
  { gameName: '甜蜜國度', englishName: undefined },
  { gameName: '石油公司', englishName: 'Pipeline' },
];
const rules: HomeRule[] = games.map(({ gameName }, index) => ({
  id: `alt-rule-${index}`, gameId: `alt-game-${index}`, gameName, gameSlug: `alt-game-${index}`,
  statement: `${gameName}常被玩錯的規則。`, commonMistake: '玩錯的方式', status: 'published', importanceCount: 0,
  tags: [], sourceLinks: [], createdByNickname: '東東',
}));

const showHome = async (page: Page) => {
  await page.route('**/api/session', route => route.fulfill({ json: { user: null, googleClientId: null, localDevLogin: true } }));
  await page.route('**/api/home', route => route.fulfill({ json: {
    generatedAt: Date.now(), featuredRules: rules, recentRules: [], recentRuleIds: [],
    featured: rules.map((rule, index) => ({ gameSlug: rule.gameSlug, gameName: rule.gameName, gameEnglishName: games[index].englishName, ruleId: rule.id, publishedRuleCount: 12 })),
  } }));
  await page.goto('/');
  await expect(page.locator('.home-featured-rail .rule-card')).toHaveCount(rules.length);
};

test.describe('phone', () => {
  test.use({ viewport: { width: 373, height: 754 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, serviceWorkers: 'block' });

  const tabSizes = (page: Page) => page.locator('.home-game-tabs > button').evaluateAll(tabs => tabs.map(tab => [tab.offsetWidth, tab.offsetHeight]));

  test('shows a smaller second name under each tab without changing any tab size', { tag: '@ui' }, async ({ page }) => {
    await showHome(page);
    const row = page.locator('[role="tablist"]');
    const rowHeight = (await row.boundingBox())!.height;
    const sizes = await tabSizes(page);
    // Every tab is as tall as a tab without a second name, and no wider than eight full-width characters.
    expect(sizes.map(([, height]) => height)).toEqual([36, 36, 36]);
    expect(Math.max(...sizes.map(([width]) => width))).toBeLessThanOrEqual(8 * 14 + 30);
    expect(rowHeight).toBeLessThanOrEqual(42);

    const pipeline = page.getByRole('tab', { name: /石油公司/ });
    await expect(pipeline.locator('.home-game-tab-alt')).toHaveText('Pipeline');
    // The long names of the selected first tab move; the others stay still.
    const marco = page.getByRole('tab', { name: /馬可波羅/ });
    await expect(marco.locator('.home-game-tab-line[data-marquee]')).toHaveCount(2);
    await expect.poll(() => marco.locator('.home-game-tab-alt > span').evaluate(span => new DOMMatrix(getComputedStyle(span).transform).m41), { timeout: 8000 }).toBeLessThan(-20);
    await expect(page.locator('.home-game-tabs > button:not(.active) [data-marquee]')).toHaveCount(0);

    await pipeline.tap();
    await expect(pipeline).toHaveAttribute('aria-selected', 'true');
    await expect(pipeline).toBeInViewport({ ratio: 1 });
    await expect(page.locator('.home-game-tab-line[data-marquee]')).toHaveCount(0);
    // A deselected tab is back to an ellipsis, and selecting never resizes a tab or the row.
    expect(await marco.locator('.home-game-tab-alt').evaluate(line => line.scrollWidth > line.clientWidth)).toBe(true);
    expect(await tabSizes(page)).toEqual(sizes);
    expect((await row.boundingBox())!.height).toBe(rowHeight);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(373);
  });
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });

  test('puts the English name on a small second line within the existing heading height', { tag: '@ui' }, async ({ page }) => {
    await showHome(page);
    const headings = page.locator('.home-rail-game-name');
    await expect(headings.locator('.home-rail-game-alt')).toHaveText([games[0].englishName!, 'Pipeline']);
    // A heading with a second name is exactly as tall as one without.
    const heights = await headings.evaluateAll(items => items.map(item => item.getBoundingClientRect().height));
    expect(heights).toEqual([44, 44, 44]);
    for (const index of [0, 2]) {
      const heading = headings.nth(index);
      const [box, title, alt] = await Promise.all([heading, heading.locator('.home-rail-game-title'), heading.locator('.home-rail-game-alt')].map(async item => (await item.boundingBox())!));
      expect(alt.x).toBeCloseTo(title.x, 0);
      expect(alt.y).toBeGreaterThanOrEqual(title.y + title.height - 1);
      expect(alt.y + alt.height).toBeLessThanOrEqual(box.y + box.height);
    }
    // The title and the rule count stay whole beside the arrow.
    for (const heading of await headings.all()) {
      const count = heading.locator('.home-rail-game-count');
      await expect(count).toHaveText('12 條規則');
      expect(await heading.locator('.home-rail-game-title, .home-rail-game-count').evaluateAll(items => items.every(item => item.scrollWidth <= item.clientWidth + 1))).toBe(true);
      const [countBox, arrowBox] = [(await count.boundingBox())!, (await heading.locator('.home-rail-game-arrow').boundingBox())!];
      expect(countBox.x + countBox.width).toBeLessThanOrEqual(arrowBox.x);
    }
  });
});
