import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {} from './storageFixture';

let site: { origin: string; close: () => Promise<void> };
test.beforeAll(async () => {
  const directory = resolve('test-results/workspace-storage-fixture');
  await build({ configFile: false, logLevel: 'error', build: { emptyOutDir: false, outDir: directory, lib: { entry: resolve('tests/workspace-startup/storageFixture.ts'), name: 'WorkspaceStorageFixture', formats: ['iife'], fileName: () => 'fixture.js' } } });
  const server = createServer(async (request, response) => {
    if (request.url === '/fixture.js') { response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); response.end(await readFile(resolve(directory, 'fixture.js'))); }
    else { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(`<!doctype html><html><head><meta charset="utf-8"></head><body>${request.url === '/probe' ? '<script src="/fixture.js"></script>' : ''}</body></html>`); }
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server');
  site = { origin: `http://127.0.0.1:${address.port}`, close: async () => { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); } };
});
test.afterAll(async () => site.close());
let errors: string[];
test.beforeEach(async ({ page }) => { errors = []; page.on('pageerror', error => errors.push(error.message)); });
test.afterEach(() => expect(errors).toEqual([]));

test('dynamic attributes persist activation and incremental counts across browser reloads', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(10000);
    let table = api.data.tables[0];
    const columnId = table.columns[0].id;
    table = { ...table, rows: table.rows.map((row, index) => ({ ...row, values: { ...row.values, [columnId]: index < 6000 ? 'Common' : 'Rare' } })) };
    api.data = { ...api.data, tables: [table] };
    await api.db.saveWorkspace(api.data);
    const column = { ...table.columns[0], inputType: 'dynamic-select' as const };
    const revised = api.assignWorkspaceChangeRevisions(api.data, { ...api.data, tables: [{ ...table, columns: [column, ...table.columns.slice(1)] }] });
    api.data = api.dynamicOptionsCache.prepare(api.data, revised, { tableId: table.id, action: { type: 'update-column', before: table.columns[0], after: column } });
    await api.db.saveWorkspace(api.data);
    const activated = await api.readDisk();
    api.instrument();
    await api.edit(9999, 'Common');
    return { columnId, activated, edited: await api.readDisk(), writes: api.writes };
  });
  expect(result.activated.states[0].columnState[result.columnId].dynamicOptions.counts.map((item: { count: number }) => item.count)).toEqual([6000, 4000]);
  expect(result.edited.states[0].columnState[result.columnId].dynamicOptions.counts.map((item: { count: number }) => item.count)).toEqual([6001, 3999]);
  expect(result.writes.filter(write => write.store === 'rowChunks')).toHaveLength(1);
  expect(result.writes.filter(write => write.store === 'tables')).toHaveLength(0);
  expect(result.writes.filter(write => write.store === 'tableState')).toHaveLength(1);
  expect(new Set(result.writes.map(write => write.transaction)).size).toBe(1);

  await page.reload();
  const reopened = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    const initial = await api.db.loadWorkspaceInitial();
    api.instrument();
    const data = await api.db.loadWorkspace({ expectCurrentRevision: true });
    await api.db.flushWorkspaceSaves();
    return { counts: initial.data.tables[0].columns[0].dynamicOptions?.counts.map(item => item.count), options: new api.WorkspaceDynamicOptionsCache().getOptions(data.tables[0], data.tables[0].columns[0].id), writes: api.writes };
  });
  expect(reopened.counts).toEqual([6001, 3999]);
  expect(reopened.options).toEqual(['Common', 'Rare']);
  expect(reopened.writes).toEqual([]);
});

