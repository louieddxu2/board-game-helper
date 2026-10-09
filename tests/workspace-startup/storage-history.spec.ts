import { expect, test } from '@playwright/test';
import type { } from './storageFixture';
import { startStorageFixture } from './storageSupport';

let site: Awaited<ReturnType<typeof startStorageFixture>>;
test.beforeAll(async () => { site = await startStorageFixture('history'); });
test.afterAll(async () => site.close());
let errors: string[];
test.beforeEach(async ({ page }) => { errors = []; page.on('pageerror', error => errors.push(error.message)); });
test.afterEach(() => expect(errors).toEqual([]));

test('reads only the active compact history head and verifies at most eight keys per batch', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(120, 2, 2);
    const activeId = api.data.tables[0].id;
    const otherId = api.data.tables[1].id;
    for (let index = 0; index < 10; index += 1) await api.edit(index, `歷史 ${index}`);
    await api.edit(0, '另一張表格', 1);
    api.instrument(); api.reads = []; api.writes = [];
    const head = await api.db.loadWorkspaceHistoryHead(activeId);
    const historyReads = api.reads.filter(read => read.store === 'history' || read.store === 'historyEntries');
    const keyReads = historyReads.filter(read => read.store === 'historyEntries' && read.method === 'getKey');
    const counts = new Map<number, number>();
    for (const read of keyReads) counts.set(read.transaction, (counts.get(read.transaction) ?? 0) + 1);
    const tableIds = historyReads.map(read => Array.isArray(read.key) ? read.key[0] : read.key);
    return {
      activeId, otherId, past: head.past.length, labels: head.past.map(entry => entry.label),
      payloadReads: historyReads.filter(read => read.store === 'historyEntries' && read.method !== 'getKey').length,
      historyGetAll: historyReads.some(read => read.store === 'history' && read.method === 'getAll'),
      keyReads: keyReads.length, maxKeysPerTransaction: Math.max(...counts.values()),
      activeOnly: tableIds.filter(id => id === activeId).length === tableIds.length,
      writes: api.writes,
    };
  });

  expect(result.past).toBe(10);
  expect(result.labels).toEqual(Array.from({ length: 10 }, (_, index) => `編輯`));
  expect(result.payloadReads).toBe(0);
  expect(result.historyGetAll).toBe(false);
  expect(result.keyReads).toBe(10);
  expect(result.maxKeysPerTransaction).toBeLessThanOrEqual(8);
  expect(result.activeOnly).toBe(true);
  expect(result.writes).toEqual([]);
});

