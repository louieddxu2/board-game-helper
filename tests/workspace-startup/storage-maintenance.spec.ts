import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { } from './storageFixture';
import { startStorageFixture } from './storageSupport';

let site: Awaited<ReturnType<typeof startStorageFixture>>;
test.beforeAll(async () => { site = await startStorageFixture('maintenance'); });
test.afterAll(async () => site.close());
let errors: string[];
test.beforeEach(async ({ page }) => { errors = []; page.on('pageerror', error => errors.push(error.message)); });
test.afterEach(() => expect(errors).toEqual([]));

const fragment = async (page: Page) => {
  await page.goto(`${site.origin}/probe`);
  return page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(512, 2);
    const table = api.data.tables[0];
    const rows = [...table.rows.slice(0, 40), ...table.rows.slice(128, 168), ...table.rows.slice(256)];
    api.data = { ...api.data, tables: [{ ...table, rows }] };
    await api.db.saveWorkspace(api.data);
    return table.id;
  });
};

test('merges fragmented variable blocks with bounded display writes and is idempotent', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(512, 2);
    const table = api.data.tables[0];
    const rows = [...table.rows.slice(0, 40), ...table.rows.slice(128, 168), ...table.rows.slice(256)];
    api.data = { ...api.data, tables: [{ ...table, rows }] };
    await api.db.saveWorkspace(api.data);
    const before = await api.readDisk();
    const beforeRows = api.data.tables[0].rows;
    const beforeState = before.states.find(state => state.tableId === table.id);
    api.instrument(); api.writes = []; api.reads = [];
    await api.db.maintainWorkspaceRowPages(table.id, { signal: new AbortController().signal, isCurrent: () => true, canRun: () => true });
    const writes = [...api.writes];
    const reads = [...api.reads];
    const after = await api.readDisk();
    const merged = await api.db.loadWorkspace({ tableIds: [table.id] });
    const archive = await api.spreadsheet.exportWorkspaceArchive(merged);
    const imported = await api.spreadsheet.importWorkspaceArchive(archive);
    api.writes = []; api.reads = [];
    await api.db.maintainWorkspaceRowPages(table.id, { signal: new AbortController().signal, isCurrent: () => true, canRun: () => true });
    return {
      writes, reads,
      secondWrites: api.writes,
      beforeHead: before.tableHeads[0], afterHead: after.tableHeads[0],
      beforeState, afterState: after.states.find(state => state.tableId === table.id),
      beforeRows, ordered: after.orderedRowIds[0],
      exportedRows: imported.data?.tables[0].rows.map(row => ({ name: row.name, values: row.values })),
      beforeExportRows: beforeRows.map(row => ({ name: row.name, values: row.values })),
    };
  });
  expect(result.writes.filter(write => write.store === 'rowPages' && write.method === 'put')).toHaveLength(1);
  expect(result.writes.filter(write => write.store === 'rowPages' && write.method === 'delete')).toHaveLength(1);
  expect(result.writes.filter(write => write.store === 'tableHeads' && write.method === 'put')).toHaveLength(1);
  expect(result.writes.filter(write => write.store === 'meta' && write.method === 'put')).toHaveLength(1);
  expect(result.writes.every(write => ['rowPages', 'tableHeads', 'meta'].includes(write.store))).toBe(true);
  expect(result.reads.some(read => ['tables', 'rowChunks', 'rowOrderPages', 'rowPages', 'history', 'historyEntries'].includes(read.store))).toBe(false);
  expect(result.afterHead.blocks.map((block: { count: number }) => block.count)).toEqual([80, 128, 128]);
  expect(result.beforeState).toEqual(result.afterState);
  expect(result.beforeRows.map((row: { id: string }) => row.id)).toEqual(result.ordered);
  expect(result.exportedRows).toEqual(result.beforeExportRows);
  expect(result.secondWrites).toEqual([]);
});

