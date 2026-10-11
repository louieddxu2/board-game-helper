import { expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, resolve } from 'node:path';

export const startServer = async (directory: string) => {
  const state = { documentDelay: 0, workspaceRequests: 0 };
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url!, 'http://localhost').pathname;
    if (pathname === '/workspace') {
      state.workspaceRequests++;
      if (state.documentDelay) await new Promise((done) => setTimeout(done, state.documentDelay));
    }
    if (pathname.startsWith('/api/')) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ user: null, googleClientId: null }));
      return;
    }
    const file = extname(pathname) ? pathname : '/index.html';
    try {
      const body = await readFile(resolve(directory, `.${file}`));
      response.writeHead(200, {
        'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' } as Record<string, string>)[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      response.end(body);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  return { server, state, origin: `http://127.0.0.1:${address.port}` };
};

export const closeServer = (server: Server) => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); });

export const waitForOfflineShell = async (page: Page) => {
  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return registration?.active?.state;
  })).toBe('activated');
};

export const seed = async (page: Page, tables = 1, rows = 4, columns = 2, historyEntries = 40) => page.evaluate(async ({ tables, rows, columns, historyEntries }) => {
  const request = indexedDB.open('board-game-helper-workspace');
  request.onupgradeneeded = () => {
    for (const name of ['state', 'meta', 'tables', 'history']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
  };
  const db = await new Promise<IDBDatabase>((done, reject) => { request.onsuccess = () => done(request.result); request.onerror = () => reject(request.error); });
  const transaction = db.transaction(['meta', 'tables', 'history'], 'readwrite');
  transaction.objectStore('meta').put({ version: 1, activeNodeId: 'node-0', bottomNavigationTableIds: [], nodes: Array.from({ length: tables }, (_, index) => ({ id: `node-${index}`, type: 'table', tableId: `table-${index}`, name: `測試表 ${index}`, parentId: null, order: index })) }, 'workspace');
  for (let index = 0; index < tables; index++) {
    transaction.objectStore('tables').put({
      id: `table-${index}`, name: `測試表 ${index}`, rowHeaderName: '項目', updatedAt: Date.now(),
      columns: Array.from({ length: columns }, (_, col) => ({ id: `column-${col}`, name: `欄位 ${col}`, inputType: 'text', overflowMode: 'expand', options: [] })),
      rows: Array.from({ length: rows }, (_, row) => ({ id: `row-${row}`, name: `項目 ${row}`, values: Object.fromEntries(Array.from({ length: columns }, (_, col) => [`column-${col}`, `資料 ${row}-${col}`])) })),
    }, `table-${index}`);
    transaction.objectStore('history').put({ tableId: `table-${index}`, future: [], past: Array.from({ length: historyEntries }, (_, entry) => ({ id: `entry-${index}-${entry}`, tableId: `table-${index}`, label: '歷史編輯', createdAt: Date.now(), action: { type: 'set-cells', columnId: 'column-0', changes: Array.from({ length: rows }, (_, row) => ({ rowId: `row-${row}`, before: '之前', after: `資料 ${row}-0` })) } })) }, `table-${index}`);
  }
  await new Promise<void>((done, reject) => { transaction.oncomplete = () => done(); transaction.onerror = () => reject(transaction.error); });
  db.close();
  localStorage.setItem('board-game-helper-google-drive-backup', JSON.stringify({ lastBackupAt: Date.now(), tableBackups: {}, structureFingerprint: '' }));
}, { tables, rows, columns, historyEntries });

export const readTableCell = (page: Page, tableId: string, rowId: string, columnId: string) => page.evaluate(async ({ tableId, rowId, columnId }) => {
  const request = indexedDB.open('board-game-helper-workspace');
  const db = await new Promise<IDBDatabase>((done, reject) => { request.onsuccess = () => done(request.result); request.onerror = () => reject(request.error); });
  const transaction = db.transaction(['tables', 'rowChunks']);
  const table = await new Promise<any>((done, reject) => {
    const get = transaction.objectStore('tables').get(tableId);
    get.onsuccess = () => done(get.result);
    get.onerror = () => reject(get.error);
  });
  const rows = table.rows ?? await new Promise<any[]>((done, reject) => {
    const get = transaction.objectStore('rowChunks').getAll(IDBKeyRange.bound([tableId, ''], [tableId, '\uffff']));
    get.onsuccess = () => done(get.result.flatMap((chunk) => chunk.rows));
    get.onerror = () => reject(get.error);
  });
  db.close();
  const row = rows.find((item: { id: string }) => item.id === rowId);
  return row?.values[columnId] ?? null;
}, { tableId, rowId, columnId });

export const visibleVirtualRowIds = (page: Page) => page.locator('.workspace-table tbody tr[data-virtual-row-id]').evaluateAll((items) => items.map((item) => item.getAttribute('data-virtual-row-id')));

export const holdIdleWork = (page: Page) => page.addInitScript(() => {
  const callbacks = new Map<number, IdleRequestCallback>();
  let next = 0;
  window.requestIdleCallback = callback => { callbacks.set(++next, callback); return next; };
  window.cancelIdleCallback = id => { callbacks.delete(id); };
  (window as any).releaseWorkspaceIdleWork = () => {
    const pending = [...callbacks.values()]; callbacks.clear();
    for (const callback of pending) callback({ didTimeout: false, timeRemaining: () => 20 });
  };
});

export const trackWorkspaceReads = (page: Page) => page.addInitScript(() => {
  const painted = new Set<string>();
  const frame = () => {
    const title = document.querySelector('[aria-label="重新命名表格"]')?.textContent;
    if (title && document.querySelector('tr[data-virtual-row-id]')) painted.add(title);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  (window as any).workspaceReads = [];
  for (const method of ['get', 'getAll', 'getAllKeys', 'count'] as const) {
    const original = IDBObjectStore.prototype[method];
    IDBObjectStore.prototype[method] = function (this: IDBObjectStore, ...args: unknown[]) {
      const raw = args[0];
      const key = raw instanceof IDBKeyRange ? (raw.lower as unknown[])[0] : Array.isArray(raw) ? raw[0] : raw;
      (window as any).workspaceReads.push({ store: this.name, method, key, painted: [...painted] });
      return Reflect.apply(original, this, args);
    } as typeof original;
  }
});

export const waitForProjection = (page: Page, count: number) => expect.poll(() => page.evaluate(async () => {
  const request = indexedDB.open('board-game-helper-workspace');
  const connection = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result); });
  if (!connection.objectStoreNames.contains('tableHeads')) { connection.close(); return undefined; }
  const get = connection.transaction('tableHeads').objectStore('tableHeads').get('table-0');
  const head = await new Promise<any>(resolve => { get.onsuccess = () => resolve(get.result); }); connection.close();
  return head?.rowCount;
})).toBe(count);
