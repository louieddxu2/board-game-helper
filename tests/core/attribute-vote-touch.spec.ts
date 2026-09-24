import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });

const subjectA = { id: 'touch-a', slug: 'touch-a', kind: 'game', displayName: '觸控遊戲甲', bggIds: [123] };
const subjectB = { id: 'touch-b', slug: 'touch-b', kind: 'game', displayName: '觸控遊戲乙', bggIds: [456] };
const subjectC = { id: 'touch-c', slug: 'touch-c', kind: 'game', displayName: '觸控遊戲丙', bggIds: [789] };
const subjectD = { id: 'touch-d', slug: 'touch-d', kind: 'game', displayName: '觸控遊戲丁', bggIds: [101112] };
const attribute = { id: 'touch-luck', key: 'luck', name: '運氣成分', fullDescription: '觸控換題測試', minValue: 0, maxValue: 10, sortOrder: 0 };
const snapshotGeneratedAt = 1_700_000_000_000;

for (const choice of ['left', 'right', 'similar'] as const) {
  test(`touch ${choice} answer returns to neutral when the next question reuses a game`, async ({ page }, testInfo) => {
    let questionRequests = 0;
    const votes: unknown[] = [];
    await page.addInitScript(() => { Math.random = () => 0; });
    await page.route('**/api/attributes/table', (route) => route.fulfill({ json: {
      generation: 1, throughVersion: 1, generatedAt: snapshotGeneratedAt,
      attributes: [attribute], subjects: [subjectA, subjectB, subjectC, subjectD],
      values: [], candidates: [], activities: [], scoreModelVersion: 'glicko-rd-v1',
    } }));
    await page.route('**/api/attributes/table/changes?*', (route) => route.fulfill({ json: {
      throughVersion: 1, hasMore: false, changes: [],
      snapshot: { generation: 1, generatedAt: snapshotGeneratedAt },
    } }));
    await page.route('**/api/attributes/question?*', async (route) => {
      questionRequests += 1;
      await route.fulfill({ status: 404 });
    });
    await page.route('**/api/attributes/responses', (route) => {
      votes.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true, updatedValues: [] } });
    });
    await page.goto('/attributes');
    const answer = choice === 'similar'
      ? page.getByRole('button', { name: '差不多', exact: true })
      : page.locator(`.attribute-game-card.is-${choice}`);
    await expect(answer).toBeEnabled();
    const neutral = await answer.evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, border: style.borderColor, color: style.color, shadow: style.boxShadow };
    });
    await answer.tap();
    await expect(page.locator('.attribute-game-card').first()).toBeVisible();
    await expect(answer).toBeEnabled();
    await expect(answer).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => votes.length).toBe(1);
    expect(questionRequests).toBe(0);
    await testInfo.attach('touch-state-after-next-question', {
      body: JSON.stringify(await answer.evaluate((element) => ({
        hover: element.matches(':hover'), focusVisible: element.matches(':focus-visible'),
        pressed: element.getAttribute('aria-pressed'), classes: element.className,
        background: getComputedStyle(element).backgroundColor, border: getComputedStyle(element).borderColor,
        touchDevice: matchMedia('(hover: none) and (pointer: coarse)').matches,
      }))), contentType: 'application/json',
    });
    await expect(answer).toHaveCSS('background-color', neutral.background);
    await expect(answer).toHaveCSS('border-color', neutral.border);
    await expect(answer).toHaveCSS('color', neutral.color);
    await expect(answer).toHaveCSS('box-shadow', neutral.shadow);
  });
}