const seedHead = async (page: Page, counts: number[]) => {
  await page.goto(`${site.origin}/probe`);
  await page.evaluate(async counts => {
    const api = window.workspaceStorageFixture;
    const rowCount = counts.reduce((sum, count) => sum + count, 0);
    await api.initialize(rowCount, 2);
    const table = api.data.tables[0];
    const existing = await api.readDisk();
    const head = existing.tableHeads[0];
    const blocks = counts.map((count, index) => ({ id: `maintenance-block-${index}`, count, revision: `seed-${index}` }));
    const pages = counts.map((count, index) => {
      const start = counts.slice(0, index).reduce((sum, value) => sum + value, 0);
      return { tableId: table.id, id: blocks[index].id, layoutRevision: blocks[index].revision, rows: table.rows.slice(start, start + count) };
    });
    const nextHead = { ...head, layoutRevision: 'seed-layout', blocks };
    const request = indexedDB.open('board-game-helper-workspace');
    const connection = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const transaction = connection.transaction(['tableHeads', 'rowPages'], 'readwrite');
    for (const block of head.blocks) transaction.objectStore('rowPages').delete([table.id, block.id]);
    transaction.objectStore('tableHeads').put(nextHead, table.id);
    for (const page of pages) transaction.objectStore('rowPages').put(page, [table.id, page.id]);
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error); });
    connection.close();
  }, counts);
  await page.reload();
};

test('splits 193 rows and honors the adjacent merge threshold', async ({ page }) => {
  await seedHead(page, [193]);
  const split = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    api.data = (await api.db.loadWorkspaceInitial()).data;
    await api.db.loadWorkspace({ expectCurrentRevision: true });
    const tableId = api.data.tables[0].id;
    api.instrument(); api.writes = []; api.reads = [];
    await api.db.maintainWorkspaceRowPages(tableId, { signal: new AbortController().signal, isCurrent: () => true, canRun: () => true });
    const disk = await api.readDisk();
    return { writes: api.writes, counts: disk.tableHeads[0].blocks.map(block => block.count), rows: disk.orderedRowIds[0] };
  });
  expect(split.counts).toEqual([97, 96]);
  expect(split.rows).toHaveLength(193);
  expect(split.writes.filter(write => write.store === 'rowPages' && write.method === 'put')).toHaveLength(2);

  await seedHead(page, [64, 64]);
  const merged = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    api.data = (await api.db.loadWorkspaceInitial()).data;
    await api.db.loadWorkspace({ expectCurrentRevision: true });
    const tableId = api.data.tables[0].id;
    api.instrument(); api.writes = []; api.reads = [];
    await api.db.maintainWorkspaceRowPages(tableId, { signal: new AbortController().signal, isCurrent: () => true, canRun: () => true });
    const disk = await api.readDisk();
    return { writes: api.writes, counts: disk.tableHeads[0].blocks.map(block => block.count) };
  });
  expect(merged.counts).toEqual([128]);
  expect(merged.writes.filter(write => write.store === 'rowPages' && write.method === 'delete')).toHaveLength(1);

  await seedHead(page, [64, 65]);
  const untouched = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    api.data = (await api.db.loadWorkspaceInitial()).data;
    await api.db.loadWorkspace({ expectCurrentRevision: true });
    const tableId = api.data.tables[0].id;
    api.instrument(); api.writes = []; api.reads = [];
    await api.db.maintainWorkspaceRowPages(tableId, { signal: new AbortController().signal, isCurrent: () => true, canRun: () => true });
    return { writes: api.writes, reads: api.reads };
  });
  expect(untouched.writes).toEqual([]);
  expect(untouched.reads.some(read => ['tables', 'rowChunks', 'rowOrderPages', 'rowPages', 'history', 'historyEntries'].includes(read.store))).toBe(false);
});