for (const activeTable of [true, false]) test(`legacy dynamic attributes rebuild once and persist only their column state (active table: ${activeTable})`, async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  await page.evaluate(async (activeTable) => {
    const api = window.workspaceStorageFixture;
    await api.initialize(600);
    const table = api.data.tables[0];
    api.data = api.model.ensureWorkspaceDynamicOptions({ ...api.data, tables: [{ ...table, columns: [{ ...table.columns[0], inputType: 'dynamic-select' }, ...table.columns.slice(1)] }] });
    if (!activeTable) api.data.activeNodeId = null;
    await api.db.saveWorkspace(api.data);
    const request = indexedDB.open('board-game-helper-workspace');
    const connection = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result); });
    const transaction = connection.transaction('tableState', 'readwrite');
    transaction.objectStore('tableState').put({ updatedAt: table.updatedAt, changeRevision: table.changeRevision }, table.id);
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error); });
    connection.close();
  }, activeTable);
  await page.reload();
  const repaired = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    const initial = await api.db.loadWorkspaceInitial();
    api.data = initial.data;
    api.instrument();
    await api.db.loadWorkspace({ expectCurrentRevision: true });
    await api.db.flushWorkspaceSaves();
    return { disk: await api.readDisk(), writes: api.writes, columnId: api.data.tables[0].columns[0].id, complete: initial.complete };
  });
  expect(repaired.complete).toBe(!activeTable);
  expect(repaired.disk.states[0].columnState[repaired.columnId].dynamicOptions.counts).toHaveLength(600);
  expect(repaired.writes.filter(write => write.store === 'rowChunks' || write.store === 'tables')).toEqual([]);
  expect(repaired.writes.filter(write => write.store === 'tableState')).toHaveLength(1);
  await page.reload();
  const writes = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.db.loadWorkspaceInitial();
    api.instrument();
    await api.db.loadWorkspace({ expectCurrentRevision: true });
    await api.db.flushWorkspaceSaves();
    return api.writes;
  });
  expect(writes).toEqual([]);
});

test('cleared dynamic object names remain empty without repeated storage repairs', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(1);
    const table = api.data.tables[0];
    const rowHeader = { ...api.model.getRowHeaderColumn(table), inputType: 'dynamic-select' as const };
    const next = { ...api.data, tables: [{ ...table, rowHeader, rows: [{ ...table.rows[0], name: null }] }] };
    api.data = api.dynamicOptionsCache.prepare(api.data, api.assignWorkspaceChangeRevisions(api.data, next));
    await api.db.saveWorkspace(api.data);
  });
  for (let reload = 0; reload < 2; reload += 1) {
    await page.reload();
    const result = await page.evaluate(async () => {
      const api = window.workspaceStorageFixture;
      api.data = (await api.db.loadWorkspaceInitial()).data;
      api.instrument();
      await api.db.loadWorkspace({ expectCurrentRevision: true });
      await api.db.flushWorkspaceSaves();
      const table = api.data.tables[0];
      return { name: table.rows[0].name, options: api.dynamicOptionsCache.getOptions(table, api.model.getRowHeaderColumn(table).id), writes: api.writes };
    });
    expect(result.name).toBeNull();
    expect(result.options).toEqual([]);
    expect(result.writes).toEqual([]);
  }
});

test('10k-row cell commits write one chunk and a new history entry in the same transaction', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(10000, 12);
    api.instrument();
    await api.edit(0, 'A');
    const first = [...api.writes];
    api.writes = [];
    await api.edit(256, 'B');
    return { first, second: api.writes, disk: await api.readDisk() };
  });
  for (const writes of [result.first, result.second]) {
    expect(writes.filter(write => write.store === 'rowChunks' && write.method === 'put')).toHaveLength(1);
    expect(writes.filter(write => write.store === 'tables')).toHaveLength(0);
    expect(writes.filter(write => write.store === 'meta' && write.key === 'workspace')).toHaveLength(0);
    expect(writes.filter(write => write.store === 'historyEntries')).toHaveLength(1);
    expect(new Set(writes.map(write => write.transaction)).size).toBe(1);
  }
  expect(result.disk.chunks).toHaveLength(40);
  expect(result.disk.chunks.every(chunk => chunk.count <= 256)).toBe(true);
  expect(result.disk.cells[0].map(cell => cell.value)).toEqual(['A', 'B', '資料 9999-0']);
  expect(result.disk.heads[0].past).toHaveLength(2);
  expect(result.disk.tables[0]).not.toHaveProperty('rows');
});

