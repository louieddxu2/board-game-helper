import { expect, test, type Page } from '@playwright/test';
import type { GameDetail, RuleCard } from '../../src/shared/types';

test.use({ viewport: { width: 373, height: 754 }, deviceScaleFactor: 2.9, isMobile: true, hasTouch: true, serviceWorkers: 'block' });

const tagNames = ['設置', '計分', '行動', '回合', '終局', '資源', '建造', '移動', '卡牌效果', '玩家順序'];
const tag = (name: string) => ({ id: `filter-${name}`, slug: `filter-${name}`, name });
// 設置 is on every rule and 計分 on four, so the row order follows the counts.
const rules: RuleCard[] = Array.from({ length: 6 }, (_, index) => {
  const names = ['設置', ...(index < 4 ? ['計分'] : []), tagNames[2 + index], tagNames[(4 + index) % tagNames.length]];
  return {
    id: `filter-rule-${index}`, gameId: 'filter-game', statement: `第 ${index + 1} 條規則。`, status: 'published',
    playerCounts: [2 + (index % 3)], sourceLinks: [], tags: Array.from(new Set(names)).map(tag), tagIds: Array.from(new Set(names)).map((name) => `filter-${name}`),
  };
});
const game: GameDetail = { id: 'filter-game', slug: 'filter-game', displayName: '篩選測試遊戲', ruleCount: rules.length, updatedAt: 1, aliases: [], rules };

const showGame = async (page: Page) => {
  await page.route('**/api/session', (route) => route.fulfill({ json: { user: null, googleClientId: null, localDevLogin: true } }));
  await page.route('**/api/games/filter-game', (route) => route.fulfill({ json: { game } }));
  await page.route('**/api/tags?*', (route) => route.fulfill({ json: { tags: tagNames.map(tag) } }));
  await page.goto('/games/filter-game');
  await expect(page.getByRole('heading', { name: game.displayName, exact: true })).toBeVisible();
};

test('keeps tags and player counts on one swipeable line each, ordered by how many rules carry a tag', { tag: '@ui' }, async ({ page }) => {
  await showGame(page);
  const tagRow = page.getByRole('group', { name: '依標籤篩選' });
  const specialRow = page.getByRole('group', { name: '依人數或版本篩選' });
  for (const row of [tagRow, specialRow]) {
    const tops = await row.getByRole('button').evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
  }
  const names = await tagRow.getByRole('button').allTextContents();
  expect(names.slice(0, 2)).toEqual(['#設置', '#計分']);
  expect(names).toHaveLength(tagNames.length);
  expect(await tagRow.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(373);
  await expect(page.getByRole('button', { name: '清除所有篩選' })).toHaveCount(0);
});

test('takes the first tap after a swipe, moves the chosen tag beside the clear button, and clears with one tap', { tag: '@ui' }, async ({ page }) => {
  await showGame(page);
  const tagRow = page.getByRole('group', { name: '依標籤篩選' });
  const box = (await tagRow.boundingBox())!;
  const client = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number) => client.send('Input.dispatchTouchEvent', {
    type, touchPoints: x === undefined ? [] : [{ x, y: box.y + box.height / 2, id: 1, radiusX: 1, radiusY: 1, force: 1 }],
  });
  // A finger moves in small steps; how far one swipe scrolls depends on the fonts' widths.
  const start = box.x + box.width - 20;
  const end = box.x + 30;
  await touch('touchStart', start);
  for (let step = 1; step <= 10; step++) await touch('touchMove', start + (end - start) * step / 10);
  await touch('touchEnd');
  await expect.poll(() => tagRow.evaluate((element) => element.scrollLeft)).toBeGreaterThan(40);
  // The screen is usable once the row stops moving: the swipe's snap can still be carrying it.
  await tagRow.evaluate((element) => new Promise<void>((resolve) => {
    let last = -1;
    let still = 0;
    const frame = () => {
      still = element.scrollLeft === last ? still + 1 : 0;
      last = element.scrollLeft;
      if (still >= 3) resolve(); else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }));

  // Tap the right-most tag the swipe brought fully into view.
  const name = await tagRow.getByRole('button').evaluateAll((buttons, edge) => buttons
    .filter((button) => { const rect = button.getBoundingClientRect(); return rect.left >= edge.left && rect.right <= edge.right; })
    .map((button) => button.textContent ?? '').at(-1) ?? '', { left: box.x, right: box.x + box.width });
  expect(name).toMatch(/^#/);
  expect(['#設置', '#計分']).not.toContain(name);
  const target = tagRow.getByRole('button', { name, exact: true });
  await target.tap();
  await expect(tagRow.getByRole('button', { name: `${name} ✕` })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => tagRow.evaluate((element) => element.scrollLeft)).toBe(0);
  expect((await tagRow.getByRole('button').allTextContents()).slice(0, 2)).toEqual(['✕', `${name} ✕`]);
  expect(new URL(page.url()).searchParams.getAll('tag')).toEqual([name.slice(1)]);

  const clear = page.getByRole('button', { name: '清除所有篩選' });
  expect((await clear.boundingBox())!.width).toBeLessThanOrEqual(28);
  await clear.tap();
  await expect(clear).toHaveCount(0);
  expect(new URL(page.url()).searchParams.getAll('tag')).toEqual([]);
});