test('selects a variable block after full startup and maintains its pending snapshot without large reads', async ({ page }) => {
  await seedHead(page, [40, 40, 128, 128]);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    const initial = await api.db.loadWorkspaceInitial();
    const table = initial.data.tables[0];
    api.data = initial.data;
    api.instrument(); api.writes = []; api.reads = [];
    const projection = await api.db.loadWorkspaceTableWindow(table.id, { scrollTop: 90 * 36, viewportHeight: 36 });
    const selectionReads = [...api.reads];
    api.writes = []; api.reads = [];
    await api.db.maintainWorkspaceRowPages(table.id, { signal: new AbortController().signal, isCurrent: () => true, canRun: () => true });
    return {
      rowCount: table.rows.length,
      selected: projection?.pages.map(page => page.id),
      selectionPageReads: selectionReads.filter(read => read.store === 'rowPages'),
      selectionLargeReads: selectionReads.filter(read => ['tables', 'rowChunks', 'rowOrderPages', 'history', 'historyEntries'].includes(read.store)),
      maintenanceWrites: api.writes,
      maintenanceLargeReads: api.reads.filter(read => ['tables', 'rowChunks', 'rowOrderPages', 'history', 'historyEntries'].includes(read.store)),
    };
  });
  expect(result.rowCount).toBe(336);
  expect(result.selected).toEqual(['maintenance-block-2']);
  expect(result.selectionPageReads).toEqual([{ store: 'rowPages', method: 'get', key: [expect.any(String), 'maintenance-block-2'], transaction: expect.any(Number) }]);
  expect(result.selectionLargeReads).toEqual([]);
  expect(result.maintenanceLargeReads).toEqual([]);
  expect(result.maintenanceWrites.filter(write => write.store === 'rowPages' && write.method === 'put')).toHaveLength(1);
  expect(result.maintenanceWrites.filter(write => write.store === 'rowPages' && write.method === 'delete')).toHaveLength(1);
});

for (const failureMode of ['abort', 'quota'] as const) test(`${failureMode} maintenance failure is atomic and a later edit recovers`, async ({ page }) => {
  const tableId = await fragment(page);
  const result = await page.evaluate(async ({ failureMode, tableId }) => {
    const api = window.workspaceStorageFixture;
    const before = await api.readDisk();
    api.instrument(); api.writes = []; api.reads = [];
    api.failNextPage = true; api.failureMode = failureMode;
    let failure = '';
    try { await api.db.maintainWorkspaceRowPages(tableId, { signal: new AbortController().signal, isCurrent: () => true, canRun: () => true }); } catch (error) { failure = (error as Error).name; }
    const aborted = await api.readDisk();
    await api.edit(0, '維護後編輯');
    const recovered = await api.db.loadWorkspace({ tableIds: [tableId] });
    return { failure, unchanged: JSON.stringify(aborted) === JSON.stringify(before), value: recovered.tables[0].rows[0].values[recovered.tables[0].columns[0].id], rows: recovered.tables[0].rows.length };
  }, { failureMode, tableId });
  expect(result.failure).toBe(failureMode === 'quota' ? 'QuotaExceededError' : 'AbortError');
  expect(result.unchanged).toBe(true);
  expect(result.value).toBe('維護後編輯');
  expect(result.rows).toBe(336);
});

test('cancels an idle maintenance plan when a normal edit supersedes its snapshot', async ({ page }) => {
  const tableId = await fragment(page);
  const result = await page.evaluate(async tableId => {
    const api = window.workspaceStorageFixture;
    const callbacks: IdleRequestCallback[] = [];
    const originalIdle = window.requestIdleCallback;
    window.requestIdleCallback = callback => { callbacks.push(callback); return callbacks.length; };
    api.instrument(); api.writes = []; api.reads = [];
    let current = true;
    const maintenance = api.db.maintainWorkspaceRowPages(tableId, { signal: new AbortController().signal, isCurrent: () => current, canRun: () => true });
    await Promise.resolve(); await Promise.resolve();
    const edit = api.edit(0, '新值');
    current = false;
    callbacks.shift()?.({ didTimeout: false, timeRemaining: () => 20 });
    await Promise.all([maintenance, edit]);
    window.requestIdleCallback = originalIdle;
    const loaded = await api.db.loadWorkspace({ tableIds: [tableId] });
    return { value: loaded.tables[0].rows[0].values[loaded.tables[0].columns[0].id], pagePuts: api.writes.filter(write => write.store === 'rowPages' && write.method === 'put').length, pageDeletes: api.writes.filter(write => write.store === 'rowPages' && write.method === 'delete').length };
  }, tableId);
  expect(result.value).toBe('新值');
  expect(result.pagePuts).toBe(1);
  expect(result.pageDeletes).toBe(0);
});
