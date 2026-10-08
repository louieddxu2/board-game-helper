import { expect, test } from '@playwright/test';
import type { } from './storageFixture';
import { startStorageFixture } from './storageSupport';

let site: Awaited<ReturnType<typeof startStorageFixture>>;
test.beforeAll(async () => { site = await startStorageFixture('hydration'); });
test.afterAll(async () => site.close());
let errors: string[];
test.beforeEach(async ({ page }) => { errors = []; page.on('pageerror', error => errors.push(error.message)); });
test.afterEach(() => expect(errors).toEqual([]));

test('hydrates 10,000 rows with exact two-key canonical batches and yields heartbeat time', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(10_000, 12);
    const source = api.data.tables[0];
    const column = { ...source.columns[0], inputType: 'dynamic-select' as const, options: [] };
    const preparedTable = {
      ...source,
      columns: [column, ...source.columns.slice(1)],
      rows: source.rows.map((row, index) => ({ ...row, values: { ...row.values, [column.id]: index < 7_000 ? 'Common' : 'Rare' } })),
    };
    api.data = { ...api.data, tables: [preparedTable] };
    await api.db.saveWorkspace(api.data);
  });
  await page.reload();
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    api.instrument(); api.reads = [];
    let heartbeats = 0;
    const heartbeat = window.setInterval(() => { heartbeats += 1; }, 1);
    const loaded = await api.db.loadWorkspace();
    window.clearInterval(heartbeat);
    const canonical = api.reads.filter(read => read.store === 'rowChunks' || read.store === 'rowOrderPages');
    const canonicalGets = canonical.filter(read => read.method === 'get');
    const counts = new Map<number, number>();
    for (const read of canonicalGets) counts.set(read.transaction, (counts.get(read.transaction) ?? 0) + 1);
    const dynamic = loaded.tables[0].columns[0].dynamicOptions?.counts ?? [];
    return {
      rowCount: loaded.tables[0].rows.length,
      first: loaded.tables[0].rows[0].values[loaded.tables[0].columns[0].id],
      last: loaded.tables[0].rows.at(-1)?.values[loaded.tables[0].columns[0].id],
      dynamic: Object.fromEntries(dynamic.map(item => [item.key, item.count])),
      canonicalCount: canonicalGets.length,
      maxCanonicalPerTransaction: Math.max(...counts.values()),
      transactionCount: counts.size,
      canonicalGetAll: canonical.some(read => read.method === 'getAll'),
      manifestCounts: canonical.filter(read => read.method === 'count').length,
      heartbeats,
    };
  });

  expect(result.rowCount).toBe(10_000);
  expect(result.first).toBe('Common'); expect(result.last).toBe('Rare');
  expect(result.dynamic).toEqual({ common: 7_000, rare: 3_000 });
  expect(result.canonicalCount).toBeGreaterThan(10);
  expect(result.maxCanonicalPerTransaction).toBeLessThanOrEqual(2);
  expect(result.transactionCount).toBeGreaterThan(1);
  expect(result.canonicalGetAll).toBe(false);
  expect(result.manifestCounts).toBe(2);
  expect(result.heartbeats).toBeGreaterThan(0);
});

