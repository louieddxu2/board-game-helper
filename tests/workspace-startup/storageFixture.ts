import * as db from '../../src/workspace/db';
import * as model from '../../src/workspace/model';
import * as history from '../../src/workspace/history';
import * as spreadsheet from '../../src/workspace/spreadsheet';
import * as rowPages from '../../src/workspace/rowPages';
import { assignWorkspaceChangeRevisions } from '../../src/workspace/changeRevisions';
import { WorkspaceDynamicOptionsCache } from '../../src/workspace/dynamicOptionsCache';
import { prepareWorkspaceColumnSave } from '../../src/workspace/columnConversion';
import type { WorkspaceData } from '../../src/workspace/types';

type Write = { store: string; method: string; key: unknown; transaction: number };
const fixture = {
  db, model, history, spreadsheet, rowPages, assignWorkspaceChangeRevisions, WorkspaceDynamicOptionsCache, prepareWorkspaceColumnSave,
  dynamicOptionsCache: new WorkspaceDynamicOptionsCache(),
  data: model.emptyWorkspace() as WorkspaceData,
  histories: new Map<string, history.WorkspaceTableHistory>(),
  writes: [] as Write[],
  reads: [] as { store: string; method: string; key: unknown }[],
  failNextChunk: false,
  failureMode: 'abort' as 'abort' | 'quota',
  async initialize(rows = 600, columns = 2, tables = 1) {
    await db.loadWorkspace();
    await db.clearWorkspace();
    const tableList = Array.from({ length: tables }, (_, tableIndex) => {
      const table = model.createTable(`表格 ${tableIndex}`);
      table.columns = Array.from({ length: columns }, (_, index) => model.createColumn(`欄位 ${index}`));
      table.rows = Array.from({ length: rows }, (_, index) => ({ id: model.makeId('row'), name: `項目 ${index}`, values: Object.fromEntries(table.columns.map((column, col) => [column.id, `資料 ${index}-${col}`])) }));
      table.changeRevision = `semantic-${tableIndex}`;
      return table;
    });
    this.data = model.normalizeWorkspace({ ...model.emptyWorkspace(), structureRevision: 'structure-before', tables: tableList, nodes: tableList.map((table, index) => model.createNode('table', table.name, null, index, table.id)) });
    this.data.activeNodeId = this.data.nodes[0]?.id ?? null;
    this.histories = new Map();
    this.dynamicOptionsCache = new WorkspaceDynamicOptionsCache();
    await db.saveWorkspace(this.data, { history: { clearAll: true } });
    this.writes = [];
  },
  prepareCell(index: number, value: string, tableIndex = 0, append = false) {
    const previous = this.data;
    const table = previous.tables[tableIndex];
    const row = table.rows[index];
    const columnId = table.columns[0].id;
    const mutation: history.WorkspaceTableMutation = { tableId: table.id, label: '編輯', action: { type: 'set-cell', rowId: row.id, columnId, before: row.values[columnId], after: value } };
    const revised = assignWorkspaceChangeRevisions(previous, { ...previous, tables: previous.tables.map(item => item === table ? { ...table, updatedAt: Date.now(), rows: table.rows.map(item => item === row ? { ...row, values: { ...row.values, [columnId]: value } } : item) } : item) });
    this.data = this.dynamicOptionsCache.prepare(previous, revised, mutation);
    const nextHistory = history.pushWorkspaceTableHistory(this.histories.get(table.id) ?? history.createEmptyWorkspaceTableHistory(table.id), mutation);
    this.histories.set(table.id, nextHistory);
    const options: db.WorkspaceSaveOptions = { mutation, history: append ? { append: [...this.histories.values()].flatMap(item => item.past) } : { replace: [...this.histories.values()] } };
    return { data: this.data, options };
  },
  async edit(index: number, value: string, tableIndex = 0, append = false) {
    const command = this.prepareCell(index, value, tableIndex, append);
    await db.saveWorkspace(command.data, command.options);
  },
  instrument() {
    for (const method of ['get', 'getAll', 'getAllKeys'] as const) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (this: IDBObjectStore, ...args: unknown[]) {
        fixture.reads.push({ store: this.name, method, key: args[0] });
        return Reflect.apply(original, this, args);
      } as typeof IDBObjectStore.prototype[typeof method];
    }
    const transactions = new WeakMap<IDBTransaction, number>();
    let nextId = 0;
    const getTransactionId = (transaction: IDBTransaction) => {
      if (!transactions.has(transaction)) transactions.set(transaction, ++nextId);
      return transactions.get(transaction)!;
    };
    for (const method of ['put', 'delete', 'clear'] as const) {
      const original = IDBObjectStore.prototype[method];
      IDBObjectStore.prototype[method] = function (this: IDBObjectStore, ...args: unknown[]) {
        fixture.writes.push({ store: this.name, method, key: method === 'put' ? args[1] : args[0], transaction: getTransactionId(this.transaction) });
        if (method === 'put' && this.name === 'rowChunks' && fixture.failNextChunk && fixture.failureMode === 'quota') {
          fixture.failNextChunk = false;
          throw new DOMException('Simulated storage quota exhausted', 'QuotaExceededError');
        }
        const request = Reflect.apply(original, this, args) as IDBRequest;
        if (method === 'put' && this.name === 'rowChunks' && fixture.failNextChunk) {
          fixture.failNextChunk = false;
          const transaction = this.transaction;
          request.addEventListener('success', () => transaction.abort(), { once: true });
        }
        return request;
      } as typeof IDBObjectStore.prototype[typeof method];
    }
  },
  async readDisk() {
    const request = indexedDB.open('board-game-helper-workspace');
    const connection = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const transaction = connection.transaction(['meta', 'tables', 'tableState', 'rowChunks', 'history', 'historyEntries', 'tableHeads', 'rowPages']);
    const readAll = (store: string) => new Promise<any[]>((resolve, reject) => { const request = transaction.objectStore(store).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const [meta, tables, states, chunks, heads, entries, tableHeads, pages] = await Promise.all(['meta', 'tables', 'tableState', 'rowChunks', 'history', 'historyEntries', 'tableHeads', 'rowPages'].map(readAll));
    connection.close();
    return {
      meta, tables, states, heads, tableHeads, pages, entryIds: entries.map(entry => entry.id),
      chunks: chunks.map(chunk => ({ tableId: chunk.tableId, chunkId: chunk.chunkId, count: chunk.rows.length })),
      cells: this.data.tables.map(table => {
        const rows = new Map<string, any>(chunks.filter(chunk => chunk.tableId === table.id).flatMap(chunk => chunk.rows.map((row: any) => [row.id, row])));
        const record = tables.find(item => (item.definition?.id ?? item.id) === table.id);
        if (record?.rows) for (const row of record.rows) rows.set(row.id, row);
        return [table.rows[0], table.rows[256], table.rows.at(-1)].filter(Boolean).map(row => ({ rowId: row!.id, value: rows.get(row!.id)?.values[table.columns[0].id] }));
      }),
    };
  },
};
declare global { interface Window { workspaceStorageFixture: typeof fixture } }
window.workspaceStorageFixture = fixture;
