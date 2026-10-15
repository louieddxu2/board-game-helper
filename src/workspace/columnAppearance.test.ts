import { describe, expect, it } from 'vitest';
import { normalizeWorkspaceColumnBackground, workspaceColumnBackgroundPalette } from './columnAppearance';
import { prepareWorkspaceColumnSave } from './columnConversion';
import { createColumn, createNode, createTable, emptyWorkspace } from './model';
import { exportWorkspaceArchive, exportWorkspaceXlsx, importWorkspaceArchive, importWorkspaceXlsx } from './spreadsheet';
import { tableSettingsRows, workbookFromRows } from './spreadsheetCodec';
import type { WorkspaceColumn, WorkspaceData, WorkspaceRow, WorkspaceTable } from './types';

const cream = '#F7EED8';
const blue = '#E8F0F7';

const formula = () => ({
  version: 1 as const,
  expression: '1 / 2',
  variables: {},
  decimalPlaces: 2,
});

const appearanceTable = (): WorkspaceTable => {
  const table = createTable('外觀測試');
  const input = { ...createColumn('輸入', 'number'), id: 'input' };
  const calculated: WorkspaceColumn = { ...createColumn('計算', 'number'), id: 'calculated', formula: formula(), backgroundColor: blue };
  table.rowHeader = { ...table.rowHeader!, backgroundColor: cream };
  table.columns = [input, calculated];
  table.rows = [{ id: 'row-1', name: '第一列', values: { input: 1 } }];
  return table;
};

const appearanceWorkspace = (): WorkspaceData => {
  const table = appearanceTable();
  const node = createNode('table', table.name, null, 0, table.id);
  return { ...emptyWorkspace(), nodes: [node], tables: [table], activeNodeId: node.id };
};

describe('workspace column appearance contract', () => {
  it('accepts only the light editor palette and normalizes imported casing', () => {
    const colors = workspaceColumnBackgroundPalette.map(({ value }) => value).filter(Boolean);
    expect(colors).toHaveLength(6);
    for (const color of colors) expect(normalizeWorkspaceColumnBackground(`  ${color.toLowerCase()} `)).toBe(color);
    for (const invalid of ['', ' #101010 ', '#ffffff', '#F7EED9', null, 42, { value: cream }]) {
      expect(normalizeWorkspaceColumnBackground(invalid)).toBeUndefined();
    }
  });

  it.each([
    ['a normal column', (table: WorkspaceTable) => table.columns[0]],
    ['the row header', (table: WorkspaceTable) => table.rowHeader!],
  ])('saves %s appearance without reading row.values or replacing rows', (_label, pickColumn) => {
    const table = appearanceTable();
    let reads = 0;
    const guardedRows = table.rows.map((row) => ({
      ...row,
      get values() {
        reads += 1;
        throw new Error('appearance-only save must not read row.values');
      },
    })) as unknown as WorkspaceRow[];
    const guardedTable: WorkspaceTable = { ...table, rows: guardedRows };
    const column = pickColumn(guardedTable);

    const saved = prepareWorkspaceColumnSave(guardedTable, { ...column, backgroundColor: ` ${cream.toLowerCase()} ` });

    expect(reads).toBe(0);
    expect(saved.table.rows).toBe(guardedRows);
    expect(saved.changes).toEqual([]);
    const restored = saved.table.rowHeader?.id === column.id ? saved.table.rowHeader : saved.table.columns.find((item) => item.id === column.id);
    expect(restored?.backgroundColor).toBe(cream);
  });

  it('round-trips row-header and calculated-column metadata through XLSX and full archives', async () => {
    const source = appearanceWorkspace();
    const table = source.tables[0];
    const settings = tableSettingsRows(table, table.name);
    const rowHeaderSettings = settings.find((row) => row[0] === 'row_header');
    const columnSettings = settings.find((row) => row[0] === 'column' && row[1] === 'calculated');
    expect(rowHeaderSettings?.[15]).toBe('');
    expect(rowHeaderSettings?.[16]).toBe(cream);
    expect(columnSettings?.[15]).toContain('"decimalPlaces":2');
    expect(columnSettings?.[16]).toBe(blue);

    for (const preserveIds of [false, true]) {
      const imported = await importWorkspaceXlsx(exportWorkspaceXlsx(source, table), { preserveIds });
      const restored = imported.table!;
      const calculated = restored.columns.find((column) => column.name === '計算')!;
      expect(restored.rowHeader?.backgroundColor).toBe(cream);
      expect(calculated.backgroundColor).toBe(blue);
      expect(calculated.formula?.decimalPlaces).toBe(2);
    }

    const archive = await importWorkspaceArchive(await exportWorkspaceArchive(source));
    const restored = archive.data!.tables[0];
    expect(restored.rowHeader?.backgroundColor).toBe(cream);
    expect(restored.columns.find((column) => column.name === '計算')?.backgroundColor).toBe(blue);
    expect(restored.columns.find((column) => column.name === '計算')?.formula?.decimalPlaces).toBe(2);
  });

  it('imports formula metadata from a legacy settings sheet that has no trailing appearance field', async () => {
    const source = appearanceWorkspace();
    const settings = tableSettingsRows(source.tables[0], '舊外觀');
    const legacySettings = settings.map((row) => (
      row[0] === 'columns' || row[0] === 'row_header' || row[0] === 'column' ? row.slice(0, 16) : row
    ));
    const legacyWorkbook = workbookFromRows([
      { name: '舊外觀', rows: [['項目', '輸入', '計算'], ['第一列', 1, '']] },
      { name: '舊外觀__設定', rows: legacySettings },
    ]);

    const imported = await importWorkspaceXlsx(legacyWorkbook, { preserveIds: true });
    const restored = imported.table!;
    const calculated = restored.columns.find((column) => column.name === '計算')!;
    expect(restored.rowHeader?.backgroundColor).toBeUndefined();
    expect(calculated.backgroundColor).toBeUndefined();
    expect(calculated.formula?.decimalPlaces).toBe(2);
  });
});