test('keeps malformed late batches private until missing chunks, order, or duplicate rows are repaired', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(600);
    const disk = await api.readDisk();
    const tableId = disk.tables[0].definition.id;
    const record = disk.tables[0] as any;
    const chunks = new Map<string, any>();
    const orders = new Map<string, any>();
    const connection = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('board-game-helper-workspace'); request.onsuccess = () => resolve(request.result); });
    const read = async (store: string, key: IDBValidKey) => new Promise<any>((resolve, reject) => { const request = connection.transaction(store).objectStore(store).get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    for (const chunkId of record.chunkIds) chunks.set(chunkId, await read('rowChunks', [tableId, chunkId]));
    for (const pageId of record.orderPageIds) orders.set(pageId, await read('rowOrderPages', [tableId, pageId]));
    connection.close();
    const mutate = async (store: string, key: IDBValidKey, value: unknown | undefined) => {
      const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('board-game-helper-workspace'); request.onsuccess = () => resolve(request.result); });
      const transaction = db.transaction(store, 'readwrite');
      if (value === undefined) transaction.objectStore(store).delete(key); else transaction.objectStore(store).put(value, key);
      await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
      db.close();
    };
    const failures: string[] = [];
    const loadFailure = async () => { try { await api.db.loadWorkspace(); } catch (error) { failures.push((error as Error).name); } };
    const lastChunkId = [...chunks.keys()].at(-1)!;
    await mutate('rowChunks', [tableId, lastChunkId], undefined); await loadFailure();
    await mutate('rowChunks', [tableId, lastChunkId], chunks.get(lastChunkId));
    const firstChunk = chunks.values().next().value;
    const secondChunk = [...chunks.values()][1];
    await mutate('rowChunks', [tableId, secondChunk.chunkId], { ...secondChunk, rows: [{ ...firstChunk.rows[0], id: firstChunk.rows[0].id }, ...secondChunk.rows.slice(1)] });
    await loadFailure();
    await mutate('rowChunks', [tableId, secondChunk.chunkId], secondChunk);
    const lastOrderId = [...orders.keys()].at(-1)!;
    await mutate('rowOrderPages', [tableId, lastOrderId], undefined); await loadFailure();
    await mutate('rowOrderPages', [tableId, lastOrderId], orders.get(lastOrderId));
    const repaired = await api.db.loadWorkspace();
    return { failures, publishedRows: api.data.tables[0].rows.length, repairedRows: repaired.tables[0].rows.length };
  });

  expect(result.failures).toEqual(['WorkspaceStorageIntegrityError', 'WorkspaceStorageIntegrityError', 'WorkspaceStorageIntegrityError']);
  expect(result.publishedRows).toBe(600);
  expect(result.repairedRows).toBe(600);
});

test('rejects orphan canonical chunks and v2 order pages before hydration can publish', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(600);
    const table = api.data.tables[0];
    const disk = await api.readDisk();
    const put = async (store: string, key: IDBValidKey, value: unknown) => {
      const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('board-game-helper-workspace'); request.onsuccess = () => resolve(request.result); });
      const transaction = db.transaction(store, 'readwrite'); transaction.objectStore(store).put(value, key);
      await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); }); db.close();
    };
    const remove = async (store: string, key: IDBValidKey) => {
      const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('board-game-helper-workspace'); request.onsuccess = () => resolve(request.result); });
      const transaction = db.transaction(store, 'readwrite'); transaction.objectStore(store).delete(key);
      await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); }); db.close();
    };
    const orphanChunk = { tableId: table.id, chunkId: 'orphan-chunk', rows: [{ ...table.rows[0], id: 'orphan-row' }] };
    const orphanOrder = { tableId: table.id, pageId: 'orphan-order', rowIds: [table.rows[0].id] };
    await put('rowChunks', [table.id, orphanChunk.chunkId], orphanChunk);
    await put('rowOrderPages', [table.id, orphanOrder.pageId], orphanOrder);
    api.instrument(); api.reads = [];
    let chunkFailure = '';
    try { await api.db.loadWorkspace(); } catch (error) { chunkFailure = (error as Error).name; }
    const chunkCounts = api.reads.filter(read => read.method === 'count').map(read => read.store);
    await remove('rowChunks', [table.id, orphanChunk.chunkId]);
    api.reads = [];
    let orderFailure = '';
    try { await api.db.loadWorkspace(); } catch (error) { orderFailure = (error as Error).name; }
    const orderCounts = api.reads.filter(read => read.method === 'count').map(read => read.store);
    return { chunkFailure, orderFailure, chunkCounts, orderCounts, publishedRows: api.data.tables[0].rows.length, diskRows: disk.orderedRowIds[0].length };
  });

  expect(result.chunkFailure).toBe('WorkspaceStorageIntegrityError');
  expect(result.orderFailure).toBe('WorkspaceStorageIntegrityError');
  expect(result.chunkCounts).toEqual(['rowChunks', 'rowOrderPages']);
  expect(result.orderCounts).toEqual(['rowChunks', 'rowOrderPages']);
  expect(result.publishedRows).toBe(result.diskRows);
});

