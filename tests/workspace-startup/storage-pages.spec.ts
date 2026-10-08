import { expect, test } from '@playwright/test';
import type { } from './storageFixture';
import { startStorageFixture } from './storageSupport';

let site: Awaited<ReturnType<typeof startStorageFixture>>;
test.beforeAll(async () => { site = await startStorageFixture('pages'); });
test.afterAll(async () => site.close());
let errors: string[];
test.beforeEach(async ({ page }) => { errors = []; page.on('pageerror', error => errors.push(error.message)); });
test.afterEach(() => expect(errors).toEqual([]));

test('appending one row writes one tail page and keeps preceding pages byte-for-byte unchanged', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(10_000, 2);
    const before = await api.readDisk();
    const table = api.data.tables[0];
    const row = { id: api.model.makeId('row'), name: '新增列', values: Object.fromEntries(table.columns.map(column => [column.id, null])) };
    const action: Parameters<typeof api.history.applyWorkspaceTableHistoryAction>[2] = { type: 'add-row', row, index: table.rows.length };
    const history = api.history.pushWorkspaceTableHistory(api.history.createEmptyWorkspaceTableHistory(table.id), { tableId: table.id, label: '新增物件', action });
    api.data = api.history.applyWorkspaceTableHistoryAction(api.data, table.id, action, 'redo');
    api.instrument();
    await api.db.saveWorkspace(api.data, { mutation: { tableId: table.id, action }, history: { replace: [history] } });
    const after = await api.readDisk();
    const initialHead = before.tableHeads[0];
    const tailId = initialHead.blocks.at(-1).id;
    return {
      pagePuts: api.writes.filter(write => write.store === 'rowPages' && write.method === 'put').length,
      chunkPuts: api.writes.filter(write => write.store === 'rowChunks' && write.method === 'put').length,
      oldPagesSame: before.pages.filter(page => page.id !== tailId).every(page => JSON.stringify(page) === JSON.stringify(after.pages.find(next => next.id === page.id))),
      tail: after.pages.find(page => page.id === tailId)?.rows.at(-1)?.id,
      rowCount: after.tableHeads[0].rowCount,
    };
  });
  expect(result.pagePuts).toBe(1);
  expect(result.chunkPuts).toBe(1);
  expect(result.oldPagesSame).toBe(true);
  expect(result.tail).toBeTruthy();
  expect(result.rowCount).toBe(10_001);
});

test('same-page, cross-page, and full-span moves write only affected projection pages and no row chunks', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(512);
    const table = api.data.tables[0];
    let history = api.history.createEmptyWorkspaceTableHistory(table.id);
    const commit = async (action: Parameters<typeof api.history.applyWorkspaceTableHistoryAction>[2]) => {
      api.data = api.history.applyWorkspaceTableHistoryAction(api.data, table.id, action, 'redo');
      history = api.history.pushWorkspaceTableHistory(history, { tableId: table.id, label: '調整順序', action });
      api.writes = [];
      await api.db.saveWorkspace(api.data, { mutation: { tableId: table.id, action }, history: { replace: [history] } });
      return { pages: api.writes.filter(write => write.store === 'rowPages' && write.method === 'put').length, chunks: api.writes.filter(write => write.store === 'rowChunks').length };
    };
    api.instrument();
    const same = await commit({ type: 'move-row', rowId: table.rows[0].id, beforeIndex: 0, afterIndex: 1 });
    const cross = await commit({ type: 'move-row', rowId: table.rows[0].id, beforeIndex: 1, afterIndex: 130 });
    const full = await commit({ type: 'move-row', rowId: table.rows[1].id, beforeIndex: 0, afterIndex: 511 });
    const saved = await api.db.loadWorkspace({ tableIds: [table.id] });
    const loadedHistories = await api.db.loadWorkspaceHistories();
    const loadedHistory = loadedHistories.get(table.id)!;
    const last = loadedHistory.past.at(-1)!;
    const undoData = api.history.applyWorkspaceTableHistoryAction(saved, table.id, last.action, 'undo');
    const undoHistory = { ...loadedHistory, past: loadedHistory.past.slice(0, -1), future: [last, ...loadedHistory.future] };
    api.data = undoData;
    await api.db.saveWorkspace(api.data, { mutation: { tableId: table.id, action: last.action }, history: { replace: [undoHistory] } });
    const afterUndo = await api.db.loadWorkspace({ tableIds: [table.id] });
    const afterUndoHistory = (await api.db.loadWorkspaceHistories()).get(table.id)!;
    const redoEntry = afterUndoHistory.future[0];
    const redoData = api.history.applyWorkspaceTableHistoryAction(afterUndo, table.id, redoEntry.action, 'redo');
    const redoHistory = { ...afterUndoHistory, past: [...afterUndoHistory.past, redoEntry], future: afterUndoHistory.future.slice(1) };
    api.data = redoData;
    await api.db.saveWorkspace(api.data, { mutation: { tableId: table.id, action: redoEntry.action }, history: { replace: [redoHistory] } });
    const reloaded = await api.db.loadWorkspace({ tableIds: [table.id] });
    return {
      same, cross, full,
      historyType: last.action.type,
      historyKeys: Object.keys(last.action),
      undoFirst: afterUndo.tables[0].rows[0].id,
      finalFirst: reloaded.tables[0].rows[0].id,
      persistedFirst: saved.tables[0].rows[0].id,
    };
  });
  expect(result.same).toEqual({ pages: 1, chunks: 0 });
  expect(result.cross).toEqual({ pages: 2, chunks: 0 });
  expect(result.full).toEqual({ pages: 2, chunks: 0 });
  expect(result.historyType).toBe('move-row');
  expect(result.historyKeys).toEqual(['type', 'rowId', 'beforeIndex', 'afterIndex']);
  expect(result.undoFirst).not.toBe(result.persistedFirst);
  expect(result.finalFirst).toBe(result.persistedFirst);
});

