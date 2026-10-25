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

test('keeps the install action inside the 66px mobile header for signed-out and signed-in home', async ({ page }) => {
  let user: object | null = null;
  await routeHome(page, () => user);
  for (const width of [320, 393]) {
    await page.setViewportSize({ width, height: 851 });
    await page.goto('/');
    const header = page.locator('.site-header');
    const install = page.getByRole('button', { name: '加入主畫面' });
    await expect(install).toBeVisible();
    await expect.poll(() => header.evaluate((element) => Math.round(element.getBoundingClientRect().height))).toBe(66);
    expect(await page.locator('body').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

    user = { id: 'mobile-user', displayName: '測試使用者', maskedEmail: 't***@example.com', roles: [] };
    await page.reload();
    await expect(page.getByRole('button', { name: '我的收藏' })).toBeVisible();
    await expect(install).toBeVisible();
    const modeBox = await page.getByRole('button', { name: '我的收藏' }).boundingBox();
    const installBox = await install.boundingBox();
    expect(modeBox).not.toBeNull();
    expect(installBox).not.toBeNull();
    expect(installBox!.y).toBeGreaterThan(modeBox!.y + modeBox!.height - 1);
    const headerBox = await header.boundingBox();
    const brandBox = await page.locator('.brand').boundingBox();
    expect(installBox!.y + installBox!.height).toBeLessThanOrEqual(headerBox!.y + headerBox!.height);
    expect(brandBox!.x + brandBox!.width).toBeLessThanOrEqual(installBox!.x);
    expect(await page.locator('body').evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
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
