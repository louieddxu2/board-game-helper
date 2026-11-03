import { expect, test, type Page } from '@playwright/test';
import type { GameDetail, RuleCard } from '../../src/shared/types';

type HomeRule = RuleCard & { gameName: string; gameSlug: string };
const lines = (count: number, text: string) => Array.from({ length: count }, (_, index) => `${text}${index + 1}`).join('\n');
const makeRule = (index: number, content: Partial<RuleCard>): HomeRule => ({
  id: `preview-rule-${index}`, gameId: `preview-game-${index}`, gameName: `展示遊戲 ${index}`, gameSlug: `preview-game-${index}`,
  statement: '短規則。', status: 'published', importanceCount: 0, tags: [], sourceLabel: '遊戲說明書', sourceLinks: [], ...content,
});
const rules = [
  makeRule(1, { statement: lines(3, '正確規則'), commonMistake: lines(3, '玩錯情況'), details: lines(20, '補充說明') }),
  makeRule(2, { statement: '每回合必須先完成行動再結算所有資源。'.repeat(40), commonMistake: '不可先領取資源。', details: '完整補充內容。' }),
  makeRule(3, { statement: lines(3, '正確規則'), commonMistake: lines(3, '玩錯情況'), details: lines(2, '補充說明') }),
  makeRule(4, {}),
];

const showHome = async (page: Page, featuredRules = rules) => {
  await page.route('**/api/session', route => route.fulfill({ json: { user: null, googleClientId: null, localDevLogin: true } }));
  await page.route('**/api/home', route => route.fulfill({ json: {
    generatedAt: Date.now(), featured: [], featuredRules, recentRules: [], recentRuleIds: [],
  } }));
  await page.route('**/api/tags?*', route => route.fulfill({ json: { tags: [] } }));
  await page.route('**/api/games/preview-game-2', route => route.fulfill({ json: { game: {
    id: rules[1].gameId, slug: rules[1].gameSlug, displayName: rules[1].gameName,
    aliases: [], ruleCount: 1, updatedAt: 1, rules: [rules[1]],
  } satisfies GameDetail } }));
  await page.goto('/');
  await expect(page.locator('.home-featured-rail .rule-card')).toHaveCount(featuredRules.length);
};

for (const width of [320, 393, 1280]) {
  test.describe(`home rule previews at ${width}px`, () => {
    const mobile = width < 800;
    test.use({ viewport: { width, height: 851 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });

    test('shares eight actual text lines across sections and keeps short cards natural', async ({ page }) => {
      await showHome(page);
      const cards = page.locator('.home-featured-rail .rule-card');
      const geometry = await cards.evaluateAll(elements => elements.map(card => {
        const body = card.querySelector('.rule-card-preview')!;
        const rows = Array.from(body.querySelectorAll('p'), paragraph => {
          const rect = paragraph.getBoundingClientRect();
          return rect.height === 0 ? 0 : Math.round(rect.height / parseFloat(getComputedStyle(paragraph).lineHeight));
        });
        const footer = card.querySelector('.rule-card-footer')!.getBoundingClientRect();
        return { rows, height: card.getBoundingClientRect().height, bodyBottom: body.getBoundingClientRect().bottom, footerTop: footer.top };
      }));
      expect(geometry[0].rows).toEqual([3, 3, 2]);
      expect(geometry[1].rows).toEqual([8, 0, 0]);
      expect(geometry[2].rows).toEqual([3, 3, 2]);
      expect(geometry[3].rows).toEqual([1]);
      for (const card of geometry) {
        expect(card.rows.reduce((sum, count) => sum + count, 0)).toBeLessThanOrEqual(8);
        expect(card.footerTop).toBeGreaterThanOrEqual(card.bodyBottom);
      }
      if (mobile) expect(geometry[3].height).toBeLessThan(geometry[0].height);
      await expect(cards.nth(0).locator('.rule-card-preview-hint')).toHaveText('內容未完，點按卡片查看完整規則');
      await expect(cards.nth(1).locator('.rule-card-preview-hint')).toHaveCount(1);
      await expect(cards.nth(2).locator('.rule-card-preview-hint')).toHaveCount(0);
      await expect(cards.nth(3).locator('.rule-card-preview-hint')).toHaveCount(0);
      // The hint adds no action: the existing importance/copy/share controls stay intact.
      await expect(cards.nth(0).getByRole('button')).toHaveCount(3);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      if (width === 393) await page.locator('#discover').screenshot({ path: '.wrangler/home-rule-preview-393.png', animations: 'disabled' });
    });

    test('opens the full rule exactly once with the first input after a swipe', async ({ page }) => {
      await showHome(page);
      if (mobile) {
        const rail = page.locator('.home-featured-rail');
        const box = (await rail.boundingBox())!;
        const client = await page.context().newCDPSession(page);
        const y = box.y + 70;
        const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number) => client.send('Input.dispatchTouchEvent', {
          type, touchPoints: x === undefined ? [] : [{ x, y, id: 1 }],
        });
        const recentTop = await page.locator('.home-rail-dots').evaluate(element => element.getBoundingClientRect().top);
        await touch('touchStart', box.x + box.width - 25);
        await touch('touchMove', box.x + box.width / 2);
        await touch('touchMove', box.x + 25);
        await touch('touchEnd');
        await expect(page.locator('.home-rail-dots span').nth(1)).toHaveClass('active');
        expect(await page.locator('.home-rail-dots').evaluate(element => element.getBoundingClientRect().top)).toBeCloseTo(recentTop, 0);
        await client.detach();
      }
      await page.evaluate(() => {
        const original = history.pushState.bind(history);
        (window as Window & { previewNavigations?: number }).previewNavigations = 0;
        history.pushState = (...args) => {
          (window as Window & { previewNavigations: number }).previewNavigations++;
          original(...args);
        };
      });
      const text = page.locator('#rule-preview-rule-2 .statement-text');
      if (mobile) await text.tap(); else await text.click();
      await expect(page).toHaveURL(/\/games\/preview-game-2#rule-preview-rule-2$/);
      await expect(page.locator('#rule-preview-rule-2.rule-card .statement-text')).toHaveText(rules[1].statement);
      await expect(page.locator('#rule-preview-rule-2 .details-text')).toHaveText(rules[1].details!);
      await expect(page.locator('.rule-card-preview')).toHaveCount(0);
      expect(await page.evaluate(() => (window as Window & { previewNavigations: number }).previewNavigations)).toBe(1);
      expect(await page.locator('#rule-preview-rule-2 .statement-text').evaluate(element => {
        return element.clientHeight / parseFloat(getComputedStyle(element).lineHeight);
      })).toBeGreaterThan(8);
    });
  });
}

test('recalculates wrapped lines when the viewport changes', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 851 });
  await showHome(page, [makeRule(8, {
    statement: '每回合結束時必須先完成所有行動再結算資源。',
    commonMistake: lines(6, '玩錯情況'), details: '補充說明',
  })]);
  const card = page.locator('#rule-preview-rule-8');
  await expect(card.locator('.details-text')).toBeHidden();
  for (const width of [1280, 320, 393]) {
    await page.setViewportSize({ width, height: 851 });
    if (width === 1280) {
      await expect(card.locator('.details-text')).toBeVisible();
      await expect(card.locator('.rule-card-preview-hint')).toHaveCount(0);
    } else {
      await expect(card.locator('.details-text')).toBeHidden();
      await expect(card.locator('.rule-card-preview-hint')).toHaveCount(1);
    }
  }
});
