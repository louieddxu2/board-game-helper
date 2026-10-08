import { expect, test } from '@playwright/test';
import type { } from './storageFixture';
import { startStorageFixture } from './storageSupport';
let site: Awaited<ReturnType<typeof startStorageFixture>>;
test.beforeAll(async () => { site = await startStorageFixture('migration'); });
test.afterAll(async () => site.close());
let errors: string[];
test.beforeEach(async ({ page }) => { errors = []; page.on('pageerror', error => errors.push(error.message)); });
test.afterEach(() => expect(errors).toEqual([]));

test('cold legacy history keeps older past, drops expired/redo entries and migrates only once', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize();
    const table = api.data.tables[0];
    const entry = (id: string, createdAt = Date.now()) => ({ id, tableId: table.id, createdAt, label: id, action: { type: 'set-cell', rowId: table.rows[0].id, columnId: table.columns[0].id, before: null, after: id } });
    const request = indexedDB.open('board-game-helper-workspace');
    const connection = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result); });
    const transaction = connection.transaction('history', 'readwrite');
    transaction.objectStore('history').put({ tableId: table.id, past: [entry('expired', Date.now() - api.history.workspaceHistoryRetentionMs - 1), entry('older')], future: [entry('redo')] }, table.id);
    await new Promise<void>(resolve => { transaction.oncomplete = () => resolve(); }); connection.close();
    api.instrument();
    await api.edit(0, 'A', 0, true);
    const firstWrites = [...api.writes]; api.writes = [];
    await api.edit(256, 'B', 0, true);
    const loaded = await api.db.loadWorkspaceHistories();
    return { firstWrites, secondWrites: api.writes, pastIds: loaded.get(table.id)?.past.map(entry => entry.id), future: loaded.get(table.id)?.future, disk: await api.readDisk() };
  });
  expect(result.pastIds).toHaveLength(3);
  expect(result.pastIds?.[0]).toBe('older');
  expect(result.future).toEqual([]);
  expect(result.disk.heads[0].storageFormat).toBe('history-entries-v1');
  expect(result.disk.entryIds).not.toContain('expired');
  expect(result.disk.entryIds).not.toContain('redo');
  expect(result.secondWrites.filter(write => write.store === 'historyEntries' && write.method === 'put')).toHaveLength(1);
});

test('materialized chunk tables export/import the existing archive format and restore all cell values', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(600, 2, 2);
    await api.edit(0, '匯出值');
    const materialized = await api.db.loadWorkspace();
    const archive = await api.spreadsheet.exportWorkspaceArchive(materialized);
    const imported = await api.spreadsheet.importWorkspaceArchive(archive);
    if (!imported.data) throw new Error('No archive data');
    const oldIds = materialized.tables.map(table => table.id);
    await api.db.saveWorkspace(imported.data, { deletedTableIds: oldIds.filter(id => !imported.data!.tables.some(table => table.id === id)), replaceTableIds: imported.data.tables.map(table => table.id), history: { clearAll: true } });
    const restored = await api.db.loadWorkspace();
    return { format: restored.version, counts: restored.tables.map(table => table.rows.length), values: restored.tables.map(table => table.rows.map(row => Object.values(row.values))), expected: materialized.tables.map(table => table.rows.map(row => Object.values(row.values))), disk: await api.readDisk() };
  });
  expect(result.format).toBe(1);
  expect(result.counts).toEqual([600, 600]);
  expect(result.values).toEqual(result.expected);
  expect(result.disk.heads).toHaveLength(0);
});

