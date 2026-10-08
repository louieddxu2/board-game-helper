import { expect, test } from '@playwright/test';
import type { } from './storageFixture';
import { startStorageFixture } from './storageSupport';

let site: Awaited<ReturnType<typeof startStorageFixture>>;
test.beforeAll(async () => { site = await startStorageFixture('migration-v6'); });
test.afterAll(async () => site.close());
let errors: string[];
test.beforeEach(async ({ page }) => { errors = []; page.on('pageerror', error => errors.push(error.message)); });
test.afterEach(() => expect(errors).toEqual([]));

test('opens a v5 projection, preserves old pages during the first partial save, and replays legacy reorder history', async ({ page }) => {
  await page.goto(`${site.origin}/blank`);
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase('board-game-helper-workspace'); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
    const request = indexedDB.open('board-game-helper-workspace', 5);
    request.onupgradeneeded = () => { for (const name of ['state', 'meta', 'tables', 'tableState', 'rowChunks', 'tableHeads', 'rowPages', 'history', 'historyEntries']) request.result.createObjectStore(name); };
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tableId = 'table-v5';
    const columnId = 'column-v5';
    const rows = Array.from({ length: 256 }, (_, index) => ({ id: `row-${index}`, name: `物件 ${index}`, values: { [columnId]: `值 ${index}` } }));
    const definition = { id: tableId, name: 'v5 表格', rowHeaderName: '物件', rowHeader: { id: 'row-header-v5', name: '物件', inputType: 'text', options: [] }, columns: [{ id: columnId, name: '欄位', inputType: 'text', options: [] }] };
    const beforeIds = rows.map(row => row.id);
    const afterIds = [...beforeIds.slice(1), beforeIds[0]];
    const entry = { id: 'legacy-reorder', tableId, label: '舊排序', createdAt: Date.now(), action: { type: 'reorder-rows', beforeIds, afterIds } };
    const transaction = db.transaction(['meta', 'tables', 'tableState', 'rowChunks', 'tableHeads', 'rowPages', 'history'], 'readwrite');
    transaction.objectStore('meta').put({ version: 1, structureRevision: 'structure-v5', nodes: [{ id: 'node-v5', type: 'table', tableId, name: definition.name, parentId: null, order: 0 }], activeNodeId: 'node-v5', bottomNavigationTableIds: [] }, 'workspace');
    transaction.objectStore('meta').put({ storageRevision: 'revision-v5', updatedAt: 100 }, 'storage');
    transaction.objectStore('tables').put({ storageFormat: 'row-chunks-v1', definition, chunkCapacity: 256, chunkIds: ['chunk-v5'], rowOrder: beforeIds }, tableId);
    transaction.objectStore('tableState').put({ updatedAt: 100, changeRevision: 'content-v5', columnState: {} }, tableId);
    transaction.objectStore('rowChunks').put({ tableId, chunkId: 'chunk-v5', rows }, [tableId, 'chunk-v5']);
    transaction.objectStore('tableHeads').put({ format: 'row-pages-v1', definition, rowCount: 256, pageSize: 128, layoutRevision: 'legacy-layout', updatedAt: 100, changeRevision: 'content-v5' }, tableId);
    transaction.objectStore('rowPages').put({ tableId, index: 0, layoutRevision: 'legacy-layout', rows: rows.slice(0, 128) }, [tableId, 0]);
    transaction.objectStore('rowPages').put({ tableId, index: 1, layoutRevision: 'legacy-layout', rows: rows.slice(128) }, [tableId, 1]);
    transaction.objectStore('history').put({ tableId, past: [entry], future: [] }, tableId);
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error); });
    db.close();
  });
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
    const initial = await api.db.loadWorkspaceInitial({ paged: true });
    api.instrument();
    const upgradeWrites = [...((window as any).__upgradeStoreWrites ?? [])];
    const connection = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('board-game-helper-workspace');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const dbVersion = connection.version;
    const storeNames = Array.from(connection.objectStoreNames).sort();
    connection.close();
    const oldPage1 = (await api.db.loadWorkspaceTableWindow('table-v5', [1]))!.pages[0];
    api.data = (await api.db.loadWorkspace({ expectCurrentRevision: true }));
    const table = api.data.tables[0];
    const histories = await api.db.loadWorkspaceHistories();
    const entry = histories.get(table.id)!.past[0];
    if (entry.action.type !== 'reorder-rows') throw new Error('Expected legacy reorder history');
    const edited = { ...table, rows: table.rows.map((row, index) => index === 0 ? { ...row, values: { ...row.values, [table.columns[0].id]: '新值' } } : row) };
    api.data = { ...api.data, tables: [edited] };
    await api.db.saveWorkspace(api.data, { mutation: { tableId: table.id, action: { type: 'set-cell', rowId: edited.rows[0].id, columnId: edited.columns[0].id, before: '值 0', after: '新值' } } });
    const partiallySaved = await api.readDisk();
    const unchangedPage = partiallySaved.pages.find(page => page.index === 1)!;
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
    return {
      initialVersion: initial.window?.head.pageRevisions,
      initialRows: initial.window?.pages[0].rows.length,
      upgradeWrites,
      dbVersion,
      storeNames,
      oldPagePreserved: JSON.stringify(oldPage1) === JSON.stringify(unchangedPage),
      upgradedVersions: partiallySaved.tableHeads[0].pageRevisions,
      undoneFirst: undone.tables[0].rows[0].id,
      redoneFirst: reloaded.tables[0].rows[0].id,
    };
  });
  expect(result.initialVersion).toBeUndefined();
  expect(result.initialRows).toBe(128);
  expect(result.upgradeWrites).toEqual([]);
  expect(result.dbVersion).toBe(6);
  expect(result.storeNames).toEqual(['history', 'historyEntries', 'meta', 'rowChunks', 'rowPages', 'state', 'tableHeads', 'tableState', 'tables']);
  expect(result.oldPagePreserved).toBe(true);
  expect(result.upgradedVersions).toHaveLength(2);
  expect(result.undoneFirst).toBe('row-0');
  expect(result.redoneFirst).toBe('row-1');
});
