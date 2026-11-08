import { expect, test } from '@playwright/test';

for (const width of [393, 1280]) {
  const mobile = width < 800;
  test.describe(`home recovery at ${width}px`, () => {
    test.use({ viewport: { width, height: 851 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });

    for (const section of ['featured', 'recent'] as const) {
      test(`recovers failed ${section} rules from the unchanged home cache on the first input`, { tag: '@ui' }, async ({ page }) => {
        let homeRequests = 0;
        let ruleRequests = 0;
        let releaseSecondAttempt!: () => void;
        const secondAttempt = new Promise<void>(resolve => { releaseSecondAttempt = resolve; });
        const rule = {
          id: 'recovery-rule', gameId: 'recovery-game', gameName: '恢復遊戲', gameSlug: 'recovery-game',
          statement: '重試後可以閱讀這條規則。', status: 'published', tags: [], sourceLinks: [],
        };
        await page.route('**/api/session', route => route.fulfill({ json: { user: null, googleClientId: null } }));
        await page.route('**/api/home', route => {
          homeRequests++;
          return route.fulfill({ json: {
            generatedAt: Date.now(),
            featured: section === 'featured' ? [{ gameName: rule.gameName, gameSlug: rule.gameSlug, ruleId: rule.id }] : [],
            recentRuleIds: section === 'recent' ? [rule.id] : [],
          } });
        });
        await page.route('**/api/rules/recovery-rule', async route => {
          ruleRequests++;
          if (ruleRequests === 2) await secondAttempt;
          if (ruleRequests < 3) return route.fulfill({ status: 503, json: { error: 'unavailable' } });
          return route.fulfill({ json: { rule } });
        });
        await page.goto('/');
        const alert = page.getByRole('alert');
        const retry = page.getByRole('button', { name: '重新載入首頁內容' });
        await expect(alert).toContainText('首頁內容暫時無法載入');
        await expect(page.getByRole('combobox', { name: '搜尋遊戲名稱' })).toBeEnabled();
        expect(ruleRequests).toBe(1);

        if (mobile) await retry.tap(); else await retry.click();
        await expect.poll(() => ruleRequests).toBe(2);
        await expect(retry).toBeDisabled();
        releaseSecondAttempt();
        await expect(retry).toBeEnabled();
        await expect(alert).toContainText('首頁內容暫時無法載入');

        if (mobile) await retry.tap(); else await retry.click();
        const target = section === 'featured' ? page.locator('.home-featured-rail') : page.locator('.home-recent-list');
        await expect(target).toContainText(rule.statement);
        await expect(alert).toHaveCount(0);
        expect(ruleRequests).toBe(3);
        // api.home() returns the same cached payload on both retries.
        expect(homeRequests).toBe(1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      });
    }
  });
}