test('tail and boundary deletions delete obsolete pages and preserve reload/export order', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(257);
    api.instrument();
    const table = api.data.tables[0];
    const expectedFirst = table.rows[0].id;
    const tailAction: Parameters<typeof api.history.applyWorkspaceTableHistoryAction>[2] = { type: 'remove-row', row: table.rows.at(-1)!, index: 256 };
    api.data = api.history.applyWorkspaceTableHistoryAction(api.data, table.id, tailAction, 'redo');
    await api.db.saveWorkspace(api.data, { mutation: { tableId: table.id, action: tailAction } });
    const tailWrites = [...api.writes];
    api.writes = [];
    const boundaryTable = api.data.tables[0];
    const expectedLast = boundaryTable.rows.at(-1)!.id;
    const boundaryAction: Parameters<typeof api.history.applyWorkspaceTableHistoryAction>[2] = { type: 'remove-row', row: boundaryTable.rows[128], index: 128 };
    api.data = api.history.applyWorkspaceTableHistoryAction(api.data, table.id, boundaryAction, 'redo');
    await api.db.saveWorkspace(api.data, { mutation: { tableId: table.id, action: boundaryAction } });
    const boundaryWrites = [...api.writes];
    const disk = await api.readDisk();
    const reloaded = await api.db.loadWorkspace({ tableIds: [table.id] });
    const archive = await api.spreadsheet.exportWorkspaceArchive(reloaded);
    const imported = await api.spreadsheet.importWorkspaceArchive(archive);
    return {
      tailDeletes: tailWrites.filter(write => write.store === 'rowPages' && write.method === 'delete').length,
      boundaryPuts: boundaryWrites.filter(write => write.store === 'rowPages' && write.method === 'put').length,
      rowCount: disk.tableHeads[0].rowCount,
      first: reloaded.tables[0].rows[0].id,
      expectedFirst,
      last: reloaded.tables[0].rows.at(-1)?.id,
      expectedLast,
      importedRows: imported.data?.tables[0].rows.length,
    };
  });
  expect(result.tailDeletes).toBe(1);
  expect(result.boundaryPuts).toBe(1);
  expect(result.rowCount).toBe(255);
  expect(result.first).toBe(result.expectedFirst);
  expect(result.last).toBe(result.expectedLast);
  expect(result.importedRows).toBe(255);
});

for (const failureMode of ['abort', 'quota'] as const) test(`${failureMode} page write failure is atomic and a later save recovers`, async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async failureMode => {
    const api = window.workspaceStorageFixture;
    await api.initialize(256);
    const before = await api.readDisk();
    const table = api.data.tables[0];
    const row = { id: api.model.makeId('row'), name: '待保存', values: Object.fromEntries(table.columns.map(column => [column.id, null])) };
    const action: Parameters<typeof api.history.applyWorkspaceTableHistoryAction>[2] = { type: 'add-row', row, index: table.rows.length };
    const history = api.history.pushWorkspaceTableHistory(api.history.createEmptyWorkspaceTableHistory(table.id), { tableId: table.id, label: '新增物件', action });
    api.data = api.history.applyWorkspaceTableHistoryAction(api.data, table.id, action, 'redo');
    api.instrument();
    api.failNextPage = true; api.failureMode = failureMode;
    let failure = '';
    try { await api.db.saveWorkspace(api.data, { mutation: { tableId: table.id, action }, history: { replace: [history] } }); } catch (error) { failure = (error as Error).name; }
    const aborted = await api.readDisk();
    const currentTable = api.data.tables[0];
    const columnId = currentTable.columns[0].id;
    const editAction: Parameters<typeof api.history.applyWorkspaceTableHistoryAction>[2] = {
      type: 'set-cell', rowId: currentTable.rows[0].id, columnId,
      before: currentTable.rows[0].values[columnId], after: '後續編輯',
    };
    const combinedHistory = api.history.pushWorkspaceTableHistory(history, { tableId: table.id, label: '後續編輯', action: editAction });
    api.data = api.history.applyWorkspaceTableHistoryAction(api.data, table.id, editAction, 'redo');
    api.writes = [];
    await api.db.saveWorkspace(api.data, { mutation: { tableId: table.id, action: editAction }, history: { replace: [combinedHistory] } });
    const recovered = await api.readDisk();
    const reloaded = await api.db.loadWorkspace({ tableIds: [table.id] });
    const stable = (disk: Awaited<ReturnType<typeof api.readDisk>>) => ({ meta: disk.meta, tables: disk.tables, states: disk.states, chunks: disk.chunks, heads: disk.heads, tableHeads: disk.tableHeads, pages: disk.pages, entryIds: disk.entryIds });
    return { failure, unchanged: JSON.stringify(stable(aborted)) === JSON.stringify(stable(before)), recoveredCount: recovered.tableHeads[0].rowCount, recoveredTail: recovered.pages.at(-1)?.rows.at(-1)?.id, recoveredEdit: reloaded.tables[0].rows[0].values[columnId], historyCount: recovered.heads[0]?.past.length };
  }, failureMode);
  expect(result.failure).toBe(failureMode === 'quota' ? 'QuotaExceededError' : 'AbortError');
  expect(result.unchanged).toBe(true);
  expect(result.recoveredCount).toBe(257);
  expect(result.recoveredTail).toBeTruthy();
  expect(result.recoveredEdit).toBe('後續編輯');
  expect(result.historyCount).toBe(2);
});
