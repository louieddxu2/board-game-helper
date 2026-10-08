import { expect, test } from '@playwright/test';
import type { } from './storageFixture';
import { startStorageFixture } from './storageSupport';

let site: Awaited<ReturnType<typeof startStorageFixture>>;
test.beforeAll(async () => { site = await startStorageFixture('order'); });
test.afterAll(async () => site.close());
let errors: string[];
test.beforeEach(async ({ page }) => { errors = []; page.on('pageerror', error => errors.push(error.message)); });
test.afterEach(() => expect(errors).toEqual([]));

test('10,000-row append and deletes write bounded order pages without reading row data', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(10_000, 2);
    api.instrument();
    const run = async (kind: 'append' | 'middle-delete' | 'tail-delete') => {
      await api.initialize(10_000, 2);
      const table = api.data.tables[0];
      const row = { id: api.model.makeId('row'), name: '新增列', values: Object.fromEntries(table.columns.map(column => [column.id, null])) };
      const action: Parameters<typeof api.history.applyWorkspaceTableHistoryAction>[2] = kind === 'append'
        ? { type: 'add-row', row, index: table.rows.length }
        : { type: 'remove-row', row: table.rows[kind === 'tail-delete' ? table.rows.length - 1 : 5_000], index: kind === 'tail-delete' ? table.rows.length - 1 : 5_000 };
      api.data = api.history.applyWorkspaceTableHistoryAction(api.data, table.id, action, 'redo');
      api.writes = []; api.reads = [];
      await api.db.saveWorkspace(api.data, { mutation: { tableId: table.id, action } });
      const writes = [...api.writes];
      const reads = [...api.reads];
      const disk = await api.readDisk();
      return {
        kind, writes, reads,
        orderIds: disk.orderedRowIds[0],
        record: disk.tables[0],
      };
    };
    return { append: await run('append'), middle: await run('middle-delete'), tail: await run('tail-delete') };
  });
  for (const scenario of [result.append, result.middle, result.tail]) {
    expect(scenario.record.storageFormat).toBe('row-chunks-v2');
    expect(scenario.record).not.toHaveProperty('rowOrder');
    expect(scenario.record.orderPageIds.length).toBeLessThanOrEqual(40);
    expect(scenario.writes.filter(write => write.store === 'rowChunks' && write.method === 'put')).toHaveLength(1);
    expect(scenario.writes.filter(write => write.store === 'rowOrderPages' && write.method === 'put')).toHaveLength(1);
    expect(scenario.writes.filter(write => write.store === 'rowOrderPages' && write.method === 'delete')).toHaveLength(0);
    expect(scenario.reads.some(read => read.store === 'rowChunks' || read.store === 'rowOrderPages')).toBe(false);
  }
  expect(result.append.orderIds).toHaveLength(10_001);
  expect(result.middle.orderIds).toHaveLength(9_999);
  expect(result.tail.orderIds).toHaveLength(9_999);
});

test('a full-page boundary append creates one order page and keeps the previous page unchanged', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(256);
    const before = await api.readDisk();
    const table = api.data.tables[0];
    const row = { id: api.model.makeId('row'), name: '邊界新增', values: Object.fromEntries(table.columns.map(column => [column.id, null])) };
    const action: Parameters<typeof api.history.applyWorkspaceTableHistoryAction>[2] = { type: 'add-row', row, index: table.rows.length };
    api.data = api.history.applyWorkspaceTableHistoryAction(api.data, table.id, action, 'redo');
    api.instrument(); api.writes = []; api.reads = [];
    await api.db.saveWorkspace(api.data, { mutation: { tableId: table.id, action } });
    const dataReads = api.reads.filter(read => read.store === 'rowChunks' || read.store === 'rowOrderPages');
    const after = await api.readDisk();
    return {
      before, after,
      orderWrites: api.writes.filter(write => write.store === 'rowOrderPages'),
      dataReads,
    };
  });
  expect(result.orderWrites.filter(write => write.method === 'put')).toHaveLength(1);
  expect(result.orderWrites.filter(write => write.method === 'delete')).toHaveLength(0);
  expect(result.after.orders.filter(page => page.pageId === result.before.orders[0].pageId)).toEqual([result.before.orders[0]]);
  expect(result.after.orderedRowIds[0]).toEqual([...result.before.orderedRowIds[0], result.after.orderedRowIds[0].at(-1)]);
  expect(result.dataReads).toEqual([]);
});

