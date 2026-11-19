import { expect, test, type APIRequestContext } from '@playwright/test';
import { applyAttributeCatalogChanges } from '../../src/lib/attributeCatalog';
import type { AttributeCatalogPayload } from '../../src/shared/types';

const catalogFromServer = async (request: APIRequestContext) => {
  let catalog: AttributeCatalogPayload = await (await request.get('/api/attributes/table')).json();
  for (let page = 0; page < 100; page++) {
    const query = new URLSearchParams({ after: String(catalog.throughVersion), generation: String(catalog.generation), generatedAt: String(catalog.generatedAt) });
    const delta = await (await request.get('/api/attributes/table/changes?' + query)).json();
    if (delta.snapshot.generation !== catalog.generation || delta.snapshot.generatedAt !== catalog.generatedAt) {
      catalog = await (await request.get('/api/attributes/table')).json(); continue;
    }
    catalog = applyAttributeCatalogChanges(catalog, delta.changes, delta.throughVersion);
    if (!delta.hasMore) return catalog;
  }
  throw new Error('Catalog did not converge');
};

test('ten mobile voters submit once concurrently; all receipts count exactly once without manual sync', async ({ browser, request, baseURL }) => {
  test.setTimeout(90_000);
  const baseline = await catalogFromServer(request);
  const attributeId = baseline.attributes[0].id;
  // Freeze only local candidate selection; every vote and every verification
  // uses the real API/database. No response or permission is mocked.
  const frozen = { ...baseline, attributes: baseline.attributes.slice(0, 1), values: [] };
  const contexts = await Promise.all(Array.from({ length: 10 }, () => browser.newContext({
    baseURL, viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true, serviceWorkers: 'block',
  })));
  try {
    const clients = await Promise.all(contexts.map(async (context) => {
      const page = await context.newPage();
      await page.addInitScript(() => { Math.random = () => 0; });
      await page.route('**/api/attributes/table', (route) => route.fulfill({ json: frozen }));
      await page.route('**/api/attributes/table/changes?*', (route) => route.fulfill({ json: {
        changes: [], hasMore: false, throughVersion: frozen.throughVersion,
        snapshot: { generation: frozen.generation, generatedAt: frozen.generatedAt },
      } }));
      await page.goto('/attributes');
      await page.getByRole('button', { name: '切換為多款排序', exact: true }).tap();
      const panel = page.locator('.attribute-ranking-page');
      for (let i = 0; i < 6; i++) {
        await panel.locator('[data-rank-source="pool"]').first().tap();
        await panel.locator('.attribute-rank-insert').last().tap();
        await expect(panel.locator('[data-rank-list] [data-rank-game]:not([data-rank-reference])')).toHaveCount(i + 1);
      }
      return { page, panel };
    }));
    const responses = await Promise.all(clients.map(async ({ page, panel }) => {
      const saved = page.waitForResponse((r) => r.url().endsWith('/api/attributes/responses'));
      await panel.getByRole('button', { name: '送出排序', exact: true }).tap();
      const response = await saved;
      expect(response.status()).toBe(200);
      await expect(panel.locator('.attribute-rank-sync')).toHaveCount(0);
      return response.request().postDataJSON() as { responseId: string; ranking: { orderedSubjectIds: string[] } };
    }));
    expect(new Set(responses.map((r) => r.responseId)).size).toBe(10);
    const order = responses[0].ranking.orderedSubjectIds;
    expect(order).toHaveLength(6);
    expect(responses.every((r) => JSON.stringify(r.ranking.orderedSubjectIds) === JSON.stringify(order))).toBe(true);
    const after = await catalogFromServer(request);
    for (const [index, id] of order.entries()) {
      const beforeValue = baseline.values.find((v) => v.subjectId === id && v.attributeId === attributeId);
      const afterValue = after.values.find((v) => v.subjectId === id && v.attributeId === attributeId)!;
      const added = index === 0 || index === order.length - 1 ? 10 : 20;
      expect(afterValue.comparisonCount).toBe((beforeValue?.comparisonCount ?? 0) + added);
      expect(afterValue.directCount).toBe(beforeValue?.directCount ?? 0);
    }
    const duplicate = await request.post('/api/attributes/responses', { data: responses[0] });
    expect(duplicate.status()).toBe(200);
    const retried = await catalogFromServer(request);
    expect(retried.values.filter((v) => v.attributeId === attributeId && order.includes(v.subjectId)))
      .toEqual(after.values.filter((v) => v.attributeId === attributeId && order.includes(v.subjectId)));
  } finally { await Promise.all(contexts.map((context) => context.close())); }
});