for (const failureMode of ['abort', 'quota'] as const) test(`${failureMode} failure leaves data/history unchanged and the next edit saves A and B`, async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async failureMode => {
    const api = window.workspaceStorageFixture;
    await api.initialize(600);
    const original = await api.readDisk();
    api.instrument(); api.failNextChunk = true; api.failureMode = failureMode;
    let failure = '';
    try { await api.edit(0, 'A'); } catch (error) { failure = (error as Error).name; }
    const aborted = await api.readDisk();
    api.writes = [];
    await api.edit(256, 'B');
    return { failure, original, aborted, recovered: await api.readDisk(), writes: api.writes };
  }, failureMode);
  expect(result.failure).toBe(failureMode === 'quota' ? 'QuotaExceededError' : 'AbortError');
  expect(result.aborted).toEqual(result.original);
  expect(result.writes.filter(write => write.store === 'rowChunks' && write.method === 'put')).toHaveLength(2);
  expect(result.recovered.cells[0].map(cell => cell.value)).toEqual(['A', 'B', '資料 599-0']);
  expect(result.recovered.entryIds).toHaveLength(2);
});

test('queued immutable snapshots preserve chunk identities and both cell edits', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(600);
    const original = await api.readDisk();
    api.instrument();
    const a = api.prepareCell(0, 'A');
    const saveA = api.db.saveWorkspace(a.data, a.options);
    const b = api.prepareCell(256, 'B');
    const saveB = api.db.saveWorkspace(b.data, b.options);
    await Promise.all([saveA, saveB]);
    return { original, disk: await api.readDisk(), writes: api.writes };
  });
  expect(result.disk.tables[0].chunkIds).toEqual(result.original.tables[0].chunkIds);
  expect(result.disk.cells[0].map(cell => cell.value)).toEqual(['A', 'B', '資料 599-0']);
  expect(result.writes.filter(write => write.store === 'rowChunks')).toHaveLength(2);
  expect(result.writes.filter(write => write.store === 'historyEntries')).toHaveLength(2);
});

test('reordering writes no chunks; top insert/delete keeps all other chunk identities', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(10000);
    const before = await api.readDisk();
    api.instrument();
    let table = api.data.tables[0];
    api.data = { ...api.data, tables: [{ ...table, rows: [...table.rows].reverse() }] };
    await api.db.saveWorkspace(api.data);
    const reordered = await api.readDisk(); const reorderWrites = [...api.writes];
    api.writes = [];
    table = api.data.tables[0];
    const row = { id: api.model.makeId('row'), name: '頂端新增', values: { [table.columns[0].id]: '新值' } };
    api.data = { ...api.data, tables: [{ ...table, rows: [row, ...table.rows] }] };
    await api.db.saveWorkspace(api.data);
    const inserted = await api.readDisk(); const insertWrites = [...api.writes];
    api.writes = [];
    api.data = { ...api.data, tables: [{ ...api.data.tables[0], rows: table.rows }] };
    await api.db.saveWorkspace(api.data);
    return { before, reordered, inserted, deleted: await api.readDisk(), reorderWrites, insertWrites, deleteWrites: api.writes };
  });
  expect(result.reorderWrites.filter(write => write.store === 'rowChunks')).toHaveLength(0);
  expect(result.reordered.tables[0].rowOrder).toEqual([...result.before.tables[0].rowOrder].reverse());
  expect(result.insertWrites.filter(write => write.store === 'rowChunks')).toHaveLength(1);
  expect(result.deleteWrites.filter(write => write.store === 'rowChunks')).toHaveLength(1);
  expect(result.inserted.tables[0].chunkIds).toEqual(result.before.tables[0].chunkIds);
  expect(result.deleted.tables[0].rowOrder).toEqual(result.reordered.tables[0].rowOrder);
});

test('partial pinned-table reads skip the active table and preserve an edit before remaining hydration', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(600, 2, 3);
    api.data = { ...api.data, bottomNavigationTableIds: [api.data.tables[1].id] };
    await api.db.saveWorkspace(api.data);
    const initial = await api.db.loadWorkspaceInitial();
    api.data = initial.data;
    const active = initial.data.tables[0];
    const reads: unknown[] = [];
    const original = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (this: IDBObjectStore, key: IDBValidKey | IDBKeyRange) { if (this.name === 'tables') reads.push(key); return original.call(this, key); };
    const pinned = await api.db.loadWorkspace({ expectCurrentRevision: true, tableIds: api.data.bottomNavigationTableIds });
    const pinnedReads = [...reads];
    api.data = pinned;
    const activeIndex = pinned.tables.findIndex(table => table.id === active.id);
    await api.edit(0, '首載後修改', activeIndex, true);
    const current = api.data.tables[activeIndex];
    reads.length = 0;
    const remaining = await api.db.loadWorkspace({ expectCurrentRevision: true });
    return { initialCount: initial.data.tables.length, pinnedCount: pinned.tables.length, pinnedReads, remainingReads: reads, activeId: active.id, pinnedId: initial.data.bottomNavigationTableIds![0], sameActive: remaining.tables.find(table => table.id === active.id) === current, count: remaining.tables.length, disk: await api.readDisk() };
  });
  expect(result.initialCount).toBe(1);
  expect(result.pinnedCount).toBe(2);
  expect(result.pinnedReads).toEqual([result.pinnedId]);
  expect(result.remainingReads).toHaveLength(1);
  expect(result.remainingReads).not.toContain(result.activeId);
  expect(result.sameActive).toBe(true);
  expect(result.count).toBe(3);
  expect(result.disk.cells.flat().some(cell => cell.value === '首載後修改')).toBe(true);
});

