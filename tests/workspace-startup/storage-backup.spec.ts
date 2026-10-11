import { expect, test } from '@playwright/test';
import type { } from './storageFixture';
import { startStorageFixture } from './storageSupport';

let site: Awaited<ReturnType<typeof startStorageFixture>>;
test.beforeAll(async () => { site = await startStorageFixture('backup'); });
test.afterAll(async () => site.close());
let errors: string[];
test.beforeEach(async ({ page }) => { errors = []; page.on('pageerror', error => errors.push(error.message)); });
test.afterEach(() => expect(errors).toEqual([]));

test('reads three 10,000-row tables transiently with bounded batches and identical XLSX values', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(10_000, 4, 3);
    api.data = { ...api.data, tables: api.data.tables.map(table => ({
      ...table,
      columns: table.columns.map((column, index) => index === 0 ? { ...column, inputType: 'dynamic-select' as const } : index === 1 ? { ...column, inputType: 'link' as const } : index === 2 ? { ...column, inputType: 'number' as const } : column),
      rows: table.rows.map((row, index) => ({ ...row, values: {
        [table.columns[0].id]: index < 7_000 ? 'Common' : 'Rare',
        [table.columns[1].id]: { label: `連結 ${index}`, url: `https://example.test/${index}` },
        [table.columns[2].id]: index,
        [table.columns[3].id]: `文字 ${index}`,
      } })),
    })) };
    await api.db.saveWorkspace(api.data);
  });
  await page.reload();
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    const initial = await api.db.loadWorkspaceInitial({ paged: true });
    api.instrument(); api.reads = []; api.writes = [];
    const summaries = await api.db.loadWorkspaceBackupSummaries(initial.data);
    const summaryReads = [...api.reads];
    const source = await api.db.prepareWorkspaceBackup(initial.data);
    const inspected = [];
    // Each call keeps only this table and its workbook, returning small assertions.
    const inspect = async (id: string) => {
      const table = await source.readTable(id);
      const workbook = await api.spreadsheet.exportWorkspaceXlsxAsync(initial.data, table);
      const imported = (await api.spreadsheet.importWorkspaceXlsx(workbook, { preserveIds: true })).table!;
      const columns = table.columns;
      return {
        id: imported.id, rows: imported.rows.length, name: imported.name,
        revision: imported.changeRevision,
        first: imported.rows[0].values, last: imported.rows.at(-1)!.values,
        sourceFirst: table.rows[0].values, sourceLast: table.rows.at(-1)!.values,
        counts: imported.columns[0].dynamicOptions?.counts.map(item => item.count),
        numberType: typeof imported.rows.at(-1)!.values[columns[2].id],
      };
    };
    for (const table of source.tables) inspected.push(await inspect(table.id));
    await source.verify();
    const backupReads = [...api.reads];
    const counts = new Map<number, number>();
    for (const read of backupReads.filter(read => ['rowChunks', 'rowOrderPages'].includes(read.store) && read.method === 'get')) counts.set(read.transaction, (counts.get(read.transaction) ?? 0) + 1);
    api.reads = [];
    // A normal subsequent hydration must still read this table: backup did not cache it.
    const opened = await api.db.loadWorkspace({ expectCurrentRevision: true, tableIds: [summaries[1].id], deferStartupWork: true });
    return {
      inspected, summaries, summaryReads, backupWrites: api.writes,
      screenTables: initial.data.tables.length,
      maxBatch: Math.max(...counts.values()),
      canonicalGetAll: backupReads.some(read => ['rowChunks', 'rowOrderPages'].includes(read.store) && read.method === 'getAll'),
      subsequentRows: opened.tables[0].rows.length,
      subsequentCanonicalReads: api.reads.filter(read => read.store === 'rowChunks' && read.method === 'get').length,
    };
  });
  expect(result.summaries).toHaveLength(3);
  expect(result.summaries.every(table => !('rows' in table))).toBe(true);
  expect(result.summaryReads.some(read => ['rowChunks', 'rowOrderPages', 'rowPages', 'history', 'historyEntries', 'tables'].includes(read.store))).toBe(false);
  expect(result.inspected.map(table => table.rows)).toEqual([10_000, 10_000, 10_000]);
  for (const table of result.inspected) {
    expect(table.first).toEqual(table.sourceFirst); expect(table.last).toEqual(table.sourceLast);
    expect(table.counts).toEqual([7_000, 3_000]); expect(table.numberType).toBe('number');
  }
  expect(result.screenTables).toBe(0);
  expect(result.backupWrites).toEqual([]);
  expect(result.maxBatch).toBeLessThanOrEqual(2);
  expect(result.canonicalGetAll).toBe(false);
  expect(result.subsequentRows).toBe(10_000);
  expect(result.subsequentCanonicalReads).toBeGreaterThan(0);
});

