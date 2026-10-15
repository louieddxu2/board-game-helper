import { expect, test } from '@playwright/test';
import type { } from './storageFixture';
import { startStorageFixture } from './storageSupport';

let site: Awaited<ReturnType<typeof startStorageFixture>>;
test.beforeAll(async () => { site = await startStorageFixture('sparse-column'); });
test.afterAll(async () => site.close());
let errors: string[];
test.beforeEach(async ({ page }) => { errors = []; page.on('pageerror', error => errors.push(error.message)); });
test.afterEach(() => expect(errors).toEqual([]));

const sparseColumnId = 'column-sparse-history';

test('appearance-only column edits persist metadata without rewriting row payloads', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(10_000, 2);
    const previous = api.data;
    const source = previous.tables[0];
    const column = source.columns[0];
    const prepared = api.prepareWorkspaceColumnSave(source, { ...column, backgroundColor: '#E8F0F7' });
    const revised = api.assignWorkspaceChangeRevisions(previous, { ...previous, tables: [prepared.table] });
    const mutation = { tableId: source.id, label: '設定欄位底色', action: {
      type: 'update-column' as const, before: column, after: prepared.table.columns[0], changes: prepared.changes,
    } };
    const history = api.history.pushWorkspaceTableHistory(api.history.createEmptyWorkspaceTableHistory(source.id), mutation);
    api.data = revised;
    api.instrument();
    api.writes = [];
    await api.db.saveWorkspace(revised, { mutation, history: { replace: [history] } });
    const reloaded = await api.db.loadWorkspace();
    const restored = reloaded.tables[0];
    return {
      backgroundColor: restored.columns[0].backgroundColor,
      payloadWrites: Object.fromEntries(['rowChunks', 'rowPages', 'rowOrderPages'].map(store => [store, api.writes.filter(write => write.store === store).length])),
      rowCount: restored.rows.length,
      firstValue: restored.rows[0].values[column.id],
    };
  });

  expect(result.backgroundColor).toBe('#E8F0F7');
  expect(result.payloadWrites).toEqual({ rowChunks: 0, rowPages: 0, rowOrderPages: 0 });
  expect(result.rowCount).toBe(10_000);
  expect(result.firstValue).toBe('資料 0-0');
});

