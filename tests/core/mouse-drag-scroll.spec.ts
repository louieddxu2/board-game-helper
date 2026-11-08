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

// The games named above the cards that are fully on screen; each name sits over its own card.
const namesInView = (rail: Locator) => rail.locator('.home-rail-game-title').evaluateAll((names) => {
  const edge = names[0].closest('.home-featured-rail')!.getBoundingClientRect();
  return names.filter((name) => { const box = name.getBoundingClientRect(); return box.left >= edge.left - 1 && box.right <= edge.right + 1; })
    .map((name) => name.textContent);
});

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
  // The names move with their cards: the three games now on screen are named above them.
  await expect.poll(() => namesInView(rail)).toEqual(['拖曳遊戲 1', '拖曳遊戲 2', '拖曳遊戲 3']);

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
  await expect.poll(() => namesInView(rail)).toEqual(['拖曳遊戲 1', '拖曳遊戲 2', '拖曳遊戲 3']);
  await expect(prev).toBeVisible();
  // Six games, three on screen: three steps reach the end, where the next arrow goes away.
  await next.click();
  await next.click();
  await expect(next).toBeHidden();
  await expect.poll(() => namesInView(rail)).toEqual(['拖曳遊戲 3', '拖曳遊戲 4', '拖曳遊戲 5']);
  await prev.click();
  await expect.poll(() => namesInView(rail)).toEqual(['拖曳遊戲 2', '拖曳遊戲 3', '拖曳遊戲 4']);
  expect(await rail.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
});

// A drag across most of the rail, the pointer passing the arrows, keeps its distance on release
// instead of springing back to one game from where it began.
test('a long drag past the arrows lands near where it was let go, never moving back', { tag: '@ui' }, async ({ page }) => {
  const rail = await showHome(page);
  const box = (await rail.boundingBox())!;
  const y = box.y + 150;
  const glide = async (from: number, to: number) => {
    await page.mouse.move(box.x + box.width * from, y);
    await page.mouse.down();
    for (let step = 1; step <= 30; step++) await page.mouse.move(box.x + box.width * (from + (to - from) * step / 30), y);
    const released = await rail.evaluate((element) => element.scrollLeft);
    // Record every position from the release until the row settles.
    await rail.evaluate((element) => {
      const seen: number[] = [];
      (window as Window & { seen?: number[] }).seen = seen;
      element.addEventListener('scroll', () => seen.push(element.scrollLeft));
    });
    await page.mouse.up();
    await expect(rail).not.toHaveAttribute('data-dragging', /.*/);
    return { released, seen: await page.evaluate(() => (window as Window & { seen: number[] }).seen) };
  };
  const max = await rail.evaluate((element) => element.scrollWidth - element.clientWidth);

  const forward = await glide(0.8, -0.05);
  expect(forward.released).toBeGreaterThan(max / 2);
  expect(await rail.evaluate((element) => element.scrollLeft)).toBeCloseTo(max, 0);
  for (const position of forward.seen) expect(position).toBeGreaterThanOrEqual(forward.released - 1);

  const back = await glide(0.2, 1.05);
  expect(await rail.evaluate((element) => element.scrollLeft)).toBe(0);
  for (const position of back.seen) expect(position).toBeLessThanOrEqual(back.released + 1);
});

// A second drag that starts while the first release is still gliding keeps snapping off until it is let go;
// otherwise the row jerks between the pointer and a snap point mid-drag.
test('a drag started during the previous glide follows the pointer without jumping', { tag: '@ui' }, async ({ page }) => {
  const rail = await showHome(page);
  const box = (await rail.boundingBox())!;
  const y = box.y + 150;
  await page.mouse.move(box.x + box.width * 0.6, y);
  await page.mouse.down();
  for (let step = 1; step <= 5; step++) await page.mouse.move(box.x + box.width * 0.6 - step * 40, y);
  await page.mouse.up();
  await rail.evaluate((element) => {
    const trace: Array<{ left: number; dragging: boolean }> = [];
    (window as Window & { trace?: typeof trace }).trace = trace;
    element.addEventListener('scroll', () => trace.push({ left: element.scrollLeft, dragging: Boolean(element.dataset.dragging) }));
  });
  await page.mouse.move(box.x + box.width * 0.8, y);
  await page.mouse.down();
  for (let step = 1; step <= 40; step++) {
    await page.mouse.move(box.x + box.width * (0.8 - 0.85 * step / 40), y);
    await page.waitForTimeout(25);
  }
  const trace = await page.evaluate(() => (window as Window & { trace: Array<{ left: number; dragging: boolean }> }).trace);
  await page.mouse.up();
  expect(trace.length).toBeGreaterThan(10);
  expect(trace.every((entry) => entry.dragging)).toBe(true);
  // While held, the row only moves the way the pointer does, in steps no bigger than the pointer's.
  for (let index = 1; index < trace.length; index++) {
    expect(trace[index].left).toBeGreaterThanOrEqual(trace[index - 1].left - 1);
    expect(trace[index].left - trace[index - 1].left).toBeLessThan(60);
  }
});