test('loads one history body on demand and rejects unknown, missing, or corrupted bodies', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(40, 2);
    await api.edit(0, '第一次'); await api.edit(1, '第二次');
    const tableId = api.data.tables[0].id;
    api.instrument(); api.reads = [];
    const head = await api.db.loadWorkspaceHistoryHead(tableId);
    const reference = head.past.at(-1)!;
    api.reads = [];
    const loaded = await api.db.loadWorkspaceHistoryEntry(tableId, reference);
    const entryReads = [...api.reads];
    let unknown = '';
    try { await api.db.loadWorkspaceHistoryEntry(tableId, { ...reference, id: 'unknown-history' }); }
    catch (error) { unknown = (error as Error).name; }

    const open = indexedDB.open('board-game-helper-workspace');
    const connection = await new Promise<IDBDatabase>((resolve, reject) => { open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
    const readTransaction = connection.transaction('historyEntries');
    const body = await new Promise<any>((resolve, reject) => { const request = readTransaction.objectStore('historyEntries').get([tableId, reference.id]); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise<void>((resolve, reject) => { readTransaction.oncomplete = () => resolve(); readTransaction.onerror = () => reject(readTransaction.error); });
    const removeTransaction = connection.transaction('historyEntries', 'readwrite');
    removeTransaction.objectStore('historyEntries').delete([tableId, reference.id]);
    await new Promise<void>((resolve, reject) => { removeTransaction.oncomplete = () => resolve(); removeTransaction.onerror = () => reject(removeTransaction.error); });
    let missingHead = '';
    try { await api.db.loadWorkspaceHistoryHead(tableId); }
    catch (error) { missingHead = (error as Error).name; }
    const restoreTransaction = connection.transaction('historyEntries', 'readwrite');
    restoreTransaction.objectStore('historyEntries').put(body, [tableId, reference.id]);
    await new Promise<void>((resolve, reject) => { restoreTransaction.oncomplete = () => resolve(); restoreTransaction.onerror = () => reject(restoreTransaction.error); });
    const writeTransaction = connection.transaction('historyEntries', 'readwrite');
    writeTransaction.objectStore('historyEntries').put({ ...body, tableId: 'foreign-table' }, [tableId, reference.id]);
    await new Promise<void>((resolve, reject) => { writeTransaction.oncomplete = () => resolve(); writeTransaction.onerror = () => reject(writeTransaction.error); });
    connection.close();

    const headAfterCorruption = await api.db.loadWorkspaceHistoryHead(tableId);
    let corrupted = '';
    try { await api.db.loadWorkspaceHistoryEntry(tableId, reference); }
    catch (error) { corrupted = (error as Error).name; }
    return {
      loadedAction: loaded.action.type, entryReads: entryReads.filter(read => read.store === 'historyEntries'),
      unknown, missingHead, headAfterCorruption: headAfterCorruption.past.length, corrupted,
    };
  });

  expect(result.loadedAction).toBe('set-cell');
  expect(result.entryReads).toHaveLength(1);
  expect(result.entryReads[0].method).toBe('get');
  expect(result.unknown).toBe('WorkspaceStorageIntegrityError');
  expect(result.missingHead).toBe('WorkspaceStorageIntegrityError');
  expect(result.headAfterCorruption).toBe(2);
  expect(result.corrupted).toBe('WorkspaceStorageIntegrityError');
});

test('keeps legacy full history readable while the head-first API migrates it', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(40, 2); await api.edit(0, '舊格式');
    const tableId = api.data.tables[0].id;
    const current = await api.db.loadWorkspaceHistoryHead(tableId);
    const reference = current.past[0];
    const open = indexedDB.open('board-game-helper-workspace');
    const connection = await new Promise<IDBDatabase>((resolve, reject) => { open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
    const readTransaction = connection.transaction('historyEntries');
    const body = await new Promise<any>((resolve, reject) => { const request = readTransaction.objectStore('historyEntries').get([tableId, reference.id]); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    await new Promise<void>((resolve, reject) => { readTransaction.oncomplete = () => resolve(); readTransaction.onerror = () => reject(readTransaction.error); });
    const transaction = connection.transaction(['history', 'historyEntries'], 'readwrite');
    transaction.objectStore('history').put({ tableId, past: [body], future: [] }, tableId);
    transaction.objectStore('historyEntries').delete([tableId, reference.id]);
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
    connection.close();
    api.instrument(); api.reads = [];
    const legacy = await api.db.loadWorkspaceHistoryHead(tableId);
    await api.db.flushWorkspaceHistorySaves();
    return { action: (legacy.past[0] as any).action.type, label: legacy.past[0].label, historyEntryReads: api.reads.filter(read => read.store === 'historyEntries').length };
  });

  expect(result.action).toBe('set-cell');
  expect(result.label).toBe('編輯');
  expect(result.historyEntryReads).toBe(0);
});

test('replaces a compact head without rewriting old bodies and rejects unknown replacement references atomically', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(40, 2); await api.edit(0, '第一個'); await api.edit(1, '第二個');
    const tableId = api.data.tables[0].id;
    const head = await api.db.loadWorkspaceHistoryHead(tableId);
    const oldReference = head.past[0];
    const readBody = async (id: string) => {
      const open = indexedDB.open('board-game-helper-workspace');
      const connection = await new Promise<IDBDatabase>((resolve, reject) => { open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
      const transaction = connection.transaction('historyEntries');
      const body = await new Promise<any>((resolve, reject) => { const request = transaction.objectStore('historyEntries').get([tableId, id]); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
      connection.close();
      return body;
    };
    const oldBody = await readBody(oldReference.id);
    const newEntry = { id: 'replacement-event', tableId, label: '新增事件', createdAt: oldReference.createdAt + 1, action: { type: 'set-cell', rowId: api.data.tables[0].rows[0].id, columnId: api.data.tables[0].columns[0].id, before: '第一個', after: '新增事件' } };
    api.instrument(); api.writes = [];
    await api.db.saveWorkspace(api.data, { history: { replace: [{ tableId, past: [...head.past, newEntry], future: [] }] } });
    const afterBody = await readBody(oldReference.id);
    const payloadPuts = api.writes.filter(write => write.store === 'historyEntries' && write.method === 'put').map(write => write.key);
    const savedHead = await api.db.loadWorkspaceHistoryHead(tableId);
    const beforeUnknown = savedHead.past.map(entry => entry.id);
    api.writes = [];
    const unknown = { id: 'unknown-replacement', label: '未知', createdAt: newEntry.createdAt + 1 };
    let failure = '';
    try { await api.db.saveWorkspace(api.data, { history: { replace: [{ tableId, past: [...savedHead.past, unknown], future: [] }] } }); }
    catch (error) { failure = (error as Error).name; }
    const afterUnknown = await api.db.loadWorkspaceHistoryHead(tableId);
    return { tableId, oldBody, afterBody, payloadPuts, savedHead: savedHead.past.map(entry => entry.id), beforeUnknown, afterUnknown: afterUnknown.past.map(entry => entry.id), failure, failedWrites: api.writes.filter(write => write.store === 'historyEntries' || write.store === 'history') };
  });

  expect(result.afterBody).toEqual(result.oldBody);
  expect(result.payloadPuts).toEqual([[result.tableId, 'replacement-event']]);
  expect(result.savedHead).toContain('replacement-event');
  expect(result.failure).toBe('WorkspaceStorageIntegrityError');
  expect(result.afterUnknown).toEqual(result.beforeUnknown);
  expect(result.failedWrites).toEqual([]);
});

test('restarts a same-tab head read when a save begins between key batches', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(80, 2);
    for (let index = 0; index < 10; index += 1) await api.edit(index, `前置 ${index}`);
    const tableId = api.data.tables[0].id;
    api.instrument(); api.reads = [];
    let triggered = false;
    let save: Promise<void> | undefined;
    const original = IDBObjectStore.prototype.getKey;
    IDBObjectStore.prototype.getKey = function (this: IDBObjectStore, ...args: any[]) {
      const request = Reflect.apply(original, this, args) as IDBRequest;
      if (this.name === 'historyEntries' && !triggered) {
        triggered = true;
        request.addEventListener('success', () => { save = api.edit(20, '讀取途中修改'); }, { once: true });
      }
      return request;
    } as typeof original;
    try {
      const head = await api.db.loadWorkspaceHistoryHead(tableId);
      if (save) await save;
      return { triggered, past: head.past.length, hasNewEdit: head.past.at(-1)?.label === '編輯' };
    } finally { IDBObjectStore.prototype.getKey = original; }
  });

  expect(result.triggered).toBe(true);
  expect(result.past).toBe(11);
  expect(result.hasNewEdit).toBe(true);
});

