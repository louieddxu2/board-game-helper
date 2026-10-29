import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });

const emptyHome = { generatedAt: Date.now(), featured: [], recentRuleIds: [], popularGames: [], recentGames: [] };

const routeHome = async (page: import('@playwright/test').Page, getUser: () => object | null) => {
  await page.route('**/api/session', (route) => route.fulfill({ json: {
    user: getUser(), googleClientId: null, localDevLogin: true,
  } }));
  await page.route('**/api/home', (route) => route.fulfill({ json: emptyHome }));
  await page.route('**/api/account/home', (route) => route.fulfill({ json: {
    favorites: [], recentUpdates: [], generatedAt: Date.now(),
  } }));
};

test('aligns a compact install action beside the slogan with smaller section headings in both home modes', async ({ page }) => {
  let user: object | null = null;
  await routeHome(page, () => user);
  const header = page.locator('.site-header');
  const install = page.getByRole('button', { name: '加入主畫面' });
  const checkHeroPosition = async () => {
    const hero = page.locator('.hero, .personal-home-hero');
    await expect(hero.locator('> .pwa-install-button')).toBeVisible();
    await expect(header.locator('.pwa-install-button')).toHaveCount(0);
    const heroBox = (await hero.boundingBox())!;
    const installBox = (await install.boundingBox())!;
    const headerBox = (await header.boundingBox())!;
    const contentBox = (await hero.locator('h1, .personal-home-search').first().boundingBox())!;
    expect(headerBox.height).toBe(page.viewportSize()!.width <= 800 ? 66 : 78);
    expect(heroBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height);
    expect(installBox.y).toBeGreaterThanOrEqual(heroBox.y);
    expect(installBox.y - heroBox.y).toBeLessThanOrEqual(28);
    expect(installBox.width).toBeLessThanOrEqual(52);
    expect(installBox.x + installBox.width).toBeLessThanOrEqual(heroBox.x + heroBox.width);
    await expect(install).toHaveText('安裝');
    if (await hero.locator('h1').count()) {
      expect(Math.abs(installBox.y + installBox.height / 2 - contentBox.y - contentBox.height / 2)).toBeLessThan(1);
      expect(contentBox.x + contentBox.width).toBeLessThan(installBox.x);
      const titleSize = await hero.locator('h1').evaluate(element => parseFloat(getComputedStyle(element).fontSize));
      const titleLineHeight = await hero.locator('h1').evaluate(element => parseFloat(getComputedStyle(element).lineHeight));
      const titlePadding = await hero.locator('h1').evaluate(element => {
        const style = getComputedStyle(element);
        return parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      });
      expect(contentBox.height - titlePadding).toBeLessThanOrEqual(titleLineHeight + 1);
      const headingSize = await page.locator('.home-rule-section h2').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize));
      expect(headingSize).toBeLessThan(titleSize);
      const searchBox = (await hero.locator('.hero-search').boundingBox())!;
      expect(searchBox.x).toBeCloseTo(contentBox.x, 0);
      expect(searchBox.y).toBeGreaterThanOrEqual(Math.max(contentBox.y + contentBox.height, installBox.y + installBox.height));
    } else {
      expect(installBox.y + installBox.height).toBeLessThanOrEqual(contentBox.y);
    }
    expect(await page.locator('body').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  };
  for (const width of [320, 393, 1280]) {
    const activate = (target: import('@playwright/test').Locator) => width <= 800 ? target.tap() : target.click();
    await page.setViewportSize({ width, height: 851 });
    await page.goto('/');
    await expect(install).toBeVisible();
    await checkHeroPosition();

    user = { id: 'mobile-user', displayName: '測試使用者', maskedEmail: 't***@example.com', roles: [] };
    await page.reload();
    await expect(page.getByRole('button', { name: '我的收藏' })).toBeVisible();
    await expect(install).toBeVisible();
    await checkHeroPosition();
    await activate(page.getByRole('button', { name: '我的收藏', exact: true }));
    await expect(page.locator('.personal-home-hero')).toBeVisible();
    await checkHeroPosition();
    await activate(page.getByRole('button', { name: '探索', exact: true }));
    await expect(page.locator('.hero')).toBeVisible();
    user = null;
  }
  user = { id: 'mobile-user', displayName: '測試使用者', maskedEmail: 't***@example.com', roles: [] };
  await page.setViewportSize({ width: 393, height: 851 });
  await page.reload();
  await expect(page.getByRole('button', { name: '我的收藏' })).toBeVisible();
  await page.screenshot({ path: '.wrangler/pwa-install-mobile.png', fullPage: false });
});

test('opens manual install help on the first native tap and closes on the first dialog action', async ({ page }) => {
  await routeHome(page, () => null);
  await page.goto('/');
  const install = page.getByRole('button', { name: '加入主畫面' });
  await install.tap();
  const help = page.getByRole('dialog', { name: '加入主畫面' });
  await expect(help).toBeVisible();
  await help.getByRole('button', { name: '知道了' }).tap();
  await expect(help).not.toBeVisible();
  await install.tap();
  await expect(help).toBeVisible();
});

test('uses one browser install prompt and hides the action after appinstalled', async ({ page }) => {
  await routeHome(page, () => null);
  await page.goto('/');
  const install = page.getByRole('button', { name: '加入主畫面' });
  await expect(install).toBeVisible();
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: 'dismissed' }>;
    };
    event.prompt = () => {
      (window as Window & { __pwaPromptCalls?: number }).__pwaPromptCalls = ((window as Window & { __pwaPromptCalls?: number }).__pwaPromptCalls ?? 0) + 1;
      return Promise.resolve();
    };
    event.userChoice = Promise.resolve({ outcome: 'dismissed' });
    window.dispatchEvent(event);
  });
  await install.tap();
  await expect.poll(() => page.evaluate(() => (window as Window & { __pwaPromptCalls?: number }).__pwaPromptCalls)).toBe(1);
  await expect(page.getByRole('dialog', { name: '加入主畫面' })).not.toBeVisible();
  await expect(install).toBeEnabled();
  await install.tap();
  await expect(page.getByRole('dialog', { name: '加入主畫面' })).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __pwaPromptCalls?: number }).__pwaPromptCalls)).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(install).toHaveCount(0);
  await expect(page.locator('.site-header')).toHaveCSS('height', '66px');
  await page.setViewportSize({ width: 1280, height: 851 });
  await expect(page.locator('.site-header')).toHaveCSS('height', '78px');
});
