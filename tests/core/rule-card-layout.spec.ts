import { expect, test, type Locator, type Page } from '@playwright/test';
import type { RuleCard } from '../../src/shared/types';

type FeaturedRule = RuleCard & { gameName: string; gameSlug: string };
type SourceWindow = Window & { sourceOpens?: Array<[string, string | undefined, string | undefined]> };
const statement = '起始有的那片Town Hall不算是城市(city)（不算入某些以城市為目標的計分條件）';
const details = '起始那片的圖案跟城市圖案很像，但顏色不同。';
const makeTags = (names: string[]) => names.map((name, index) => ({ id: `layout-tag-${index}`, slug: `layout-tag-${index}`, name }));
const sample: FeaturedRule = {
  id: 'layout-rule', gameId: 'layout-game', gameName: '聖瑪利亞號', gameSlug: 'santa-maria',
  statement, commonMistake: '將它當作城市計分', details, status: 'published', importanceCount: 0,
  tags: makeTags(['計分', '城市']), tagIds: ['layout-tag-0', 'layout-tag-1'], createdByNickname: '東東',
  sourceLabel: 'Bgg作者答覆', sourceLinks: [{ url: 'https://boardgamegeek.com/thread/123' }],
};

const showCard = async (page: Page, rule: FeaturedRule) => {
  await page.route('**/api/session', route => route.fulfill({ json: { user: null, googleClientId: null, localDevLogin: true } }));
  await page.route('**/api/home', route => route.fulfill({ json: {
    generatedAt: Date.now(), featured: [], featuredRules: [rule], recentRules: [], recentRuleIds: [], popularGames: [],
  } }));
  await page.route('**/api/tags?*', route => route.fulfill({ json: { tags: rule.tags } }));
  await page.addInitScript(() => {
    const target = window as SourceWindow;
    target.sourceOpens = [];
    target.open = (url, name, features) => {
      target.sourceOpens!.push([String(url), name, features]);
      return null;
    };
  });
  await page.goto('/');
  const card = page.locator('#rule-layout-rule');
  await expect(card).toBeVisible();
  return card;
};

const box = async (locator: Locator) => {
  const result = await locator.boundingBox();
  expect(result).not.toBeNull();
  return result!;
};