test('format-only background migration preserves semantic revisions and timestamps', async ({ page }) => {
  await page.goto(`${site.origin}/blank`);
  await page.evaluate(async () => {
    const request = indexedDB.open('board-game-helper-workspace', 3);
    request.onupgradeneeded = () => { for (const name of ['state', 'meta', 'tables', 'history']) request.result.createObjectStore(name); };
    const connection = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result); });
    const transaction = connection.transaction(['meta', 'tables'], 'readwrite');
    transaction.objectStore('meta').put({ version: 1, storageRevision: 'original-storage', updatedAt: 100, structureRevision: 'original-structure', activeNodeId: 'node-original', bottomNavigationTableIds: [], nodes: [{ id: 'node-original', type: 'table', tableId: 'table-original', name: '原表', parentId: null, order: 0 }] }, 'workspace');
    transaction.objectStore('tables').put({ id: 'table-original', name: '原表', rowHeaderName: '項目', updatedAt: 100, changeRevision: 'original-content', columns: [{ id: 'column-original', name: '欄位', inputType: 'text', options: [] }], rows: [{ id: 'row-original', name: '列', values: { 'column-original': '保留值' } }] }, 'table-original');
    await new Promise<void>(resolve => { transaction.oncomplete = () => resolve(); });
    connection.close();
  });
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    const initial = await api.db.loadWorkspaceInitial(); api.data = initial.data;
    await api.db.loadWorkspace({ expectCurrentRevision: true });
    await api.db.flushWorkspaceSaves();
    return api.readDisk();
  });
  expect(result.tables[0].storageFormat).toBe('row-chunks-v2');
  expect(result.orders).toHaveLength(1);
  expect(result.states[0]).toEqual({ updatedAt: 100, changeRevision: 'original-content', columnState: {} });
  expect(result.meta).toContainEqual(expect.objectContaining({ structureRevision: 'original-structure' }));
  const storage = result.meta.find(item => 'storageRevision' in item);
  expect(storage.updatedAt).toBe(100);
  expect(storage.storageRevision).not.toBe('original-storage');
  expect(result.cells[0][0].value).toBe('保留值');
});

test('v3 upgrade waits for an old connection, migrates only metadata initially and rolls back an aborted table migration', async ({ page }) => {
  await page.goto(`${site.origin}/blank`);
  await page.evaluate(async () => {
    const request = indexedDB.open('board-game-helper-workspace', 3);
    request.onupgradeneeded = () => { for (const name of ['state', 'meta', 'tables', 'history']) request.result.createObjectStore(name); };
    const connection = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result); });
    const transaction = connection.transaction(['meta', 'tables'], 'readwrite');
    transaction.objectStore('meta').put({ version: 1, storageRevision: 'legacy-storage', updatedAt: 100, structureRevision: 'legacy-structure', activeNodeId: 'node-legacy', bottomNavigationTableIds: ['table-legacy'], nodes: [{ id: 'node-legacy', type: 'table', tableId: 'table-legacy', name: '舊表', parentId: null, order: 0 }] }, 'workspace');
    transaction.objectStore('tables').put({ id: 'table-legacy', name: '舊表', rowHeaderName: '項目', updatedAt: 100, changeRevision: 'legacy-semantic', columns: [{ id: 'column-legacy', name: '欄位', inputType: 'text', options: [] }], rows: Array.from({ length: 600 }, (_, index) => ({ id: `row-${index}`, name: `列 ${index}`, values: { 'column-legacy': `舊值 ${index}` } })) }, 'table-legacy');
    await new Promise<void>(resolve => { transaction.oncomplete = () => resolve(); });
    (window as any).legacyConnection = connection;
  });
  await page.addScriptTag({ url: `${site.origin}/fixture.js` });
  await expect.poll(() => page.evaluate(() => document.documentElement.hasAttribute('data-workspace-storage-blocked'))).toBe(true);
  await page.evaluate(() => (window as any).legacyConnection.close());
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    const initial = await api.db.loadWorkspaceInitial(); api.data = initial.data;
    const before = await api.readDisk();
    api.instrument(); api.failNextOrder = true;
    let failure = '';
    try { await api.db.saveWorkspace(api.data, { partial: true }); } catch (error) { failure = (error as Error).name; }
    const aborted = await api.readDisk();
    await api.edit(0, '早期編輯', 0, true);
    const migrated = await api.readDisk();
    const loaded = await api.db.loadWorkspace();
    return { failure, before, aborted, migrated, version: loaded.version, structure: loaded.structureRevision, count: loaded.tables[0].rows.length, value: loaded.tables[0].rows[0].values['column-legacy'] };
  });
  expect(result.before.chunks).toHaveLength(0);
  expect(result.before.tables[0].rows).toHaveLength(600);
  expect(result.before.meta).toContainEqual(expect.objectContaining({ storageRevision: 'legacy-storage', updatedAt: 100 }));
  expect(result.failure).toBe('AbortError');
  expect(result.aborted).toEqual(result.before);
  expect(result.migrated.chunks).toHaveLength(3);
  expect(result.migrated.orders).toHaveLength(3);
  expect(result.migrated.tables[0].storageFormat).toBe('row-chunks-v2');
  expect(result.version).toBe(1);
  expect(result.structure).toBe('legacy-structure');
  expect(result.count).toBe(600);
  expect(result.value).toBe('早期編輯');
});
