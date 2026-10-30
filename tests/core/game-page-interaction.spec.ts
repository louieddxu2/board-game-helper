import { expect, test, type Locator, type Page } from '@playwright/test';
import type { GameDetail } from '../../src/shared/types';

const game: GameDetail = {
  id: 'interaction-game', slug: 'interaction-game', displayName: '聖瑪利亞號', englishName: 'Santa Maria',
  ruleCount: 2, updatedAt: 1, aliases: [], reviewStatus: 'not_required', renameOwnerId: 'interaction-admin',
  rules: [
    { id: 'interaction-rule-1', gameId: 'interaction-game', statement: '起始板塊不算城市。',
      commonMistake: '將它當作城市計分', details: '起始板塊與城市的顏色不同。', status: 'published', categories: ['teaching_setup_opening'],
      tags: [{ id: 'interaction-tag', slug: 'setup', name: '設置' }], tagIds: ['interaction-tag'], playerCounts: [2, 3], editionNotes: ['基本版'], sourceLinks: [] },
    { id: 'interaction-rule-2', gameId: 'interaction-game', statement: '第二條規則保留在列表中。', status: 'published', categories: ['action_effect_detail', 'flow_endgame_scoring'], tags: [], sourceLinks: [] },
  ],
};

const showGame = async (page: Page, detail = game) => {
  let writes = 0;
  await page.route('**/api/session', route => route.fulfill({ json: {
    user: { id: 'interaction-admin', roles: ['admin'] }, googleClientId: null, localDevLogin: true,
  } }));
  await page.route('**/api/games/interaction-game', route => route.fulfill({ json: { game: detail } }));
  await page.route('**/api/games/interaction-game/view', route => route.fulfill({ json: { success: true, counted: false } }));
  await page.route('**/api/games/interaction-game/rule-importance', route => route.fulfill({ json: { ruleIds: [] } }));
  await page.route('**/api/tags?*', route => route.fulfill({ json: { tags: game.rules[0].tags } }));
  await page.route('**/api/account/favorites/interaction-game', route => {
    if (route.request().method() === 'POST') writes++;
    return route.fulfill({ json: { favorite: writes > 0, favoriteCount: writes, wasFirst: false } });
  });
  await page.route('**/api/account/favorites/interaction-game/seen', route => route.fulfill({ json: { ok: true } }));
  await page.goto('/games/interaction-game');
  await expect(page.getByRole('heading', { name: detail.displayName, exact: true })).toBeVisible();
  return { writes: () => writes };
};