test('10k-row add-column history preserves sparse rows and writes no row payloads', async ({ page, context }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async columnId => {
    const api = window.workspaceStorageFixture;
    await api.initialize(10_000, 2);
    const beforeTable = api.data.tables[0];
    const column = { id: columnId, name: '稀疏欄', inputType: 'text' as const, options: [] };
    const action: Parameters<typeof api.history.applyWorkspaceTableHistoryAction>[2] = { type: 'add-column', column, index: beforeTable.columns.length };
    const addedHistory = api.history.pushWorkspaceTableHistory(api.history.createEmptyWorkspaceTableHistory(beforeTable.id), { tableId: beforeTable.id, label: '新增屬性', action });
    const payloadStores = new Set(['rowChunks', 'rowPages', 'rowOrderPages']);
    const countPayloadWrites = (writes: typeof api.writes) => Object.fromEntries([...payloadStores].map(store => [store, writes.filter(write => write.store === store).length]));
    const save = async (data: typeof api.data, history: typeof addedHistory) => {
      api.writes = [];
      await api.db.saveWorkspace(data, { mutation: { tableId: beforeTable.id, action }, history: { replace: [history] } });
      return { payload: countPayloadWrites(api.writes), definitions: api.writes.filter(write => write.store === 'tables' && write.method === 'put').length, states: api.writes.filter(write => write.store === 'tableState' && write.method === 'put').length, heads: api.writes.filter(write => write.store === 'tableHeads' && write.method === 'put').length, entries: api.writes.filter(write => write.store === 'historyEntries' && write.method === 'put').length, historyHeads: api.writes.filter(write => write.store === 'history' && write.method === 'put').length };
    };

    api.data = api.history.applyWorkspaceTableHistoryAction(api.data, beforeTable.id, action, 'redo');
    const rowsSameAfterAdd = api.data.tables[0].rows === beforeTable.rows;
    api.instrument();
    const added = await save(api.data, addedHistory);
    return { rowsSameAfterAdd, added };
  }, sparseColumnId);

  expect(result.rowsSameAfterAdd).toBe(true);
  expect(result.added.payload).toEqual({ rowChunks: 0, rowPages: 0, rowOrderPages: 0 });
  expect(result.added.definitions).toBe(1);
  expect(result.added.states).toBe(1);
  expect(result.added.heads).toBe(1);
  expect(result.added.historyHeads).toBe(1);
  expect(result.added.entries).toBe(1);

  const fresh = await context.newPage();
  fresh.on('pageerror', error => errors.push(error.message));
  await fresh.goto(`${site.origin}/probe`);
  const reopened = await fresh.evaluate(async columnId => {
    const api = window.workspaceStorageFixture;
    const loaded = await api.db.loadWorkspace();
    const table = loaded.tables[0];
    const history = (await api.db.loadWorkspaceHistories()).get(table.id)!;
    const entry = history.past[0];
    const action = entry.action;
    const save = async (data: typeof loaded, nextHistory: typeof history) => {
      api.writes = [];
      await api.db.saveWorkspace(data, { mutation: { tableId: table.id, action }, history: { replace: [nextHistory] } });
      return Object.fromEntries(['rowChunks', 'rowPages', 'rowOrderPages'].map(store => [store, api.writes.filter(write => write.store === store).length]));
    };
    api.instrument();
    const undoneData = api.history.applyWorkspaceTableHistoryAction(loaded, table.id, action, 'undo');
    const undoneHistory = { ...history, past: [], future: [entry] };
    const undoPayload = await save(undoneData, undoneHistory);
    const redoneData = api.history.applyWorkspaceTableHistoryAction(undoneData, table.id, action, 'redo');
    const redoneHistory = { ...undoneHistory, past: [entry], future: [] };
    const redoPayload = await save(redoneData, redoneHistory);
    const final = await api.db.loadWorkspace();
    const finalTable = final.tables[0];
    return {
      columns: finalTable.columns.map(column => column.id),
      missingRows: finalTable.rows.filter(row => !Object.hasOwn(row.values, columnId)).length,
      rowCount: finalTable.rows.length,
      undoPayload,
      redoPayload,
    };
  }, sparseColumnId);
  await fresh.close();
  expect(reopened.columns).toContain(sparseColumnId);
  expect(reopened.missingRows).toBe(10_000);
  expect(reopened.rowCount).toBe(10_000);
  expect(reopened.undoPayload).toEqual({ rowChunks: 0, rowPages: 0, rowOrderPages: 0 });
  expect(reopened.redoPayload).toEqual({ rowChunks: 0, rowPages: 0, rowOrderPages: 0 });
});

test('first sparse-column edit writes one chunk and page, survives reload, and exports its value', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async columnId => {
    const api = window.workspaceStorageFixture;
    await api.initialize(10_000, 2);
    const original = api.data.tables[0];
    const addedColumn = { id: columnId, name: '稀疏欄', inputType: 'text' as const, options: [] };
    const addAction: Parameters<typeof api.history.applyWorkspaceTableHistoryAction>[2] = { type: 'add-column', column: addedColumn, index: original.columns.length };
    const addHistory = api.history.pushWorkspaceTableHistory(api.history.createEmptyWorkspaceTableHistory(original.id), { tableId: original.id, label: '新增屬性', action: addAction });
    api.data = api.history.applyWorkspaceTableHistoryAction(api.data, original.id, addAction, 'redo');
    await api.db.saveWorkspace(api.data, { mutation: { tableId: original.id, action: addAction }, history: { replace: [addHistory] } });

    const loaded = await api.db.loadWorkspace();
    api.data = loaded;
    const table = loaded.tables[0];
    const row = table.rows[5_000];
    const editAction: Parameters<typeof api.history.applyWorkspaceTableHistoryAction>[2] = { type: 'set-cell', rowId: row.id, columnId, before: null, after: '新欄值' };
    const currentHistory = (await api.db.loadWorkspaceHistories()).get(table.id)!;
    const editEntry = { id: 'sparse-column-edit', tableId: table.id, label: '編輯稀疏欄', createdAt: Date.now(), action: editAction };
    const editHistory = { ...currentHistory, past: [...currentHistory.past, editEntry], future: [] };
    const edited = api.history.applyWorkspaceTableHistoryAction(loaded, table.id, editAction, 'redo');
    api.instrument();
    api.writes = [];
    await api.db.saveWorkspace(edited, { mutation: { tableId: table.id, action: editAction }, history: { replace: [editHistory] } });
    const writes = [...api.writes];
    const reloaded = await api.db.loadWorkspace();
    const reloadedTable = reloaded.tables[0];
    const archive = await api.spreadsheet.exportWorkspaceArchive(reloaded);
    const imported = await api.spreadsheet.importWorkspaceArchive(archive);
    const importedTable = imported.data!.tables[0];
    return {
      chunkPuts: writes.filter(write => write.store === 'rowChunks' && write.method === 'put').length,
      pagePuts: writes.filter(write => write.store === 'rowPages' && write.method === 'put').length,
      orderPageWrites: writes.filter(write => write.store === 'rowOrderPages').length,
      reloadedValue: reloadedTable.rows[5_000].values[columnId],
      reloadedMissingRows: reloadedTable.rows.filter(item => !Object.hasOwn(item.values, columnId)).length,
      importedValue: importedTable.rows[5_000].values[columnId],
    };
  }, sparseColumnId);

  expect(result.chunkPuts).toBe(1);
  expect(result.pagePuts).toBe(1);
  expect(result.orderPageWrites).toBe(0);
  expect(result.reloadedValue).toBe('新欄值');
  expect(result.reloadedMissingRows).toBe(9_999);
  expect(result.importedValue).toBe('新欄值');
});

