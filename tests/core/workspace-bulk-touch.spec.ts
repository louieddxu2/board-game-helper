import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test('same-column touches select immediately while guard-band panning cannot open search', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/workspace');
  await expect(page.getByRole('button', { name: '建立表格' })).toBeVisible();

  // Seed only local Workspace data so this test exercises browser touch handling.
  await page.evaluate(async () => {
    const request = indexedDB.open('board-game-helper-workspace', 3);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction(['meta', 'tables'], 'readwrite');
    transaction.objectStore('meta').put({
      version: 1,
      nodes: [{ id: 'node-touch', type: 'table', name: '觸控測試', parentId: null, order: 0, tableId: 'table-touch' }],
      activeNodeId: 'node-touch',
      bottomNavigationTableIds: [],
    }, 'workspace');
    transaction.objectStore('tables').put({
      id: 'table-touch', name: '觸控測試', rowHeaderName: '項目', updatedAt: 1,
      columns: [{ id: 'column-touch', name: '屬性 1', inputType: 'text', options: [] }],
      rows: Array.from({ length: 48 }, (_, index) => ({
        id: `row-${index + 1}`, name: `項目 ${index + 1}`, values: { 'column-touch': null },
      })),
    }, 'table-touch');
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  });
  await page.reload();

  const cells = page.locator('td[data-bulk-column-id="column-touch"]');
  await expect(cells.nth(3)).toBeVisible();
  const toolbar = page.getByRole('toolbar', { name: '批次編輯 屬性 1' });
  const client = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x?: number, y?: number) => client.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x: x!, y: y!, id: 1, radiusX: 1, radiusY: 1, force: 1 }],
  });
  const center = async (index: number) => {
    const box = await cells.nth(index).boundingBox();
    if (!box) throw new Error(`Missing visible cell ${index + 1}`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
  };

  const first = await center(0);
  await touch('touchStart', first.x, first.y);
  await expect(toolbar).toContainText('已選 1 格');
  await touch('touchEnd');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  const second = await center(1);
  await touch('touchStart', second.x, second.y);
  await touch('touchEnd');
  await expect(toolbar).toContainText('已選 2 格');

  const fourth = await center(3);
  await touch('touchStart', second.x, second.y);
  await touch('touchMove', fourth.x, fourth.y);
  await touch('touchEnd');
  await expect(toolbar).toContainText('已選 4 格');

  const viewport = page.locator('.workspace-table-viewport');
  await viewport.evaluate((element) => { element.scrollTop = 40; });
  const guardX = second.box.x + 3;
  await touch('touchStart', guardX, second.y);
  await touch('touchMove', guardX, second.y - 80);
  await touch('touchEnd');
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(40);
  await expect(toolbar).toContainText('已選 4 格');

  await viewport.evaluate((element) => { element.scrollTop = element.scrollHeight - element.clientHeight; });
  const viewportBox = await viewport.boundingBox();
  if (!viewportBox) throw new Error('Missing table viewport');
  const edgeX = viewportBox.x + 8;
  const edgeY = viewportBox.y + viewportBox.height - 80;
  await touch('touchStart', edgeX, edgeY);
  await touch('touchMove', edgeX, edgeY - 100);
  await page.waitForTimeout(600);
  await expect(page.getByRole('searchbox')).toHaveCount(0);
  await touch('touchEnd');
  expect(pageErrors).toEqual([]);
  await client.detach();
});
