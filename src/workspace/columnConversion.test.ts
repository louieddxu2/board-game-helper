import { describe, expect, it } from 'vitest';
import { prepareWorkspaceColumnSave, WorkspaceColumnConversionError } from './columnConversion';
import { createColumn, createNode, createTable, emptyWorkspace, ensureTableDynamicOptions, formatWorkspaceDateTime, normalizeWorkspace } from './model';
import { exportWorkspaceXlsx, importWorkspaceXlsx } from './spreadsheet';
import type { WorkspaceCellValue, WorkspaceColumn, WorkspaceData, WorkspaceTable } from './types';

const makeTable = (column: WorkspaceColumn, values: WorkspaceCellValue[], names: WorkspaceCellValue[] = ['第一筆', '第二筆']): WorkspaceTable => {
  const table = createTable('轉換測試');
  table.columns = [column];
  table.rows = values.map((value, index) => ({
    id: `row-${index + 1}`,
    name: names[index] ?? `第 ${index + 1} 筆`,
    values: { [column.id]: value },
  }));
  return table;
};

const asData = (table: WorkspaceTable): WorkspaceData => {
  const node = createNode('table', table.name, null, 0, table.id);
  return { ...emptyWorkspace(), activeNodeId: node.id, nodes: [node], tables: [table] };
};

describe('workspace column conversion', () => {
  it('converts a saved type draft without mutating the current table', () => {
    const source = makeTable({ ...createColumn('數量', 'number'), id: 'column-1' }, [2, 3]);
    const draft = { ...source.columns[0], inputType: 'dynamic-select' as const };

    const saved = prepareWorkspaceColumnSave(source, draft);

    expect(source.columns[0].inputType).toBe('number');
    expect(source.rows.map((row) => row.values['column-1'])).toEqual([2, 3]);
    expect(saved.table.columns[0].inputType).toBe('dynamic-select');
    expect(saved.table.rows.map((row) => row.values['column-1'])).toEqual(['2', '3']);
    expect(saved.changes).toEqual([
      { rowId: 'row-1', before: 2, after: '2' },
      { rowId: 'row-2', before: 3, after: '3' },
    ]);
  });

  it('converts numeric cells to strings before building dynamic-list statistics', () => {
    const source = makeTable({ ...createColumn('數量', 'number'), id: 'column-1' }, [2, 2, 3]);
    const prepared = prepareWorkspaceColumnSave(source, { ...source.columns[0], inputType: 'dynamic-select' });
    const dynamic = ensureTableDynamicOptions(prepared.table);

    expect(dynamic.rows.map((row) => row.values['column-1'])).toEqual(['2', '2', '3']);
    expect(dynamic.columns[0].dynamicOptions?.counts.map(({ key, count }) => [key, count])).toEqual([
      ['2', 2],
      ['3', 1],
    ]);
  });

  it('converts a link to label-first text and keeps the converted text through reload and XLSX export', async () => {
    if (!Blob.prototype.arrayBuffer) Object.defineProperty(Blob.prototype, 'arrayBuffer', { configurable: true, value(this: Blob) {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    } });
    const source = makeTable({ ...createColumn('網站', 'link'), id: 'column-1' }, [
      { url: 'https://example.com/game', label: '遊戲官網' },
      { url: 'https://example.com/rules', label: '' },
    ]);
    const prepared = prepareWorkspaceColumnSave(source, { ...source.columns[0], inputType: 'text' });
    const reloaded = normalizeWorkspace(asData(prepared.table)).tables[0];
    const imports = await Promise.all([prepared.table, reloaded].map(table => importWorkspaceXlsx(exportWorkspaceXlsx(asData(table), table))));

    expect(prepared.table.rows.map((row) => row.values['column-1'])).toEqual(['遊戲官網', 'https://example.com/rules']);
    expect(reloaded.rows.map((row) => row.values['column-1'])).toEqual(['遊戲官網', 'https://example.com/rules']);
    for (const imported of imports) expect(imported.table?.rows.map(row => row.values[imported.table!.columns[0].id])).toEqual(['遊戲官網', 'https://example.com/rules']);
  });

  it.each(['number', 'datetime'] as const)('rejects an invalid %s conversion without changing any table data or settings', (inputType) => {
    const source = makeTable({ ...createColumn('數量', 'text'), id: 'column-1' }, ['12', '不是數字']);
    const candidate = { ...source.columns[0], inputType };

    expect(() => prepareWorkspaceColumnSave(source, candidate)).toThrow(WorkspaceColumnConversionError);
    expect(source.columns[0].inputType).toBe('text');
    expect(source.rows.map((row) => row.values['column-1'])).toEqual(['12', '不是數字']);
  });

  it('keeps row references and does not read cells when saving only column formatting', () => {
    const column = createColumn('數量', 'number');
    const source = makeTable(column, [2]);
    Object.defineProperty(source.rows[0], 'values', { get() { throw new Error('Formatting must not scan row values'); } });
    const prepared = prepareWorkspaceColumnSave(source, { ...column, alignment: 'right' });
    expect(prepared.table.rows).toBe(source.rows);
    expect(prepared.changes).toEqual([]);
  });

  it('uses the previous displayed time when converting a datetime column to text', () => {
    const value = '2026-08-12T12:14:00.000Z';
    const source = makeTable({ ...createColumn('時間', 'datetime'), id: 'column-1' }, [value]);
    const prepared = prepareWorkspaceColumnSave(source, { ...source.columns[0], inputType: 'text' });

    expect(prepared.table.rows[0].values['column-1']).toBe(formatWorkspaceDateTime(value));
  });

  it('converts the editable row header with the same save-time rules', () => {
    const source = makeTable({ ...createColumn('備註', 'text'), id: 'column-1' }, ['甲', '乙'], [
      { url: 'https://example.com/a', label: '甲網站' },
      { url: 'https://example.com/b', label: '' },
    ]);
    source.rowHeader = { ...source.rowHeader!, inputType: 'link' };
    source.rowHeaderName = '來源';
    const prepared = prepareWorkspaceColumnSave(source, { ...source.rowHeader, inputType: 'text' });

    expect(prepared.table.rowHeader?.inputType).toBe('text');
    expect(prepared.table.rows.map((row) => row.name)).toEqual(['甲網站', 'https://example.com/b']);
    expect(prepared.changes.map((change) => [change.rowId, change.before, change.after])).toEqual([
      ['row-1', { url: 'https://example.com/a', label: '甲網站' }, '甲網站'],
      ['row-2', { url: 'https://example.com/b', label: '' }, 'https://example.com/b'],
    ]);
  });
});
