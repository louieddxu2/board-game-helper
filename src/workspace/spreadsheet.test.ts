import { describe, expect, it } from 'vitest';
import { createColumn, createNode, createRow, createTable, emptyWorkspace, ensureWorkspaceDynamicOptions } from './model';
import { cloneImportedWorkspace, exportWorkspaceArchive, exportWorkspaceBackupManifestXlsx, exportWorkspaceXlsx, importWorkspaceArchive, importWorkspaceBackupManifestXlsx, importWorkspaceXlsx, inferPlainColumnSettings } from './spreadsheet';
import type { WorkspaceData } from './types';
import { WorkspaceDynamicOptionsCache } from './dynamicOptionsCache';
import { assignWorkspaceChangeRevisions, workspaceTableChangeRevision } from './changeRevisions';

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

const readStoredWorkbook = async (blob: Blob) => {
  ensureBlobArrayBuffer();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const decoder = new TextDecoder();
  const read16 = (offset: number) => bytes[offset] | (bytes[offset + 1] << 8);
  const read32 = (offset: number) => (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
  const entries = new Map<string, string>();
  let offset = 0;
  while (offset + 4 <= bytes.length && read32(offset) === 0x04034b50) {
    const size = read32(offset + 18);
    const nameLength = read16(offset + 26);
    const extraLength = read16(offset + 28);
    const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const contentStart = offset + 30 + nameLength + extraLength;
    entries.set(name, decoder.decode(bytes.subarray(contentStart, contentStart + size)));
    offset = contentStart + size;
  }
  const workbook = new DOMParser().parseFromString(entries.get('xl/workbook.xml')!, 'application/xml');
  const sheetNames = Array.from(workbook.getElementsByTagName('sheet')).map((sheet) => sheet.getAttribute('name'));
  const sheetRows = (index: number) => {
    const document = new DOMParser().parseFromString(entries.get(`xl/worksheets/sheet${index + 1}.xml`)!, 'application/xml');
    return Array.from(document.getElementsByTagName('row')).map((row) => Array.from(row.getElementsByTagName('c')).map((cell) => cell.getElementsByTagName('t')[0]?.textContent ?? cell.getElementsByTagName('v')[0]?.textContent ?? ''));
  };
  return { sheetNames, sheetRows };
};

const replaceStoredWorkbookText = async (blob: Blob, search: string, replacement: string) => {
  ensureBlobArrayBuffer();
  const encoder = new TextEncoder();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const needle = encoder.encode(search);
  const replacementBytes = encoder.encode(replacement);
  expect(needle).toHaveLength(replacementBytes.length);
  let match = -1;
  for (let index = 0; index <= bytes.length - needle.length; index += 1) {
    if (needle.every((byte, offset) => bytes[index + offset] === byte)) { match = index; break; }
  }
  expect(match).toBeGreaterThanOrEqual(0);
  bytes.set(replacementBytes, match);
  return new Blob([bytes], { type: blob.type });
};

const replaceStoredWorkbookTextWithDifferentLength = async (blob: Blob, search: string, replacement: string) => {
  ensureBlobArrayBuffer();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const read16 = (offset: number) => bytes[offset] | (bytes[offset + 1] << 8);
  const read32 = (offset: number) => (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
  const set32 = (target: Uint8Array, offset: number, value: number) => {
    target[offset] = value & 0xff;
    target[offset + 1] = (value >>> 8) & 0xff;
    target[offset + 2] = (value >>> 16) & 0xff;
    target[offset + 3] = (value >>> 24) & 0xff;
  };
  const parts: Uint8Array[] = [];
  let offset = 0;
  let replaced = false;
  while (offset + 4 <= bytes.length && read32(offset) === 0x04034b50) {
    const size = read32(offset + 18);
    const nameLength = read16(offset + 26);
    const extraLength = read16(offset + 28);
    const headerLength = 30 + nameLength + extraLength;
    const contentStart = offset + headerLength;
    const content = decoder.decode(bytes.subarray(contentStart, contentStart + size));
    const nextContent = !replaced && content.includes(search) ? content.replace(search, replacement) : content;
    if (nextContent !== content) replaced = true;
    const nextBytes = encoder.encode(nextContent);
    const header = bytes.slice(offset, contentStart);
    set32(header, 18, nextBytes.length);
    set32(header, 22, nextBytes.length);
    parts.push(header, nextBytes);
    offset = contentStart + size;
  }
  expect(replaced).toBe(true);
  const rebuilt = new Uint8Array(parts.reduce((total, part) => total + part.length, bytes.length - offset));
  let writeOffset = 0;
  for (const part of parts) { rebuilt.set(part, writeOffset); writeOffset += part.length; }
  rebuilt.set(bytes.slice(offset), writeOffset);
  return new Blob([rebuilt], { type: blob.type });
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
  it('retags valid legacy statistics when merging imported tables without recounting their cells', () => {
    const source = makeFixture();
    const table = source.tables[0];
    table.updatedAt = 1;
    table.changeRevision = undefined;
    table.columns[1] = { ...table.columns[1], inputType: 'dynamic-select', options: [] };
    const saved = ensureWorkspaceDynamicOptions(source);
    const originalStatistics = saved.tables[0].columns[1].dynamicOptions!;
    const copied = cloneImportedWorkspace(saved);
    const imported = copied.tables[0];
    expect(imported.columns[1].dynamicOptions?.sourceRevision).toBe(workspaceTableChangeRevision(imported));
    expect(imported.columns[1].dynamicOptions?.counts).toBe(originalStatistics.counts);
    expect(originalStatistics.sourceRevision).toBe('legacy:1');
    let reads = 0;
    imported.rows = imported.rows.map(row => ({ ...row, get values() { reads += 1; return row.values; } }));
    const cache = new WorkspaceDynamicOptionsCache();
    cache.primePreparedTables(copied, [imported.id]);
    const prepared = cache.prepare(undefined, assignWorkspaceChangeRevisions(undefined, copied));
    expect(cache.getOptions(prepared.tables[0], imported.columns[1].id)).toEqual(['已擁有']);
    expect(reads).toBe(0);
  });

  it('does not make stale statistics valid by remapping import IDs', () => {
    const source = makeFixture();
    source.tables[0].columns[1].inputType = 'dynamic-select';
    const saved = ensureWorkspaceDynamicOptions(source);
    saved.tables[0].columns[1].dynamicOptions!.sourceRevision = 'stale';
    expect(cloneImportedWorkspace(saved).tables[0].columns[1].dynamicOptions).toBeUndefined();
  });

  it('keeps XLSX settings unchanged and rebuilds dynamic column statistics on import', async () => {
    const source = makeFixture();
    const table = source.tables[0];
    table.columns[1] = { ...table.columns[1], inputType: 'dynamic-select', isMultiple: true, options: [] };
    const columnId = table.columns[1].id;
    table.rows[0].values[columnId] = 'Rare';
    table.rows.push(...['Common, common', 'Common'].map(value => ({ ...createRow(table.columns), values: { [columnId]: value } })));
    const prepared = ensureWorkspaceDynamicOptions(source);
    for (const exported of [exportWorkspaceXlsx(prepared, prepared.tables[0]), exportWorkspaceXlsx(prepared)]) {
      const workbook = await readStoredWorkbook(exported);
      expect(JSON.stringify(workbook.sheetRows(1))).not.toContain('dynamicOptions');
      const imported = await importWorkspaceXlsx(exported);
      const restored = imported.table ?? imported.data!.tables[0];
      expect(restored.columns[1]).toMatchObject({ inputType: 'dynamic-select', isMultiple: true, options: [], dynamicOptions: {
        version: 1, counts: [{ key: 'rare', count: 1 }, { key: 'common', count: 2 }],
      } });
    }
  });

  it('infers conservative property types for ordinary spreadsheet imports', () => {
    expect(inferPlainColumnSettings([1, 2, 3])).toMatchObject({ inputType: 'number' });
    expect(inferPlainColumnSettings(['example.com/a', 'https://example.org/b'])).toMatchObject({ inputType: 'link' });
    expect(inferPlainColumnSettings(['2026/08/12 20:14', '2026/08/13 09:00'])).toMatchObject({ inputType: 'datetime', dateOnly: false });
    expect(inferPlainColumnSettings(['2026/08/12', '2026/08/13'])).toMatchObject({ inputType: 'datetime', dateOnly: true });
    expect(inferPlainColumnSettings(['合作', '競爭', '合作'])).toEqual({ inputType: 'select', options: ['合作', '競爭'], overflowMode: 'wrap' });
    expect(inferPlainColumnSettings(['唯一一', '唯一二', '唯一三'])).toMatchObject({ inputType: 'text', options: [] });
  });

  it('applies inferred property types while importing an ordinary data-only workbook', async () => {
    const source = makeFixture();
    const table = source.tables[0];
    const website = createColumn('網站');
    const playedAt = createColumn('遊玩時間');
    table.columns.push(website, playedAt);
    table.rows[0].values[website.id] = 'example.com/a';
    table.rows[0].values[playedAt.id] = '2026/08/12 20:14';
    const second = createRow(table.columns, '第二款');
    second.values[table.columns[0].id] = '另一款遊戲';
    second.values[table.columns[1].id] = '已擁有';
    second.values[table.columns[2].id] = 4;
    second.values[website.id] = 'https://example.org/b';
    second.values[playedAt.id] = '2026/08/13 09:00';
    table.rows.push(second);
    const exported = exportWorkspaceXlsx(source, table);
    const settingsSheetTag = '<sheet name="收藏清單__設定" sheetId="2" r:id="rId2"/>';
    const dataOnlyWorkbook = await replaceStoredWorkbookText(exported, settingsSheetTag, ' '.repeat(new TextEncoder().encode(settingsSheetTag).length));

    const imported = await importWorkspaceXlsx(dataOnlyWorkbook);
    expect(imported.source).toBe('plain');

    expect(imported.table?.columns.map((column) => column.inputType)).toEqual(['text', 'select', 'number', 'link', 'datetime']);
    expect(imported.table?.columns[1].options).toEqual(['已擁有']);
    expect(imported.table?.rows[0].values[imported.table.columns[3].id]).toEqual({ url: 'example.com/a', label: '' });
  });

  it('exports a clean data sheet followed by a separate settings sheet', async () => {
    const source = makeFixture();
    source.tables[0].rowHeaderName = '桌遊收藏';
    const workbook = await readStoredWorkbook(exportWorkspaceXlsx(source, source.tables[0]));

    expect(workbook.sheetNames).toEqual(['收藏清單', '收藏清單__設定']);
    expect(workbook.sheetRows(0)[0]).toEqual(['桌遊收藏', '屬性 1', '狀態', '數量']);
    expect(workbook.sheetRows(0).flat()).not.toContain('__workspace_table');
    expect(workbook.sheetRows(0).flat()).not.toContain('__workspace_table_settings');
    expect(workbook.sheetRows(1)[0]).toEqual(['__workspace_table_settings', '1']);
    expect(workbook.sheetRows(1)).toContainEqual(['data_sheet', '收藏清單']);
  });

  it('imports the v1 split-sheet table layout', async () => {
    const source = makeFixture();
    source.tables[0].columns[1].isMultiple = true;
    const workbookBlob = exportWorkspaceXlsx(source, source.tables[0]);
    const workbook = await readStoredWorkbook(workbookBlob);
    const imported = await importWorkspaceXlsx(workbookBlob);

    expect(workbook.sheetNames).toEqual(['收藏清單', '收藏清單__設定']);
    expect(workbook.sheetRows(1)[0]).toEqual(['__workspace_table_settings', '1']);
    expect(imported.table?.columns.map((column) => column.inputType)).toEqual(['text', 'select', 'number']);
    expect(imported.table?.columns[1].isMultiple).toBe(true);
    expect(imported.table?.rows[0].values[imported.table.columns[2].id]).toBe(2);
  });

  it('imports the v1 whole-workspace layout', async () => {
    const source = makeFixture();
    const imported = await importWorkspaceXlsx(exportWorkspaceXlsx(source));

    expect(imported.isWorkspace).toBe(true);
    expect(imported.data?.nodes).toEqual(source.nodes);
    expect(imported.data?.tables[0].name).toBe(source.tables[0].name);
  });

  it('rejects an unknown settings version instead of guessing another layout', async () => {
    const source = makeFixture();
    const workbook = exportWorkspaceXlsx(source, source.tables[0]);
    const unknownVersion = await replaceStoredWorkbookText(workbook, '__workspace_table_settings</t></is></c><c r="B1"><v>1</v>', '__workspace_table_settings</t></is></c><c r="B1"><v>9</v>');

    await expect(importWorkspaceXlsx(unknownVersion)).rejects.toThrow('不支援的 __workspace_table_settings 格式版本：9');
  });

  it('does not treat a pre-release internal marker as a supported legacy format', async () => {
    const source = makeFixture();
    const workbook = exportWorkspaceXlsx(source, source.tables[0]);
    const internalFormat = await replaceStoredWorkbookText(workbook, '__workspace_table_settings', '__workspace_table_internal');

    await expect(importWorkspaceXlsx(internalFormat)).rejects.toThrow('無法辨識的 Workspace 格式標記：__workspace_table_internal');
  });

  it('rejects an unknown workspace version instead of guessing another layout', async () => {
    const source = makeFixture();
    const workbook = exportWorkspaceXlsx(source);
    const unknownVersion = await replaceStoredWorkbookText(workbook, '__workspace</t></is></c><c r="B1"><v>1</v>', '__workspace</t></is></c><c r="B1"><v>9</v>');

    await expect(importWorkspaceXlsx(unknownVersion)).rejects.toThrow('不支援的 __workspace 格式版本：9');
  });

  it('rejects a changed data header instead of assigning values to the wrong property', async () => {
    const source = makeFixture();
    source.tables[0].rowHeaderName = '桌遊收藏';
    const workbook = exportWorkspaceXlsx(source, source.tables[0]);
    const changedHeader = await replaceStoredWorkbookText(workbook, '>桌遊收藏</t>', '>錯誤欄位</t>');

    await expect(importWorkspaceXlsx(changedHeader)).rejects.toThrow('資料頁欄位與設定頁不一致');
  });

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
    expect(imported.source).toBe('structured');
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

  it('preserves the multi-select property setting through an xlsx round trip', async () => {
    ensureBlobArrayBuffer();
    const source = makeFixture();
    source.tables[0].columns[1].isMultiple = true;
    const imported = await importWorkspaceXlsx(exportWorkspaceXlsx(source, source.tables[0]));
    expect(imported.table?.columns[1].isMultiple).toBe(true);
  });

  it('preserves the numeric input mode through an xlsx round trip', async () => {
    ensureBlobArrayBuffer();
    const source = makeFixture();
    source.tables[0].columns[2].numberInputMode = 'step';
    const imported = await importWorkspaceXlsx(exportWorkspaceXlsx(source, source.tables[0]));
    expect(imported.table?.columns[2].numberInputMode).toBe('step');
  });

  it('round-trips fixed option colors and numeric range colors', async () => {
    ensureBlobArrayBuffer();
    const source = makeFixture();
    const table = source.tables[0];
    const status = table.columns[1];
    status.optionColors = { 已擁有: '#2F6F5E', 想要: '#C2410C' };
    status.hidden = true;
    table.columns[2].numberRanges = [
      { min: null, max: 0, color: '#1D4ED8' },
      { min: 1, max: 10, color: '#2F6F5E' },
      { min: 11, max: null, color: '#C2410C' },
    ];
    table.rowHeader = { ...table.rowHeader!, inputType: 'select', options: ['已擁有'], optionColors: { 已擁有: '#7C3AED' } };

    const imported = await importWorkspaceXlsx(exportWorkspaceXlsx(source, table));
    expect(imported.table?.columns[1].optionColors).toEqual(status.optionColors);
    expect(imported.table?.columns[1].hidden).toBe(true);
    expect(imported.table?.columns[2].numberRanges).toEqual(table.columns[2].numberRanges);
    expect(imported.table?.rowHeader?.optionColors).toEqual({ 已擁有: '#7C3AED' });
  });

  it('round-trips the full-width-character column width limit', async () => {
    const source = makeFixture();
    source.tables[0].columns[0].overflowMode = 'ellipsis';
    source.tables[0].columns[0].widthLimitChars = 8;

    const imported = await importWorkspaceXlsx(exportWorkspaceXlsx(source, source.tables[0]));

    expect(imported.table?.columns[0]).toMatchObject({ overflowMode: 'ellipsis', widthLimitChars: 8 });
  });

  it('round-trips the date-only display preference without changing the stored date-time', async () => {
    const source = makeFixture();
    source.tables[0].columns[0].inputType = 'datetime';
    source.tables[0].columns[0].dateOnly = true;
    source.tables[0].rows[0].values[source.tables[0].columns[0].id] = '2026-08-12T12:14:00.000Z';

    const imported = await importWorkspaceXlsx(exportWorkspaceXlsx(source, source.tables[0]));

    expect(imported.table?.columns[0].dateOnly).toBe(true);
    expect(imported.table?.rows[0].values[imported.table.columns[0].id]).toBe('2026-08-12T12:14:00.000Z');
  });

  it('round-trips the wrapped line limit without shifting the date-only setting', async () => {
    const source = makeFixture();
    source.tables[0].columns[0].dateOnly = true;
    source.tables[0].columns[0].lineLimit = 3;

    const exported = exportWorkspaceXlsx(source, source.tables[0]);
    const workbook = await readStoredWorkbook(exported);
    const columnSettings = workbook.sheetRows(1).find((row) => row[0] === 'column');
    const imported = await importWorkspaceXlsx(exported);

    expect(columnSettings).toContain('true');
    expect(columnSettings).toContain('3');
    expect(imported.table?.columns[0]).toMatchObject({ dateOnly: true, lineLimit: 3 });
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
    table.rows[0].values[link.id] = { url: 'example.com/rules', label: '規則頁' };
    const labelOnlyRow = createRow(table.columns, '第二筆');
    labelOnlyRow.values[link.id] = { url: '', label: '僅名稱' };
    table.rows.push(labelOnlyRow);

    const exported = exportWorkspaceXlsx(source, table);
    const workbook = await readStoredWorkbook(exported);
    const imported = await importWorkspaceXlsx(exported);

    expect(workbook.sheetRows(0)[1]).toContain('遊戲頁面\nhttps://example.com/game');
    expect(workbook.sheetRows(0)[1]).toContain('規則頁\nexample.com/rules');
    expect(workbook.sheetRows(0)[2]).toContain('僅名稱\n');
    expect(imported.table?.rowHeader).toMatchObject({ name: '來源', inputType: 'link', overflowMode: 'ellipsis' });
    expect(imported.table?.rows[0].name).toEqual({ url: 'https://example.com/game', label: '遊戲頁面' });
    expect(imported.table?.columns.at(-1)).toMatchObject({ name: '規則', inputType: 'link', overflowMode: 'expand' });
    expect(imported.table?.rows[0].values[imported.table.columns.at(-1)!.id]).toEqual({ url: 'example.com/rules', label: '規則頁' });
    expect(imported.table?.rows[1].values[imported.table.columns.at(-1)!.id]).toEqual({ url: '', label: '僅名稱' });
  });

  it('round-trips date-time values as normalized ISO strings', async () => {
    ensureBlobArrayBuffer();
    const source = makeFixture();
    const table = source.tables[0];
    const dateTime = createColumn('建立時間', 'datetime');
    table.columns.push(dateTime);
    table.rows[0].values[dateTime.id] = '2024-02-03T06:05:00.000Z';

    const imported = await importWorkspaceXlsx(exportWorkspaceXlsx(source, table));

    expect(imported.table?.columns.at(-1)).toMatchObject({ name: '建立時間', inputType: 'datetime' });
    expect(imported.table?.rows[0].values[imported.table.columns.at(-1)!.id]).toBe('2024-02-03T06:05:00.000Z');
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

  it('preserves table and workspace revisions through XLSX and ZIP exports', async () => {
    ensureBlobArrayBuffer();
    const source = makeFixture();
    source.tables[0].changeRevision = 'table-revision-1';
    source.structureRevision = 'structure-revision-1';
    source.bottomNavigationTableIds = [source.tables[0].id];

    const singleTable = await importWorkspaceXlsx(exportWorkspaceXlsx(source, source.tables[0]), { preserveIds: true });
    expect(singleTable.table?.changeRevision).toBe('table-revision-1');

    const workspace = await importWorkspaceXlsx(exportWorkspaceXlsx(source));
    expect(workspace.data?.structureRevision).toBe('structure-revision-1');
    expect(workspace.data?.tables[0].changeRevision).toBe('table-revision-1');

    const archive = await importWorkspaceArchive(await exportWorkspaceArchive(source));
    expect(archive.data?.structureRevision).toBe('structure-revision-1');
    expect(archive.data?.tables[0].changeRevision).toBe('table-revision-1');
  });

  it('parses legacy fingerprint manifests by named columns without restoring the fingerprint', async () => {
    const source = makeFixture();
    source.structureRevision = 'structure-revision-legacy';
    source.tables[0].id = 'table-1';
    source.nodes[0] = { ...source.nodes[0], id: 'node-1', tableId: 'table-1' };
    const currentManifest = exportWorkspaceBackupManifestXlsx(source, [], [{
      id: 'table-1', nodeId: 'node-1', folderId: null, name: '收藏表', updatedAt: 99,
      changeRevision: 'legacy-content', driveFileId: 'drive-table-1', fileName: '收藏表.xlsx',
    }], 123);
    const legacyManifest = await replaceStoredWorkbookTextWithDifferentLength(currentManifest, 'changeRevision', 'contentFingerprint');

    const imported = await importWorkspaceBackupManifestXlsx(legacyManifest);

    expect(imported.structureRevision).toBe('structure-revision-legacy');
    expect(imported.tables).toEqual([expect.objectContaining({ id: 'table-1', driveFileId: 'drive-table-1', fileName: '收藏表.xlsx', updatedAt: 99 })]);
    expect(imported.tables[0]).not.toHaveProperty('contentFingerprint');
    expect(imported.tables[0]).not.toHaveProperty('changeRevision');
  });

  it('exports change revisions in the current manifest schema', async () => {
    const source = makeFixture();
    source.structureRevision = 'structure-revision-2';
    source.tables[0].changeRevision = 'table-revision-2';
    const manifest = await importWorkspaceBackupManifestXlsx(exportWorkspaceBackupManifestXlsx(source, [], [{
      id: source.tables[0].id,
      nodeId: source.nodes[0].id,
      folderId: null,
      name: source.tables[0].name,
      updatedAt: source.tables[0].updatedAt,
      changeRevision: source.tables[0].changeRevision,
      driveFileId: 'drive-table-1',
      fileName: '收藏清單.xlsx',
    }], 123));

    expect(manifest.structureRevision).toBe('structure-revision-2');
    expect(manifest.tables[0].changeRevision).toBe('table-revision-2');
  });

  it('round-trips the workspace tree through multiple sheets', async () => {
    ensureBlobArrayBuffer();
    const source = makeFixture();
    const folder = createNode('folder', '桌遊', null, 0);
    source.nodes[0].parentId = folder.id;
    source.nodes.push(folder);
    source.bottomNavigationTableIds = [source.tables[0].id];
    const imported = await importWorkspaceXlsx(exportWorkspaceXlsx(source));
    const workbook = await readStoredWorkbook(exportWorkspaceXlsx(source));
    expect(workbook.sheetNames).toEqual(['__workspace', '收藏清單', '收藏清單__設定']);
    expect(imported.isWorkspace).toBe(true);
    expect(imported.source).toBe('workspace');
    expect(imported.data?.nodes).toHaveLength(2);
    expect(imported.data?.tables[0].name).toBe('收藏清單');
    expect(imported.data?.bottomNavigationTableIds).toEqual([source.tables[0].id]);
    const copy = cloneImportedWorkspace(imported.data!);
    expect(copy.nodes.every((node) => node.id !== imported.data?.nodes.find((original) => original.name === node.name)?.id)).toBe(true);
    expect(copy.nodes.find((node) => node.type === 'table')?.tableId).toBe(copy.tables[0].id);
    expect(copy.nodes.find((node) => node.type === 'table')?.parentId).toBe(copy.nodes.find((node) => node.type === 'folder')?.id);
    expect(copy.bottomNavigationTableIds).toEqual([copy.tables[0].id]);
  });

  it('exports and imports the whole workspace as a folder-shaped ZIP archive', async () => {
    const source = makeFixture();
    const folder = createNode('folder', '桌遊', null, 0);
    source.nodes[0].parentId = folder.id;
    source.nodes.push(folder);
    source.bottomNavigationTableIds = [source.tables[0].id];

    const archive = await exportWorkspaceArchive(source);
    expect(archive.type).toBe('application/zip');

    const imported = await importWorkspaceArchive(archive);
    expect(imported.isWorkspace).toBe(true);
    const importedData = imported.data;
    expect(importedData).toBeDefined();
    expect(importedData?.nodes).toEqual(source.nodes);
    expect(importedData?.tables).toHaveLength(1);
    expect(importedData?.tables[0].name).toBe(source.tables[0].name);
    expect(importedData?.tables[0].columns[1].inputType).toBe('select');
    expect(importedData?.tables[0].rows[0].values[importedData?.tables[0].columns[2].id]).toBe(2);
    expect(importedData?.bottomNavigationTableIds).toEqual([source.tables[0].id]);
  });
});
