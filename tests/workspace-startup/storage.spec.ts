import { expect, test } from '@playwright/test';
import type { } from './storageFixture';
import { startStorageFixture } from './storageSupport';
let site: Awaited<ReturnType<typeof startStorageFixture>>;
test.beforeAll(async () => { site = await startStorageFixture('projection'); });
test.afterAll(async () => site.close());
let errors: string[];
test.beforeEach(async ({ page }) => { errors = []; page.on('pageerror', error => errors.push(error.message)); });
test.afterEach(() => expect(errors).toEqual([]));

test('ten thousand rows open from a bounded display projection and cannot be saved or exported as a complete table', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  await page.evaluate(async () => { await window.workspaceStorageFixture.initialize(10000, 12, 2); });
  await page.reload();
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    api.instrument();
    const initial = await api.db.loadWorkspaceInitial({ paged: true });
    const reads = [...api.reads];
    const display = api.rowPages.workspaceWindowDisplayTable(initial.window!);
    let saveRejected = false, exportRejected = false, missingRejected = false;
    try { await api.db.saveWorkspace({ ...initial.data, tables: [{ ...display }] }, { partial: true }); } catch { saveRejected = true; }
    try { api.spreadsheet.exportWorkspaceXlsx(initial.data, { ...display }); } catch { exportRejected = true; }
    try { api.spreadsheet.exportWorkspaceXlsx(initial.data); } catch { missingRejected = true; }
    const tailIndex = api.rowPages.workspaceRowPageAt(initial.window!.head, initial.window!.head.rowCount - 1);
    const tail = await api.db.loadWorkspaceTableWindow(display.id, [tailIndex]);
    const full = await api.db.loadWorkspace({ expectCurrentRevision: true, tableIds: [display.id] });
    return { reads, loadedTables: initial.data.tables.length, rowCount: initial.window!.head.rowCount, first: display.rows[0].name, count: display.rows.length, last: tail!.pages[0].rows.at(-1)!.name,
      completeCount: full.tables[0].rows.length, saveRejected, exportRejected, missingRejected };
  });
  expect(result.loadedTables).toBe(0);
  expect(result.rowCount).toBe(10000);
  expect(result.count).toBe(128);
  expect(result.first).toBe('項目 0'); expect(result.last).toBe('項目 9999');
  expect(result.completeCount).toBe(10000);
  expect(result.saveRejected && result.exportRejected && result.missingRejected).toBe(true);
  expect(result.reads.filter(read => read.store === 'rowPages')).toHaveLength(1);
  expect(result.reads.every(read => ['meta', 'tableHeads', 'rowPages'].includes(read.store))).toBe(true);
});

test('a legacy transposed row head still opens from a bounded paged projection', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(10000, 12);
    const tableId = api.data.tables[0].id;
    const request = indexedDB.open('board-game-helper-workspace');
    const connection = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const transaction = connection.transaction('tableHeads', 'readwrite');
    const store = transaction.objectStore('tableHeads');
    const head = await new Promise<any>((resolve, reject) => { const get = store.get(tableId); get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error); });
    store.put({ ...head, definition: { ...head.definition, transposed: true } }, tableId);
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
    connection.close();

    api.instrument();
    const initial = await api.db.loadWorkspaceInitial({ paged: true });
    return { loadedTables: initial.data.tables.length, complete: initial.complete, progressive: initial.progressive, transposed: initial.window?.head.definition.transposed, rowCount: initial.window?.head.rowCount, reads: api.reads };
  });

  expect(result.loadedTables).toBe(0);
  expect(result.complete).toBe(false);
  expect(result.progressive).toBe(true);
  expect(result.transposed).toBe(true);
  expect(result.rowCount).toBe(10000);
  expect(result.reads.filter(read => read.store === 'rowPages')).toHaveLength(1);
  expect(result.reads.some(read => read.store === 'tables' || read.store === 'rowChunks')).toBe(false);
  expect(result.reads.every(read => ['meta', 'tableHeads', 'rowPages'].includes(read.store))).toBe(true);
});