test('restarts a same-tab read after a first-batch save and retains both cell and metadata edits', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(10_000, 2);
    api.instrument(); api.reads = []; api.writes = [];
    let firstCanonicalBatch = false;
    let resolveSave!: () => void;
    let rejectSave!: (error: unknown) => void;
    const saveCompleted = new Promise<void>((resolve, reject) => { resolveSave = resolve; rejectSave = reject; });
    const original = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (this: IDBObjectStore, ...args: Parameters<typeof original>) {
      const request = Reflect.apply(original, this, args) as IDBRequest;
      if (this.name === 'rowChunks' && !firstCanonicalBatch) {
        firstCanonicalBatch = true;
        request.addEventListener('success', () => {
          const command = api.prepareCell(9_000, '讀取途中修改');
          const changed = { ...command.data, structureRevision: 'during-hydration-save' };
          api.data = changed;
          void api.db.saveWorkspace(changed, command.options).then(resolveSave, rejectSave);
        }, { once: true });
      }
      return request;
    } as typeof original;
    try {
      const loaded = await api.db.loadWorkspace();
      await saveCompleted;
      const canonicalGets = api.reads.filter(read => read.store === 'rowChunks' && read.method === 'get').length;
      return {
        firstCanonicalBatch, canonicalGets,
        value: loaded.tables[0].rows[9_000].values[loaded.tables[0].columns[0].id],
        revision: loaded.structureRevision,
      };
    } finally { IDBObjectStore.prototype.get = original; }
  });

  expect(result.firstCanonicalBatch).toBe(true);
  expect(result.canonicalGets).toBeGreaterThan(2);
  expect(result.value).toBe('讀取途中修改');
  expect(result.revision).toBe('during-hydration-save');
});

test('does not publish a cross-tab revision conflict or continue stale canonical reads', async ({ page, context }) => {
  await page.goto(`${site.origin}/probe`);
  const id = await page.evaluate(async () => { const api = window.workspaceStorageFixture; await api.initialize(600); return api.data.tables[0].id; });
  await page.evaluate(async () => { const api = window.workspaceStorageFixture; api.data = await api.db.loadWorkspace(); });
  const peer = await context.newPage();
  await peer.goto(`${site.origin}/probe`);
  await peer.evaluate(async () => { const api = window.workspaceStorageFixture; api.data = await api.db.loadWorkspace(); await api.edit(0, '外部分頁修改'); });
  const result = await page.evaluate(async ({ tableId }) => {
    const api = window.workspaceStorageFixture;
    let current = true;
    api.instrument(); api.reads = [];
    const original = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (this: IDBObjectStore, key: IDBValidKey | IDBKeyRange) {
      if (this.name === 'rowChunks') current = false;
      return original.call(this, key);
    };
    let conflict = '';
    try { await api.db.loadWorkspace({ expectCurrentRevision: true, tableIds: [tableId], isCurrent: () => current }); }
    catch (error) { conflict = (error as Error).name; }
    finally { IDBObjectStore.prototype.get = original; }
    return { conflict, retained: api.data.tables[0].rows[0].values[api.data.tables[0].columns[0].id], chunkReads: api.reads.filter(read => read.store === 'rowChunks').length, orderReads: api.reads.filter(read => read.store === 'rowOrderPages').length };
  }, { tableId: id });
  await peer.close();

  expect(result.conflict).toBe('WorkspaceStorageConflictError');
  expect(result.retained).toBe('資料 0-0');
  expect(result.chunkReads).toBe(0);
  expect(result.orderReads).toBe(0);
});

