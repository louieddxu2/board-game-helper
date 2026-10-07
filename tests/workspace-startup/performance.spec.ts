import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { closeServer, seed, startServer, waitForOfflineShell } from './startupSupport';
let site: Awaited<ReturnType<typeof startServer>>;
test.beforeAll(async () => { site = await startServer(resolve('dist/client')); });
test.afterAll(async () => { await closeServer(site.server); });
test.beforeEach(() => { site.state.documentDelay = 0; });

test('cached navigation does not request a slow document or load unrelated site code', async ({ page }) => {
  await page.goto(`${site.origin}/workspace`);
  await waitForOfflineShell(page);
  await seed(page);
  site.state.documentDelay = 2500;
  const before = site.state.workspaceRequests;
  await page.reload();
  await expect(page.locator('.workspace-table')).toBeVisible();
  expect(site.state.workspaceRequests).toBe(before);
  const resources = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name));
  expect(resources.some((name) => /\/api\/|\/assets\/api-|\/assets\/SiteLayout-/.test(name))).toBe(false);
});

test('an installed PWA restores its table before loading homepage modules', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'standalone', { value: true });
    localStorage.setItem('wrong-board-game-pwa-last-route', '/workspace');
  });
  await page.goto(`${site.origin}/`);
  await expect(page.getByRole('button', { name: '建立表格', exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/workspace');
  const resources = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name));
  expect(resources.some((name) => /\/api\/|\/assets\/(?:api-|SiteLayout-|HomePage-)/.test(name))).toBe(false);
});

test('reports repeat startup timing with many local tables on a throttled mobile viewport', async ({ page, context }, info) => {
  const client = await context.newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  let timingInstalled = false;
  const measure = async (origin: string, virtualized: boolean) => {
    await page.goto(`${origin}/workspace`);
    await expect(page.locator('.workspace-page')).toBeVisible();
    await waitForOfflineShell(page);
    await seed(page, 8, 250, 12);
    if (!timingInstalled) await page.addInitScript(() => {
      const timing = { firstPaintAt: 0, drawerAt: 0, fullDrawerAt: 0 };
      Object.assign(window, { __workspaceStartupTiming: timing });
      let scheduled = false;
      const observeFirstRow = new MutationObserver(() => {
        if (scheduled || !document.querySelector('.workspace-table tbody tr')) return;
        scheduled = true;
        observeFirstRow.disconnect();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          timing.firstPaintAt = performance.now();
          const tryOpen = () => {
            if (document.querySelector('aside.workspace-drawer')) {
              timing.drawerAt = performance.now();
              const waitForFullDrawer = () => {
                if (document.querySelector('.workspace-drawer-create')) { timing.fullDrawerAt = performance.now(); return; }
                window.setTimeout(waitForFullDrawer, 16);
              };
              waitForFullDrawer();
              return;
            }
            document.querySelector<HTMLButtonElement>('button[aria-label="開啟目錄"]')?.click();
            window.setTimeout(tryOpen, 16);
          };
          tryOpen();
        }));
      });
      observeFirstRow.observe(document, { childList: true, subtree: true });
    });
    timingInstalled = true;
    const samples: number[] = [];
    const drawerSamples: number[] = [];
    const fullDrawerSamples: number[] = [];
    for (let index = 0; index < 5; index++) {
      await page.reload();
      if (virtualized) {
        await expect(page.locator('.workspace-table tbody tr[data-virtual-row-id]').first()).toHaveAttribute('data-virtual-row-id', 'row-0');
        expect(await page.locator('.workspace-table tbody tr[data-virtual-row-id]').count()).toBeLessThan(80);
      } else await expect(page.locator('.workspace-table tbody tr')).toHaveCount(250);
      await expect(page.getByRole('complementary', { name: 'Workspace 目錄' })).toBeVisible();
      await expect(page.getByRole('button', { name: '新增表格' })).toBeVisible();
      await expect.poll(() => page.evaluate(() => (window as unknown as { __workspaceStartupTiming: { fullDrawerAt: number } }).__workspaceStartupTiming.fullDrawerAt)).toBeGreaterThan(0);
      const timing = await page.evaluate(() => (window as unknown as { __workspaceStartupTiming: { firstPaintAt: number; drawerAt: number; fullDrawerAt: number } }).__workspaceStartupTiming);
      expect(timing.firstPaintAt).toBeGreaterThan(0);
      expect(timing.drawerAt).toBeGreaterThan(0);
      expect(timing.fullDrawerAt).toBeGreaterThan(0);
      samples.push(timing.firstPaintAt);
      drawerSamples.push(timing.drawerAt);
      fullDrawerSamples.push(timing.fullDrawerAt);
    }
    return { samples: samples.map(Math.round), medianMs: Math.round([...samples].sort((a, b) => a - b)[2]), drawerSamples: drawerSamples.map(Math.round), drawerMedianMs: Math.round([...drawerSamples].sort((a, b) => a - b)[2]), fullDrawerSamples: fullDrawerSamples.map(Math.round), fullDrawerMedianMs: Math.round([...fullDrawerSamples].sort((a, b) => a - b)[2]) };
  };
  const current = await measure(site.origin, true);
  let baseline: Awaited<ReturnType<typeof measure>> | undefined;
  if (process.env.WORKSPACE_BASELINE_DIR) {
    const previous = await startServer(resolve(process.env.WORKSPACE_BASELINE_DIR));
    try { baseline = await measure(previous.origin, false); } finally { await closeServer(previous.server); }
  }
  const result = { viewport: '390x844', cpuSlowdown: 4, tables: 8, rowsPerTable: 250, columnsPerTable: 12, current, baseline };
  console.log(JSON.stringify(result));
  await info.attach('startup-timing', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
});