test('display pages follow manual ordering and single-cell edits update only the affected page atomically', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(10000);
    const source = api.data.tables[0];
    api.data = { ...api.data, tables: [{ ...source, rows: [...source.rows].reverse() }] };
    await api.db.saveWorkspace(api.data);
    api.instrument();
    await api.edit(256, '只更改這格');
    const writes = [...api.writes];
    const diskHead = (await api.readDisk()).tableHeads.find(head => head.definition.id === source.id)!;
    const middleIndex = api.rowPages.workspaceRowPageAt(diskHead, 256);
    const lastIndex = api.rowPages.workspaceRowPageAt(diskHead, diskHead.rowCount - 1);
    const projection = await api.db.loadWorkspaceTableWindow(source.id, [0, middleIndex, lastIndex]);
    const editedRowId = api.data.tables[0].rows[256].id;
    const editedRow = projection!.pages.flatMap(page => page.rows).find(row => row.id === editedRowId)!;
    return { writes, first: projection!.pages[0].rows[0].name, value: editedRow.values[source.columns[0].id], last: projection!.pages.at(-1)!.rows.at(-1)!.name };
  });
  expect(result.first).toBe('項目 9999'); expect(result.last).toBe('項目 0');
  expect(result.value).toBe('只更改這格');
  expect(result.writes.filter(write => write.store === 'rowPages' && write.method === 'put')).toHaveLength(1);
  expect(result.writes.filter(write => write.store === 'rowChunks' && write.method === 'put')).toHaveLength(1);
  expect(new Set(result.writes.map(write => write.transaction)).size).toBe(1);
});

test('missing display pages and cross-tab stale reads fail without returning a partial table', async ({ page, context }) => {
  await page.goto(`${site.origin}/probe`);
  const id = await page.evaluate(async () => { const api = window.workspaceStorageFixture; await api.initialize(600); return api.data.tables[0].id; });
  const other = await context.newPage();
  await other.goto(`${site.origin}/probe`);
  await other.evaluate(async () => { await window.workspaceStorageFixture.db.loadWorkspaceInitial({ paged: true }); });
  await page.evaluate(async () => { await window.workspaceStorageFixture.edit(0, '另一頁更新'); });
  const conflict = await other.evaluate(async id => {
    try { await window.workspaceStorageFixture.db.loadWorkspaceTableWindow(id, [0]); return ''; } catch (error) { return (error as Error).name; }
  }, id);
  expect(conflict).toBe('WorkspaceStorageConflictError');
  await other.close();
  await page.evaluate(async id => {
    const initial = await window.workspaceStorageFixture.db.loadWorkspaceInitial({ paged: true });
    const head = initial.window!.head;
    const pageKey = head.format === 'row-blocks-v1' ? head.blocks[0].id : 0;
    const request = indexedDB.open('board-game-helper-workspace');
    const connection = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result); });
    const transaction = connection.transaction('rowPages', 'readwrite');
    transaction.objectStore('rowPages').delete([id, pageKey]);
    await new Promise<void>(resolve => { transaction.oncomplete = () => resolve(); }); connection.close();
  }, id);
  expect(await page.evaluate(async () => {
    try { await window.workspaceStorageFixture.db.loadWorkspaceInitial({ paged: true }); return ''; } catch (error) { return (error as Error).name; }
  })).toBe('WorkspaceStorageIntegrityError');
});

test('restored search and sorting request complete data and never evaluate only the loaded page', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  await page.evaluate(async () => { await window.workspaceStorageFixture.initialize(600); });
  await page.reload();
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    const initial = await api.db.loadWorkspaceInitial({ paged: true });
    const head = initial.window!.head;
    const view = { searchOpen: true, searchQuery: '', headerFilters: {}, scrollTop: 0, scrollLeft: 0 };
    localStorage.setItem('board-game-helper-workspace-view-state', JSON.stringify({ tables: { [head.definition.id]: view } }));
    const searched = await api.db.loadWorkspaceInitial({ paged: true });
    localStorage.setItem('board-game-helper-workspace-view-state', JSON.stringify({ tables: { [head.definition.id]: { ...view, searchOpen: false, headerFilters: { [`column:${head.definition.columns[0].id}`]: { includedKeys: null, sort: 'desc' } } } } }));
    const sorted = await api.db.loadWorkspaceInitial({ paged: true });
    return { searched: searched.data.tables[0].rows.length, sorted: sorted.data.tables[0].rows.length, noWindow: !searched.window && !sorted.window };
  });
  expect(result).toEqual({ searched: 600, sorted: 600, noWindow: true });
});

