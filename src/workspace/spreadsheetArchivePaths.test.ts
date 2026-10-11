import { describe, expect, it } from 'vitest';
import { createNode, createTable, emptyWorkspace } from './model';
import { exportWorkspaceArchive, importWorkspaceArchive, importWorkspaceBackupManifestXlsx, WORKSPACE_ARCHIVE_ROOT } from './spreadsheet';
import { readStoredZip } from './spreadsheetCodec';

if (typeof Blob.prototype.arrayBuffer !== 'function') Object.defineProperty(Blob.prototype, 'arrayBuffer', {
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

describe('workspace archive path allocation', () => {
  it('deduplicates sanitized paths, protects manifest.xlsx, and round-trips names', async () => {
    const folderA = createNode('folder', 'A/B', null, 0);
    const folderB = createNode('folder', 'A:B', null, 1);
    const dotFolder = createNode('folder', '..', null, 2);
    const sameA = createTable('same');
    const sameB = createTable('same');
    const reserved = createTable('manifest');
    const dots = createTable('..');
    const trailingDot = createTable('foo.');
    const tableA = createNode('table', sameA.name, folderA.id, 0, sameA.id);
    const tableB = createNode('table', sameB.name, folderB.id, 0, sameB.id);
    const reservedNode = createNode('table', reserved.name, null, 1, reserved.id);
    const dotsNode = createNode('table', dots.name, null, 2, dots.id);
    const trailingDotNode = createNode('table', trailingDot.name, dotFolder.id, 0, trailingDot.id);
    const source = {
      ...emptyWorkspace(),
      nodes: [folderA, folderB, dotFolder, tableA, tableB, reservedNode, dotsNode, trailingDotNode],
      tables: [sameA, sameB, reserved, dots, trailingDot],
      activeNodeId: tableA.id,
    };

    const archive = await exportWorkspaceArchive(source);
    const entries = await readStoredZip(archive);
    const manifestBytes = entries.get(`${WORKSPACE_ARCHIVE_ROOT}/manifest.xlsx`)!;
    const manifest = await importWorkspaceBackupManifestXlsx(new Blob([manifestBytes.slice().buffer as ArrayBuffer]));
    const fileNames = manifest.tables.map(table => table.fileName);
    const tableEntries = [...entries.keys()].filter(name => name !== `${WORKSPACE_ARCHIVE_ROOT}/manifest.xlsx`);

    expect(fileNames.filter(name => name.startsWith('same'))).toEqual(['same.xlsx', 'same-2.xlsx']);
    expect(fileNames).toContain('manifest-2.xlsx');
    expect(fileNames).toContain('foo.xlsx');
    expect(tableEntries.some(name => name.includes('/未命名/foo.xlsx'))).toBe(true);
    expect(fileNames.some(name => name.includes('..'))).toBe(false);
    expect(tableEntries).toHaveLength(5);
    expect(new Set(tableEntries).size).toBe(5);
    expect(tableEntries.every(name => !name.includes('..'))).toBe(true);

    const imported = await importWorkspaceArchive(archive);
    expect(imported.data?.tables.map(table => table.name)).toEqual(source.tables.map(table => table.name));
    expect(imported.data?.nodes).toEqual(source.nodes);
  });
});