test('10k-row empty-column removal captures no values and keeps delete undo redo payload-free', async ({ page, context }) => {
  await page.goto(`${site.origin}/probe`);
  const removed = await page.evaluate(async columnId => {
    const api = window.workspaceStorageFixture;
    await api.initialize(10_000, 2);
    const original = api.data.tables[0];
    const column = { id: columnId, name: '稀疏欄', inputType: 'text' as const, options: [] };
    const addAction: Parameters<typeof api.history.applyWorkspaceTableHistoryAction>[2] = { type: 'add-column', column, index: original.columns.length };
    const addHistory = api.history.pushWorkspaceTableHistory(api.history.createEmptyWorkspaceTableHistory(original.id), { tableId: original.id, label: '新增屬性', action: addAction });
    const added = api.history.applyWorkspaceTableHistoryAction(api.data, original.id, addAction, 'redo');
    await api.db.saveWorkspace(added, { mutation: { tableId: original.id, action: addAction }, history: { replace: [addHistory] } });
    const loaded = await api.db.loadWorkspace();
    const table = loaded.tables[0];
    const candidate = {
      ...loaded,
      tables: loaded.tables.map(item => item.id === table.id ? { ...item, columns: item.columns.filter(item => item.id !== columnId) } : item),
    };
    const mutation = api.history.inferWorkspaceTableMutation(loaded, candidate);
    if (!mutation || mutation.action.type !== 'remove-column') throw new Error('Expected inferred remove-column action');
    const removedData = api.history.applyWorkspaceTableHistoryAction(loaded, table.id, mutation.action, 'redo');
    const history = (await api.db.loadWorkspaceHistories()).get(table.id)!;
    const removalHistory = api.history.pushWorkspaceTableHistory(history, mutation);
    const beforeDisk = await api.readDisk();
    api.data = removedData;
    api.instrument();
    api.writes = [];
    await api.db.saveWorkspace(removedData, { mutation, history: { replace: [removalHistory] } });
    const afterDisk = await api.readDisk();
    const payloadStores = ['rowChunks', 'rowPages', 'rowOrderPages'];
    const payload = Object.fromEntries(payloadStores.map(store => [store, api.writes.filter(write => write.store === store).length]));
    const ids = (disk: typeof beforeDisk) => ({
      chunks: disk.chunks.filter(chunk => chunk.tableId === table.id).map(chunk => chunk.chunkId),
      pages: disk.pages.filter(page => page.tableId === table.id).map(page => page.id),
      orders: disk.orders.filter(page => page.tableId === table.id).map(page => page.pageId),
    });
    return { tableId: table.id, values: Object.keys(mutation.action.values), payload, before: ids(beforeDisk), after: ids(afterDisk) };
  }, sparseColumnId);

  expect(removed.values).toEqual([]);
  expect(removed.payload).toEqual({ rowChunks: 0, rowPages: 0, rowOrderPages: 0 });
  expect(removed.after).toEqual(removed.before);

  const fresh = await context.newPage();
  fresh.on('pageerror', error => errors.push(error.message));
  await fresh.goto(`${site.origin}/probe`);
  const reopened = await fresh.evaluate(async ({ columnId, tableId }) => {
    const api = window.workspaceStorageFixture;
    const loaded = await api.db.loadWorkspace();
    const history = (await api.db.loadWorkspaceHistories()).get(tableId)!;
    const entry = history.past.at(-1)!;
    const action = entry.action;
    const payload = () => Object.fromEntries(['rowChunks', 'rowPages', 'rowOrderPages'].map(store => [store, api.writes.filter(write => write.store === store).length]));
    const save = async (data: typeof loaded, nextHistory: typeof history) => {
      api.writes = [];
      await api.db.saveWorkspace(data, { mutation: { tableId, action }, history: { replace: [nextHistory] } });
      return payload();
    };
    api.instrument();
    const undone = api.history.applyWorkspaceTableHistoryAction(loaded, tableId, action, 'undo');
    const undoneHistory = { ...history, past: history.past.slice(0, -1), future: [entry, ...history.future] };
    const undoneTable = undone.tables[0];
    const undoColumns = undoneTable.columns.map(column => column.id);
    const undoMissingRows = undoneTable.rows.filter(row => !Object.hasOwn(row.values, columnId)).length;
    const undoPayload = await save(undone, undoneHistory);
    const redone = api.history.applyWorkspaceTableHistoryAction(undone, tableId, action, 'redo');
    const redoneHistory = { ...undoneHistory, past: [...undoneHistory.past, entry], future: undoneHistory.future.slice(1) };
    const redoPayload = await save(redone, redoneHistory);
    const final = await api.db.loadWorkspace();
    return { columns: final.tables[0].columns.map(column => column.id), missingRows: final.tables[0].rows.filter(row => !Object.hasOwn(row.values, columnId)).length, undoColumns, undoMissingRows, undoPayload, redoPayload };
  }, { columnId: sparseColumnId, tableId: removed.tableId });
  await fresh.close();
  expect(reopened.undoColumns).toContain(sparseColumnId);
  expect(reopened.undoMissingRows).toBe(10_000);
  expect(reopened.columns).not.toContain(sparseColumnId);
  expect(reopened.missingRows).toBe(10_000);
  expect(reopened.undoPayload).toEqual({ rowChunks: 0, rowPages: 0, rowOrderPages: 0 });
  expect(reopened.redoPayload).toEqual({ rowChunks: 0, rowPages: 0, rowOrderPages: 0 });
});

