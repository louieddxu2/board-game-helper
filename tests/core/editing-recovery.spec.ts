import { expect, test, type Locator } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
let gameA: { id: string; slug: string; name: string };
let gameB: { id: string; slug: string; name: string };
const existingStatement = '起始設置只能放五個方塊。';

test.beforeAll(async ({ playwright, baseURL }) => {
  const setup = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL! } });
  try {
    expect((await setup.post('/api/auth/dev', { data: {} })).ok()).toBe(true);
    const suffix = Date.now();
    const create = async (name: string) => {
      const response = await setup.post('/api/submissions', { data: {
        newGame: { displayName: name }, idempotencyKey: crypto.randomUUID(),
        rules: [{ statement: existingStatement }],
      } });
      expect(response.status()).toBe(201);
      const result = await response.json();
      return { id: result.gameId, slug: result.gameSlug, name };
    };
    gameA = await create(`草稿保護甲 ${suffix}`);
    gameB = await create(`草稿保護乙 ${suffix}`);
  } finally { await setup.dispose(); }
});

for (const touch of [false, true]) {
  test.describe(touch ? 'mobile editing recovery' : 'desktop editing recovery', () => {
    test.use({ viewport: { width: touch ? 390 : 1280, height: 844 }, isMobile: touch, hasTouch: touch });
    const activate = (target: Locator) => touch ? target.tap() : target.click();

    test('previews an old draft and handles keep and discard on the first native dialog action', async ({ page, context }, testInfo) => {
      expect((await context.request.post('/api/auth/dev', { data: {} })).ok()).toBe(true);
      await page.goto(`/add?game=${encodeURIComponent(gameA.slug)}`);
      await expect(page.getByRole('textbox', { name: '遊戲名稱', exact: true })).toHaveValue(gameA.name);
      const statement = page.getByRole('textbox', { name: '正確規則 *', exact: true });
      await activate(statement);
      await expect(statement).toBeFocused();
      await statement.pressSequentially('需要保留的舊稿內容');
      await expect(page.getByRole('status', { name: '草稿儲存狀態' })).toContainText('草稿已儲存於');

      const openAnotherGame = async () => {
        await page.goto(`/games/${encodeURIComponent(gameB.slug)}`);
        await expect(page.getByRole('heading', { name: gameB.name, exact: true })).toBeVisible();
        await activate(page.getByRole('navigation', { name: touch ? '手機主要導覽' : '主要導覽', exact: true }).getByRole('link', { name: /記錄/u }));
        const dialog = page.getByRole('alertdialog', { name: '已有其他遊戲的草稿' });
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText(gameA.name);
        await expect(dialog).toContainText('需要保留的舊稿內容');
        await expect(dialog).toContainText(gameB.name);
        await expect(dialog.getByRole('button', { name: '繼續舊稿', exact: true })).toBeFocused();
        if (touch) await page.screenshot({ path: testInfo.outputPath('draft-preview-mobile.png') });
        return dialog;
      };

      let dialog = await openAnotherGame();
      await activate(dialog.getByRole('button', { name: '繼續舊稿', exact: true }));
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole('textbox', { name: '遊戲名稱', exact: true })).toHaveValue(gameA.name);
      await expect(statement).toHaveValue('需要保留的舊稿內容');
      await expect(page.getByRole('status', { name: '草稿儲存狀態' })).toContainText('草稿已儲存於');

      dialog = await openAnotherGame();
      await activate(dialog.getByRole('button', { name: '捨棄舊稿並記錄', exact: true }));
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole('textbox', { name: '遊戲名稱', exact: true })).toHaveValue(gameB.name);
      await expect(statement).toHaveValue('');
      await expect(page.getByRole('status', { name: '草稿儲存狀態' })).toContainText('草稿已儲存於');
      await page.reload();
      await expect(page.getByRole('textbox', { name: '遊戲名稱', exact: true })).toHaveValue(gameB.name);
      await expect(statement).toHaveValue('');
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
    });

    test('makes a failed local save visible and retries once without losing the entered text', async ({ page, context }) => {
      expect((await context.request.post('/api/auth/dev', { data: {} })).ok()).toBe(true);
      await page.addInitScript(() => {
        const original = IDBObjectStore.prototype.put;
        let failed = false;
        IDBObjectStore.prototype.put = function (...args) {
          const value = args[0] as { rules?: { statement: string }[] };
          if (this.name === 'drafts' && !failed && value.rules?.some(rule => rule.statement === 'Draft safety')) {
            failed = true;
            throw new DOMException('Test quota failure', 'QuotaExceededError');
          }
          return original.apply(this, args);
        };
      });
      await page.goto(`/add?game=${encodeURIComponent(gameA.slug)}`);
      const statement = page.getByRole('textbox', { name: '正確規則 *', exact: true });
      await expect(statement).toBeVisible();
      await activate(statement);
      await statement.pressSequentially('Draft safety');
      await expect(page.getByRole('status', { name: '草稿儲存狀態' })).toContainText('草稿儲存失敗');
      await expect(statement).toHaveValue('Draft safety');
      await activate(page.getByRole('button', { name: '重試儲存', exact: true }));
      await expect(page.getByRole('status', { name: '草稿儲存狀態' })).toContainText('草稿已儲存於');
      await page.reload();
      await expect(statement).toHaveValue('Draft safety');
    });

    test('retries a failed home read once without reloading the page', async ({ page }) => {
      let reads = 0;
      await page.route('**/api/home', route => {
        reads++;
        return reads === 1 ? route.fulfill({ status: 503, json: { error: 'unavailable' } }) : route.continue();
      });
      await page.goto('/');
      const retry = page.getByRole('button', { name: '重新載入首頁內容' });
      await expect(retry).toBeVisible();
      expect(reads).toBe(1);
      const response = page.waitForResponse(value => value.url().endsWith('/api/home') && value.ok());
      await activate(retry);
      await response;
      await expect(page.locator('.home-discover-section .skeleton-card')).toHaveCount(0);
      await expect(retry).toHaveCount(0);
      expect(reads).toBe(2);
    });

    test('keeps the search query and retries its failed catalog read on the first action', async ({ page }) => {
      let snapshots = 0;
      await page.route('**/api/game-catalog', route => {
        snapshots++;
        return snapshots === 1 ? route.fulfill({ status: 503, json: { error: 'unavailable' } }) : route.continue();
      });
      await page.goto('/');
      const search = page.getByRole('combobox', { name: '搜尋遊戲名稱' });
      await activate(search);
      await search.pressSequentially(gameA.name);
      const retry = page.getByRole('button', { name: '重試搜尋', exact: true });
      await expect(retry).toBeVisible();
      expect(snapshots).toBe(1);
      await activate(retry);
      await expect(page.getByRole('option', { name: gameA.name, exact: true })).toBeVisible();
      await expect(search).toHaveValue(gameA.name);
      expect(snapshots).toBe(2);
    });

    test('restores the list filter and expanded game after returning from the game page', async ({ page, context }) => {
      expect((await context.request.post('/api/auth/dev', { data: {} })).ok()).toBe(true);
      await page.goto('/catalog');
      const search = page.getByRole('searchbox', { name: '篩選遊戲名稱' });
      await activate(search);
      await search.pressSequentially(gameA.name);
      await expect(search).toHaveValue(gameA.name);
      const row = page.getByRole('button', { name: new RegExp(gameA.name, 'u') });
      await expect(row).toBeVisible();
      await activate(row);
      const open = page.getByRole('link', { name: '開啟一般遊戲頁 ↗' });
      await expect(open).toBeVisible();
      await activate(open);
      await expect(page.getByRole('heading', { name: gameA.name, exact: true })).toBeVisible();
      await page.goBack();
      await expect(search).toHaveValue(gameA.name);
      await expect(row).toHaveAttribute('aria-expanded', 'true');
      await expect(open).toBeVisible();
      await expect(page.locator(touch ? '.catalog-mobile-rule-statement' : '.catalog-rules-table strong').filter({ hasText: existingStatement })).toBeVisible();
    });
  });
}
