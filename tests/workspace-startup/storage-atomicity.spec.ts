import { expect, test } from '@playwright/test';
import type { } from './storageFixture';
import { startStorageFixture } from './storageSupport';
let site: Awaited<ReturnType<typeof startStorageFixture>>;
test.beforeAll(async () => { site = await startStorageFixture('atomicity'); });
test.afterAll(async () => site.close());
let errors: string[];
test.beforeEach(async ({ page }) => { errors = []; page.on('pageerror', error => errors.push(error.message)); });
test.afterEach(() => expect(errors).toEqual([]));

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

for (const failureMode of ['abort', 'quota'] as const) test(`${failureMode} failure leaves data/history unchanged, hydration retains edits and the next edit saves A and B`, async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async failureMode => {
    const api = window.workspaceStorageFixture;
    await api.initialize(600, 2, 2);
    const [firstId, secondId] = api.data.tables.map(table => table.id);
    api.data = (await api.db.loadWorkspaceInitial()).data;
    const original = await api.readDisk();
    api.instrument(); api.failNextChunk = true; api.failureMode = failureMode;
    let failure = '';
    try { await api.edit(0, 'A'); } catch (error) { failure = (error as Error).name; }
    const aborted = await api.readDisk();
    const hydrated = await api.db.loadWorkspace({ expectCurrentRevision: true, tableIds: [secondId] });
    const retained = hydrated.tables.find(table => table.id === firstId)!;
    const retainedValue = retained.rows[0].values[retained.columns[0].id];
    const otherCount = hydrated.tables.find(table => table.id === secondId)!.rows.length;
    api.data = { ...api.data, tables: [retained, ...hydrated.tables.filter(table => table.id !== firstId)] };
    api.writes = [];
    await api.edit(256, 'B');
    return { failure, original, aborted, retainedValue, otherCount, recovered: await api.readDisk(), writes: api.writes };
  }, failureMode);
  expect(result.failure).toBe(failureMode === 'quota' ? 'QuotaExceededError' : 'AbortError');
  expect(result.aborted).toEqual(result.original);
  expect(result.retainedValue).toBe('A'); expect(result.otherCount).toBe(600);
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
  expect(result.reordered.orderedRowIds[0]).toEqual([...result.before.orderedRowIds[0]].reverse());
  expect(result.insertWrites.filter(write => write.store === 'rowChunks')).toHaveLength(1);
  expect(result.deleteWrites.filter(write => write.store === 'rowChunks')).toHaveLength(1);
  expect(result.inserted.tables[0].chunkIds).toEqual(result.before.tables[0].chunkIds);
  expect(result.deleted.orderedRowIds[0]).toEqual(result.reordered.orderedRowIds[0]);
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
  expect(result.pasted.orderedRowIds[0]).toHaveLength(513);
  expect(result.pasted.chunks).toHaveLength(3);
  expect(result.pasteWrites.filter(write => write.store === 'rowChunks' && write.method === 'put')).toHaveLength(3);
  expect(result.undone.orderedRowIds[0]).toEqual(result.before.orderedRowIds[0]);
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
