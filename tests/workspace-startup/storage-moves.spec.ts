import { expect, test } from '@playwright/test';
import type { } from './storageFixture';
import { startStorageFixture } from './storageSupport';

let site: Awaited<ReturnType<typeof startStorageFixture>>;
test.beforeAll(async () => { site = await startStorageFixture('moves'); });
test.afterAll(async () => site.close());
let errors: string[];
test.beforeEach(async ({ page }) => { errors = []; page.on('pageerror', error => errors.push(error.message)); });
test.afterEach(() => expect(errors).toEqual([]));

const forbiddenReads = (reads: Array<{ store: string }>) => reads.filter(read => ['rowChunks', 'rowOrderPages', 'rowPages', 'historyEntries'].includes(read.store));

test('certified moves keep 10,000-row endpoints and bounded order/display writes', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(10_000, 2);
    api.instrument();
    const originalIds = { first: api.data.tables[0].rows[0].id, second: api.data.tables[0].rows[1].id, last: api.data.tables[0].rows.at(-1)!.id };
    const commit = async (from: number, to: number) => {
      const table = api.data.tables[0];
      const action: Parameters<typeof api.history.applyWorkspaceTableHistoryAction>[2] = { type: 'move-row', rowId: table.rows[from].id, beforeIndex: from, afterIndex: to };
      api.data = api.history.applyWorkspaceTableHistoryAction(api.data, table.id, action, 'redo');
      api.writes = []; api.reads = [];
      await api.db.saveWorkspace(api.data, { mutation: { tableId: table.id, action } });
      return { writes: [...api.writes], reads: [...api.reads], first: api.data.tables[0].rows[0].id, last: api.data.tables[0].rows.at(-1)?.id };
    };
    const firstToLast = await commit(0, 9_999);
    const lastToFirst = await commit(9_999, 0);
    const persisted = await api.db.loadWorkspace({ tableIds: [api.data.tables[0].id] });
    return {
      firstToLast: { ...firstToLast, persistedFirst: persisted.tables[0].rows[0].id },
      lastToFirst,
      originalIds,
    };
  });
  for (const move of [result.firstToLast, result.lastToFirst]) {
    expect(move.writes.filter((write: { store: string; method: string }) => write.store === 'rowChunks')).toEqual([]);
    expect(move.writes.filter((write: { store: string; method: string }) => write.store === 'rowOrderPages' && write.method === 'put').length).toBeLessThanOrEqual(3);
    expect(move.writes.filter((write: { store: string; method: string }) => write.store === 'rowPages' && write.method === 'put').length).toBeLessThanOrEqual(3);
    expect(forbiddenReads(move.reads)).toEqual([]);
  }
  expect(result.firstToLast.first).toBe(result.originalIds.second);
  expect(result.firstToLast.last).toBe(result.originalIds.first);
  expect(result.lastToFirst.first).toBe(result.originalIds.first);
  expect(result.firstToLast.persistedFirst).toBe(result.originalIds.first);
});

test('keeps same-page, cross-boundary, full-order-page, and vanished-source moves local', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    api.instrument();
    const run = async (rows: number, from: number, to: number) => {
      await api.initialize(rows, 2);
      const table = api.data.tables[0];
      const action: Parameters<typeof api.history.applyWorkspaceTableHistoryAction>[2] = { type: 'move-row', rowId: table.rows[from].id, beforeIndex: from, afterIndex: to };
      api.data = api.history.applyWorkspaceTableHistoryAction(api.data, table.id, action, 'redo');
      api.writes = []; api.reads = [];
      await api.db.saveWorkspace(api.data, { mutation: { tableId: table.id, action } });
      return { writes: [...api.writes], reads: [...api.reads] };
    };
    return {
      samePage: await run(512, 10, 20),
      crossBoundary: await run(512, 127, 128),
      fullOrderPage: await run(512, 0, 256),
      vanishedSource: await run(129, 128, 0),
    };
  });
  const summary = (move: { writes: Array<{ store: string; method: string }>; reads: Array<{ store: string }> }) => ({
    orderPuts: move.writes.filter(write => write.store === 'rowOrderPages' && write.method === 'put').length,
    displayPuts: move.writes.filter(write => write.store === 'rowPages' && write.method === 'put').length,
    displayDeletes: move.writes.filter(write => write.store === 'rowPages' && write.method === 'delete').length,
    chunkWrites: move.writes.filter(write => write.store === 'rowChunks').length,
    forbidden: forbiddenReads(move.reads),
  });
  expect(summary(result.samePage)).toMatchObject({ orderPuts: 1, displayPuts: 1, displayDeletes: 0, chunkWrites: 0, forbidden: [] });
  expect(summary(result.crossBoundary)).toMatchObject({ displayPuts: 2, chunkWrites: 0, forbidden: [] });
  expect(summary(result.fullOrderPage)).toMatchObject({ orderPuts: 3, displayPuts: 2, chunkWrites: 0, forbidden: [] });
  expect(summary(result.vanishedSource)).toMatchObject({ displayPuts: 1, displayDeletes: 1, chunkWrites: 0, forbidden: [] });
});

