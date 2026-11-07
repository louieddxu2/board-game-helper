import { expect, test, type Locator, type Page } from '@playwright/test';

const games = Array.from({ length: 6 }, (_, index) => ({
  id: `recent-game-${index}`, slug: `recent-game-${index}`,
  displayName: `${index + 1}・聖瑪利亞號與它的完整擴充遊戲名稱`,
}));

const showHome = async (page: Page, mode: 'explore' | 'personal') => {
  await page.addInitScript(mode => localStorage.setItem('home_view_mode', mode), mode);
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/session') return route.fulfill({ json: { user: { id: 'recent-user', roles: [] }, googleClientId: null } });
    if (path === '/api/home') return route.fulfill({ json: { generatedAt: Date.now(), featured: [], recentRuleIds: [] } });
    if (path === '/api/account/home') return route.fulfill({ json: { favorites: [], recentUpdates: [], generatedAt: Date.now() } });
    // The home footer counts games from the search list once it nears the screen.
    if (path === '/api/game-catalog') return route.fulfill({ json: { generation: 1, throughVersion: 0, generatedAt: Date.now(), games: [] } });
    if (path === '/api/game-catalog/changes') return route.fulfill({ json: { changes: [], throughVersion: 0, hasMore: false } });
    if (path === '/api/tags/changes') return route.fulfill({ json: { changes: [], throughVersion: 0, hasMore: false } });
    if (path.endsWith('/rule-importance')) return route.fulfill({ json: { ruleIds: [] } });
    if (path.endsWith('/view')) return route.fulfill({ json: { success: true, counted: false } });
    if (path.startsWith('/api/account/favorites/')) return route.fulfill({ json: { favorite: false, favoriteCount: 0 } });
    const game = games.find(game => path === `/api/games/${game.slug}`);
    if (game) return route.fulfill({ json: { game: { ...game, aliases: [], ruleCount: 0, rules: [], updatedAt: 1 } } });
    throw new Error(`Unexpected request: ${path}`);
  });
  await page.goto('/');
  await expect(page.locator(mode === 'explore' ? '.hero' : '.personal-home-hero')).toBeVisible();
  await page.evaluate(async games => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('wrong-board-game-rules');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tx = db.transaction('recentGames', 'readwrite');
    const viewedAt = Date.now();
    games.forEach((game, index) => tx.objectStore('recentGames').put({ ...game, viewedAt: viewedAt - index }));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, games);
  await page.reload();
  const rail = page.getByRole('navigation', { name: '最近看過的遊戲' });
  await expect(rail.getByRole('link')).toHaveCount(6);
  await page.evaluate(() => {
    const original = history.pushState.bind(history);
    (window as Window & { recentNavigations?: number }).recentNavigations = 0;
    history.pushState = (...args) => {
      (window as Window & { recentNavigations: number }).recentNavigations++;
      original(...args);
    };
  });
  return rail;
};

const navigationCount = (page: Page) => page.evaluate(() => (window as Window & { recentNavigations: number }).recentNavigations);

const openVisibleGame = async (page: Page, rail: Locator, mobile: boolean) => {
  const index = await rail.getByRole('link').evaluateAll(links => {
    const rail = links[0].parentElement!.getBoundingClientRect();
    return links.findIndex(link => {
      const box = link.getBoundingClientRect();
      const center = box.x + box.width / 2;
      return center > rail.left + 8 && center < rail.right - 8;
    });
  });
  expect(index).toBeGreaterThanOrEqual(0);
  const link = rail.getByRole('link').nth(index);
  const href = await link.getAttribute('href');
  const name = await link.innerText();
  if (mobile) await link.tap(); else await link.click();
  await expect(page).toHaveURL(url => url.pathname === href);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  expect(await navigationCount(page)).toBe(1);
};