test('rejects a foreign revision discovered after the first canonical batch without publishing a partial table', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const cached = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(10_000, 2);
    const data = await api.db.loadWorkspace();
    return { tableId: data.tables[0].id, data };
  });
  await page.reload();
  const result = await page.evaluate(async ({ tableId, data }) => {
    const api = window.workspaceStorageFixture;
    await api.db.loadWorkspaceInitial({ paged: true });
    api.data = data;
    api.instrument(); api.reads = [];
    let firstCanonicalBatch = false;
    const updateForeignRevision = async () => {
      const open = indexedDB.open('board-game-helper-workspace');
      const connection = await new Promise<IDBDatabase>((resolve, reject) => { open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
      const transaction = connection.transaction('meta', 'readwrite');
      const store = transaction.objectStore('meta');
      const current = await new Promise<any>((resolve, reject) => {
        const request = store.get('storage'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      store.put({ ...current, storageRevision: 'foreign-mid-hydration' }, 'storage');
      await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
      connection.close();
    };
    let foreignRevision: Promise<void> | undefined;
    const original = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (this: IDBObjectStore, ...args: Parameters<typeof original>) {
      const request = Reflect.apply(original, this, args) as IDBRequest;
      if (this.name === 'rowChunks' && !firstCanonicalBatch) {
        firstCanonicalBatch = true;
        request.addEventListener('success', () => { foreignRevision = updateForeignRevision(); }, { once: true });
      }
      return request;
    } as typeof original;
    let conflict = '';
    try { await api.db.loadWorkspace({ expectCurrentRevision: true, tableIds: [tableId] }); }
    catch (error) { conflict = (error as Error).name; }
    finally { IDBObjectStore.prototype.get = original; }
    if (foreignRevision) await foreignRevision;
    return {
      conflict, firstCanonicalBatch, foreignScheduled: Boolean(foreignRevision),
      rowChunkGets: api.reads.filter(read => read.store === 'rowChunks' && read.method === 'get').length,
      retained: api.data.tables[0].rows[0].values[api.data.tables[0].columns[0].id],
    };
  }, cached);

  expect(result.firstCanonicalBatch).toBe(true);
  expect(result.foreignScheduled).toBe(true);
  expect(result.rowChunkGets).toBeGreaterThan(0);
  expect(result.conflict).toBe('WorkspaceStorageConflictError');
  expect(result.retained).toBe('資料 0-0');
});

test('stops after the first canonical batch when isCurrent becomes false', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(600);
    let current = true;
    api.instrument(); api.reads = [];
    const original = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (this: IDBObjectStore, key: IDBValidKey | IDBKeyRange) {
      if (this.name === 'rowChunks') current = false;
      return original.call(this, key);
    };
    let failure = '';
    try { await api.db.loadWorkspace({ isCurrent: () => current }); } catch (error) { failure = (error as Error).name; }
    finally { IDBObjectStore.prototype.get = original; }
    const chunks = api.reads.filter(read => read.store === 'rowChunks' && read.method === 'get');
    const orders = api.reads.filter(read => read.store === 'rowOrderPages' && read.method === 'get');
    return { failure, chunks: chunks.length, orders: orders.length };
  });

  expect(result.failure).toBe('AbortError');
  expect(result.chunks).toBeLessThanOrEqual(2);
  expect(result.orders).toBe(0);
});

test('reads v1 embedded order without order pages and v2 through its canonical order pages', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(600);
    const disk = await api.readDisk();
    const table = disk.tables[0] as any;
    const id = table.definition.id;
    const request = indexedDB.open('board-game-helper-workspace');
    const db = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result); });
    const put = async (record: any) => {
      const transaction = db.transaction('tables', 'readwrite'); transaction.objectStore('tables').put(record, id);
      await new Promise<void>(resolve => { transaction.oncomplete = () => resolve(); });
    };
    await put({ ...table, storageFormat: 'row-chunks-v1', rowOrder: disk.orderedRowIds[0] });
    db.close();
    api.instrument(); api.reads = [];
    const legacy = await api.db.loadWorkspace();
    const legacyOrderReads = api.reads.filter(read => read.store === 'rowOrderPages').length;
    const restore = await new Promise<IDBDatabase>(resolve => { const open = indexedDB.open('board-game-helper-workspace'); open.onsuccess = () => resolve(open.result); });
    const transaction = restore.transaction('tables', 'readwrite'); transaction.objectStore('tables').put(table, id);
    await new Promise<void>(resolve => { transaction.oncomplete = () => resolve(); }); restore.close();
    api.reads = [];
    const current = await api.db.loadWorkspace();
    return { legacyRows: legacy.tables[0].rows.length, legacyFirst: legacy.tables[0].rows[0].id, expectedFirst: disk.orderedRowIds[0][0], legacyOrderReads, currentRows: current.tables[0].rows.length, v2OrderReads: api.reads.filter(read => read.store === 'rowOrderPages').length };
  });

  expect(result.legacyRows).toBe(600);
  expect(result.legacyFirst).toBe(result.expectedFirst);
  expect(result.legacyOrderReads).toBe(0);
  expect(result.currentRows).toBe(600);
  expect(result.v2OrderReads).toBeGreaterThan(0);
});