for (const kind of ['add', 'delete'] as const) for (const failureMode of ['abort', 'quota'] as const) test(`${failureMode} order-page failure rolls back an ${kind} and the next edit saves both`, async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async ({ failureMode, kind }) => {
    const api = window.workspaceStorageFixture;
    await api.initialize(kind === 'add' ? 256 : 257, 2);
    const table = api.data.tables[0];
    const before = await api.readDisk();
    const row = { id: api.model.makeId('row'), name: '待保存', values: Object.fromEntries(table.columns.map(column => [column.id, null])) };
    const change: Parameters<typeof api.history.applyWorkspaceTableHistoryAction>[2] = kind === 'add' ? { type: 'add-row', row, index: table.rows.length }
      : { type: 'remove-row', row: table.rows[128], index: 128 };
    const edit: Parameters<typeof api.history.applyWorkspaceTableHistoryAction>[2] = { type: 'set-cell', rowId: table.rows[0].id, columnId: table.columns[0].id, before: table.rows[0].values[table.columns[0].id], after: '後續編輯' };
    let history = api.history.createEmptyWorkspaceTableHistory(table.id);
    history = api.history.pushWorkspaceTableHistory(history, { tableId: table.id, label: '變更列', action: change });
    api.data = api.history.applyWorkspaceTableHistoryAction(api.data, table.id, change, 'redo');
    api.instrument(); api.failNextOrder = true; api.failureMode = failureMode;
    let failure = '';
    try { await api.db.saveWorkspace(api.data, { mutation: { tableId: table.id, action: change }, history: { replace: [history] } }); } catch (error) { failure = (error as Error).name; }
    const aborted = await api.readDisk();
    history = api.history.pushWorkspaceTableHistory(history, { tableId: table.id, label: '編輯', action: edit });
    api.data = api.history.applyWorkspaceTableHistoryAction(api.data, table.id, edit, 'redo');
    api.writes = [];
    await api.db.saveWorkspace(api.data, { mutation: { tableId: table.id, action: edit }, history: { replace: [history] } });
    const recovered = await api.db.loadWorkspace({ tableIds: [table.id] });
    return { failure, before, aborted, recovered, disk: await api.readDisk(), writes: api.writes, removedId: kind === 'delete' ? table.rows[128].id : undefined };
  }, { failureMode, kind });
  expect(result.failure).toBe(failureMode === 'quota' ? 'QuotaExceededError' : 'AbortError');
  expect(result.aborted).toEqual(result.before);
  expect(result.recovered.tables[0].rows).toHaveLength(kind === 'add' ? 257 : 256);
  if (kind === 'add') expect(result.recovered.tables[0].rows.at(-1)?.name).toBe('待保存');
  else expect(result.recovered.tables[0].rows.map(row => row.id)).not.toContain(result.removedId);
  expect(result.recovered.tables[0].rows[0].values[result.recovered.tables[0].columns[0].id]).toBe('後續編輯');
  expect(result.disk.orderedRowIds[0]).toHaveLength(kind === 'add' ? 257 : 256);
  expect(result.disk.heads[0].past).toHaveLength(2);
  expect(result.writes.filter(write => write.store === 'rowOrderPages' && write.method === 'put')).toHaveLength(1);
});

