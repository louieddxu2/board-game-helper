import { expect, test } from '@playwright/test';

test('登入、建立規則、編輯規則與登出皆實際持久化', async ({ page, context }) => {
  const browserErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('pageerror', (error) => browserErrors.push(error.message));

  await page.goto('/login');
  await expect(page.getByRole('button', { name: '以本機管理員登入' })).toBeVisible();
  await page.getByRole('button', { name: '以本機管理員登入' }).click();
  await expect(page).toHaveURL(/\/account$/u);

  const signedIn = await page.request.get('/api/session');
  expect(signedIn.ok()).toBeTruthy();
  expect((await signedIn.json()).user).toEqual(expect.objectContaining({
    displayName: '本機管理員',
    roles: expect.arrayContaining(['admin']),
  }));
  const cookies = await context.cookies();
  expect(cookies.find((cookie) => cookie.name === 'wbr_session')).toEqual(expect.objectContaining({
    httpOnly: true,
    sameSite: 'Lax',
  }));

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const gameName = `核心流程測試遊戲 ${suffix}`;
  const originalRule = `核心流程原始規則 ${suffix}`;
  const editedRule = `核心流程編輯後規則 ${suffix}`;
  await page.goto(`/add?name=${encodeURIComponent(gameName)}`);
  await expect(page.getByRole('heading', { name: '記錄玩錯的規則' })).toBeVisible();
  await expect(page.getByPlaceholder('搜尋或輸入遊戲名稱')).toHaveValue(gameName);
  await page.locator('.rule-input-fields textarea').first().fill(originalRule);

  const submissionPromise = page.waitForResponse((response) => response.url().endsWith('/api/submissions') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '送出 1 條規則' }).click();
  await page.getByRole('button', { name: '建立並投稿' }).click();
  const submissionResponse = await submissionPromise;
  expect(submissionResponse.status()).toBe(201);
  const submission = await submissionResponse.json() as { ruleIds: string[]; gameSlug: string };
  expect(submission.ruleIds).toHaveLength(1);
  await page.waitForURL((url) => decodeURIComponent(url.pathname) === `/games/${submission.gameSlug}`);

  const created = await page.request.get(`/api/rules/${submission.ruleIds[0]}`);
  expect(created.ok()).toBeTruthy();
  expect((await created.json()).rule.statement).toBe(originalRule);

  const editButton = page.getByRole('button', { name: '編輯', exact: true });
  if (!await editButton.isVisible()) {
    await page.getByRole('button', { name: originalRule, exact: true }).click();
  }
  await expect(editButton).toBeVisible();
  await editButton.click();
  const editor = page.getByRole('dialog', { name: '編輯規則' });
  await expect(editor).toBeVisible();
  await editor.locator('textarea').first().fill(editedRule);
  const editPromise = page.waitForResponse((response) => response.url().endsWith(`/api/rules/${submission.ruleIds[0]}`) && response.request().method() === 'PATCH');
  await editor.getByRole('button', { name: '儲存修改' }).click();
  expect((await editPromise).ok()).toBeTruthy();
  await expect(page.getByText(editedRule, { exact: true })).toBeVisible();

  const updated = await page.request.get(`/api/rules/${submission.ruleIds[0]}`);
  expect(updated.ok()).toBeTruthy();
  expect((await updated.json()).rule.statement).toBe(editedRule);

  await page.goto('/account');
  await page.getByRole('button', { name: '登出' }).click();
  const signedOut = await page.request.get('/api/session');
  expect(signedOut.ok()).toBeTruthy();
  expect((await signedOut.json()).user).toBeNull();
  expect((await context.cookies()).some((cookie) => cookie.name === 'wbr_session')).toBe(false);
  expect(browserErrors).toEqual([]);
});