test('deferred v1 hydration normalizes legacy values without writes, then materializes an early save', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(600, 4);
    const source = api.data.tables[0];
    const [text, linkSource, dateSource, dynamicSource] = source.columns;
    const link = { ...linkSource, inputType: 'link' as const };
    const date = { ...dateSource, inputType: 'datetime' as const };
    const dynamic = { ...dynamicSource, inputType: 'dynamic-select' as const, options: [] };
    const preparedTable = {
      ...source,
      columns: [text, link, date, dynamic],
      rows: source.rows.map((row, index) => ({
        ...row,
        values: {
          ...row.values,
          [link.id]: index === 0 ? 'https://old.example/entry' : `https://old.example/${index}`,
          [date.id]: index === 0 ? 1_735_689_600_000 : '2025-01-02T00:00:00.000Z',
          [dynamic.id]: index < 400 ? 'Alpha' : 'Beta',
        },
      })),
    };
    api.data = { ...api.data, tables: [preparedTable] };
    await api.db.saveWorkspace(api.data);
    const disk = await api.readDisk();
    const tableRecord = disk.tables[0] as any;
    const tableId = tableRecord.definition.id;
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('board-game-helper-workspace'); request.onsuccess = () => resolve(request.result); });
    const legacyRecord = { ...tableRecord };
    delete legacyRecord.orderPageIds;
    const invalidDynamicOptions = { version: 99, sourceRevision: 'invalid', isMultiple: false, counts: [] };
    const transaction = db.transaction(['tables', 'tableState', 'rowOrderPages'], 'readwrite');
    for (const order of disk.orders.filter(page => page.tableId === tableId)) transaction.objectStore('rowOrderPages').delete([tableId, order.pageId]);
    const stateStore = transaction.objectStore('tableState');
    const stateRequest = stateStore.get(tableId);
    stateRequest.onsuccess = () => {
      const state = stateRequest.result ?? {};
      stateStore.put({ ...state, columnState: { ...(state.columnState ?? {}), [dynamic.id]: { dynamicOptions: invalidDynamicOptions } } }, tableId);
    };
    transaction.objectStore('tables').put({
      ...legacyRecord,
      storageFormat: 'row-chunks-v1',
      rowOrder: disk.orderedRowIds[0],
      definition: {
        ...tableRecord.definition,
        columns: tableRecord.definition.columns.map((column: any) => column.id === dynamic.id
          ? { ...column, dynamicOptions: invalidDynamicOptions }
          : column),
      },
    }, tableId);
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); }); db.close();
    api.instrument(); api.reads = []; api.writes = [];
    const loaded = await api.db.loadWorkspace({ deferStartupWork: true });
    const orderReads = api.reads.filter(read => read.store === 'rowOrderPages');
    const deferredWrites = [...api.writes];
    const loadedFirst = loaded.tables[0];
    const loadedFirstRow = loadedFirst.rows[0];
    const loadedLastRow = loadedFirst.rows.at(-1)!;
    const deferredDynamicOptions = loadedFirst.columns.find(column => column.id === dynamic.id)?.dynamicOptions;
    api.data = loaded;
    await api.edit(0, '延後讀取後修改');
    const saved = await api.readDisk();
    const reopened = await api.db.loadWorkspace();
    const reopenedTable = reopened.tables[0];
    const reopenedFirst = reopenedTable.rows[0];
    const reopenedLast = reopenedTable.rows.at(-1)!;
    return {
      rows: loadedFirst.rows.length,
      orderReads,
      deferredWrites,
      link: loadedFirstRow.values[link.id],
      date: loadedFirstRow.values[date.id],
      lastDate: loadedLastRow.values[date.id],
      dynamicValue: loadedFirstRow.values[dynamic.id],
      deferredDynamicOptions,
      format: saved.tables[0].storageFormat,
      value: saved.cells[0][0].value,
      orderPageCount: saved.orders.filter(page => page.tableId === tableId).length,
      reopenedLink: reopenedFirst.values[link.id],
      reopenedDate: reopenedFirst.values[date.id],
      reopenedLastDate: reopenedLast.values[date.id],
      reopenedDynamicValue: reopenedFirst.values[dynamic.id],
      reopenedDynamicCounts: reopenedTable.columns.find(column => column.id === dynamic.id)?.dynamicOptions?.counts,
    };
  });

  expect(result.rows).toBe(600);
  expect(result.orderReads).toEqual([]);
  expect(result.deferredWrites).toEqual([]);
  expect(result.link).toEqual({ url: 'https://old.example/entry', label: '' });
  expect(result.date).toBe('2025-01-01T00:00:00.000Z');
  expect(result.lastDate).toBe('2025-01-02T00:00:00.000Z');
  expect(result.dynamicValue).toBe('Alpha');
  expect(result.deferredDynamicOptions).toEqual({ version: 99, sourceRevision: 'invalid', isMultiple: false, counts: [] });
  expect(result.format).toBe('row-chunks-v2');
  expect(result.value).toBe('延後讀取後修改');
  expect(result.orderPageCount).toBeGreaterThan(0);
  expect(result.reopenedLink).toEqual({ url: 'https://old.example/entry', label: '' });
  expect(result.reopenedDate).toBe('2025-01-01T00:00:00.000Z');
  expect(result.reopenedLastDate).toBe('2025-01-02T00:00:00.000Z');
  expect(result.reopenedDynamicValue).toBe('Alpha');
  expect(Object.fromEntries((result.reopenedDynamicCounts ?? []).map((item: any) => [item.key, item.count]))).toEqual({ alpha: 400, beta: 200 });
});

