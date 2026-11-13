import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });

const subjectA = { id: 'touch-a', slug: 'touch-a', kind: 'game', displayName: '觸控遊戲甲', bggIds: [123] };
const subjectB = { id: 'touch-b', slug: 'touch-b', kind: 'game', displayName: '觸控遊戲乙', bggIds: [456] };
const subjectC = { id: 'touch-c', slug: 'touch-c', kind: 'game', displayName: '觸控遊戲丙', bggIds: [789] };
const subjectD = { id: 'touch-d', slug: 'touch-d', kind: 'game', displayName: '觸控遊戲丁', bggIds: [101112] };
const attribute = { id: 'touch-luck', key: 'luck', name: '運氣成分', fullDescription: '觸控換題測試', minValue: 0, maxValue: 10, sortOrder: 0 };
const strategy = { ...attribute, id: 'strategy', key: 'long_term_planning', name: '長期規劃', fullDescription: '提前規劃多回合的程度。', sortOrder: 1 };
const snapshotGeneratedAt = 1_700_000_000_000;

const mockVotingCatalog = async (page: Page, attributes = [attribute]) => {
  await page.addInitScript(() => { Math.random = () => 0; });
  await page.route('**/api/attributes/table', (route) => route.fulfill({ json: {
    generation: 1, throughVersion: 1, generatedAt: snapshotGeneratedAt,
    attributes, subjects: [subjectA, subjectB, subjectC, subjectD],
    values: [], candidates: [], activities: [], scoreModelVersion: 'glicko-rd-v1',
  } }));
  await page.route('**/api/attributes/table/changes?*', (route) => route.fulfill({ json: {
    throughVersion: 1, hasMore: false, changes: [], snapshot: { generation: 1, generatedAt: snapshotGeneratedAt },
  } }));
  await page.route('**/api/attributes/activities', (route) => route.fulfill({ json: { activities: [] } }));
};

test('filters voting attributes with the first tap after scrolling and keeps the selection on reload', async ({ page }) => {
  const extraAttributes = Array.from({ length: 16 }, (_, index) => ({
    ...attribute, id: `extra-${index}`, key: `extra-${index}`, name: `測試屬性 ${index + 1}`, sortOrder: index + 2,
    fullDescription: `由屬性資料載入的第 ${index + 1} 則說明文字。`,
  }));
  const votes: string[] = [];
  await mockVotingCatalog(page, [attribute, strategy, ...extraAttributes]);
  await page.route('**/api/attributes/responses', (route) => {
    votes.push(route.request().postDataJSON().attributeId);
    return route.fulfill({ json: { ok: true, updatedValues: [] } });
  });
  await page.goto('/attributes');
  const trigger = page.getByRole('button', { name: /抽選屬性/ });
  const heading = page.locator('#attributes-question-heading');
  await expect(heading).toContainText(attribute.name);
  await trigger.tap();

  const dialog = page.getByRole('dialog', { name: '抽選屬性' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: strategy.name })).toHaveAccessibleDescription(strategy.fullDescription);
  await dialog.getByRole('button', { name: '清除' }).tap();
  await expect(dialog.getByRole('button', { name: '套用' })).toBeDisabled();
  await dialog.getByText(strategy.fullDescription, { exact: true }).tap();
  await expect(dialog.locator('input:checked')).toHaveCount(1);
  const list = dialog.getByRole('group', { name: '可抽選的屬性' });
  const bounds = (await list.boundingBox())!;
  const client = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', y?: number) => client.send('Input.dispatchTouchEvent', {
    type, touchPoints: y === undefined ? [] : [{ x: bounds.x + 90, y }],
  });
  const start = bounds.y + bounds.height - 60;
  // A tap during the swipe's momentum only stops the list, as on a phone, so the first tap
  // that must count is the one after the browser reports the scroll, momentum included, has ended.
  type Settling = HTMLElement & { scrollSettled?: Promise<void> };
  await list.evaluate((element: Settling) => {
    element.scrollSettled = new Promise((resolve) => element.addEventListener('scrollend', () => resolve(), { once: true }));
  });
  await touch('touchStart', start);
  for (let step = 1; step <= 8; step++) await touch('touchMove', start - 32 * step);
  await touch('touchEnd');
  await list.evaluate((element: Settling) => element.scrollSettled);
  expect(await list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect(dialog.locator('input:checked')).toHaveCount(1);
  // Tap the middle of the option at the list's centre: a point near the edge between two
  // options is ambiguous to the browser's touch adjustment, as it is to a finger.
  const point = await list.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const x = bounds.left + 120;
    const label = document.elementFromPoint(x, bounds.top + bounds.height / 2)?.closest('label');
    const box = label?.getBoundingClientRect();
    return { x, y: box ? box.top + box.height / 2 : 0, nameId: label?.querySelector('input')?.getAttribute('aria-labelledby') };
  });
  expect(point.nameId).toBeTruthy();
  await page.touchscreen.tap(point.x, point.y);
  await expect(dialog.locator('input:checked')).toHaveCount(2);
  await expect(dialog.locator(`[aria-labelledby="${point.nameId}"]`)).toBeChecked();
  const secondName = await dialog.locator(`[id="${point.nameId}"]`).textContent();
  expect(secondName).not.toBe(strategy.name);
  await dialog.getByRole('button', { name: '套用' }).tap();
  await expect(dialog).toBeHidden();
  await expect(trigger).toHaveText('抽選屬性2');
  await expect(heading).toContainText(strategy.name);

  const similar = page.getByRole('button', { name: '差不多' });
  await expect(similar).toBeEnabled();
  await similar.tap();
  await expect.poll(() => votes).toEqual([strategy.id]);
  await expect(similar).toBeEnabled();
  await expect(heading).toContainText(strategy.name);

  await page.reload();
  await trigger.tap();
  await expect(dialog.getByRole('checkbox', { name: strategy.name })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: secondName!, exact: true })).toBeChecked();
  await dialog.getByRole('button', { name: '全選' }).tap();
  await dialog.getByRole('button', { name: '關閉' }).tap();
  await trigger.tap();
  await expect(dialog.locator('input:checked')).toHaveCount(2);
  await dialog.getByRole('button', { name: '全選' }).tap();
  await dialog.getByRole('button', { name: '套用' }).tap();
  await expect(trigger).toHaveText('抽選屬性');
});

test.describe('desktop attribute filter', () => {
  test.use({ viewport: { width: 1280, height: 850 }, isMobile: false, hasTouch: false });

  test('restores focus to the trigger after Escape and applying by click', async ({ page }) => {
    await mockVotingCatalog(page, [attribute, strategy]);
    await page.goto('/attributes');
    const trigger = page.getByRole('button', { name: /抽選屬性/ });
    const dialog = page.getByRole('dialog', { name: '抽選屬性' });
    await trigger.click();
    await expect(dialog.getByRole('button', { name: '關閉' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await page.keyboard.press('Enter');
    const luck = dialog.getByRole('checkbox', { name: attribute.name });
    await luck.press('Space');
    await expect(luck).not.toBeChecked();
    await dialog.getByRole('button', { name: '套用' }).click();
    await expect(trigger).toBeFocused();
    await expect(page.locator('#attributes-question-heading')).toContainText(strategy.name);
  });
});

for (const choice of ['left', 'right', 'similar'] as const) {
  test(`touch ${choice} answer returns to neutral when the next question reuses a game`, async ({ page }, testInfo) => {
    let questionRequests = 0;
    const votes: unknown[] = [];
    await mockVotingCatalog(page);
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