test('10k-row explicit-null column removal reopens with zero payload writes on undo and redo', async ({ page, context }) => {
  await page.goto(`${site.origin}/probe`);
  const removed = await page.evaluate(async columnId => {
    const api = window.workspaceStorageFixture;
    await api.initialize(10_000, 2);
    const original = api.data.tables[0];
    const column = { id: columnId, name: '明確空值欄', inputType: 'text' as const, options: [] };
    api.data = {
      ...api.data,
      tables: api.data.tables.map(table => table.id !== original.id ? table : {
        ...table,
        columns: [...table.columns, column],
        rows: table.rows.map(row => ({ ...row, values: { ...row.values, [columnId]: null } })),
      }),
    };
    await api.db.saveWorkspace(api.data, { history: { clearAll: true } });
    const loaded = await api.db.loadWorkspace();
    const table = loaded.tables[0];
    const candidate = { ...loaded, tables: loaded.tables.map(item => item.id === table.id ? { ...item, columns: item.columns.filter(item => item.id !== columnId) } : item) };
    const mutation = api.history.inferWorkspaceTableMutation(loaded, candidate);
    if (!mutation || mutation.action.type !== 'remove-column') throw new Error('Expected inferred explicit-null remove-column action');
    const removalHistory = api.history.pushWorkspaceTableHistory(api.history.createEmptyWorkspaceTableHistory(table.id), mutation);
    const removedData = api.history.applyWorkspaceTableHistoryAction(loaded, table.id, mutation.action, 'redo');
    api.instrument();
    api.writes = [];
    await api.db.saveWorkspace(removedData, { mutation, history: { replace: [removalHistory] } });
    return {
      values: Object.keys(mutation.action.values),
      payload: Object.fromEntries(['rowChunks', 'rowPages', 'rowOrderPages'].map(store => [store, api.writes.filter(write => write.store === store).length])),
    };
  }, sparseColumnId);

  expect(removed.values).toEqual([]);
  expect(removed.payload).toEqual({ rowChunks: 0, rowPages: 0, rowOrderPages: 0 });

  const fresh = await context.newPage();
  fresh.on('pageerror', error => errors.push(error.message));
  await fresh.goto(`${site.origin}/probe`);
  const reopened = await fresh.evaluate(async ({ columnId }) => {
    const api = window.workspaceStorageFixture;
    api.instrument();
    api.reads = [];
    const loaded = await api.db.loadWorkspace();
    const table = loaded.tables[0];
    const history = (await api.db.loadWorkspaceHistories()).get(table.id)!;
    const entry = history.past.at(-1)!;
    const action = entry.action;
    const payloadStores = ['rowChunks', 'rowPages', 'rowOrderPages'];
    const save = async (data: typeof loaded, nextHistory: typeof history) => {
      api.writes = [];
      await api.db.saveWorkspace(data, { mutation: { tableId: table.id, action }, history: { replace: [nextHistory] } });
      return Object.fromEntries(payloadStores.map(store => [store, api.writes.filter(write => write.store === store).length]));
    };
    const loadReads = Object.fromEntries(payloadStores.map(store => [store, api.reads.filter(read => read.store === store).length]));
    const undone = api.history.applyWorkspaceTableHistoryAction(loaded, table.id, action, 'undo');
    const undoneHistory = { ...history, past: history.past.slice(0, -1), future: [entry, ...history.future] };
    const undoPayload = await save(undone, undoneHistory);
    const redone = api.history.applyWorkspaceTableHistoryAction(undone, table.id, action, 'redo');
    const redoneHistory = { ...undoneHistory, past: [...undoneHistory.past, entry], future: undoneHistory.future.slice(1) };
    const redoPayload = await save(redone, redoneHistory);
    const final = await api.db.loadWorkspace();
    const finalTable = final.tables[0];
    return {
      loadReads,
      undoColumns: undone.tables[0].columns.map(column => column.id),
      undoMissing: undone.tables[0].rows.filter(row => !Object.hasOwn(row.values, columnId)).length,
      redoPayload,
      undoPayload,
      columns: finalTable.columns.map(column => column.id),
      missing: finalTable.rows.filter(row => !Object.hasOwn(row.values, columnId)).length,
    };
  }, { columnId: sparseColumnId });
  await fresh.close();

  expect(reopened.loadReads.rowChunks).toBeGreaterThan(0);
  expect(reopened.loadReads.rowPages).toBe(0);
  expect(reopened.undoColumns).toContain(sparseColumnId);
  expect(reopened.undoMissing).toBe(10_000);
  expect(reopened.undoPayload).toEqual({ rowChunks: 0, rowPages: 0, rowOrderPages: 0 });
  expect(reopened.redoPayload).toEqual({ rowChunks: 0, rowPages: 0, rowOrderPages: 0 });
  expect(reopened.columns).not.toContain(sparseColumnId);
  expect(reopened.missing).toBe(10_000);
});

