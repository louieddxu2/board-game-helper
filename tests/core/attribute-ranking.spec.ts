import { expect, test, type Locator } from '@playwright/test';

test.use({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });

const point = async (element: Locator) => {
  const box = await element.boundingBox();
  if (!box) throw new Error('Drag target has no bounding box.');
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
};

test('ranks games with native touch and records only adjacent results in order through the real API', async ({ page, context }) => {
  const requests: { responseId: string; subjectAId: string; subjectBId: string; comparison: string }[] = [];
  await page.route('**/api/attributes/responses', async (route) => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 2) {
      const persisted = await route.fetch();
      expect(persisted.ok()).toBe(true);
      await route.abort('failed'); // Lose the acknowledgement after the actual database write.
    } else if (requests.length === 4) {
      await route.fulfill({ status: 429, json: { error: 'rate_limited' } });
    } else {
      await route.continue();
    }
  });
  await page.goto('/attributes');
  await page.getByRole('button', { name: '多款排序' }).tap();
  const panel = page.locator('.attribute-ranking-page');
  const candidates = panel.locator('[data-rank-source="pool"]');
  const list = panel.locator('[data-rank-list]');
  const ordered = list.locator('[data-rank-game]');
  const submit = panel.getByRole('button', { name: '送出排序' });
  await expect(candidates.nth(6)).toBeVisible();
  await expect(submit).toBeDisabled();
  expect(await panel.evaluate((element) => element.offsetWidth)).toBe(360);
  expect((await panel.locator('.attribute-rank-footer').boundingBox())?.height).toBeLessThanOrEqual(48);
  const ids = (await candidates.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-rank-game')!))).slice(0, 7);

  const cdp = await context.newCDPSession(page);
  const move = (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', coordinates?: { x: number; y: number }) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: coordinates ? [coordinates] : [] });
  const gap = (index: number) => list.locator(`[data-rank-slot="${index}"]`);
  const drag = async (source: Locator, index: number, fromLeft = true, cancel = false) => {
    const start = await point(source);
    const end = await point(gap(index));
    if (!index) end.y += 2;
    await move('touchStart', start);
    const pickup = fromLeft ? { x: start.x + 24, y: start.y } : start;
    if (fromLeft) await move('touchMove', pickup);
    for (let step = 1; step <= 6; step++) {
      await move('touchMove', { x: pickup.x + (end.x - pickup.x) * step / 6, y: pickup.y + (end.y - pickup.y) * step / 6 });
    }
    await expect(gap(index)).toHaveAttribute('data-over', 'true');
    await move(cancel ? 'touchCancel' : 'touchEnd');
  };

  await drag(candidates.first(), 0);
  await expect(ordered).toHaveCount(1);
  const candidate = (id: string) => candidates.and(panel.locator(`[data-rank-game="${id}"]`));
  await drag(candidate(ids[1]), 0);
  await drag(candidate(ids[6]), 1, true, true);
  await expect(ordered).toHaveCount(2);
  await drag(ordered.first().locator('[data-rank-grip]'), 2, false);
  await expect(ordered.first()).toHaveAttribute('data-rank-game', ids[0]);

  await panel.getByRole('button', { name: '切回兩兩比較' }).tap();
  await page.getByRole('button', { name: '多款排序' }).tap();
  await expect(ordered).toHaveCount(2);
  for (const [offset, id] of ids.slice(2, 6).entries()) {
    await candidate(id).tap();
    await list.getByRole('button', { name: /後面$/ }).tap();
    await expect(ordered).toHaveCount(offset + 3);
  }

  await context.setOffline(true);
  await submit.tap();
  await expect(panel).toContainText('5 筆待同步');
  expect(requests).toHaveLength(0);
  await context.setOffline(false);
  await expect(panel).toContainText('4 筆待同步');
  await panel.getByRole('button', { name: '重新同步' }).tap();
  await expect(panel).toContainText('3 筆待同步');
  await panel.getByRole('button', { name: '重新同步' }).tap();
  await expect(panel.getByText(/待同步/)).toHaveCount(0);

  const [one, two, three, four, five, six] = ids;
  expect(requests.map(({ subjectAId, subjectBId, comparison }) => [subjectAId, subjectBId, comparison])).toEqual([
    [three, four, 'A_HIGHER'], [two, three, 'A_HIGHER'], [two, three, 'A_HIGHER'],
    [four, five, 'A_HIGHER'], [four, five, 'A_HIGHER'], [one, two, 'A_HIGHER'], [five, six, 'A_HIGHER'],
  ]);
  expect(requests[1].responseId).toBe(requests[2].responseId);
  expect(requests[3].responseId).toBe(requests[4].responseId);
  const activity = await (await page.request.get('/api/attributes/activities')).json();
  const idsWritten = new Set(requests.map(({ responseId }) => responseId));
  const recorded = activity.activities.filter(({ responseId }: { responseId: string }) => idsWritten.has(responseId));
  expect(recorded.map(({ responseId }: { responseId: string }) => responseId)).toEqual([...idsWritten].reverse());
});