test('rejects a foreign revision discovered during history-head key verification', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(80, 2);
    for (let index = 0; index < 10; index += 1) await api.edit(index, `外部前置 ${index}`);
    const tableId = api.data.tables[0].id;
    const updateForeignRevision = () => new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('board-game-helper-workspace');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const connection = open.result;
        const transaction = connection.transaction('meta', 'readwrite');
        const store = transaction.objectStore('meta');
        const read = store.get('storage');
        read.onsuccess = () => store.put({ ...read.result, storageRevision: 'foreign-history-revision' }, 'storage');
        transaction.oncomplete = () => { connection.close(); resolve(); };
        transaction.onerror = () => { connection.close(); reject(transaction.error); };
      };
    });
    api.instrument(); api.reads = [];
    let scheduled: Promise<void> | undefined;
    let triggered = false;
    const original = IDBObjectStore.prototype.getKey;
    IDBObjectStore.prototype.getKey = function (this: IDBObjectStore, ...args: any[]) {
      const request = Reflect.apply(original, this, args) as IDBRequest;
      if (this.name === 'historyEntries' && !triggered) {
        triggered = true;
        request.addEventListener('success', () => { scheduled = updateForeignRevision(); }, { once: true });
      }
      return request;
    } as typeof original;
    let failure = '';
    try { await api.db.loadWorkspaceHistoryHead(tableId); }
    catch (error) { failure = (error as Error).name; }
    finally { IDBObjectStore.prototype.getKey = original; }
    if (scheduled) await scheduled;
    return { failure, triggered, keyReads: api.reads.filter(read => read.store === 'historyEntries' && read.method === 'getKey').length };
  });

  expect(result.triggered).toBe(true);
  expect(result.failure).toBe('WorkspaceStorageConflictError');
  expect(result.keyReads).toBeGreaterThan(0);
});