test('partially filled sparse-column removal rewrites only touched chunks and pages', async ({ page, context }) => {
  await page.goto(`${site.origin}/probe`);
  const removed = await page.evaluate(async columnId => {
    const api = window.workspaceStorageFixture;
    await api.initialize(10_000, 2);
    const original = api.data.tables[0];
    const column = { id: columnId, name: '稀疏欄', inputType: 'text' as const, options: [] };
    const addAction: Parameters<typeof api.history.applyWorkspaceTableHistoryAction>[2] = { type: 'add-column', column, index: original.columns.length };
    const addHistory = api.history.pushWorkspaceTableHistory(api.history.createEmptyWorkspaceTableHistory(original.id), { tableId: original.id, label: '新增屬性', action: addAction });
    const added = api.history.applyWorkspaceTableHistoryAction(api.data, original.id, addAction, 'redo');
    await api.db.saveWorkspace(added, { mutation: { tableId: original.id, action: addAction }, history: { replace: [addHistory] } });
    const loaded = await api.db.loadWorkspace();
    const table = loaded.tables[0];
    const indexes = [17, 5_000, 5_001, 7_777];
    const values = ['第一筆', '零', '空字串', '最後一筆'] as const;
    const editAction: Parameters<typeof api.history.applyWorkspaceTableHistoryAction>[2] = {
      type: 'set-cells', columnId, changes: indexes.map((index, position) => ({ rowId: table.rows[index].id, before: null, after: values[position] })),
    };
    const populated = api.history.applyWorkspaceTableHistoryAction(loaded, table.id, editAction, 'redo');
    const populatedHistory = api.history.pushWorkspaceTableHistory((await api.db.loadWorkspaceHistories()).get(table.id)!, { tableId: table.id, label: '填入稀疏欄', action: editAction });
    await api.db.saveWorkspace(populated, { mutation: { tableId: table.id, action: editAction }, history: { replace: [populatedHistory] } });
    const beforeRemoval = await api.db.loadWorkspace();
    const beforeTable = beforeRemoval.tables[0];
    const candidate = { ...beforeRemoval, tables: beforeRemoval.tables.map(item => item.id === beforeTable.id ? { ...item, columns: item.columns.filter(item => item.id !== columnId) } : item) };
    const mutation = api.history.inferWorkspaceTableMutation(beforeRemoval, candidate);
    if (!mutation || mutation.action.type !== 'remove-column') throw new Error('Expected inferred remove-column action');
    const removedData = api.history.applyWorkspaceTableHistoryAction(beforeRemoval, beforeTable.id, mutation.action, 'redo');
    const removalHistory = api.history.pushWorkspaceTableHistory(populatedHistory, mutation);
    const beforeDisk = await api.readDisk();
    const request = indexedDB.open('board-game-helper-workspace');
    const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const chunkTransaction = database.transaction('rowChunks', 'readonly');
    const storedChunks = await new Promise<any[]>((resolve, reject) => { const get = chunkTransaction.objectStore('rowChunks').getAll(); get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error); });
    database.close();
    api.data = removedData;
    api.instrument();
    api.writes = [];
    await api.db.saveWorkspace(removedData, { mutation, history: { replace: [removalHistory] } });
    const afterDisk = await api.readDisk();
    const affectedChunkIds = [...new Set(indexes.map(index => storedChunks.find(chunk => chunk.tableId === beforeTable.id && chunk.rows.some((row: { id: string }) => row.id === beforeTable.rows[index].id))?.chunkId).filter(Boolean))].sort();
    const affectedPageIds = [...new Set(indexes.map(index => beforeDisk.pages.find(page => page.tableId === beforeTable.id && page.rows.some(row => row.id === beforeTable.rows[index].id))?.id).filter(Boolean))].sort();
    const keys = (store: string) => api.writes.filter(write => write.store === store).map(write => Array.isArray(write.key) ? write.key[1] : write.key).sort();
    return {
      tableId: beforeTable.id,
      indexes,
      values,
      historyValues: Object.keys(mutation.action.values),
      expectedHistoryValues: indexes.map(index => beforeTable.rows[index].id),
      missingCaptured: Object.hasOwn(mutation.action.values, beforeTable.rows[0].id),
      before: { chunks: beforeDisk.chunks.filter(chunk => chunk.tableId === beforeTable.id).map(chunk => chunk.chunkId), pages: beforeDisk.pages.filter(page => page.tableId === beforeTable.id).map(page => page.id), orders: beforeDisk.orders.filter(page => page.tableId === beforeTable.id).map(page => page.pageId) },
      after: { chunks: afterDisk.chunks.filter(chunk => chunk.tableId === beforeTable.id).map(chunk => chunk.chunkId), pages: afterDisk.pages.filter(page => page.tableId === beforeTable.id).map(page => page.id), orders: afterDisk.orders.filter(page => page.tableId === beforeTable.id).map(page => page.pageId) },
      affectedChunkIds, affectedPageIds, writes: { chunks: keys('rowChunks'), pages: keys('rowPages'), orders: keys('rowOrderPages') },
    };
  }, sparseColumnId);

  expect(removed.historyValues).toEqual(removed.expectedHistoryValues);
  expect(removed.missingCaptured).toBe(false);
  expect(removed.writes.chunks).toEqual(removed.affectedChunkIds);
  expect(removed.writes.pages).toEqual(removed.affectedPageIds);
  expect(removed.writes.orders).toEqual([]);
  expect(removed.after.chunks).toEqual(removed.before.chunks);
  expect(removed.after.pages).toEqual(removed.before.pages);
  expect(removed.after.orders).toEqual(removed.before.orders);

  const fresh = await context.newPage();
  fresh.on('pageerror', error => errors.push(error.message));
  await fresh.goto(`${site.origin}/probe`);
  const restored = await fresh.evaluate(async ({ columnId, tableId, indexes, values }) => {
    const api = window.workspaceStorageFixture;
    const loaded = await api.db.loadWorkspace();
    const history = (await api.db.loadWorkspaceHistories()).get(tableId)!;
    const entry = history.past.at(-1)!;
    const action = entry.action;
    api.instrument();
    api.writes = [];
    const undone = api.history.applyWorkspaceTableHistoryAction(loaded, tableId, action, 'undo');
    const undoneHistory = { ...history, past: history.past.slice(0, -1), future: [entry, ...history.future] };
    await api.db.saveWorkspace(undone, { mutation: { tableId, action }, history: { replace: [undoneHistory] } });
    const writes = {
      chunks: api.writes.filter(write => write.store === 'rowChunks').map(write => Array.isArray(write.key) ? write.key[1] : write.key).sort(),
      pages: api.writes.filter(write => write.store === 'rowPages').map(write => Array.isArray(write.key) ? write.key[1] : write.key).sort(),
      orders: api.writes.filter(write => write.store === 'rowOrderPages').map(write => Array.isArray(write.key) ? write.key[1] : write.key).sort(),
    };
    const reloaded = await api.db.loadWorkspace();
    const table = reloaded.tables[0];
    return { writes, values: indexes.map(index => table.rows[index].values[columnId]), missing: !Object.hasOwn(table.rows[0].values, columnId), columns: table.columns.map(column => column.id) };
  }, { columnId: sparseColumnId, tableId: removed.tableId, indexes: removed.indexes, values: removed.values });
  await fresh.close();
  expect(restored.writes.chunks).toEqual(removed.affectedChunkIds);
  expect(restored.writes.pages).toEqual(removed.affectedPageIds);
  expect(restored.writes.orders).toEqual([]);
  expect(restored.values).toEqual(removed.values);
  expect(restored.missing).toBe(true);
  expect(restored.columns).toContain(sparseColumnId);
});

