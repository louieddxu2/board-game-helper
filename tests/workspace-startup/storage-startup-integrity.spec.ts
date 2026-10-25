import { expect, test } from '@playwright/test';
import type { } from './storageFixture';
import { startStorageFixture } from './storageSupport';

let site: Awaited<ReturnType<typeof startStorageFixture>>;
test.beforeAll(async () => { site = await startStorageFixture('startup-integrity'); });
test.afterAll(async () => site.close());

test('backup reads both stored tables before the screen has hydrated any complete table', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  await page.evaluate(async () => { await window.workspaceStorageFixture.initialize(260, 2, 2); });
  await page.reload();
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    api.instrument();
    const initial = await api.db.loadWorkspaceInitial({ paged: true });
    const source = await api.db.prepareWorkspaceBackup(initial.data);
    const rowCounts = [];
    for (const table of source.tables) rowCounts.push((await source.readTable(table.id)).rows.length);
    await source.verify();
    return { complete: initial.complete, memoryTables: initial.data.tables.length,
      directoryTables: initial.data.nodes.filter(node => node.type === 'table').length,
      backupTables: source.tables.length, rowCounts, writes: api.writes };
  });
  expect(result).toEqual({ complete: false, memoryTables: 0, directoryTables: 2,
    backupTables: 2, rowCounts: [260, 260], writes: [] });
});

test('an initial read error leaves existing records intact and can be retried', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(260, 2, 2);
    const before = await api.readDisk();
    api.instrument(); api.writes = [];
    const original = IDBObjectStore.prototype.get;
    let name = '';
    IDBObjectStore.prototype.get = function (key) {
      if (this.name === 'meta' && key === 'workspace') throw new DOMException('Simulated read failure', 'UnknownError');
      return original.call(this, key);
    };
    try { await api.db.loadWorkspaceInitial({ paged: true }); }
    catch (error) { name = (error as Error).name; }
    finally { IDBObjectStore.prototype.get = original; }
    const writes = [...api.writes];
    const after = await api.readDisk();
    const loaded = await api.db.loadWorkspace();
    return { name, writes, unchanged: JSON.stringify(before) === JSON.stringify(after),
      rows: loaded.tables.map(table => table.rows.length) };
  });
  expect(result).toEqual({ name: 'UnknownError', writes: [], unchanged: true, rows: [260, 260] });
});

test('still migrates a valid legacy whole-workspace record when no modern records exist', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(260, 2, 2);
    const legacy = api.data;
    await api.db.clearWorkspace();
    const request = indexedDB.open('board-game-helper-workspace');
    const connection = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result); });
    const transaction = connection.transaction('state', 'readwrite');
    transaction.objectStore('state').put(legacy, 'workspace');
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error); });
    connection.close();
  });
  await page.reload();
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    const initial = await api.db.loadWorkspaceInitial({ paged: true });
    const source = await api.db.prepareWorkspaceBackup(initial.data);
    const rows = [];
    for (const table of source.tables) rows.push((await source.readTable(table.id)).rows.length);
    return { tables: source.tables.length, rows };
  });
  expect(result).toEqual({ tables: 2, rows: [260, 260] });
});

for (const residue of ['tables', 'chunks-only'] as const) {
  test(`missing workspace metadata with ${residue} must not initialize and save an empty workspace`, async ({ page }) => {
    await page.goto(`${site.origin}/probe`);
    await page.evaluate(async residue => {
      const api = window.workspaceStorageFixture;
      await api.initialize(260, 2, 2);
      const request = indexedDB.open('board-game-helper-workspace');
      const connection = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const transaction = connection.transaction(Array.from(connection.objectStoreNames), 'readwrite');
      if (residue === 'tables') transaction.objectStore('meta').delete('workspace');
      else for (const name of Array.from(connection.objectStoreNames)) if (name !== 'rowChunks') transaction.objectStore(name).clear();
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error);
      });
      connection.close();
    }, residue);
    await page.reload();
    const result = await page.evaluate(async () => {
      const api = window.workspaceStorageFixture;
      const before = await api.readDisk();
      api.instrument(); api.writes = [];
      let name = '';
      try { await api.db.loadWorkspaceInitial({ paged: true }); }
      catch (error) { name = (error as Error).name; }
      const writes = [...api.writes];
      const after = await api.readDisk();
      return { name, writes, unchanged: JSON.stringify(before) === JSON.stringify(after), chunks: after.chunks.length };
    });
    expect(result.chunks).toBeGreaterThan(0);
    expect(result.name).toBe('WorkspaceStorageIntegrityError');
    expect(result.writes).toEqual([]);
    expect(result.unchanged).toBe(true);
  });
}