for (const mode of ['explore', 'personal'] as const) {
  for (const width of [320, 393, 1280]) {
    const mobile = width <= 800;
    test.describe(`${mode} recent games at ${width}px`, () => {
      test.use({ viewport: { width, height: 851 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });

      test(mobile ? 'keeps full names on one row and accepts the first tap after scrolling' : 'preserves the desktop wrapped layout and opens a game on the first click', async ({ page }) => {
        const rail = await showHome(page, mode);
        const geometry = await rail.evaluate(element => ({
          width: element.clientWidth, scrollWidth: element.scrollWidth,
          links: Array.from(element.children, link => {
            const box = link.getBoundingClientRect();
            const style = getComputedStyle(link);
            return { y: box.y, height: box.height, scrollWidth: link.scrollWidth, clientWidth: link.clientWidth, whiteSpace: style.whiteSpace };
          }),
        }));
        if (mobile) expect(geometry.scrollWidth).toBeGreaterThan(geometry.width);
        else {
          expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
          expect(geometry.links.at(-1)!.y).toBeGreaterThan(geometry.links[0].y);
        }
        for (const link of geometry.links) {
          if (mobile) {
            expect(link.y).toBeCloseTo(geometry.links[0].y, 0);
            expect(link.height).toBeGreaterThanOrEqual(44);
          }
          expect(link.scrollWidth).toBeLessThanOrEqual(link.clientWidth + 1);
          expect(link.whiteSpace).toBe(mobile ? 'nowrap' : 'normal');
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        const box = (await rail.boundingBox())!;
        const y = box.y + box.height / 2;
        if (mobile) {
          const client = await page.context().newCDPSession(page);
          await rail.evaluate(element => {
            element.dataset.scrollEnded = 'false';
            element.addEventListener('scrollend', () => { (element as HTMLElement).dataset.scrollEnded = 'true'; }, { once: true });
          });
          const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number) => client.send('Input.dispatchTouchEvent', {
            type, touchPoints: x === undefined ? [] : [{ x, y, id: 1 }],
          });
          await touch('touchStart', box.x + box.width - 20);
          await touch('touchMove', box.x + box.width / 2);
          await touch('touchMove', box.x + 20);
          await touch('touchEnd');
          await expect(rail).toHaveAttribute('data-scroll-ended', 'true');
          await client.detach();
        }
        if (mobile) expect(await rail.evaluate(element => element.scrollLeft)).toBeGreaterThan(50);
        else expect(await rail.evaluate(element => element.scrollLeft)).toBe(0);
        expect(new URL(page.url()).pathname).toBe('/');
        expect(await navigationCount(page)).toBe(0);
        if (width === 393) await page.screenshot({ path: `.wrangler/home-recents-${mode}.png`, animations: 'disabled' });
        await openVisibleGame(page, rail, mobile);
      });

      if (width === 393) test('accepts the first tap after a cancelled native touch', async ({ page }) => {
        const rail = await showHome(page, mode);
        const box = (await rail.boundingBox())!;
        const client = await page.context().newCDPSession(page);
        const point = { x: box.x + 60, y: box.y + box.height / 2, id: 1 };
        await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
        await client.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
        await client.detach();
        expect(await navigationCount(page)).toBe(0);
        await openVisibleGame(page, rail, true);
      });

      if (!mobile) test('keeps wrapped links reachable through keyboard navigation', async ({ page }) => {
        const rail = await showHome(page, mode);
        const links = rail.getByRole('link');
        await links.first().focus();
        for (let index = 1; index < games.length; index++) await page.keyboard.press('Tab');
        await expect(links.last()).toBeFocused();
        const bounds = await links.last().evaluate(element => ({
          link: element.getBoundingClientRect().toJSON(), rail: element.parentElement!.getBoundingClientRect().toJSON(),
        }));
        // Native scrolling rounds fractional CSS pixels; allow at most one pixel at either edge.
        expect(bounds.link.left).toBeGreaterThanOrEqual(bounds.rail.left - 1);
        expect(bounds.link.right).toBeLessThanOrEqual(bounds.rail.right + 1);
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(new RegExp(`/games/${games.at(-1)!.slug}$`));
        expect(await navigationCount(page)).toBe(1);
      });
    });
  }
}