test('does not lose a cell when an unrecognized move takes the generic path', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(513, 2);
    const table = api.data.tables[0];
    const originalIds = { first: table.rows[0].id, second: table.rows[1].id };
    const columnId = table.columns[0].id;
    const action: Parameters<typeof api.history.applyWorkspaceTableHistoryAction>[2] = { type: 'move-row', rowId: table.rows[0].id, beforeIndex: 0, afterIndex: 512 };
    const changed = { ...table, rows: [...table.rows.slice(1), { ...table.rows[0], values: { ...table.rows[0].values, [columnId]: '同時修改' } }] };
    api.data = { ...api.data, tables: [changed] };
    api.instrument(); api.writes = []; api.reads = [];
    await api.db.saveWorkspace(api.data, { mutation: { tableId: table.id, action } });
    const reloaded = await api.db.loadWorkspace({ tableIds: [table.id] });
    return {
      rows: reloaded.tables[0].rows.map(row => row.id),
      lastValue: reloaded.tables[0].rows.at(-1)?.values[columnId],
      chunkWrites: api.writes.filter(write => write.store === 'rowChunks').length,
      originalIds,
    };
  });
  expect(result.rows[0]).toBe(result.originalIds.second);
  expect(result.rows.at(-1)).toBe(result.originalIds.first);
  expect(result.lastValue).toBe('同時修改');
  expect(result.chunkWrites).toBeLessThanOrEqual(1);
});

test('queued immutable move and cell saves preserve undo/redo order and values', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(513, 2);
    const table = api.data.tables[0];
    const originalIds = { first: table.rows[0].id, last: table.rows.at(-1)!.id };
    const move: Parameters<typeof api.history.applyWorkspaceTableHistoryAction>[2] = { type: 'move-row', rowId: table.rows[0].id, beforeIndex: 0, afterIndex: 512 };
    let history = api.history.createEmptyWorkspaceTableHistory(table.id);
    const moved = api.history.applyWorkspaceTableHistoryAction(api.data, table.id, move, 'redo');
    history = api.history.pushWorkspaceTableHistory(history, { tableId: table.id, label: '移動', action: move });
    const firstSave = api.db.saveWorkspace(moved, { mutation: { tableId: table.id, action: move }, history: { replace: [history] } });
    const movedTable = moved.tables[0];
    const columnId = movedTable.columns[0].id;
    const edit: Parameters<typeof api.history.applyWorkspaceTableHistoryAction>[2] = { type: 'set-cell', rowId: movedTable.rows[1].id, columnId, before: movedTable.rows[1].values[columnId], after: '排隊編輯' };
    const edited = api.history.applyWorkspaceTableHistoryAction(moved, table.id, edit, 'redo');
    history = api.history.pushWorkspaceTableHistory(history, { tableId: table.id, label: '編輯', action: edit });
    api.data = edited;
    const secondSave = api.db.saveWorkspace(edited, { mutation: { tableId: table.id, action: edit }, history: { replace: [history] } });
    await Promise.all([firstSave, secondSave]);
    const reloaded = await api.db.loadWorkspace({ tableIds: [table.id] });
    const loadedHistory = (await api.db.loadWorkspaceHistories()).get(table.id)!;
    const moveEntry = loadedHistory.past[0];
    const cellEntry = loadedHistory.past[1];
    const cellUndone = api.history.applyWorkspaceTableHistoryAction(reloaded, table.id, cellEntry.action, 'undo');
    const afterCellUndoHistory = { ...loadedHistory, past: [moveEntry], future: [cellEntry, ...loadedHistory.future] };
    await api.db.saveWorkspace(cellUndone, { mutation: { tableId: table.id, action: cellEntry.action }, history: { replace: [afterCellUndoHistory] } });
    const moveUndone = api.history.applyWorkspaceTableHistoryAction(cellUndone, table.id, moveEntry.action, 'undo');
    const afterMoveUndoHistory = { ...afterCellUndoHistory, past: [], future: [moveEntry, ...afterCellUndoHistory.future] };
    await api.db.saveWorkspace(moveUndone, { mutation: { tableId: table.id, action: moveEntry.action }, history: { replace: [afterMoveUndoHistory] } });
    const moveRedone = api.history.applyWorkspaceTableHistoryAction(moveUndone, table.id, moveEntry.action, 'redo');
    const afterMoveRedoHistory = { ...afterMoveUndoHistory, past: [moveEntry], future: [cellEntry] };
    await api.db.saveWorkspace(moveRedone, { mutation: { tableId: table.id, action: moveEntry.action }, history: { replace: [afterMoveRedoHistory] } });
    const redone = api.history.applyWorkspaceTableHistoryAction(moveRedone, table.id, cellEntry.action, 'redo');
    const redoHistory = { ...afterMoveRedoHistory, past: [moveEntry, cellEntry], future: [] };
    await api.db.saveWorkspace(redone, { mutation: { tableId: table.id, action: cellEntry.action }, history: { replace: [redoHistory] } });
    const final = await api.db.loadWorkspace({ tableIds: [table.id] });
    return {
      finalIds: final.tables[0].rows.map(row => row.id),
      expectedIds: edited.tables[0].rows.map(row => row.id),
      undoIds: moveUndone.tables[0].rows.map(row => row.id),
      originalIds,
      editedValue: final.tables[0].rows.find(row => row.id === movedTable.rows[1].id)?.values[columnId],
      historyTypes: (await api.db.loadWorkspaceHistories()).get(table.id)!.past.map(entry => entry.action.type),
    };
  });
  expect(result.finalIds).toEqual(result.expectedIds);
  expect(result.undoIds[0]).toBe(result.originalIds.first);
  expect(result.undoIds.at(-1)).toBe(result.originalIds.last);
  expect(result.editedValue).toBe('排隊編輯');
  expect(result.historyTypes).toEqual(['move-row', 'set-cell']);
});

