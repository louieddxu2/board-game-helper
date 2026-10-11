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