for (const width of [393, 320, 1280]) {
  const touch = width <= 800;
  test.describe(`game page at ${width}px`, () => {
    test.use({ viewport: { width, height: 851 }, deviceScaleFactor: touch ? 3 : 1, isMobile: touch, hasTouch: touch, serviceWorkers: 'block' });
    const activate = (target: Locator) => touch ? target.tap() : target.click();

    test('aligns title actions with the first line and opens resources and editing directly', async ({ page }) => {
      const state = await showGame(page);
      const favorite = page.getByRole('button', { name: '收藏遊戲', exact: true });
      await expect(favorite).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator('.game-title-row')).toContainText(game.displayName);
      expect(await favorite.evaluate(el => Boolean(el.closest('.game-title-row')))).toBe(true);
      const titleGeometry = await page.locator('.game-hero').evaluate(el => {
        const range = document.createRange();
        range.selectNodeContents(el.querySelector('h1')!);
        return { firstLine: range.getClientRects()[0].toJSON(),
          favorite: el.querySelector('.game-favorite')!.getBoundingClientRect().toJSON(),
          edit: el.querySelector('.game-name-edit')!.getBoundingClientRect().toJSON(),
          info: el.querySelector('.game-hero-info')!.getBoundingClientRect().toJSON() };
      });
      for (const icon of [titleGeometry.favorite, titleGeometry.edit]) {
        expect(Math.abs(icon.y + icon.height / 2 - titleGeometry.firstLine.y - titleGeometry.firstLine.height / 2)).toBeLessThan(2);
        expect(icon.x + icon.width).toBeLessThanOrEqual(titleGeometry.info.x + titleGeometry.info.width + 1);
      }
      const actions = await page.locator('.game-hero-actions').boundingBox();
      if (touch) {
        expect(actions!.height).toBe(44);
        expect(actions!.width).toBeCloseTo(width / 5, 0);
        expect((await page.locator('.game-hero').boundingBox())!.height).toBeLessThan(90);
      }
      if (width === 393) {
        const hero = (await page.locator('.game-hero').boundingBox())!;
        const index = (await page.getByRole('group', { name: '規則快速索引' }).boundingBox())!;
        await page.screenshot({ path: '.wrangler/game-page-quick-index.png', clip: {
          x: hero.x - 2, y: hero.y - 8, width: hero.width + 4, height: index.y + index.height - hero.y + 13,
        } });
      }
      await activate(favorite);
      await expect(page.getByRole('button', { name: '取消收藏', exact: true })).toHaveAttribute('aria-pressed', 'true');
      expect(state.writes()).toBe(1);
      const resources = page.getByRole('button', { name: '外部資源', exact: true });
      await expect(resources).toBeVisible();
      await expect(resources).toHaveText('資源');
      await activate(resources);
      const resourceDialog = page.getByRole('dialog', { name: '外部資源', exact: true });
      await expect(resourceDialog).toBeVisible();
      await activate(resourceDialog.getByRole('button', { name: '關閉外部資源', exact: true }));
      await expect(resourceDialog).toHaveCount(0);
      await activate(page.getByRole('button', { name: '編輯遊戲名稱', exact: true }));
      const editor = page.getByRole('dialog', { name: '編輯遊戲名稱', exact: true });
      await expect(editor).toBeVisible();
      await activate(editor.getByRole('button', { name: '關閉編輯視窗', exact: true }));
      await expect(editor).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });

    test('fits three complete concept indexes on one row and toggles each selection off', async ({ page }) => {
      await showGame(page);
      const index = page.getByRole('group', { name: '規則快速索引' });
      const entries = index.getByRole('button');
      await expect(entries).toHaveCount(3);
      await expect(index.getByRole('button', { name: /全部/ })).toHaveCount(0);
      const geometry = await entries.evaluateAll(elements => elements.map(el => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return { box: el.getBoundingClientRect().toJSON(), lines: range.getClientRects().length,
          overflow: el.scrollWidth > el.clientWidth + 1 };
      }));
      for (const { box, lines, overflow } of geometry) {
        expect(Math.abs(box.y - geometry[0].box.y)).toBeLessThan(1);
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(lines).toBe(1);
        expect(overflow).toBe(false);
      }
      for (const [label, ruleId] of [
        ['教學、設置、開局', 'interaction-rule-1'], ['行動、效果、細節', 'interaction-rule-2'],
        ['流程、終局、計分', 'interaction-rule-2'],
      ]) {
        const entry = index.getByRole('button', { name: label, exact: true });
        await expect(entry).toHaveAttribute('aria-pressed', 'false');
        await activate(entry);
        await expect(entry).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('.game-rules > *')).toHaveCount(1);
        await expect(page.locator(`#rule-${ruleId}`)).toBeVisible();
        await activate(entry);
        await expect(entry).toHaveAttribute('aria-pressed', 'false');
        await expect(page.locator('.game-rules > *')).toHaveCount(2);
      }
    });

    test('hides empty indexes and keeps other categories available after the first native input', async ({ page }) => {
      await showGame(page, { ...game, rules: [game.rules[0], { ...game.rules[1], categories: ['action_effect_detail'] }] });
      const index = page.getByRole('group', { name: '規則快速索引' });
      const empty = index.getByRole('button', { name: '流程、終局、計分', exact: true });
      const action = index.getByRole('button', { name: '行動、效果、細節', exact: true });
      const opening = index.getByRole('button', { name: '教學、設置、開局', exact: true });
      await expect(empty).toHaveCount(0);
      await expect(index.getByRole('button')).toHaveCount(2);
      const geometry = await index.evaluate(el => ({ box: el.getBoundingClientRect().toJSON(),
        buttons: [...el.querySelectorAll('button')].map(button => button.getBoundingClientRect().toJSON()) }));
      expect(geometry.buttons[0].y).toBeCloseTo(geometry.buttons[1].y, 0);
      expect(geometry.buttons[0].width).toBeCloseTo(geometry.buttons[1].width, 0);
      expect(geometry.buttons[0].x).toBeCloseTo(geometry.box.x, 0);
      expect(geometry.buttons[1].right).toBeCloseTo(geometry.box.right, 0);
      if (width === 393) await index.screenshot({ path: '.wrangler/game-index-visible-only.png' });
      await expect(page.locator('.game-rules > *')).toHaveCount(2);
      await activate(action);
      await expect(action).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.game-rules > *')).toHaveCount(1);
      await expect(opening).toBeEnabled();
      await activate(opening);
      await expect(opening).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#rule-interaction-rule-1')).toBeVisible();
      await expect(action).toBeEnabled();
      await activate(opening);
      await expect(page.locator('.game-rules > *')).toHaveCount(2);
    });

    test('expands from metadata, the corner and blank padding without applying a filter', async ({ page }) => {
      await showGame(page);
      const card = page.locator('#rule-interaction-rule-1');
      for (const selector of ['.compact-tag', '.compact-attribute', '.compact-attribute:nth-child(2)', '.compact-rule-text']) {
        await expect(card).toHaveClass('rule-card-compact');
        await activate(card.locator(selector).first());
        await expect(card).toHaveClass('rule-card');
        await expect(page.getByLabel('已選標籤')).toHaveCount(0);
        await expect(page.locator('.game-rules > *')).toHaveCount(2);
        await activate(card.locator('.statement-text'));
      }
      const cardBox = await card.boundingBox();
      const corner = { x: cardBox!.width - 15, y: 15 };
      if (touch) await card.tap({ position: corner }); else await card.click({ position: corner });
      await expect(card).toHaveClass('rule-card');
      await activate(card.locator('.statement-text'));
      const padding = { x: 4, y: (await card.boundingBox())!.height / 2 };
      if (touch) await card.tap({ position: padding }); else await card.click({ position: padding });
      await expect(card).toHaveClass('rule-card');
      await activate(card.getByRole('button', { name: '#設置', exact: true }));
      await expect(page.getByLabel('已選標籤')).toContainText('#設置');
      await expect(page.locator('.game-rules > *')).toHaveCount(1);
    });

    if (width === 393) test('fills the row with the only available concept and toggles on the first tap', async ({ page }) => {
      await showGame(page, { ...game, ruleCount: 1, rules: [game.rules[0]] });
      const index = page.getByRole('group', { name: '規則快速索引' });
      const entry = index.getByRole('button', { name: '教學、設置、開局', exact: true });
      await expect(index.getByRole('button')).toHaveCount(1);
      const geometry = await index.evaluate(el => ({ width: el.getBoundingClientRect().width,
        buttonWidth: el.querySelector('button')!.getBoundingClientRect().width }));
      expect(geometry.buttonWidth).toBeCloseTo(geometry.width, 0);
      await activate(entry);
      await expect(entry).toHaveAttribute('aria-pressed', 'true');
      await activate(entry);
      await expect(entry).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator('.game-rules > *')).toHaveCount(1);
    });

    if (width === 393) test('ignores swipe, cancel, long press and pinch, then accepts the first fresh tap', async ({ page }) => {
      await showGame(page, { ...game, rules: [...game.rules, ...Array.from({ length: 6 }, (_, index) => ({
        ...game.rules[1], id: `extra-rule-${index}`, statement: `額外規則 ${index + 1}，用於確認頁面可以正常捲動。`,
      }))] });
      const card = page.locator('#rule-interaction-rule-1');
      const client = await page.context().newCDPSession(page);
      const center = async () => {
        await card.scrollIntoViewIfNeeded();
        const box = (await card.boundingBox())!;
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      };
      const nativeTouch = (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', point?: { x: number; y: number }) => client.send('Input.dispatchTouchEvent', {
        type, touchPoints: point ? [{ ...point, id: 1, radiusX: 1, radiusY: 1, force: 1 }] : [],
      });
      const freshTap = async () => {
        await expect(card).toHaveClass('rule-card-compact');
        await card.tap();
        await expect(card).toHaveClass('rule-card');
        await card.locator('.statement-text').tap();
        await expect(card).toHaveClass('rule-card-compact');
      };
      let point = await center();
      const scrollBefore = await page.evaluate(() => scrollY);
      await nativeTouch('touchStart', point);
      await nativeTouch('touchMove', { x: point.x, y: point.y - 60 });
      await nativeTouch('touchMove', { x: point.x, y: point.y - 100 });
      await nativeTouch('touchEnd');
      await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(scrollBefore);
      await freshTap();
      point = await center();
      await nativeTouch('touchStart', point);
      await nativeTouch('touchCancel');
      await freshTap();
      point = await center();
      await nativeTouch('touchStart', point);
      // Holding is the gesture being tested, rather than an input-readiness delay.
      await page.waitForTimeout(650);
      await nativeTouch('touchEnd');
      await freshTap();
      point = await center();
      const fingers = (distance: number) => [-1, 1].map((side, index) => ({
        x: point.x + side * distance, y: point.y, id: index + 1, radiusX: 1, radiusY: 1, force: 1,
      }));
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(25) });
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(40) });
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(55) });
      await nativeTouch('touchEnd');
      await freshTap();
      await client.detach();
    });

    if (width === 393) test('keeps a long title complete without expanding the action column', async ({ page }) => {
      await showGame(page, { ...game, displayName: '聖瑪利亞號：這是一個很長而且必須完整顯示的遊戲名稱' });
      const geometry = await page.locator('.game-hero').evaluate(el => {
        const range = document.createRange();
        range.selectNodeContents(el.querySelector('h1')!);
        return {
        info: el.querySelector('.game-hero-info')!.getBoundingClientRect().toJSON(),
        actions: el.querySelector('.game-hero-actions')!.getBoundingClientRect().toJSON(),
        favorite: el.querySelector('.game-favorite')!.getBoundingClientRect().toJSON(),
        title: el.querySelector('h1')!.getBoundingClientRect().toJSON(),
        firstLine: range.getClientRects()[0].toJSON(),
      }; });
      expect(geometry.info.x + geometry.info.width).toBeLessThanOrEqual(geometry.actions.x);
      expect(geometry.favorite.width).toBe(44);
      expect(geometry.title.height).toBeGreaterThan(40);
      expect(Math.abs(geometry.favorite.y + geometry.favorite.height / 2 - geometry.firstLine.y - geometry.firstLine.height / 2)).toBeLessThan(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  });
}
