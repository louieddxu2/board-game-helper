import { expect, test } from '@playwright/test';
import type { } from './storageFixture';
import { startStorageFixture } from './storageSupport';

let site: Awaited<ReturnType<typeof startStorageFixture>>;
test.beforeAll(async () => { site = await startStorageFixture('migration-v6'); });
test.afterAll(async () => site.close());
let errors: string[];
test.beforeEach(async ({ page }) => { errors = []; page.on('pageerror', error => errors.push(error.message)); });
test.afterEach(() => expect(errors).toEqual([]));

for (const version of [5, 6, 7]) test(`opens a v${version} legacy order, keeps first paint free of order reads, and migrates order pages in the background`, async ({ page }) => {
  await page.goto(`${site.origin}/blank`);
  await page.evaluate(async version => {
    await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase('board-game-helper-workspace'); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
    const request = indexedDB.open('board-game-helper-workspace', version);
    request.onupgradeneeded = () => {
      const names = ['state', 'meta', 'tables', 'tableState', 'rowChunks', 'tableHeads', 'rowPages', 'history', 'historyEntries'];
      if (version === 7) names.splice(5, 0, 'rowOrderPages');
      for (const name of names) request.result.createObjectStore(name);
    };
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tableId = 'table-v6';
    const columnId = 'column-v6';
    const rows = Array.from({ length: 256 }, (_, index) => ({ id: `row-${index}`, name: `物件 ${index}`, values: { [columnId]: `值 ${index}` } }));
    const definition = { id: tableId, name: 'v6 表格', rowHeaderName: '物件', rowHeader: { id: 'row-header-v6', name: '物件', inputType: 'text', options: [] }, columns: [{ id: columnId, name: '欄位', inputType: 'text', options: [] }] };
    const beforeIds = rows.map(row => row.id);
    const afterIds = [...beforeIds.slice(1), beforeIds[0]];
    const entry = { id: 'legacy-reorder', tableId, label: '舊排序', createdAt: Date.now(), action: { type: 'reorder-rows', beforeIds, afterIds } };
    const orderPageIds = ['order-v7-0', 'order-v7-1'];
    const stores = ['meta', 'tables', 'tableState', 'rowChunks', 'tableHeads', 'rowPages', 'history'];
    if (version === 7) stores.splice(4, 0, 'rowOrderPages');
    const transaction = db.transaction(stores, 'readwrite');
    transaction.objectStore('meta').put({ version: 1, structureRevision: 'structure-v6', nodes: [{ id: 'node-v6', type: 'table', tableId, name: definition.name, parentId: null, order: 0 }], activeNodeId: 'node-v6', bottomNavigationTableIds: [] }, 'workspace');
    transaction.objectStore('meta').put({ storageRevision: 'revision-v6', updatedAt: 100 }, 'storage');
    transaction.objectStore('tables').put(version === 7
      ? { storageFormat: 'row-chunks-v2', definition, chunkCapacity: 256, chunkIds: ['chunk-v6'], orderPageIds }
      : { storageFormat: 'row-chunks-v1', definition, chunkCapacity: 256, chunkIds: ['chunk-v6'], rowOrder: beforeIds }, tableId);
    transaction.objectStore('tableState').put({ updatedAt: 100, changeRevision: 'content-v6', columnState: {} }, tableId);
    transaction.objectStore('rowChunks').put({ tableId, chunkId: 'chunk-v6', rows }, [tableId, 'chunk-v6']);
    if (version === 7) {
      transaction.objectStore('rowOrderPages').put({ tableId, pageId: orderPageIds[0], rowIds: beforeIds.slice(0, 128) }, [tableId, orderPageIds[0]]);
      transaction.objectStore('rowOrderPages').put({ tableId, pageId: orderPageIds[1], rowIds: beforeIds.slice(128) }, [tableId, orderPageIds[1]]);
    }
    const pageRevisions = version === 6 || version === 7 ? ['legacy-page-0', 'legacy-page-1'] : undefined;
    transaction.objectStore('tableHeads').put({ format: 'row-pages-v1', definition, rowCount: 256, pageSize: 128, layoutRevision: 'legacy-layout', pageRevisions, updatedAt: 100, changeRevision: 'content-v6' }, tableId);
    transaction.objectStore('rowPages').put({ tableId, index: 0, layoutRevision: pageRevisions?.[0] ?? 'legacy-layout', rows: rows.slice(0, 128) }, [tableId, 0]);
    transaction.objectStore('rowPages').put({ tableId, index: 1, layoutRevision: pageRevisions?.[1] ?? 'legacy-layout', rows: rows.slice(128) }, [tableId, 1]);
    transaction.objectStore('history').put({ tableId, past: [entry], future: [] }, tableId);
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error); });
    db.close();
  }, version);
  await page.addInitScript(() => {
    const writes: string[] = [];
    (window as any).__upgradeStoreWrites = writes;
    for (const method of ['put', 'delete', 'clear'] as const) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (this: IDBObjectStore, ...args: any[]) {
        writes.push(this.name);
        return Reflect.apply(original, this, args) as never;
      } as typeof IDBObjectStore.prototype[typeof method];
    }
  });
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    api.instrument();
    api.reads = [];
    const initial = await api.db.loadWorkspaceInitial({ paged: true });
    const firstPaintOrderReads = api.reads.filter(read => read.store === 'rowOrderPages');
    const upgradeWrites = [...((window as any).__upgradeStoreWrites ?? [])];
    const connection = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('board-game-helper-workspace');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const dbVersion = connection.version;
    const storeNames = Array.from(connection.objectStoreNames).sort();
    connection.close();
    const oldPage1 = (await api.db.loadWorkspaceTableWindow('table-v6', [1]))!.pages[0];
    api.data = (await api.db.loadWorkspace({ expectCurrentRevision: true }));
    await api.db.flushWorkspaceSaves();
    const migrationOrderReads = api.reads.filter(read => read.store === 'rowOrderPages');
    const migrationWrites = [...api.writes];
    const migrated = await api.readDisk();
    const migratedHead = migrated.tableHeads.find(head => head.definition.id === api.data.tables[0].id)!;
    if (migratedHead.format !== 'row-blocks-v1') throw new Error(`Expected display projection migration, received ${migratedHead.format}`);
    const migratedSecondId = migratedHead.blocks[1].id;
    const migratedSecondBeforeEdit = migrated.pages.find(page => page.id === migratedSecondId)!;
    const table = api.data.tables[0];
    const histories = await api.db.loadWorkspaceHistories();
    const entry = histories.get(table.id)!.past[0];
    if (entry.action.type !== 'reorder-rows') throw new Error('Expected legacy reorder history');
    const edited = { ...table, rows: table.rows.map((row, index) => index === 0 ? { ...row, values: { ...row.values, [table.columns[0].id]: '新值' } } : row) };
    api.data = { ...api.data, tables: [edited] };
    await api.db.saveWorkspace(api.data, { mutation: { tableId: table.id, action: { type: 'set-cell', rowId: edited.rows[0].id, columnId: edited.columns[0].id, before: '值 0', after: '新值' } } });
    const afterEdit = await api.readDisk();
    const unchangedPage = afterEdit.pages.find(page => page.id === migratedSecondId)!;
    const applied = api.history.applyWorkspaceTableHistoryAction(api.data, table.id, entry.action, 'redo');
    api.data = applied;
    await api.db.saveWorkspace(api.data, { mutation: { tableId: table.id, action: entry.action } });
    const reordered = await api.db.loadWorkspace({ tableIds: [table.id] });
    const undo = api.history.applyWorkspaceTableHistoryAction(reordered, table.id, entry.action, 'undo');
    api.data = undo;
    await api.db.saveWorkspace(api.data, { mutation: { tableId: table.id, action: entry.action } });
    const undone = await api.db.loadWorkspace({ tableIds: [table.id] });
    const redo = api.history.applyWorkspaceTableHistoryAction(undone, table.id, entry.action, 'redo');
    api.data = redo;
    await api.db.saveWorkspace(api.data, { mutation: { tableId: table.id, action: entry.action } });
    const reloaded = await api.db.loadWorkspace({ tableIds: [table.id] });
    const archive = await api.spreadsheet.exportWorkspaceArchive(reloaded);
    const imported = await api.spreadsheet.importWorkspaceArchive(archive);
    return {
      initialVersion: initial.window?.head.format === 'row-pages-v1' ? initial.window.head.pageRevisions : undefined,
      initialRows: initial.window?.pages[0].rows.length,
      firstPaintOrderReads,
      migrationOrderReads,
      migrationWrites,
      upgradeWrites,
      dbVersion,
      storeNames,
      oldPagePreserved: JSON.stringify(oldPage1.rows) === JSON.stringify(migratedSecondBeforeEdit.rows),
      migratedBlockStable: JSON.stringify(migratedSecondBeforeEdit) === JSON.stringify(unchangedPage),
      upgradedVersions: migratedHead.blocks.map(block => block.revision),
      undoneFirst: undone.tables[0].rows[0].id,
      redoneFirst: reloaded.tables[0].rows[0].id,
      tableFormat: afterEdit.tables[0].storageFormat,
      orderPageCount: afterEdit.orders.length,
      importedRows: imported.data?.tables[0].rows.map(row => [row.name, ...imported.data!.tables[0].columns.map(column => row.values[column.id])]),
      reloadedRows: reloaded.tables[0].rows.map(row => [row.name, ...reloaded.tables[0].columns.map(column => row.values[column.id])]),
    };
  });
  expect(result.initialVersion).toEqual(version === 5 ? undefined : ['legacy-page-0', 'legacy-page-1']);
  expect(result.initialRows).toBe(128);
  expect(result.firstPaintOrderReads).toEqual([]);
  expect(result.migrationOrderReads).toHaveLength(version === 7 ? 1 : 0);
  expect(result.upgradeWrites).toEqual([]);
  if (version === 7) {
    expect(result.migrationWrites.filter(write => ['rowChunks', 'rowOrderPages'].includes(write.store))).toEqual([]);
    expect(result.migrationWrites.filter(write => write.store === 'tables')).toEqual([]);
  }
  expect(result.dbVersion).toBe(8);
  expect(result.storeNames).toEqual(['history', 'historyEntries', 'meta', 'rowChunks', 'rowOrderPages', 'rowPages', 'state', 'tableHeads', 'tableState', 'tables']);
  expect(result.oldPagePreserved).toBe(true);
  expect(result.migratedBlockStable).toBe(true);
  expect(result.upgradedVersions).toHaveLength(2);
  expect(result.tableFormat).toBe('row-chunks-v2');
  expect(result.orderPageCount).toBe(version === 7 ? 2 : 1);
  expect(result.undoneFirst).toBe('row-0');
  expect(result.redoneFirst).toBe('row-1');
  expect(result.importedRows).toEqual(result.reloadedRows);
});
