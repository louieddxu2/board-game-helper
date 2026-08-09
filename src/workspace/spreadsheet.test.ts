import { describe, expect, it } from 'vitest';
import { createColumn, createNode, createRow, createTable, emptyWorkspace } from './model';
import { cloneImportedWorkspace, exportWorkspaceXlsx, importWorkspaceXlsx } from './spreadsheet';
import type { WorkspaceData } from './types';

const ensureBlobArrayBuffer = () => {
  if (typeof Blob.prototype.arrayBuffer === 'function') return;
  Object.defineProperty(Blob.prototype, 'arrayBuffer', {
    configurable: true,
    value(this: Blob) {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    },
  });
};

const makeFixture = (): WorkspaceData => {
  const table = createTable('收藏清單');
  const status = createColumn('狀態', 'select'); status.options = ['已擁有', '想要'];
  const quantity = createColumn('數量', 'number');
  table.columns.push(status, quantity);
  const row = createRow(table.columns);
  row.values[table.columns[0].id] = '花磚物語';
  row.values[status.id] = '已擁有';
  row.values[quantity.id] = 2;
  table.rows = [row];
  const node = createNode('table', table.name, null, 0, table.id);
  return { ...emptyWorkspace(), nodes: [node], tables: [table], activeNodeId: node.id };
};

describe('workspace spreadsheet format', () => {
  it('round-trips one table through an xlsx workbook', async () => {
    ensureBlobArrayBuffer();
    const source = makeFixture();
    const table = source.tables[0];
    table.rowHeaderName = '桌遊收藏';
    table.textScale = 1.4;
    table.columns[0].alignment = 'right';
    table.rows[0].name = '花磚物語';
    const imported = await importWorkspaceXlsx(exportWorkspaceXlsx(source, table));
    expect(imported.isWorkspace).toBe(false);
    expect(imported.table?.name).toBe('收藏清單（匯入）');
    expect(imported.table?.columns.map((column) => column.inputType)).toEqual(['text', 'select', 'number']);
    expect(imported.table?.rowHeaderName).toBe('桌遊收藏');
    expect(imported.table?.textScale).toBe(1.4);
    expect(imported.table?.columns[0].alignment).toBe('right');
    expect(imported.table?.rows[0].name).toBe('花磚物語');
    expect(imported.table?.rows[0].values[imported.table.columns[2].id]).toBe(2);
  });

  it('preserves line breaks inside fixed options through an xlsx round trip', async () => {
    ensureBlobArrayBuffer();
    const source = makeFixture();
    source.tables[0].columns[1].options = ['第一行\n第二行', '單行'];
    const imported = await importWorkspaceXlsx(exportWorkspaceXlsx(source, source.tables[0]));
    expect(imported.table?.columns[1].options).toEqual(['第一行\n第二行', '單行']);
  });

  it('round-trips link values, overflow modes, and the editable first-column property', async () => {
    ensureBlobArrayBuffer();
    const source = makeFixture();
    const table = source.tables[0];
    table.rowHeaderName = '來源';
    table.rowHeader = { ...table.rowHeader!, name: '來源', inputType: 'link', overflowMode: 'ellipsis' };
    table.rows[0].name = { url: 'https://example.com/game', label: '遊戲頁面' };
    const link = createColumn('規則', 'link');
    link.overflowMode = 'expand';
    table.columns.push(link);
    table.rows[0].values[link.id] = { url: 'https://example.com/rules', label: '規則頁' };

    const imported = await importWorkspaceXlsx(exportWorkspaceXlsx(source, table));

    expect(imported.table?.rowHeader).toMatchObject({ name: '來源', inputType: 'link', overflowMode: 'ellipsis' });
    expect(imported.table?.rows[0].name).toEqual({ url: 'https://example.com/game', label: '遊戲頁面' });
    expect(imported.table?.columns.at(-1)).toMatchObject({ name: '規則', inputType: 'link', overflowMode: 'expand' });
    expect(imported.table?.rows[0].values[imported.table.columns.at(-1)!.id]).toEqual({ url: 'https://example.com/rules', label: '規則頁' });
  });

  it('round-trips the non-destructive transposed view preference', async () => {
    ensureBlobArrayBuffer();
    const source = makeFixture();
    source.tables[0].transposed = true;

    const imported = await importWorkspaceXlsx(exportWorkspaceXlsx(source, source.tables[0]));

    expect(imported.table?.transposed).toBe(true);
    expect(imported.table?.columns.map((column) => column.name)).toEqual(source.tables[0].columns.map((column) => column.name));
    expect(imported.table?.rows.map((row) => row.name)).toEqual(source.tables[0].rows.map((row) => row.name));
  });

  it('round-trips the workspace tree through multiple sheets', async () => {
    ensureBlobArrayBuffer();
    const source = makeFixture();
    const folder = createNode('folder', '桌遊', null, 0);
    source.nodes[0].parentId = folder.id;
    source.nodes.push(folder);
    const imported = await importWorkspaceXlsx(exportWorkspaceXlsx(source));
    expect(imported.isWorkspace).toBe(true);
    expect(imported.data?.nodes).toHaveLength(2);
    expect(imported.data?.tables[0].name).toBe('收藏清單');
    const copy = cloneImportedWorkspace(imported.data!);
    expect(copy.nodes.every((node) => node.id !== imported.data?.nodes.find((original) => original.name === node.name)?.id)).toBe(true);
    expect(copy.nodes.find((node) => node.type === 'table')?.tableId).toBe(copy.tables[0].id);
    expect(copy.nodes.find((node) => node.type === 'table')?.parentId).toBe(copy.nodes.find((node) => node.type === 'folder')?.id);
  });
});
