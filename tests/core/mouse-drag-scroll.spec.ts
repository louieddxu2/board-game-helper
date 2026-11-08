import { expect, test, type Locator, type Page } from '@playwright/test';
import type { RuleCard } from '../../src/shared/types';

// Rows that swipe under a finger also follow a mouse drag on desktop.
test.use({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });

type HomeRule = RuleCard & { gameName: string; gameSlug: string };
const featuredRules: HomeRule[] = Array.from({ length: 6 }, (_, index) => ({
  id: `drag-rule-${index}`, gameId: `drag-game-${index}`, gameName: `拖曳遊戲 ${index}`, gameSlug: `drag-game-${index}`,
  statement: `第 ${index + 1} 款遊戲的規則。`, status: 'published', importanceCount: 0, tags: [], sourceLinks: [],
}));

const showHome = async (page: Page) => {
  await page.route('**/api/session', route => route.fulfill({ json: { user: null, googleClientId: null, localDevLogin: true } }));
  await page.route('**/api/home', route => route.fulfill({ json: { generatedAt: Date.now(), featured: [], featuredRules, recentRules: [], recentRuleIds: [] } }));
  await page.route('**/api/tags?*', route => route.fulfill({ json: { tags: [] } }));
  await page.goto('/');
  const rail = page.locator('.home-featured-rail');
  await expect(rail.locator('.rule-card')).toHaveCount(featuredRules.length);
  return rail;
};

const dragBy = async (page: Page, row: Locator, distance: number) => {
  const box = (await row.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(80, box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step++) await page.mouse.move(x + distance * step / 10, y);
  await page.mouse.up();
  // The row is usable once it has glided to its snap point and snapping is back on.
  await expect(row).not.toHaveAttribute('data-dragging', /.*/);
};

test('drags the featured games to the next one without opening a card, then opens one on a click', { tag: '@ui' }, async ({ page }) => {
  const rail = await showHome(page);
  const step = await rail.evaluate((element) => (element.firstElementChild as HTMLElement).offsetWidth + parseFloat(getComputedStyle(element).columnGap));
  await dragBy(page, rail, -120);
  // A short drag still moves one game along and lands on its edge.
  expect(await rail.evaluate((element) => element.scrollLeft)).toBeCloseTo(step, 0);
  await expect(rail).not.toHaveAttribute('data-dragging', /.*/);
  expect(new URL(page.url()).pathname).toBe('/');
  // The tabs above follow: the three games now on screen are the selected ones.
  await expect(page.getByRole('tab', { selected: true })).toHaveText(['拖曳遊戲 1', '拖曳遊戲 2', '拖曳遊戲 3']);

  await dragBy(page, rail, 120);
  expect(await rail.evaluate((element) => element.scrollLeft)).toBe(0);
  expect(new URL(page.url()).pathname).toBe('/');

  await rail.locator('#rule-drag-rule-1 .statement-text').click();
  await expect(page).toHaveURL(/\/games\/drag-game-1#rule-drag-rule-1$/);
});

test('a small mouse movement is still a click', { tag: '@ui' }, async ({ page }) => {
  const rail = await showHome(page);
  const text = rail.locator('#rule-drag-rule-0 .statement-text');
  const box = (await text.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + 25, box.y + 9);
  await page.mouse.up();
  await expect(page).toHaveURL(/\/games\/drag-game-0#rule-drag-rule-0$/);
});

test('shows arrows beside the rail that move one game at a time and hide at either end', { tag: '@ui' }, async ({ page }) => {
  const rail = await showHome(page);
  const prev = page.getByRole('button', { name: '上一個遊戲' });
  const next = page.getByRole('button', { name: '下一個遊戲' });
  await expect(prev).toBeHidden();
  await expect(next).toBeVisible();
  await next.click();
  await expect(page.getByRole('tab', { selected: true })).toHaveText(['拖曳遊戲 1', '拖曳遊戲 2', '拖曳遊戲 3']);
  await expect(prev).toBeVisible();
  // Six games, three on screen: three steps reach the end, where the next arrow goes away.
  await next.click();
  await next.click();
  await expect(next).toBeHidden();
  await expect(page.getByRole('tab', { selected: true })).toHaveText(['拖曳遊戲 3', '拖曳遊戲 4', '拖曳遊戲 5']);
  await prev.click();
  await expect(page.getByRole('tab', { selected: true })).toHaveText(['拖曳遊戲 2', '拖曳遊戲 3', '拖曳遊戲 4']);
  expect(await rail.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
});
