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
  makeRule(3, { statement: lines(2, '正確規則'), commonMistake: lines(2, '玩錯情況'), details: lines(2, '補充說明') }),
  makeRule(4, {}),
  makeRule(5, { statement: lines(20, '只有正確規則') }),
];

const showHome = async (page: Page, featuredRules = rules, recentRules: HomeRule[] = []) => {
  await page.route('**/api/session', route => route.fulfill({ json: { user: null, googleClientId: null, localDevLogin: true } }));
  await page.route('**/api/home', route => route.fulfill({ json: {
    generatedAt: Date.now(), featured: [], featuredRules, recentRules, recentRuleIds: [],
  } }));
  await page.route('**/api/tags?*', route => route.fulfill({ json: { tags: [] } }));
  const gameRules = [...featuredRules, ...recentRules].filter(rule => rule.gameId === rules[1].gameId);
  await page.route('**/api/games/preview-game-2', route => route.fulfill({ json: { game: {
    id: rules[1].gameId, slug: rules[1].gameSlug, displayName: rules[1].gameName,
    aliases: [], ruleCount: gameRules.length, updatedAt: 1, rules: gameRules,
  } satisfies GameDetail } }));
  await page.goto('/');
  await expect(page.locator('.home-featured-rail .rule-card')).toHaveCount(featuredRules.length + recentRules.length);
};

for (const width of [320, 393, 1280]) {
  test.describe(`home rule previews at ${width}px`, () => {
    const mobile = width < 800;
    test.use({ viewport: { width, height: 851 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });

    if (!mobile) test('preserves the desktop line budget', async ({ page }) => {
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
      expect(geometry[2].rows).toEqual([2, 2, 2]);
      expect(geometry[3].rows).toEqual([1]);
      expect(geometry[4].rows).toEqual([8]);
      for (const card of geometry) {
        expect(card.rows.reduce((sum, count) => sum + count, 0)).toBeLessThanOrEqual(8);
        expect(card.footerTop).toBeGreaterThanOrEqual(card.bodyBottom);
      }
      await expect(cards.nth(0).locator('.rule-card-preview-hint')).toHaveText('內容未完，點按卡片查看完整規則');
      await expect(cards.nth(1).locator('.rule-card-preview-hint')).toHaveCount(1);
      await expect(cards.nth(2).locator('.rule-card-preview-hint')).toHaveCount(0);
      await expect(cards.nth(3).locator('.rule-card-preview-hint')).toHaveCount(0);
      // The hint adds no action: the existing importance/copy/share controls stay intact.
      await expect(cards.nth(0).getByRole('button')).toHaveCount(3);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
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
      if (mobile) {
        const box = (await text.boundingBox())!;
        await page.touchscreen.tap(box.x + 40, box.y + 20);
      } else await text.click();
      await expect(page).toHaveURL(/\/games\/preview-game-2#rule-preview-rule-2$/);
      await expect(page.locator('#rule-preview-rule-2.rule-card .statement-text')).toHaveText(rules[1].statement);
      await expect(page.locator('#rule-preview-rule-2 .details-text')).toHaveText(rules[1].details!);
      await expect(page.locator('.rule-card-preview')).toHaveCount(0);
      expect(await page.evaluate(() => (window as Window & { previewNavigations: number }).previewNavigations)).toBe(1);
      expect(await page.locator('#rule-preview-rule-2 .statement-text').evaluate(element => {
        return element.clientHeight / parseFloat(getComputedStyle(element).lineHeight);
      })).toBeGreaterThan(8);
    });

    if (!mobile) test('updates line limits and hints when font size changes at a fixed width and line height', async ({ page }) => {
      await showHome(page, [makeRule(9, {
        statement: '回合結束後先計分再補牌。', commonMistake: lines(6, '玩錯情況'), details: '補充說明',
      })]);
      const card = page.locator('#rule-preview-rule-9');
      await expect(card.locator('.rule-card-preview-hint')).toHaveCount(0);
      await expect(card.locator('.details-text')).toBeVisible();
      const beforeWidth = await card.evaluate(element => element.getBoundingClientRect().width);
      const style = await page.addStyleTag({ content: '.rule-card-preview .statement-text { font-size: 64px; line-height: 27px; }' });
      await expect(card.locator('.rule-card-preview-hint')).toHaveCount(1);
      await expect(card.locator('.details-text')).toBeHidden();
      const visibleLines = await card.locator('.rule-card-preview p').evaluateAll(elements => elements.reduce((sum, element) => {
        return sum + Math.round(element.getBoundingClientRect().height / parseFloat(getComputedStyle(element).lineHeight));
      }, 0));
      expect(visibleLines).toBe(8);
      expect(await card.evaluate(element => element.getBoundingClientRect().width)).toBe(beforeWidth);
      await style.evaluate(element => element.remove());
      await expect(card.locator('.rule-card-preview-hint')).toHaveCount(0);
      await expect(card.locator('.details-text')).toBeVisible();
    });
  });
}

test.describe('two rules of the same game in the mobile window', () => {
  test.use({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });

  for (const which of ['first', 'second'] as const) {
    test(`opens the ${which} rule from the first tap on its own visible area`, async ({ page }) => {
      const first = { ...rules[1], id: 'short-rule', statement: '本回合先移動。', commonMistake: undefined, details: undefined };
      const second = rules[1];
      await showHome(page, [first], [second]);
      const rail = page.locator('.home-featured-rail');
      const firstCard = rail.locator('#rule-short-rule');
      const secondEntry = rail.locator('.home-rule-stack-entry').nth(1);
      const clippedLink = secondEntry.locator('.home-rule-stack-link');
      await expect(clippedLink).toBeVisible();
      await expect(secondEntry.locator('.home-rule-stack-content')).toHaveJSProperty('inert', true);
      const stack = (await rail.locator('.home-rule-stack').boundingBox())!;
      const secondBox = (await secondEntry.boundingBox())!;
      expect(secondBox.y).toBeLessThan(stack.y + stack.height - 20);
      expect(secondBox.y + secondBox.height).toBeGreaterThan(stack.y + stack.height);
      const previousLength = await page.evaluate(() => history.length);
      if (which === 'first') {
        await firstCard.locator('.rule-title-link').tap();
        await expect(page).toHaveURL(/\/games\/preview-game-2#rule-short-rule$/);
        await expect(page.locator('#rule-short-rule.rule-card .statement-text')).toHaveText(first.statement);
      } else {
        await page.touchscreen.tap(secondBox.x + 40, secondBox.y + 20);
        await expect(page).toHaveURL(/\/games\/preview-game-2#rule-preview-rule-2$/);
        await expect(page.locator('#rule-preview-rule-2.rule-card .statement-text')).toHaveText(second.statement);
      }
      expect(await page.evaluate(() => history.length)).toBe(previousLength + 1);
    });
  }
});