for (const width of [393, 320, 1280]) {
  test.describe(`rule card at ${width}px`, () => {
    const touch = width <= 800;
    test.use({ viewport: { width, height: 851 }, deviceScaleFactor: touch ? 3 : 1, isMobile: touch, hasTouch: touch, serviceWorkers: 'block' });
    const activate = (target: Locator) => touch ? target.tap() : target.click();

    test('keeps the complete rule compact, with a two-line source and usable actions', async ({ page }) => {
      const card = await showCard(page, sample);
      await expect(card.locator('.statement-text')).toHaveText(statement);
      await expect(card.locator('.mistake-text')).toHaveText(sample.commonMistake!);
      await expect(card.locator('.details-text')).toHaveText(details);
      const source = card.locator('.rule-source-entry');
      await activate(source);
      expect(await page.evaluate(() => (window as SourceWindow).sourceOpens)).toEqual([
        ['https://boardgamegeek.com/thread/123', '_blank', 'noopener,noreferrer'],
      ]);
      expect(new URL(page.url()).pathname).toBe('/');
      const cardBox = await box(card);
      if (width === 393) expect(cardBox.height).toBeLessThan(315);
      const geometry = await card.evaluate(el => {
        const rect = (selector: string) => el.querySelector(selector)!.getBoundingClientRect().toJSON();
        return { sourceTitle: rect('.rule-source-title'), sourceValue: rect('.rule-source-value'),
          title: rect('.rule-game-title'), tags: rect('.rule-tags'),
          notes: [
            { label: rect('.mistake-badge'), text: rect('.mistake-text') },
            { label: rect('.details-badge'), text: rect('.details-text') },
          ],
          actions: [...el.querySelectorAll('.rule-card-footer button')].map(action => action.getBoundingClientRect().toJSON()) };
      });
      expect(geometry.sourceTitle.y + geometry.sourceTitle.height).toBeLessThanOrEqual(geometry.sourceValue.y + 1);
      await expect(source.locator('.rule-source-title')).toHaveCSS('font-size', '11px');
      await expect(source.locator('.rule-source-value')).toHaveCSS('font-size', '11px');
      for (const { label, text } of geometry.notes) {
        expect(Math.abs(label.y + label.height / 2 - text.y - text.height / 2)).toBeLessThan(1);
      }
      for (const actionBox of geometry.actions) {
        expect(actionBox.width).toBeGreaterThanOrEqual(43);
        expect(actionBox.height).toBeGreaterThanOrEqual(43);
        expect(Math.abs(actionBox.y - geometry.actions[0].y)).toBeLessThan(1);
      }
      if (width === 393) {
        expect(Math.abs(geometry.tags.y - geometry.title.y)).toBeLessThan(1);
      }
      expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      if (touch) await card.screenshot({ path: `.wrangler/rule-card-compact-${width}.png` });
    });

    if (touch) test('moves two long tags below the game name when the first row is full', async ({ page }) => {
      const tags = makeTags(['需要保留完整名稱的計分標籤', '另外一個很長的城市判定標籤']);
      const card = await showCard(page, { ...sample, tags, tagIds: tags.map(tag => tag.id) });
      const geometry = await card.evaluate(el => {
        const title = el.querySelector('.rule-game-title')!.getBoundingClientRect();
        const tags = el.querySelector('.rule-tags')!.getBoundingClientRect();
        return { titleBottom: title.bottom, tagsTop: tags.top, tagsX: tags.x, contentX: title.x,
          overflow: el.scrollWidth > el.clientWidth + 1 };
      });
      expect(geometry.tagsTop).toBeGreaterThanOrEqual(geometry.titleBottom - 1);
      expect(geometry.tagsX).toBeCloseTo(geometry.contentX, 0);
      expect(geometry.overflow).toBe(false);
      for (const tag of tags) await expect(card.getByRole('button', { name: `#${tag.name}`, exact: true })).toBeVisible();
    });

    test('wraps all tags below long game and author information without hiding text', async ({ page }) => {
      const tags = makeTags(['計分', '城市', '遊戲結束', '資源轉換', '擴充模組', '玩家順序', '回合結算',
        '這個標籤名稱特別長仍然必須完整顯示並且保持原本的字級與點按範圍']);
      const rule = { ...sample, gameName: '聖瑪利亞號：這是一個很長且必須完整顯示的遊戲名稱',
        createdByNickname: '公開建立者名稱很長仍然完整保留', editedByNicknames: ['另一位修改者', '第三位修改者'],
        playerCounts: [2, 3, 4], editionNotes: ['基本版與完整保留名稱的擴充'], tags, tagIds: tags.map(tag => tag.id) };
      const card = await showCard(page, rule);
      const cardBox = await box(card);
      const tagGroup = card.getByLabel('主題標籤');
      const groupBox = await box(tagGroup);
      const nameBox = await box(card.locator('.rule-game-title'));
      const creditsBox = await box(card.locator('.rule-card-header-actions'));
      const sameRow = await card.evaluate(el => ({ titleY: el.querySelector('.rule-game-title')!.getBoundingClientRect().y,
        creditsY: el.querySelector('.rule-card-header-actions')!.getBoundingClientRect().y }));
      expect(Math.abs(sameRow.titleY - sameRow.creditsY)).toBeLessThan(1);
      expect(groupBox.y).toBeGreaterThanOrEqual(Math.max(nameBox.y + nameBox.height, creditsBox.y + creditsBox.height) - 1);
      expect(groupBox.width).toBeGreaterThan(cardBox.width - 28);
      await expect(card.getByRole('heading', { name: rule.gameName })).toBeVisible();
      await expect(card.getByText(`建立：${rule.createdByNickname}`)).toBeVisible();
      await expect(card.getByText('修改：另一位修改者、第三位修改者')).toBeVisible();
      for (const tag of tags) {
        const target = tagGroup.getByRole('button', { name: `#${tag.name}`, exact: true });
        await expect(target).toBeVisible();
        await expect(target).toHaveCSS('font-size', '12px');
        const targetBox = await box(target);
        expect(targetBox.x).toBeGreaterThanOrEqual(cardBox.x);
        expect(targetBox.x + targetBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
      }
      const content = await box(card.locator('.rule-statement-section'));
      expect(content.y).toBeGreaterThanOrEqual(groupBox.y + groupBox.height);
      expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      if (width === 393) await card.screenshot({ path: '.wrangler/rule-card-many-tags.png' });
      await activate(tagGroup.getByRole('button', { name: '#計分', exact: true }));
      await expect(page).toHaveURL(url => url.pathname === '/games/santa-maria' && url.searchParams.get('tag') === '計分' && !url.hash);
    });

    test('retains full source names, every link and the first cancel and confirm actions', async ({ page }) => {
      const sourceLabel = '官方規則書與作者提供的完整補充說明，超長名稱保留於來源提示';
      const card = await showCard(page, { ...sample, sourceLabel, sourceLinks: [
        { label: '原始答覆', url: 'https://boardgamegeek.com/thread/123' },
        { label: '補充原文', url: 'https://example.com/rules?edition=2' },
      ] });
      const sources = card.locator('.rule-source-entry');
      await expect(sources).toHaveCount(2);
      for (const value of await card.locator('.rule-source-value').all()) {
        await expect(value).toContainText(sourceLabel);
        expect(await value.getAttribute('title')).toContain(sourceLabel);
        await expect(value).toHaveCSS('text-overflow', 'ellipsis');
        expect(await value.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
      }
      const extra = card.getByRole('button', { name: /來源2.*補充原文/ });
      await activate(extra);
      const dialog = page.getByRole('alertdialog', { name: '即將離開本站' });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('https://example.com/rules?edition=2');
      await activate(dialog.getByRole('button', { name: '取消', exact: true }));
      await expect(dialog).toHaveCount(0);
      expect(await page.evaluate(() => (window as SourceWindow).sourceOpens)).toEqual([]);
      await activate(extra);
      await expect(dialog).toBeVisible();
      await activate(dialog.getByRole('button', { name: '繼續前往', exact: true }));
      await expect(dialog).toHaveCount(0);
      expect(await page.evaluate(() => (window as SourceWindow).sourceOpens)).toEqual([
        ['https://example.com/rules?edition=2', '_blank', 'noopener,noreferrer'],
      ]);
      expect(new URL(page.url()).pathname).toBe('/');
    });
  });
}