test('stale cross-tab revision cannot write either data or history', async ({ page, context }) => {
  await page.goto(`${site.origin}/probe`);
  await page.evaluate(() => window.workspaceStorageFixture.initialize());
  const peer = await context.newPage();
  await peer.goto(`${site.origin}/probe`);
  await peer.evaluate(async () => { const api = window.workspaceStorageFixture; api.data = await api.db.loadWorkspace(); await api.edit(0, '另一分頁'); });
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    const before = await api.readDisk();
    let failure = '';
    try { await api.edit(0, '舊分頁'); } catch (error) { failure = (error as Error).name; }
    return { failure, before, after: await api.readDisk() };
  });
  expect(result.failure).toBe('WorkspaceStorageConflictError');
  expect(result.after).toEqual(result.before);
});

test('deleting one table removes its chunks/state/history without touching another; clear/import is atomic', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(600, 2, 2);
    await api.edit(0, '保留'); await api.edit(0, '刪除', 1);
    const removedId = api.data.tables[1].id;
    api.data = { ...api.data, tables: api.data.tables.slice(0, 1), nodes: api.data.nodes.slice(0, 1) };
    await api.db.saveWorkspace(api.data, { deletedTableIds: [removedId] });
    const deleted = await api.readDisk();
    api.data = { ...api.data, tables: [{ ...api.data.tables[0], rows: [{ ...api.data.tables[0].rows[0], values: { [api.data.tables[0].columns[0].id]: '匯入取代' } }] }] };
    await api.db.saveWorkspace(api.data, { replaceTableIds: api.data.tables.map(table => table.id), history: { clearAll: true } });
    return { deleted, removedId, replaced: await api.readDisk() };
  });
  expect(result.deleted.tables).toHaveLength(1);
  expect(result.deleted.states).toHaveLength(1);
  expect(result.deleted.chunks.every(chunk => chunk.tableId !== result.removedId)).toBe(true);
  expect(result.deleted.heads).toHaveLength(1);
  expect(result.deleted.entryIds).toHaveLength(1);
  expect(result.replaced.chunks).toHaveLength(1);
  expect(result.replaced.entryIds).toHaveLength(0);
  expect(result.replaced.heads).toHaveLength(0);
  expect(result.replaced.cells[0][0].value).toBe('匯入取代');
});

test('missing chunks fail loudly instead of returning a shorter table', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const failure = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(600);
    const disk = await api.readDisk();
    const request = indexedDB.open('board-game-helper-workspace');
    const connection = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result); });
    const transaction = connection.transaction('rowChunks', 'readwrite');
    transaction.objectStore('rowChunks').delete([disk.chunks[0].tableId, disk.chunks[0].chunkId]);
    await new Promise<void>(resolve => { transaction.oncomplete = () => resolve(); });
    connection.close();
    try { await api.db.loadWorkspace(); return ''; } catch (error) { return (error as Error).name; }
  });
  expect(failure).toBe('WorkspaceStorageIntegrityError');
});

