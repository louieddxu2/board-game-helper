import { expect, test } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
let gameName: string;
let gameSlug: string;
const statement = '三人局只有五個方塊，這是公開分享的規則摘要。';

test.beforeAll(async ({ playwright, baseURL }) => {
  const setup = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL! } });
  try {
    expect((await setup.post('/api/auth/dev', { data: {} })).ok()).toBe(true);
    gameName = `公開預覽 <&> ${Date.now()}`;
    const response = await setup.post('/api/submissions', { data: {
      newGame: { displayName: gameName, englishName: 'Launch Preview' },
      idempotencyKey: crypto.randomUUID(), rules: [{ statement }],
    } });
    expect(response.status()).toBe(201);
    gameSlug = (await response.json()).gameSlug;
  } finally { await setup.dispose(); }
});

test.beforeEach(async ({ page }) => {
  // This checks real local-admin requests; Google authentication is separately
  // covered by identity tests, not fabricated Google credentials in the browser.
  await page.route('https://accounts.google.com/**', route => route.request().url().endsWith('/gsi/client')
    ? route.fulfill({ contentType: 'text/javascript', body: '// Local-admin regression.' }) : route.abort('blockedbyclient'));
});

for (const touch of [false, true]) {
  test.describe(touch ? 'mobile launch flows' : 'desktop launch flows', () => {
    test.use({ viewport: { width: touch ? 390 : 1280, height: 844 }, isMobile: touch, hasTouch: touch });

    test('returns the first login action to its selected game', async ({ page }) => {
      await page.goto(`/games/${encodeURIComponent(gameSlug)}`);
      await expect(page.getByRole('heading', { name: gameName, exact: true })).toBeVisible();
      const record = page.getByRole('link', { name: /記錄/u });
      if (touch) await record.tap(); else await record.click();
      await expect(page.locator('.add-page')).toBeVisible();
      const login = page.locator('.add-page').getByRole('link', { name: '登入', exact: true });
      if (touch) await login.tap(); else await login.click();
      await expect(page).toHaveURL(url => url.pathname === '/login' && url.searchParams.get('returnTo') === `/add?game=${encodeURIComponent(gameSlug)}`);
      const localLogin = page.getByRole('button', { name: '以本機管理員登入' });
      await expect(localLogin).toBeVisible();
      if (touch) await localLogin.tap(); else await localLogin.click();
      await expect(page).toHaveURL(url => url.pathname === '/add' && url.searchParams.get('game') === gameSlug);
      await expect(page.getByRole('textbox', { name: '遊戲名稱', exact: true })).toHaveValue(gameName);
    });

    test('retries a temporary game failure once on the first native action', async ({ page }) => {
      let reads = 0;
      await page.route('**/api/games/*', async route => {
        if (route.request().method() !== 'GET' || decodeURIComponent(new URL(route.request().url()).pathname) !== `/api/games/${gameSlug}`) return route.continue();
        reads++;
        if (reads === 1) return route.fulfill({ status: 503, json: { error: 'temporarily_unavailable' } });
        return route.continue();
      });
      await page.goto(`/games/${encodeURIComponent(gameSlug)}`);
      await expect(page.getByRole('heading', { name: '暫時無法載入遊戲' })).toBeVisible();
      expect(reads).toBe(1);
      const retry = page.getByRole('button', { name: '重新載入', exact: true });
      if (touch) await retry.tap(); else await retry.click();
      await expect(page.getByRole('heading', { name: gameName, exact: true })).toBeVisible();
      expect(reads).toBe(2);
      await expect(page.getByRole('heading', { name: '找不到這款遊戲' })).toHaveCount(0);
    });
  });
}

test('serves readable game-specific previews in the initial HTML without executing scripts', async ({ request }) => {
  const response = await request.get(`/games/${encodeURIComponent(gameSlug)}`);
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain(`<title>${gameName.replace('<&>', '&lt;&amp;&gt;')}｜玩錯的桌遊規則</title>`);
  expect(html).toContain(statement);
  expect(html).toContain('<meta property="og:title"');
  expect(html).toContain(`<link rel="canonical" href="http://127.0.0.1:4173/games/${encodeURIComponent(gameSlug)}"`);
  expect(html).toContain('content="http://127.0.0.1:4173/social-preview.png"');
});

test('distinguishes a missing game from a recoverable network error', async ({ page }) => {
  await page.goto(`/games/missing-${Date.now()}`);
  await expect(page.getByRole('heading', { name: '找不到這款遊戲' })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新載入', exact: true })).toHaveCount(0);
});
