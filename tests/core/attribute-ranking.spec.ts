import { expect, test, type Locator, type Page } from '@playwright/test';
import type { AttributeCatalogPayload } from '../../src/shared/types';

test.use({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });

const point = async (element: Locator) => {
  const box = await element.boundingBox();
  if (!box) throw new Error('Drag target has no bounding box.');
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
};

for (const { width, selected } of [{ width: 320, selected: false }, { width: 390, selected: true }]) {
  test(`the first drag after a candidate fling shows its landing spot and adds exactly one game (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 780 });
    await page.goto('/attributes');
    await page.getByRole('button', { name: '切換為多款排序' }).tap();
    const pool = page.getByRole('region', { name: '候選遊戲' }).locator('.attribute-rank-list');
    const candidates = pool.locator('[data-rank-source="pool"]');
    await expect(candidates.first()).toBeVisible();
    const list = page.locator('[data-rank-list]');
    const ordered = list.locator('[data-rank-game]');
    if (selected) {
      await candidates.first().tap();
      await list.locator('.attribute-rank-insert').last().tap();
      await candidates.first().tap();
      await expect(list.getByRole('button', { name: /後面$/ })).toBeVisible();
    }
    const orderedIds = () => ordered.evaluateAll((cards) => cards.map((card) => card.getAttribute('data-rank-game')));
    const before = await orderedIds();
    await pool.evaluate((element) => {
      element.addEventListener('pointerdown', (event) => {
        element.dataset.touchSource = (event.target as HTMLElement).closest<HTMLElement>('[data-rank-game]')?.dataset.rankGame ?? '';
      }, { capture: true });
      const board = element.closest<HTMLElement>('.attribute-ranking-page')!;
      board.addEventListener('pointermove', (event) => { board.dataset.testFingerY = String(event.clientY); }, { capture: true });
    });
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x = 0, y = 0) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    const left = (await pool.boundingBox())!;
    const x = Math.round(left.x + left.width * .72);
    const startY = Math.round(left.y + left.height * .72);
    const dragY = startY - 90;
    const drop = await point(list.locator(`[data-rank-slot="${before.length}"]`));
    await touch('touchStart', x, startY);
    for (const offset of [15, 30, 45, 60, 75, 90]) await touch('touchMove', x, startY - offset);
    await touch('touchEnd');
    await touch('touchStart', x, dragY);
    expect(await pool.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    const pickupY = dragY + (selected ? 12 : -12);
    await touch('touchMove', x + 24, pickupY);
    for (const offset of [.2, .4, .6, .8, 1]) {
      await touch('touchMove', Math.round(x + 24 + (drop.x - x - 24) * offset), Math.round(pickupY + (drop.y - pickupY) * offset));
    }
    const landing = list.locator('[data-rank-slot][data-over]');
    await expect(landing).toHaveAttribute('data-rank-slot', String(before.length), { timeout: 1500 });
    const marker = await landing.evaluate((element) => ({ height: getComputedStyle(element, '::after').height, content: getComputedStyle(element, '::after').content }));
    expect(marker).toEqual({ height: '3px', content: '""' });
    const ghost = page.locator('.attribute-rank-ghost');
    const ghostClearance = await ghost.evaluate((element) => {
      const fingerY = Number(element.closest<HTMLElement>('.attribute-ranking-page')!.dataset.testFingerY);
      return fingerY - element.getBoundingClientRect().bottom;
    });
    expect(ghostClearance).toBeGreaterThanOrEqual(17);
    if (selected) await test.info().attach('390px touch drag preview', { body: await page.screenshot(), contentType: 'image/png' });
    const dragged = await pool.getAttribute('data-touch-source');
    await touch('touchEnd');
    expect(dragged).toBeTruthy();
    await expect(ordered).toHaveCount(before.length + 1);
    expect(await orderedIds()).toEqual([...before, dragged]);
  });
}

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
  const toggle = page.getByRole('button', { name: /^切換為(?:多款排序|兩兩比較)$/ });
  await toggle.waitFor();
  await expect(toggle).toHaveText('切換為多款排序');
  const originalToggleBox = await toggle.boundingBox();
  const header = page.locator('.attribute-vote-header');
  const originalHeaderBox = await header.boundingBox();
  await header.evaluate((element) => { element.dataset.testOriginalHeader = 'true'; });
  await toggle.tap();
  await expect(toggle).toHaveText('切換為兩兩比較');
  expect(await toggle.boundingBox()).toEqual(originalToggleBox);
  await expect(header).toHaveAttribute('data-test-original-header', 'true');
  expect(await header.boundingBox()).toEqual(originalHeaderBox);
  const panel = page.locator('.attribute-ranking-page');
  const candidates = panel.locator('[data-rank-source="pool"]');
  const list = panel.locator('[data-rank-list]');
  const ordered = list.locator('[data-rank-game]');
  const submit = panel.getByRole('button', { name: '送出排序' });
  await expect(candidates.nth(6)).toBeVisible();
  await expect(submit).toBeDisabled();
  expect(await panel.evaluate((element) => element.offsetWidth)).toBe(360);
  expect((await panel.locator('.attribute-rank-footer').boundingBox())?.height).toBeLessThanOrEqual(48);
  const firstCandidates = await candidates.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-rank-game')));
  await panel.locator('.attribute-rank-refresh').first().tap();
  const refreshedCandidates = await candidates.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-rank-game')));
  expect(firstCandidates).not.toContain(refreshedCandidates[0]);
  expect(refreshedCandidates.slice(1)).toEqual(firstCandidates.slice(1));
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

  await toggle.evaluate((button) => {
    for (const name of ['pointerdown', 'pointerup', 'pointercancel', 'click']) {
      button.addEventListener(name, () => { button.dataset.testToggleEvents = `${button.dataset.testToggleEvents ?? ''} ${name}`; });
    }
  });
  await toggle.tap();
  const toggleEvents = await toggle.getAttribute('data-test-toggle-events');
  expect(await toggle.textContent(), `First mode-switch touch after dragging: ${toggleEvents}`).toBe('切換為多款排序');
  await expect(header).toHaveAttribute('data-test-original-header', 'true');
  expect(await header.boundingBox()).toEqual(originalHeaderBox);
  await toggle.tap();
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

test('allows moving scored references in order and records votes only for player entries', async ({ page }) => {
  await page.addInitScript(() => { Math.random = () => 0; });
  await page.route('**/api/attributes/table', async (route) => {
    const response = await route.fetch();
    const catalog: AttributeCatalogPayload = await response.json();
    const attribute = catalog.attributes[0];
    catalog.subjects = catalog.subjects.slice(0, 22).map((subject, index) => ({ ...subject, secondaryName: `Ranking game ${index + 1}` }));
    catalog.values = catalog.subjects.slice(18).map((subject, index) => ({
      subjectId: subject.id, attributeId: attribute.id, score: [9.26, 9, 1.24, 0.96][index],
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
  await page.getByRole('button', { name: '切換為多款排序' }).tap();
  const list = page.locator('[data-rank-list]');
  const references = list.locator('[data-rank-reference]');
  const candidate = page.locator('[data-rank-source="pool"]').first();
  const submit = page.getByRole('button', { name: '送出排序' });
  await expect(references.locator('.attribute-rank-reference-score')).toHaveText(['9.3 分', '9 分', '1.2 分', '1 分']);
  await expect(candidate.locator('.attribute-rank-name small')).toHaveText(/Ranking game/);
  await expect(references.first().locator('.attribute-rank-name small')).toHaveText(/Ranking game/);
  expect((await point(references.first().locator('.attribute-rank-reference-score'))).x).toBeGreaterThan((await point(references.first().locator('.attribute-rank-name'))).x);
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
  await expect(submit).toBeDisabled();

  const secondCandidateId = await candidate.getAttribute('data-rank-game');
  await drag(candidate, 5);
  expect(await rankedIds()).toEqual([ids[0], candidateId, ...ids.slice(1), secondCandidateId]);

  const pairs: string[][] = [];
  page.on('request', (request) => {
    if (!request.url().endsWith('/api/attributes/responses')) return;
    const { subjectAId, subjectBId } = request.postDataJSON();
    pairs.push([subjectAId, subjectBId]);
  });
  const response = page.waitForResponse((result) => result.url().endsWith('/api/attributes/responses'));
  await submit.tap();
  await expect(page.getByText('已儲存 1 組相鄰比較')).toBeVisible();
  expect((await response).ok()).toBe(true);
  await expect(page.getByText(/待同步/)).toHaveCount(0);
  expect(pairs).toEqual([[candidateId, secondCandidateId]]);
});