test('cross-chunk paste allocates a full-table overflow chunk and undo removes that empty chunk', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(512);
    const before = await api.readDisk();
    const table = api.data.tables[0];
    const columnId = table.columns[0].id;
    const row = { id: api.model.makeId('row'), name: '新增列', values: { [columnId]: null } };
    const action: Parameters<typeof api.history.applyWorkspaceTableHistoryAction>[2] = { type: 'paste-range', addedRows: [row], addedColumns: [], changes: [
      { rowId: table.rows[255].id, columnId, before: table.rows[255].values[columnId], after: 'A' },
      { rowId: table.rows[256].id, columnId, before: table.rows[256].values[columnId], after: 'B' },
      { rowId: row.id, columnId, before: null, after: 'C' },
    ] };
    const past = api.history.pushWorkspaceTableHistory(api.history.createEmptyWorkspaceTableHistory(table.id), { tableId: table.id, label: '貼上', action });
    api.instrument();
    api.data = api.history.applyWorkspaceTableHistoryAction(api.data, table.id, action, 'redo');
    await api.db.saveWorkspace(api.data, { mutation: { tableId: table.id, action }, history: { replace: [past] } });
    const pasted = await api.readDisk(); const pasteWrites = [...api.writes]; api.writes = [];
    api.data = api.history.applyWorkspaceTableHistoryAction(api.data, table.id, action, 'undo');
    await api.db.saveWorkspace(api.data, { mutation: { tableId: table.id, action }, history: { replace: [{ tableId: table.id, past: [], future: past.past }] } });
    const undone = await api.readDisk(); const undoWrites = [...api.writes];
    return { before, pasted, undone, pasteWrites, undoWrites };
  });
  expect(result.pasted.tables[0].rowOrder).toHaveLength(513);
  expect(result.pasted.chunks).toHaveLength(3);
  expect(result.pasteWrites.filter(write => write.store === 'rowChunks' && write.method === 'put')).toHaveLength(3);
  expect(result.undone.tables[0].rowOrder).toEqual(result.before.tables[0].rowOrder);
  expect(result.undone.chunks).toHaveLength(2);
  expect(result.undoWrites.filter(write => write.store === 'rowChunks' && write.method === 'delete')).toHaveLength(1);
  expect(result.undoWrites.filter(write => write.store === 'historyEntries')).toHaveLength(0);
  expect(result.undone.heads[0].future).toHaveLength(1);
});

test('column removal and undo rewrite affected chunks while retaining all original values', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(600);
    const table = api.data.tables[0];
    const column = table.columns[0];
    const action: Parameters<typeof api.history.applyWorkspaceTableHistoryAction>[2] = { type: 'remove-column', column, index: 0, values: Object.fromEntries(table.rows.map(row => [row.id, row.values[column.id]])) };
    const past = api.history.pushWorkspaceTableHistory(api.history.createEmptyWorkspaceTableHistory(table.id), { tableId: table.id, label: '刪欄', action });
    api.instrument();
    api.data = api.history.applyWorkspaceTableHistoryAction(api.data, table.id, action, 'redo');
    await api.db.saveWorkspace(api.data, { mutation: { tableId: table.id, action }, history: { replace: [past] } });
    const removed = await api.db.loadWorkspace(); const removeWrites = [...api.writes]; api.writes = [];
    api.data = api.history.applyWorkspaceTableHistoryAction(removed, table.id, action, 'undo');
    await api.db.saveWorkspace(api.data, { mutation: { tableId: table.id, action }, history: { replace: [{ tableId: table.id, past: [], future: past.past }] } });
    const restored = await api.db.loadWorkspace();
    return { columnAbsent: removed.tables[0].rows.every(row => !(column.id in row.values)), columnCount: removed.tables[0].columns.length, allRestored: restored.tables[0].rows.every((row, index) => row.values[column.id] === `資料 ${index}-0`), removeWrites, undoWrites: api.writes };
  });
  expect(result.columnAbsent).toBe(true);
  expect(result.columnCount).toBe(1);
  expect(result.allRestored).toBe(true);
  expect(result.removeWrites.filter(write => write.store === 'rowChunks')).toHaveLength(3);
  expect(result.undoWrites.filter(write => write.store === 'rowChunks')).toHaveLength(3);
  expect(result.undoWrites.filter(write => write.store === 'historyEntries')).toHaveLength(0);
});

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
  expect(result.tables[0].storageFormat).toBe('row-chunks-v1');
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
    api.instrument(); api.failNextChunk = true;
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
  expect(result.version).toBe(1);
  expect(result.structure).toBe('legacy-structure');
  expect(result.count).toBe(600);
  expect(result.value).toBe('早期編輯');
});