test('keeps a backup usable across layout maintenance and a history-only write during a canonical read', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(512, 2, 2);
    const first = api.data.tables[0];
    const fragmented = { ...first, rows: [...first.rows.slice(0, 40), ...first.rows.slice(128, 168), ...first.rows.slice(256)] };
    await api.db.saveWorkspace({ ...api.data, tables: [fragmented, api.data.tables[1]] });
    const initial = await api.db.loadWorkspaceInitial({ paged: true });
    const active = await api.db.loadWorkspace({ expectCurrentRevision: true, tableIds: [first.id] });
    const data = { ...initial.data, tables: active.tables };
    const source = await api.db.prepareWorkspaceBackup(data);
    api.instrument(); api.writes = [];
    await api.db.maintainWorkspaceRowPages(first.id, { signal: new AbortController().signal, isCurrent: () => true, canRun: () => true });
    await source.verify();
    const layoutWrites = [...api.writes];
    const originalGet = IDBObjectStore.prototype.get;
    let historyWrite: Promise<void> | undefined;
    IDBObjectStore.prototype.get = function (...args) {
      const request = Reflect.apply(originalGet, this, args);
      if (this.name === 'rowChunks' && !historyWrite) {
        historyWrite = api.db.saveWorkspaceHistory(api.history.createEmptyWorkspaceTableHistory(first.id));
      }
      return request;
    };
    const second = await source.readTable(source.tables.find(table => table.id !== first.id)!.id);
    IDBObjectStore.prototype.get = originalGet;
    await historyWrite;
    await source.verify();
    return { layoutWrites, historyTriggered: Boolean(historyWrite), secondRows: second.rows.length, summaries: source.tables, activeRows: data.tables[0].rows.length };
  });
  expect(result.layoutWrites.some(write => write.store === 'rowPages')).toBe(true);
  expect(result.historyTriggered).toBe(true);
  expect(result.secondRows).toBe(512);
  expect(result.activeRows).toBe(336);
  expect(result.summaries).toHaveLength(2);
});

test('backs up an unopened legacy table without migration writes or saving its rows in the cache', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(600, 2, 2);
    const legacy = api.data.tables[1];
    const connection = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('board-game-helper-workspace'); request.onsuccess = () => resolve(request.result); });
    const transaction = connection.transaction(['tables', 'tableHeads'], 'readwrite');
    transaction.objectStore('tables').put(legacy, legacy.id);
    transaction.objectStore('tableHeads').delete(legacy.id);
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
    connection.close();
  });
  await page.reload();
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    const initial = await api.db.loadWorkspaceInitial({ paged: true });
    api.instrument(); api.writes = [];
    const source = await api.db.prepareWorkspaceBackup(initial.data);
    const legacy = await source.readTable(source.tables[1].id);
    const workbook = await api.spreadsheet.exportWorkspaceXlsxAsync(initial.data, legacy);
    const imported = (await api.spreadsheet.importWorkspaceXlsx(workbook, { preserveIds: true })).table!;
    await source.verify();
    return { screenTables: initial.data.tables.length, writes: api.writes, revision: imported.changeRevision, summary: source.tables[1], rows: imported.rows.length, last: imported.rows.at(-1)?.values[imported.columns[0].id] };
  });
  expect(result.screenTables).toBe(0);
  expect(result.writes).toEqual([]);
  expect(result.rows).toBe(600);
  expect(result.last).toBe('資料 599-0');
  expect(result.revision).toBe(result.summary.changeRevision);
});