for (const failureMode of ['abort', 'quota'] as const) test(`${failureMode} move rollback keeps a later cell save`, async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async failureMode => {
    const api = window.workspaceStorageFixture;
    await api.initialize(512, 2);
    const before = await api.readDisk();
    const table = api.data.tables[0];
    const move: Parameters<typeof api.history.applyWorkspaceTableHistoryAction>[2] = { type: 'move-row', rowId: table.rows[0].id, beforeIndex: 0, afterIndex: 511 };
    let history = api.history.createEmptyWorkspaceTableHistory(table.id);
    const moved = api.history.applyWorkspaceTableHistoryAction(api.data, table.id, move, 'redo');
    history = api.history.pushWorkspaceTableHistory(history, { tableId: table.id, label: '移動', action: move });
    api.data = moved;
    api.instrument(); api.writes = []; api.reads = [];
    api.failNextPage = true; api.failureMode = failureMode;
    let failure = '';
    try { await api.db.saveWorkspace(moved, { mutation: { tableId: table.id, action: move }, history: { replace: [history] } }); } catch (error) { failure = (error as Error).name; }
    const aborted = await api.readDisk();
    const editedTable = api.data.tables[0];
    const columnId = editedTable.columns[0].id;
    const edit: Parameters<typeof api.history.applyWorkspaceTableHistoryAction>[2] = { type: 'set-cell', rowId: editedTable.rows[0].id, columnId, before: editedTable.rows[0].values[columnId], after: '移動後編輯' };
    const edited = api.history.applyWorkspaceTableHistoryAction(api.data, table.id, edit, 'redo');
    history = api.history.pushWorkspaceTableHistory(history, { tableId: table.id, label: '編輯', action: edit });
    api.data = edited;
    await api.db.saveWorkspace(edited, { mutation: { tableId: table.id, action: edit }, history: { replace: [history] } });
    const recovered = await api.db.loadWorkspace({ tableIds: [table.id] });
    const loadedHistory = (await api.db.loadWorkspaceHistories()).get(table.id)!;
    const stable = (disk: Awaited<ReturnType<typeof api.readDisk>>) => ({ meta: disk.meta, tables: disk.tables, states: disk.states, chunks: disk.chunks, orders: disk.orders, heads: disk.heads, tableHeads: disk.tableHeads, pages: disk.pages, entryIds: disk.entryIds });
    return {
      failure, unchanged: JSON.stringify(stable(aborted)) === JSON.stringify(stable(before)),
      rows: recovered.tables[0].rows.map(row => row.id), expected: edited.tables[0].rows.map(row => row.id),
      value: recovered.tables[0].rows.find(row => row.id === editedTable.rows[0].id)?.values[columnId],
      historyTypes: loadedHistory.past.map(entry => entry.action.type),
    };
  }, failureMode);
  expect(result.failure).toBe(failureMode === 'quota' ? 'QuotaExceededError' : 'AbortError');
  expect(result.unchanged).toBe(true);
  expect(result.rows).toEqual(result.expected);
  expect(result.value).toBe('移動後編輯');
  expect(result.historyTypes).toEqual(['move-row', 'set-cell']);
});
