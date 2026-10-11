import { expect, test } from '@playwright/test';
import type {} from './storageFixture';
import { startStorageFixture } from './storageSupport';

let site: Awaited<ReturnType<typeof startStorageFixture>>;
test.beforeAll(async () => { site = await startStorageFixture('export'); });
test.afterAll(async () => site.close());

test('large async export yields browser tasks and lets DOM input run before completion', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  await page.evaluate(async () => { await window.workspaceStorageFixture.initialize(10_000, 12); });
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    const input = document.createElement('input');
    document.body.append(input);
    let completed = false;
    let timerTicks = 0;
    const timerTimes: number[] = [];
    let inputBeforeCompletion = false;
    let rafBeforeCompletion = 0;
    let longTaskCount = 0;
    let maxLongTaskDuration = 0;
    const timer = window.setInterval(() => { timerTicks += 1; timerTimes.push(performance.now()); }, 0);
    input.addEventListener('input', () => { if (!completed) inputBeforeCompletion = true; });
    const observer = typeof PerformanceObserver === 'undefined' ? undefined : new PerformanceObserver(entries => {
      for (const entry of entries.getEntries()) { longTaskCount += 1; maxLongTaskDuration = Math.max(maxLongTaskDuration, entry.duration); }
    });
    try { observer?.observe({ type: 'longtask', buffered: false }); } catch { /* Chromium may omit longtask support. */ }
    let frame = 0;
    const paint = () => { if (!completed) { rafBeforeCompletion += 1; frame = requestAnimationFrame(paint); } };
    frame = requestAnimationFrame(paint);
    window.setTimeout(() => {
      input.value = 'typed while exporting';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, 0);
    const started = performance.now();
    const blob = await api.spreadsheet.exportWorkspaceXlsxAsync(api.data, api.data.tables[0], { isCurrent: () => true });
    const completedAt = performance.now();
    const duration = completedAt - started;
    completed = true;
    await new Promise<void>(resolve => window.setTimeout(resolve, 0));
    cancelAnimationFrame(frame);
    window.clearInterval(timer);
    observer?.disconnect();
    input.remove();
    const completedTimerTimes = timerTimes.filter(time => time <= completedAt);
    const maxTimerGap = completedTimerTimes.length === 0
      ? duration
      : Math.max(completedTimerTimes[0] - started, completedAt - completedTimerTimes.at(-1)!, ...completedTimerTimes.slice(1).map((time, index) => time - completedTimerTimes[index]));
    return { size: blob.size, duration, timerTicks, maxTimerGap, inputBeforeCompletion, rafBeforeCompletion, longTaskCount, maxLongTaskDuration };
  });
  await test.info().attach('export-cooperative-metrics', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  console.info('workspace export cooperative metrics', result);
  expect(result.size).toBeGreaterThan(1000);
  expect(result.duration).toBeGreaterThan(0);
  expect(result.timerTicks).toBeGreaterThan(0);
  expect(result.inputBeforeCompletion).toBe(true);
  expect(result.rafBeforeCompletion).toBeGreaterThan(0);
});

test('cancellation is observable and a changed host does not alter the immutable export snapshot', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(2_000, 2);
    const original = api.data;
    const originalTable = original.tables[0];
    let current = true;
    const cancelTimer = window.setTimeout(() => { current = false; }, 0);
    let cancelled = '';
    try { await api.spreadsheet.exportWorkspaceXlsxAsync(original, originalTable, { isCurrent: () => current }); }
    catch (error) { cancelled = (error as Error).name; }
    window.clearTimeout(cancelTimer);

    const snapshot = api.data;
    const sourceTable = snapshot.tables[0];
    const changedTable = { ...sourceTable, rows: sourceTable.rows.map((row, index) => index === 0 ? { ...row, name: '後來的編輯' } : row) };
    const exporting = api.spreadsheet.exportWorkspaceXlsxAsync(snapshot, sourceTable, { isCurrent: () => true });
    api.data = { ...snapshot, tables: [changedTable] };
    const exported = await exporting;
    const imported = await api.spreadsheet.importWorkspaceXlsx(exported, { preserveIds: true });
    return { cancelled, firstName: imported.table?.rows[0]?.name, currentName: api.data.tables[0].rows[0].name };
  });
  expect(result.cancelled).toBe('AbortError');
  expect(result.firstName).toBe('項目 0');
  expect(result.currentName).toBe('後來的編輯');
});

test('archive export imports as a complete workspace and rejects a paged projection', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(48, 3, 2);
    const archive = await api.spreadsheet.exportWorkspaceArchive(api.data, { isCurrent: () => true });
    const imported = await api.spreadsheet.importWorkspaceArchive(archive);
    const initial = await api.db.loadWorkspaceInitial({ paged: true });
    const display = api.rowPages.workspaceWindowDisplayTable(initial.window!);
    let projectionError = '';
    try { api.spreadsheet.exportWorkspaceXlsx(initial.data, display); }
    catch (error) { projectionError = (error as Error).name; }
    return { archiveSize: archive.size, isWorkspace: imported.isWorkspace, tableCount: imported.data?.tables.length, projectionError };
  });
  expect(result.archiveSize).toBeGreaterThan(1000);
  expect(result.isWorkspace).toBe(true);
  expect(result.tableCount).toBe(2);
  expect(result.projectionError).toBe('WorkspaceStorageIntegrityError');
});
