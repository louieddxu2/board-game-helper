import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { closeServer, seed, startServer } from './startupSupport';

let site: Awaited<ReturnType<typeof startServer>>;
test.beforeAll(async () => { site = await startServer(resolve('dist/client')); });
test.afterAll(async () => closeServer(site.server));

const setup = async (page: Page, atBottom = true, useClock = true) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${site.origin}/privacy`);
  await seed(page, 1, 250, 2, 0);
  await page.goto(`${site.origin}/workspace`);
  const viewport = page.locator('.workspace-table-viewport');
  await expect(page.getByText('項目 0', { exact: true })).toBeVisible();
  await viewport.evaluate((element, atBottom) => { element.scrollTop = (element.scrollHeight - element.clientHeight) * (atBottom ? 1 : 0.5); }, atBottom);
  await expect(page.getByText(atBottom ? '項目 249' : '項目 124', { exact: true })).toBeInViewport();
  const box = await viewport.boundingBox();
  if (!box) throw new Error('Missing table viewport');
  if (useClock) {
    const clockStart = Date.now();
    await page.clock.install({ time: clockStart });
    await page.clock.pauseAt(clockStart + 1_000);
  }
  const wait = (ms: number) => useClock ? page.clock.runFor(ms) : page.waitForTimeout(ms);
  const client = await page.context().newCDPSession(page);
  const touchAt = async (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number, id = 1) => client.send('Input.dispatchTouchEvent', {
    type,
    timestamp: await page.evaluate(() => Date.now() / 1000),
    touchPoints: type === 'touchEnd' ? [] : [{ x, y, id, radiusX: 1, radiusY: 1, force: 1 }],
  });
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', pull = 0) => touchAt(type, box.x + box.width - 12, box.y + box.height - 80 - pull);
  const tap = async (x: number, y: number, id = 2) => {
    await touchAt('touchStart', x, y, id);
    await wait(35);
    await touchAt('touchEnd', x, y, id);
    await wait(16);
  };
  const fling = async (x: number, y: number, distance = 120, steps = 6, interval = 20) => {
    await touchAt('touchStart', x, y);
    for (let step = 1; step <= steps; step++) {
      await wait(interval);
      await touchAt('touchMove', x, y - distance * step / steps);
    }
    await touchAt('touchEnd', x, y - distance);
    return Date.now();
  };
  const motionStopped = () => viewport.evaluate(element => new Promise<{ top: number; max: number }>(resolve => {
    let previousTop = element.scrollTop, quietFrames = 0;
    const sample = () => {
      const top = element.scrollTop;
      quietFrames = Math.abs(top - previousTop) < 0.1 ? quietFrames + 1 : 0;
      previousTop = top;
      if (quietFrames >= 6 && !element.querySelector('table')?.classList.contains('is-bouncing')) {
        resolve({ top, max: element.scrollHeight - element.clientHeight });
      } else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
  const cellPoint = async () => {
    const point = await viewport.evaluate(element => {
      const viewportBox = element.getBoundingClientRect();
      const cells = Array.from(element.querySelectorAll<HTMLElement>('td[data-bulk-column-id="column-0"]'));
      for (const cell of cells) {
        const box = cell.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
        if (y < viewportBox.top + viewportBox.height / 2 || y > viewportBox.bottom - 80) continue;
        if (document.elementFromPoint(x, y)?.closest('td') === cell) return { x, y, value: cell.textContent ?? '' };
      }
      return null;
    });
    if (!point) throw new Error('Missing hit-testable cell inside the table viewport');
    return point;
  };
  return { errors, client, touch, tap, fling, wait, motionStopped, cellPoint, table: page.locator('.workspace-table'), viewport, search: page.getByRole('searchbox', { name: '搜尋此表' }), editor: page.locator('.workspace-value-dialog') };
};

test('starts the search countdown only after an upward pull reaches the visible bounce limit', async ({ page }) => {
  const gesture = await setup(page);
  await gesture.touch('touchStart');
  await gesture.touch('touchMove', 24);
  await page.clock.runFor(700);
  await expect(gesture.search).toHaveCount(0);
  await expect(gesture.table).toHaveCSS('--workspace-bounce-y', '-8.4px');
  await gesture.touch('touchMove', 90);
  await expect(gesture.table).toHaveCSS('--workspace-bounce-y', '-30.0px');
  await page.clock.runFor(499);
  await expect(gesture.search).toHaveCount(0);
  await page.clock.runFor(1);
  await expect(gesture.search).toBeVisible();
  await gesture.touch('touchEnd');
  expect(gesture.errors).toEqual([]);
  await gesture.client.detach();
});

test('starts a fresh countdown after retreating and reaching the limit again', async ({ page }) => {
  const gesture = await setup(page);
  await gesture.touch('touchStart');
  await gesture.touch('touchMove', 90);
  await expect(gesture.table).toHaveCSS('--workspace-bounce-y', '-30.0px');
  await page.clock.runFor(300);
  await gesture.touch('touchMove', 40);
  await expect(gesture.table).toHaveCSS('--workspace-bounce-y', '-14.0px');
  await page.clock.runFor(700);
  await expect(gesture.search).toHaveCount(0);
  await gesture.touch('touchMove', 110);
  await expect(gesture.table).toHaveCSS('--workspace-bounce-y', '-30.0px');
  await page.clock.runFor(499);
  await expect(gesture.search).toHaveCount(0);
  await page.clock.runFor(1);
  await expect(gesture.search).toBeVisible();
  await gesture.touch('touchEnd');
  expect(gesture.errors).toEqual([]);
  await gesture.client.detach();
});

test('does not open search when the finger lifts before the countdown completes', async ({ page }) => {
  const gesture = await setup(page);
  await gesture.touch('touchStart');
  await gesture.touch('touchMove', 90);
  await expect(gesture.table).toHaveCSS('--workspace-bounce-y', '-30.0px');
  await page.clock.runFor(499);
  await gesture.touch('touchEnd');
  await page.clock.runFor(600);
  await expect(gesture.search).toHaveCount(0);
  expect(gesture.errors).toEqual([]);
  await gesture.client.detach();
});

test('native touch tap control opens an untouched visible cell', async ({ page }) => {
  const gesture = await setup(page);
  const cell = page.locator('td[data-bulk-row-id="row-249"][data-bulk-column-id="column-0"]');
  const box = await cell.boundingBox();
  if (!box) throw new Error('Missing bottom data cell');
  await gesture.tap(box.x + box.width / 2, box.y + box.height / 2, 1);
  await expect(gesture.editor).toBeVisible();
  await gesture.client.detach();
});

test('opens the first fresh touch tap after bottom-boundary motion has finished', async ({ page }) => {
  const gesture = await setup(page, true, false);
  const cell = page.locator('td[data-bulk-row-id="row-249"][data-bulk-column-id="column-0"]');
  await expect(cell).toBeVisible();
  const source = await gesture.cellPoint();
  const releasedAt = await gesture.fling(source.x, source.y);
  const stopped = await gesture.motionStopped();
  expect(stopped.top).toBe(stopped.max);
  await expect(gesture.table).not.toHaveClass(/is-bouncing/);
  await gesture.wait(80);
  expect(await gesture.viewport.evaluate(element => element.scrollTop)).toBe(stopped.top);
  await expect(gesture.search).toHaveCount(0);
  await expect(gesture.editor).toHaveCount(0);
  const box = await cell.boundingBox();
  if (!box) throw new Error('Missing bottom data cell');
  expect(Date.now() - releasedAt).toBeLessThan(500);
  await gesture.tap(box.x + box.width / 2, box.y + box.height / 2, 1);
  await expect(gesture.editor).toBeVisible();
  await expect(gesture.editor.getByRole('textbox')).toHaveValue('資料 249-0');
  expect(gesture.errors).toEqual([]);
  await gesture.client.detach();
});

test('accepts a fresh tap after an interior fling has naturally finished', async ({ page }) => {
  const gesture = await setup(page, false, false);
  const source = await gesture.cellPoint();
  const before = await gesture.viewport.evaluate(element => element.scrollTop);
  const releasedAt = await gesture.fling(source.x, source.y);
  const releasedTop = await gesture.viewport.evaluate(element => element.scrollTop);
  await gesture.wait(100);
  expect(await gesture.viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(releasedTop);
  const stopped = await gesture.motionStopped();
  expect(Date.now() - releasedAt).toBeGreaterThan(500);
  await gesture.wait(80);
  expect(await gesture.viewport.evaluate(element => element.scrollTop)).toBe(stopped.top);
  expect(stopped.top).toBeGreaterThan(before);
  expect(stopped.top).toBeLessThan(stopped.max);
  await expect(gesture.editor).toHaveCount(0);
  const target = await gesture.cellPoint();
  await gesture.tap(target.x, target.y);
  await expect(gesture.editor).toBeVisible();
  expect(gesture.errors).toEqual([]);
  await gesture.client.detach();
});

for (const delay of [0, 250, 1200]) {
  test(`stops writing past the native bottom and accepts the first tap ${delay} ms after a fling reaches it`, async ({ page }) => {
    const gesture = await setup(page, false, false);
    await gesture.viewport.evaluate(element => { element.scrollTop = element.scrollHeight - element.clientHeight - 1000; });
    await expect(page.getByText('項目 220', { exact: true })).toBeInViewport();
    const writes = await gesture.viewport.evaluateHandle(element => {
      const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
      if (!descriptor?.get || !descriptor.set) throw new Error('Missing native scrollTop descriptor');
      const writes: { requested: number; before: number; actual: number }[] = [];
      Object.defineProperty(element, 'scrollTop', {
        configurable: true,
        get() { return descriptor.get!.call(this); },
        set(requested: number) {
          const before = descriptor.get!.call(this);
          descriptor.set!.call(this, requested);
          writes.push({ requested, before, actual: descriptor.get!.call(this) });
        },
      });
      return writes;
    });
    const source = await gesture.cellPoint();
    await gesture.fling(source.x, source.y, 240, 4, 16);
    await expect.poll(() => gesture.viewport.evaluate(element => (
      element.scrollHeight - element.clientHeight - element.scrollTop
    ))).toBeLessThanOrEqual(1);
    await gesture.wait(delay);
    expect(await writes.evaluate(entries => entries.filter(entry => (
      Math.abs(entry.requested - entry.actual) > 1 && entry.before === entry.actual
    )).length)).toBeLessThanOrEqual(1);
    await expect(gesture.table).not.toHaveClass(/is-bouncing/);
    await expect(gesture.editor).toHaveCount(0);
    const target = await gesture.cellPoint();
    await gesture.tap(target.x, target.y);
    await expect(gesture.editor).toBeVisible();
    await expect(gesture.editor.getByRole('textbox')).toHaveValue(target.value);
    expect(gesture.errors).toEqual([]);
    await writes.dispose();
    await gesture.client.detach();
  });
}

for (const delay of [0, 100]) {
  test(`opens the cell touched during bottom rebound after ${delay} ms without a second tap`, async ({ page }) => {
    const gesture = await setup(page, true, false);
    const source = await gesture.cellPoint();
    await gesture.fling(source.x, source.y);
    await expect(gesture.table).toHaveClass(/is-bounce-settling/);
    await gesture.wait(delay);
    await expect(gesture.editor).toHaveCount(0);
    const target = await gesture.cellPoint();
    await gesture.tap(target.x, target.y);
    await expect(gesture.editor).toBeVisible();
    await expect(gesture.editor.getByRole('textbox')).toHaveValue(target.value);
    await expect(gesture.search).toHaveCount(0);
    expect(gesture.errors).toEqual([]);
    await gesture.client.detach();
  });
}