test('initial active-only hydration tolerates another missing table while retaining active pins for later reads', async ({ page }) => {
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(300, 2, 3);
    const [active, missing, pin] = api.data.tables;
    api.data = { ...api.data, bottomNavigationTableIds: [pin.id] };
    await api.db.saveWorkspace(api.data);
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('board-game-helper-workspace'); request.onsuccess = () => resolve(request.result); });
    const transaction = db.transaction('tables', 'readwrite'); transaction.objectStore('tables').delete(missing.id);
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); }); db.close();
    api.instrument(); api.reads = [];
    const initial = await api.db.loadWorkspaceInitial();
    const initialTableGets = api.reads.filter(read => read.store === 'tables' && read.method === 'get').map(read => read.key);
    api.reads = [];
    const pins = await api.db.loadWorkspace({ expectCurrentRevision: true, tableIds: [pin.id] });
    const pinTableGets = api.reads.filter(read => read.store === 'tables' && read.method === 'get').map(read => read.key);
    return {
      activeId: active.id, pinId: pin.id, missingId: missing.id,
      initialIds: initial.data.tables.map(table => table.id), complete: initial.complete,
      retainedPins: initial.data.bottomNavigationTableIds,
      initialTableGets, pinTableGets, pinRows: pins.tables[0].rows.length,
    };
  });

  expect(result.initialIds).toEqual([result.activeId]);
  expect(result.complete).toBe(false);
  expect(result.retainedPins).toEqual([result.pinId]);
  expect(result.initialTableGets).toEqual([result.activeId]);
  expect(result.initialTableGets).not.toContain(result.missingId);
  expect(result.pinTableGets).toEqual([result.pinId]);
  expect(result.pinRows).toBe(300);
});

test('completes hydration once even when idle callbacks are held', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'requestIdleCallback', { configurable: true, value: () => 0 }); });
  await page.goto(`${site.origin}/probe`);
  const result = await page.evaluate(async () => {
    const api = window.workspaceStorageFixture;
    await api.initialize(300);
    const loaded = await api.db.loadWorkspace();
    return { rows: loaded.tables[0].rows.length, last: loaded.tables[0].rows.at(-1)?.name };
  });

  expect(result).toEqual({ rows: 300, last: '項目 299' });
});
