import { describe, expect, it } from 'vitest';
import { createNode, createTable, emptyWorkspace } from './model';
import { exportWorkspaceArchive, exportWorkspaceBackupManifestXlsx, exportWorkspaceXlsx, importWorkspaceArchive, importWorkspaceBackupManifestXlsx, WORKSPACE_ARCHIVE_ROOT } from './spreadsheet';
import { blobBytes, readStoredZip, zipStoreBytes } from './spreadsheetCodec';

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

  it('imports a flat snapshot ZIP from any root while preserving nested folders and safe duplicate names', async () => {
    const folder = createNode('folder', '策略/擴充', null, 0);
    const nestedFolder = createNode('folder', '..', folder.id, 0);
    const first = createTable('manifest');
    const second = createTable('manifest');
    const reserved = createTable('..');
    const firstNode = createNode('table', first.name, nestedFolder.id, 0, first.id);
    const secondNode = createNode('table', second.name, folder.id, 1, second.id);
    const reservedNode = createNode('table', reserved.name, null, 2, reserved.id);
    const source = {
      ...emptyWorkspace(),
      nodes: [folder, nestedFolder, firstNode, secondNode, reservedNode],
      tables: [first, second, reserved],
      activeNodeId: firstNode.id,
      bottomNavigationTableIds: [first.id],
    };
    const refs = [
      { id: first.id, nodeId: firstNode.id, folderId: nestedFolder.id, name: first.name, updatedAt: first.updatedAt, driveFileId: 'drive-1', fileName: 'manifest-2.xlsx' },
      { id: second.id, nodeId: secondNode.id, folderId: folder.id, name: second.name, updatedAt: second.updatedAt, driveFileId: 'drive-2', fileName: 'manifest-3.xlsx' },
      { id: reserved.id, nodeId: reservedNode.id, folderId: null, name: reserved.name, updatedAt: reserved.updatedAt, driveFileId: 'drive-3', fileName: '未命名.xlsx' },
    ];
    const root = 'downloaded-snapshot/session-42/';
    const entries = [{
      name: `${root}manifest.xlsx`,
      content: await blobBytes(exportWorkspaceBackupManifestXlsx(source, [
        { id: folder.id, name: folder.name, parentId: folder.parentId, order: folder.order, driveFolderId: '' },
        { id: nestedFolder.id, name: nestedFolder.name, parentId: nestedFolder.parentId, order: nestedFolder.order, driveFolderId: '' },
      ], refs, 123, 'flat')),
    }];
    for (const ref of refs) {
      const table = source.tables.find(item => item.id === ref.id)!;
      entries.push({ name: `${root}${ref.fileName}`, content: await blobBytes(exportWorkspaceXlsx(source, table)) });
    }

    const archive = await zipStoreBytes(entries, 'application/zip');
    const imported = await importWorkspaceArchive(archive);

    expect(imported.data?.nodes).toEqual(source.nodes);
    expect(imported.data?.bottomNavigationTableIds).toEqual(source.bottomNavigationTableIds);
    expect(imported.data?.tables.map(table => table.name)).toEqual(source.tables.map(table => table.name));
  });
});