test('saved column conversions persist rows, counts and original values for undo across reloads', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const converted = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(600);
    const source = api.data.tables[0];
    const column = { ...source.columns[0], inputType: 'link' as const };
    const table = { ...source, columns: [column, ...source.columns.slice(1)], rows: source.rows.map((row, index) => ({
      ...row, values: { ...row.values, [column.id]: { url: `http://example.com/game/${index}`, label: index < 400 ? 'Common' : 'Rare' } },
    })) };
    api.data = api.assignWorkspaceChangeRevisions(api.data, { ...api.data, tables: [table] });
    await api.db.saveWorkspace(api.data);
    const previous = api.data;
    const prepared = api.prepareWorkspaceColumnSave(previous.tables[0], { ...column, inputType: 'dynamic-select' });
    const mutation = { tableId: table.id, label: '設定屬性', action: {
      type: 'update-column' as const, before: column, after: prepared.table.columns[0], changes: prepared.changes,
    } };
    api.data = api.dynamicOptionsCache.prepare(previous, api.assignWorkspaceChangeRevisions(previous, { ...previous, tables: [prepared.table] }), mutation);
    const history = api.history.pushWorkspaceTableHistory(api.history.createEmptyWorkspaceTableHistory(table.id), mutation);
    api.instrument();
    await api.db.saveWorkspace(api.data, { mutation, history: { replace: [history] } });
    return { disk: await api.readDisk(), writes: api.writes, columnId: column.id };
  });
  expect(converted.disk.cells[0].map(cell => cell.value)).toEqual(['Common', 'Common', 'Rare']);
  expect(converted.disk.states[0].columnState[converted.columnId].dynamicOptions.counts.map((item: { count: number }) => item.count)).toEqual([400, 200]);
  expect(converted.writes.filter(write => write.store === 'rowChunks')).toHaveLength(3);
  expect(converted.writes.filter(write => write.store === 'historyEntries')).toHaveLength(1);
  expect(new Set(converted.writes.map(write => write.transaction)).size).toBe(1);

  await page.reload();
  const reopened = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    api.data = (await api.db.loadWorkspaceInitial()).data;
    const table = api.data.tables[0];
    const histories = await api.db.loadWorkspaceHistories();
    const action = histories.get(table.id)!.past.at(-1)!.action;
    if (action.type !== 'update-column') throw new Error('Missing column conversion history');
    const loaded = { values: table.rows.map(row => row.values[table.columns[0].id]), options: api.dynamicOptionsCache.getOptions(table, table.columns[0].id) };
    const previous = api.data;
    const undo = api.history.applyWorkspaceTableHistoryAction(previous, table.id, action, 'undo');
    api.data = api.dynamicOptionsCache.prepare(previous, api.assignWorkspaceChangeRevisions(previous, undo), { tableId: table.id, action }, 'undo');
    await api.db.saveWorkspace(api.data, { mutation: { tableId: table.id, action } });
    return { loaded, undoneDisk: await api.readDisk() };
  });
  expect(reopened.loaded.values.filter(value => value === 'Common')).toHaveLength(400);
  expect(reopened.loaded.values.filter(value => value === 'Rare')).toHaveLength(200);
  expect(reopened.loaded.options).toEqual(['Common', 'Rare']);
  expect(reopened.undoneDisk.cells[0].map(cell => cell.value)).toEqual([
    { url: 'http://example.com/game/0', label: 'Common' },
    { url: 'http://example.com/game/256', label: 'Common' },
    { url: 'http://example.com/game/599', label: 'Rare' },
  ]);
  await page.reload();
  expect(await page.evaluate(async () => {
    const table = (await window.workspaceStorageFixture.db.loadWorkspaceInitial()).data.tables[0];
    return { inputType: table.columns[0].inputType, value: table.rows[0].values[table.columns[0].id] };
  })).toEqual({ inputType: 'link', value: { url: 'http://example.com/game/0', label: 'Common' } });
});

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
    return { disk: await api.readDisk(), writes: api.writes, columnId: api.data.tables[0].columns[0].id, complete: initial.complete, initialStatistics: initial.data.tables[0].columns[0].dynamicOptions };
  });
  expect(repaired.complete).toBe(!activeTable);
  // The first visible active table must not wait for a full-column statistics rebuild.
  expect(repaired.initialStatistics).toBeUndefined();
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