test('a failed sparse-column save keeps the pending edit for the next save', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async columnId => {
    const api = window.workspaceStorageFixture;
    await api.initialize(600, 2);
    const original = api.data.tables[0];
    const addedColumn = { id: columnId, name: '稀疏欄', inputType: 'text' as const, options: [] };
    const addAction: Parameters<typeof api.history.applyWorkspaceTableHistoryAction>[2] = { type: 'add-column', column: addedColumn, index: original.columns.length };
    const addHistory = api.history.pushWorkspaceTableHistory(api.history.createEmptyWorkspaceTableHistory(original.id), { tableId: original.id, label: '新增屬性', action: addAction });
    api.data = api.history.applyWorkspaceTableHistoryAction(api.data, original.id, addAction, 'redo');
    await api.db.saveWorkspace(api.data, { mutation: { tableId: original.id, action: addAction }, history: { replace: [addHistory] } });

    const firstRow = api.data.tables[0].rows[0];
    const firstAction: Parameters<typeof api.history.applyWorkspaceTableHistoryAction>[2] = { type: 'set-cell', rowId: firstRow.id, columnId, before: null, after: '第一次' };
    const firstData = api.history.applyWorkspaceTableHistoryAction(api.data, original.id, firstAction, 'redo');
    api.instrument();
    api.failNextChunk = true;
    let failure = '';
    try { await api.db.saveWorkspace(firstData, { mutation: { tableId: original.id, action: firstAction } }); }
    catch (error) { failure = (error as Error).name; }

    const laterRow = firstData.tables[0].rows[256];
    const laterAction: Parameters<typeof api.history.applyWorkspaceTableHistoryAction>[2] = { type: 'set-cell', rowId: laterRow.id, columnId, before: null, after: '第二次' };
    const laterData = api.history.applyWorkspaceTableHistoryAction(firstData, original.id, laterAction, 'redo');
    api.writes = [];
    await api.db.saveWorkspace(laterData, { mutation: { tableId: original.id, action: laterAction } });
    const reloaded = await api.db.loadWorkspace();
    const table = reloaded.tables[0];
    return {
      failure,
      laterChunkPuts: api.writes.filter(write => write.store === 'rowChunks' && write.method === 'put').length,
      firstValue: table.rows[0].values[columnId],
      laterValue: table.rows[256].values[columnId],
    };
  }, sparseColumnId);

  expect(result.failure).toBe('AbortError');
  expect(result.laterChunkPuts).toBe(2);
  expect(result.firstValue).toBe('第一次');
  expect(result.laterValue).toBe('第二次');
});
