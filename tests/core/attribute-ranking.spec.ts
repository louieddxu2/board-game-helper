import { expect, test, type Locator, type Page } from '@playwright/test';
import type { AttributeCatalogPayload } from '../../src/shared/types';

test.use({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });

const point = async (element: Locator) => {
  const box = await element.boundingBox();
  if (!box) throw new Error('Drag target has no bounding box.');
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
};

const rankingDrag = async (page: Page, list: Locator) => {
  const cdp = await page.context().newCDPSession(page);
  const move = (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', coordinates?: { x: number; y: number }) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: coordinates ? [coordinates] : [] });
  const gap = (index: number) => list.locator(`[data-rank-slot="${index}"]`);
  return async (source: Locator, index: number, { fromLeft = true, cancel = false, blocked = false } = {}) => {
    const start = await point(source);
    const end = await point(gap(index));
    if (!index) end.y += 2;
    await move('touchStart', start);
    const pickup = fromLeft ? { x: start.x + 24, y: start.y } : start;
    if (fromLeft) await move('touchMove', pickup);
    for (let step = 1; step <= 6; step++) {
      await move('touchMove', { x: pickup.x + (end.x - pickup.x) * step / 6, y: pickup.y + (end.y - pickup.y) * step / 6 });
    }
    await expect(gap(index)).toHaveAttribute(blocked ? 'data-blocked' : 'data-over', 'true');
    await move(cancel ? 'touchCancel' : 'touchEnd');
  };
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

  const drag = await rankingDrag(page, list);

  await drag(candidates.first(), 0);
  await expect(ordered).toHaveCount(1);
  const candidate = (id: string) => candidates.and(panel.locator(`[data-rank-game="${id}"]`));
  await drag(candidate(ids[1]), 0);
  await drag(candidate(ids[6]), 1, { cancel: true });
  await expect(ordered).toHaveCount(2);
  await drag(ordered.first().locator('[data-rank-grip]'), 2, { fromLeft: false });
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

test('prefills scored references and lets them pass a player entry while blocking changes to their order', async ({ page }) => {
  await page.route('**/api/attributes/table', async (route) => {
    const response = await route.fetch();
    const catalog: AttributeCatalogPayload = await response.json();
    const attributes = catalog.attributes[0];
    catalog.values = catalog.subjects.slice(0, 12).map((subject, index) => ({
      subjectId: subject.id, attributeId: attributes.id, score: index < 6 ? 9 : 1,
      directCount: 1, decisiveComparisonCount: 0, evidenceCount: 1, comparisonCount: 0,
      ratingDeviation: 1, modelVersion: 'glicko-rd-v2',
    }));
    await route.fulfill({ response, json: catalog });
  });
  await page.route('**/api/attributes/table/changes?*', (route) => {
    // Keep the reference-score fixture stable against votes saved by other core tests.
    const query = new URL(route.request().url()).searchParams;
    return route.fulfill({ json: {
      changes: [], throughVersion: Number(query.get('after')), hasMore: false,
      snapshot: { generation: Number(query.get('generation')), generatedAt: Number(query.get('generatedAt')) },
    } });
  });

  await page.goto('/attributes');
  await page.getByRole('button', { name: '多款排序' }).tap();
  const list = page.locator('[data-rank-list]');
  const references = list.locator('[data-rank-reference]');
  const candidate = page.locator('[data-rank-source="pool"]').first();
  const submit = page.getByRole('button', { name: '送出排序' });
  await expect(references).toHaveText([/參考 9 分/, /參考 9 分/, /參考 1 分/, /參考 1 分/]);
  await expect(submit).toBeDisabled();
  const ids = await references.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-rank-game')!));
  for (const id of ids) await expect(page.locator(`[data-rank-source="pool"][data-rank-game="${id}"]`)).toHaveCount(0);
  await references.first().tap();
  await expect(list.getByRole('button', { name: /後面$/ })).toHaveCount(0);
  await references.first().tap();
  const candidateId = await candidate.getAttribute('data-rank-game');
  const drag = await rankingDrag(page, list);
  await drag(candidate, 0);
  const referenceGrip = references.first().locator('[data-rank-grip]');
  await drag(referenceGrip, 0, { fromLeft: false });
  const ranking = list.locator('[data-rank-game]');
  const rankedIds = () => ranking.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-rank-game')));
  expect(await rankedIds()).toEqual([ids[0], candidateId, ...ids.slice(1)]);
  await drag(referenceGrip, 5, { fromLeft: false, blocked: true });
  await expect(page.getByText('參考遊戲須維持分數順序。')).toBeVisible();
  expect(await rankedIds()).toEqual([ids[0], candidateId, ...ids.slice(1)]);

  const pairs: string[][] = [];
  page.on('request', (request) => {
    if (!request.url().endsWith('/api/attributes/responses')) return;
    const { subjectAId, subjectBId } = request.postDataJSON();
    pairs.push([subjectAId, subjectBId]);
  });
  const responses = [candidateId, ids[0]].map((id) => page.waitForResponse((response) => response.url().endsWith('/api/attributes/responses')
    && response.request().postDataJSON().subjectAId === id));
  await submit.tap();
  await expect(page.getByText('已儲存 2 組相鄰比較')).toBeVisible();
  const saved = await Promise.all(responses);
  expect(saved.every((response) => response.ok())).toBe(true);
  expect(pairs).toEqual([[candidateId, ids[1]], [ids[0], candidateId]]);
});