test('queued append and middle delete preserve both immutable saves and their history on reload', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(600, 2);
    const table = api.data.tables[0];
    const row = { id: api.model.makeId('row'), name: '排隊新增', values: Object.fromEntries(table.columns.map(column => [column.id, null])) };
    const add = { type: 'add-row' as const, row, index: 600 };
    let history = api.history.pushWorkspaceTableHistory(api.history.createEmptyWorkspaceTableHistory(table.id), { tableId: table.id, label: '新增', action: add });
    api.data = api.history.applyWorkspaceTableHistoryAction(api.data, table.id, add, 'redo');
    const first = api.db.saveWorkspace(api.data, { mutation: { tableId: table.id, action: add }, history: { replace: [history] } });
    const remove = { type: 'remove-row' as const, row: table.rows[300], index: 300 };
    history = api.history.pushWorkspaceTableHistory(history, { tableId: table.id, label: '刪除', action: remove });
    api.data = api.history.applyWorkspaceTableHistoryAction(api.data, table.id, remove, 'redo');
    const expected = api.data.tables[0].rows;
    const second = api.db.saveWorkspace(api.data, { mutation: { tableId: table.id, action: remove }, history: { replace: [history] } });
    await Promise.all([first, second]);
    const loaded = await api.db.loadWorkspace();
    const histories = await api.db.loadWorkspaceHistories();
    return { expected, rows: loaded.tables[0].rows, past: histories.get(table.id)?.past.map(entry => entry.action.type) };
  });
  expect(result.rows).toEqual(result.expected);
  expect(result.past).toEqual(['add-row', 'remove-row']);
});

test('insert undo and whole archive roundtrip preserve row order', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(600, 2);
    const table = api.data.tables[0];
    const row = { id: api.model.makeId('row'), name: '中間新增', values: Object.fromEntries(table.columns.map(column => [column.id, null])) };
    const add: Parameters<typeof api.history.applyWorkspaceTableHistoryAction>[2] = { type: 'add-row', row, index: 300 };
    api.data = api.history.applyWorkspaceTableHistoryAction(api.data, table.id, add, 'redo');
    await api.db.saveWorkspace(api.data, { mutation: { tableId: table.id, action: add } });
    const inserted = await api.db.loadWorkspace({ tableIds: [table.id] });
    const remove: Parameters<typeof api.history.applyWorkspaceTableHistoryAction>[2] = { type: 'remove-row', row, index: 300 };
    api.data = api.history.applyWorkspaceTableHistoryAction(inserted, table.id, remove, 'redo');
    await api.db.saveWorkspace(api.data, { mutation: { tableId: table.id, action: remove } });
    const undone = await api.db.loadWorkspace({ tableIds: [table.id] });
    const archive = await api.spreadsheet.exportWorkspaceArchive(undone);
    const imported = await api.spreadsheet.importWorkspaceArchive(archive);
    return { original: table.rows.map(item => item.id), undone: undone.tables[0].rows.map(item => item.id), names: undone.tables[0].rows.map(item => item.name), imported: imported.data?.tables[0].rows.map(item => item.name) };
  });
  expect(result.undone).toEqual(result.original);
  expect(result.imported).toEqual(result.names);
});

test('deleting the last table and clearing the workspace removes all order pages', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(257, 2);
    const table = api.data.tables[0];
    const remove: Parameters<typeof api.history.applyWorkspaceTableHistoryAction>[2] = { type: 'remove-row', row: table.rows.at(-1)!, index: table.rows.length - 1 };
    api.data = api.history.applyWorkspaceTableHistoryAction(api.data, table.id, remove, 'redo');
    await api.db.saveWorkspace(api.data, { mutation: { tableId: table.id, action: remove } });
    const afterRowDelete = await api.readDisk();
    api.data = { ...api.data, tables: [], nodes: [] };
    await api.db.saveWorkspace(api.data, { deletedTableIds: [table.id] });
    const afterTableDelete = await api.readDisk();
    await api.db.clearWorkspace();
    const afterClear = await api.readDisk();
    return { afterRowDelete, afterTableDelete, afterClear };
  });
  expect(result.afterRowDelete.orders).toHaveLength(1);
  expect(result.afterRowDelete.orderedRowIds[0]).toHaveLength(256);
  expect(result.afterTableDelete.orders).toEqual([]);
  expect(result.afterClear.orders).toEqual([]);
});