test('rejects a real edit during a late canonical batch without publishing transient rows', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(10_000, 2, 2);
    const initial = await api.db.loadWorkspaceInitial({ paged: true });
    const active = await api.db.loadWorkspace({ expectCurrentRevision: true, tableIds: [api.data.tables[0].id] });
    const partial = { ...initial.data, tables: active.tables };
    const source = await api.db.prepareWorkspaceBackup(partial);
    const originalGet = IDBObjectStore.prototype.get;
    let canonicalGets = 0;
    let edit: Promise<void> | undefined;
    IDBObjectStore.prototype.get = function (...args) {
      const request = Reflect.apply(originalGet, this, args);
      if (this.name === 'rowChunks' && ++canonicalGets === 5) {
        edit = api.edit(0, '備份期間編輯');
      }
      return request;
    };
    let failure = '';
    try { await source.readTable(source.tables[1].id); } catch (error) { failure = (error as Error).message; }
    IDBObjectStore.prototype.get = originalGet;
    await edit;
    let finalFailure = '';
    try { await source.verify(); } catch (error) { finalFailure = (error as Error).message; }
    return { failure, finalFailure, screenTables: partial.tables.length, value: api.data.tables[0].rows[0].values[api.data.tables[0].columns[0].id] };
  });
  expect(result.failure).toContain('備份期間已有變更');
  expect(result.finalFailure).toContain('備份期間已有變更');
  expect(result.screenTables).toBe(1);
  expect(result.value).toBe('備份期間編輯');
});

test('rejects another-tab updates, cancellation and missing chunks on transient reads', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(600);
    const initial = await api.db.loadWorkspaceInitial({ paged: true });
    let current = true;
    const cancelled = await api.db.prepareWorkspaceBackup(initial.data, { isCurrent: () => current });
    current = false;
    let cancelledName = '';
    try { await cancelled.readTable(cancelled.tables[0].id); } catch (error) { cancelledName = (error as Error).name; }
    const source = await api.db.prepareWorkspaceBackup(initial.data);
    const disk = await api.readDisk();
    const connection = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('board-game-helper-workspace'); request.onsuccess = () => resolve(request.result); });
    const remove = connection.transaction('rowChunks', 'readwrite');
    remove.objectStore('rowChunks').delete([source.tables[0].id, disk.tables[0].chunkIds.at(-1)!]);
    await new Promise<void>((resolve, reject) => { remove.oncomplete = () => resolve(); remove.onerror = () => reject(remove.error); });
    let missingName = '';
    try { await source.readTable(source.tables[0].id); } catch (error) { missingName = (error as Error).name; }
    const external = connection.transaction('meta', 'readwrite');
    external.objectStore('meta').put({ storageRevision: 'another-tab' }, 'storage');
    await new Promise<void>((resolve, reject) => { external.oncomplete = () => resolve(); external.onerror = () => reject(external.error); });
    connection.close();
    let conflictName = '';
    try { await source.verify(); } catch (error) { conflictName = (error as Error).name; }
    return { cancelledName, missingName, conflictName, screenTables: initial.data.tables.length };
  });
  expect(result.cancelledName).toBe('AbortError');
  expect(result.missingName).toBe('WorkspaceStorageIntegrityError');
  expect(result.conflictName).toBe('WorkspaceStorageConflictError');
  expect(result.screenTables).toBe(0);
});
