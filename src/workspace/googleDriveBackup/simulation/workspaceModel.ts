import { createNode, createTable, emptyWorkspace } from '../../model';
import type { WorkspaceData, WorkspaceTable } from '../../types';

/** A device's IndexedDB as the backup code observes it. Every edit replaces `data` immutably. */
export interface SimulatedDevice {
  name: string;
  data: WorkspaceData;
  /** Changes whenever the browser's site data (IndexedDB) is recreated. */
  storageIdentity: string;
  localStorage: Map<string, string>;
}

export type EditKind = 'cell' | 'add-row' | 'add-table' | 'delete-table' | 'rename-table';

let counter = 0;
const tick = () => (counter += 1);
export const resetModelCounter = () => { counter = 0; };

const tableWith = (name: string, marker: string): WorkspaceTable => {
  const table = createTable(name);
  const stamp = tick();
  table.id = `table-${marker}-${stamp}`;
  table.columns[0].id = `column-${marker}-${stamp}`;
  table.rowHeader = { ...table.rowHeader!, id: `row-header-${table.id}` };
  table.rows = [{ id: `row-${stamp}`, name: `列 ${stamp}`, values: { [table.columns[0].id]: `${marker} 初始 ${stamp}` } }];
  table.changeRevision = `rev-${stamp}`;
  table.updatedAt = Date.now();
  return table;
};

const withTables = (data: WorkspaceData, tables: WorkspaceTable[], structural: boolean): WorkspaceData => ({
  ...data,
  tables,
  nodes: structural
    ? tables.map((table, order) => ({ ...(data.nodes.find(node => node.tableId === table.id) ?? createNode('table', table.name, null, order, table.id)), name: table.name, order }))
    : data.nodes,
  bottomNavigationTableIds: structural ? tables.slice(0, 2).map(table => table.id) : data.bottomNavigationTableIds,
  structureRevision: structural ? `structure-${tick()}` : data.structureRevision,
  updatedAt: Date.now(),
});

export const emptyDeviceData = (): WorkspaceData => ({ ...emptyWorkspace(), structureRevision: `structure-${tick()}` });

export const populatedDeviceData = (marker: string, tableCount = 2): WorkspaceData =>
  withTables(emptyDeviceData(), Array.from({ length: tableCount }, (_, index) => tableWith(`${marker} 表 ${index + 1}`, marker)), true);

export const createDevice = (name: string, tableCount = 2): SimulatedDevice => ({
  name,
  data: tableCount ? populatedDeviceData(name, tableCount) : emptyDeviceData(),
  storageIdentity: `idb-${name}-${tick()}`,
  localStorage: new Map(),
});

/** Names include characters Drive file names reject and deliberate duplicates. */
const awkwardNames = ['收藏', '收藏', 'a/b:c*?', '..', '表格.', ' '];

export const editDevice = (device: SimulatedDevice, kind: EditKind, pick: number) => {
  const { data } = device;
  const index = data.tables.length ? pick % data.tables.length : -1;
  const touch = (table: WorkspaceTable, change: Partial<WorkspaceTable>): WorkspaceTable =>
    ({ ...table, ...change, changeRevision: `rev-${tick()}`, updatedAt: Date.now() });
  if (kind === 'add-table' || index < 0) {
    if (data.tables.length >= 4) return;
    device.data = withTables(data, [...data.tables, tableWith(`${device.name} 新表 ${tick()}`, device.name)], true);
    return;
  }
  const table = data.tables[index];
  if (kind === 'delete-table') {
    device.data = withTables(data, data.tables.filter(item => item !== table), true);
    return;
  }
  if (kind === 'rename-table') {
    const renamed = touch(table, { name: awkwardNames[pick % awkwardNames.length].trim() || `表 ${tick()}` });
    device.data = withTables(data, data.tables.map(item => item === table ? renamed : item), true);
    return;
  }
  const column = table.columns[0].id;
  const rows = kind === 'add-row'
    ? [...table.rows, { id: `row-${tick()}`, name: `列 ${tick()}`, values: { [column]: `新增 ${tick()}` } }]
    : table.rows.map((row, rowIndex) => rowIndex === pick % table.rows.length ? { ...row, values: { ...row.values, [column]: `編輯 ${tick()}` } } : row);
  device.data = withTables(data, data.tables.map(item => item === table ? touch(table, { rows }) : item), false);
};

/** Browser site data was cleared: IndexedDB always goes, localStorage only sometimes. */
export const wipeDevice = (device: SimulatedDevice, keepLocalStorage: boolean) => {
  device.data = emptyDeviceData();
  device.storageIdentity = `idb-${device.name}-${tick()}`;
  if (!keepLocalStorage) device.localStorage.clear();
};

/** Everything a user would call "my data": structure, names and cell contents, not bookkeeping. */
export const contentFingerprint = (data: WorkspaceData) => JSON.stringify({
  nodes: [...data.nodes].sort((left, right) => left.id.localeCompare(right.id))
    .map(node => [node.id, node.type, node.name, node.parentId, node.order, node.tableId ?? null]),
  navigation: data.bottomNavigationTableIds ?? [],
  tables: [...data.tables].sort((left, right) => left.id.localeCompare(right.id)).map(table => [
    table.id, table.name, table.columns.map(column => [column.id, column.name, column.inputType]),
    table.rows.map(row => [row.name, table.columns.map(column => row.values[column.id] ?? null)]),
  ]),
});

export const sameRevisions = (left: WorkspaceData, right: WorkspaceData) => left.structureRevision === right.structureRevision
  && left.tables.length === right.tables.length
  && left.tables.every(table => right.tables.find(item => item.id === table.id)?.changeRevision === table.changeRevision);
