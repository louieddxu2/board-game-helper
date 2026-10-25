// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { createNode, createTable, emptyWorkspace } from '../model';
import type { WorkspaceData } from '../types';
import { workspaceBackupTableSummary, type WorkspaceBackupSource } from '../workspaceBackupSource';
import { createInMemoryDrive, type InMemoryDriveFixture } from './backupTestFixture';
import { createGoogleDriveSnapshotBackup } from './snapshotBackup';
import { RemoteBackupConflictError } from './folderBackup';
import { createSnapshotCoordinator } from './snapshotCoordinator';
import { DRIVE_SNAPSHOT_KEY, DRIVE_SNAPSHOT_XLSX } from '../../shared/driveSnapshots';
import { FOLDER_MIME } from './googleDriveApi';
import { snapshotTags } from './driveSnapshotStore';

const TOKEN = 'snapshot-protocol-drive-token';
const memoryStorage = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; };
const workspace = (suffix = 1) => {
  const table = createTable(`整合測試-${suffix}`); table.updatedAt = 100 + suffix; table.changeRevision = `table-revision-${suffix}`;
  table.rows = [{ ...table.rows[0], id: `row-${suffix}`, name: `第一列-${suffix}`, values: { [table.columns[0].id]: `內容-${suffix}` } }];
  const node = createNode('table', table.name, null, 0, table.id);
  const data: WorkspaceData = { ...emptyWorkspace(), structureRevision: `structure-revision-${suffix}`, nodes: [node], tables: [], activeNodeId: node.id, bottomNavigationTableIds: [table.id] };
  const source: WorkspaceBackupSource = { tables: [workspaceBackupTableSummary(table)], readTable: async id => { if (id !== table.id) throw new Error('unexpected table'); return table; }, verify: async () => undefined };
  return { data, source, table };
};
const serviceFor = (drive: InMemoryDriveFixture, storage = memoryStorage()) => createGoogleDriveSnapshotBackup({
  folderPath: ['BoardGameHelper', '動態表格備份'], backupKey: 'dynamic-sheet-primary-workspace-v2', retainedVersions: 3,
  tokenProvider: { getAccessToken: async () => TOKEN }, fetchImpl: drive.fetchImpl, storage,
});
const rootFor = (drive: InMemoryDriveFixture) => [...drive.files.values()].find(file => file.appProperties?.backupKind === 'root');

describe('browser-to-Drive snapshot protocol integration', () => {
  test('blocks an empty source before creating Drive folders or receipts', async () => {
    const drive = createInMemoryDrive(); const service = serviceFor(drive); const before = [...drive.files.keys()];
    await expect(service.backup(emptyWorkspace(), {}, {})).rejects.toThrow('沒有表格');
    expect([...drive.files.keys()]).toEqual(before); expect(drive.calls.uploads).toHaveLength(0);
  });

  test('writes a receipt beside a complete XLSX snapshot and restores through Drive leases', async () => {
    const requests: string[] = []; const drive = createInMemoryDrive();
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => { requests.push(String(input)); return drive.fetchImpl(input, init); };
    const fixture = workspace(); const service = createGoogleDriveSnapshotBackup({ folderPath: ['BoardGameHelper', '動態表格備份'], backupKey: 'dynamic-sheet-primary-workspace-v2', retainedVersions: 3, tokenProvider: { getAccessToken: async () => TOKEN }, fetchImpl, storage: memoryStorage() });
    const receipt = await service.backup(fixture.data, { sourceUpdatedAt: 101 }, { source: fixture.source });
    service.acknowledgeBackup?.(receipt.file.id); await service.maintain?.();
    const root = rootFor(drive); expect(root?.appProperties).toMatchObject({ backupKey: DRIVE_SNAPSHOT_KEY, backupKind: 'root' });
    const snapshotId = receipt.file.appProperties?.snapshotId;
    const folder = [...drive.files.values()].find(file => file.appProperties?.backupKind === 'snapshot' && file.appProperties.snapshotId === snapshotId)!;
    const children = [...drive.files.values()].filter(file => file.parents?.[0] === folder.id && !file.trashed);
    expect(children).toHaveLength(2); expect(children.every(file => file.mimeType === DRIVE_SNAPSHOT_XLSX)).toBe(true);
    expect(children.map(file => file.appProperties?.backupKind).sort()).toEqual(['manifest', 'table']);
    const jsonReceipt = [...drive.files.values()].find(file => file.appProperties?.backupKind === 'receipt' && file.appProperties.snapshotId === snapshotId)!;
    expect(jsonReceipt.parents).toEqual([root!.id]); expect(jsonReceipt.appProperties).toMatchObject({ schemaVersion: '4' });
    expect(JSON.parse(new TextDecoder().decode(jsonReceipt.body))).toMatchObject({ schema: 1, operation: { status: 'committed', id: snapshotId } });
    const restored = await service.restore(receipt.file);
    expect(restored.tables[0].id).toBe(fixture.table.id); expect(restored.tables[0].rows[0].values[restored.tables[0].columns[0].id]).toBe('內容-1');
    expect(requests.every(url => url.startsWith('https://www.googleapis.com/drive/') || url.startsWith('https://www.googleapis.com/upload/drive/'))).toBe(true);
  });

  test('resumes a partial upload without creating a second snapshot folder', async () => {
    const fixture = workspace(); let failed = false;
    const drive = createInMemoryDrive({ shouldFailUpload: request => request.metadata.appProperties?.backupKind === 'table' && !failed ? (failed = true, 'one table failed') : undefined });
    const storage = memoryStorage(); const service = serviceFor(drive, storage);
    await expect(service.backup(fixture.data, {}, { source: fixture.source })).rejects.toThrow('one table failed');
    const firstFolders = [...drive.files.values()].filter(file => file.appProperties?.backupKind === 'snapshot');
    await expect(service.backup(fixture.data, {}, { source: fixture.source })).resolves.toBeDefined();
    const folders = [...drive.files.values()].filter(file => file.appProperties?.backupKind === 'snapshot' && !file.trashed);
    expect(folders).toHaveLength(1); expect(folders[0].id).toBe(firstFolders[0].id);
    expect(drive.liveFiles().filter(file => file.appProperties?.backupKind === 'table')).toHaveLength(1);
  });

  test('recovers a lost commit response after a service reload without duplicating XLSX files', async () => {
    let loseResponse = true; const drive = createInMemoryDrive({ onUpload: async file => {
      if (!loseResponse || file.appProperties?.backupKind !== 'receipt' || !file.body) return;
      const body = JSON.parse(new TextDecoder().decode(file.body)) as { operation?: { status?: string } };
      if (body.operation?.status === 'committed') { loseResponse = false; throw new Error('lost commit response'); }
    }});
    const storage = memoryStorage(); const fixture = workspace(); const first = serviceFor(drive, storage);
    const receipt = await first.backup(fixture.data, {}, { source: fixture.source }); const uploads = drive.calls.uploads.length; await first.maintain?.();
    const reloaded = serviceFor(drive, storage); const recovered = await reloaded.backup(fixture.data, {}, { source: fixture.source });
    expect(recovered.file.id).toBe(receipt.file.id); expect(drive.calls.uploads.length).toBe(uploads);
  });

  test('validates the decoded manifest before allowing the coordinator to commit', async () => {
    let drive!: InMemoryDriveFixture; let corrupted = false;
    drive = createInMemoryDrive({ onUpload: async file => {
      if (corrupted || file.appProperties?.backupKind !== 'manifest') return;
      corrupted = true; drive.setBody(file.id, new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    }});
    const fixture = workspace(); const service = serviceFor(drive);
    await expect(service.backup(fixture.data, {}, { source: fixture.source })).rejects.toThrow();
    const receipts = [...drive.files.values()].filter(file => file.appProperties?.backupKind === 'receipt' && !file.trashed);
    expect(receipts).toHaveLength(1);
    expect(JSON.parse(new TextDecoder().decode(receipts[0].body)).operation.status).toBe('uploading');
    expect(receipts[0].appProperties?.schemaVersion).toBe('4');
  });

  test('rejects a stale cross-device overwrite before another Drive write', async () => {
    const drive = createInMemoryDrive(); const first = serviceFor(drive, memoryStorage()); const firstWorkspace = workspace(1);
    const firstReceipt = await first.backup(firstWorkspace.data, {}, { source: firstWorkspace.source }); first.acknowledgeBackup?.(firstReceipt.file.id); await first.maintain?.();
    const second = serviceFor(drive, memoryStorage()); const secondWorkspace = workspace(2);
    const secondReceipt = await second.backup(secondWorkspace.data, {}, { source: secondWorkspace.source }); second.acknowledgeBackup?.(secondReceipt.file.id); await second.maintain?.();
    const uploads = drive.calls.uploads.length;
    await expect(first.backup(firstWorkspace.data, {}, { source: firstWorkspace.source, expectedRemoteFileId: firstReceipt.file.id })).rejects.toBeInstanceOf(RemoteBackupConflictError);
    expect(drive.calls.uploads.length).toBe(uploads);
  });

  test('treats changed or missing snapshot files as unavailable during restore', async () => {
    const drive = createInMemoryDrive(); const fixture = workspace(); const service = serviceFor(drive);
    const receipt = await service.backup(fixture.data, {}, { source: fixture.source }); service.acknowledgeBackup?.(receipt.file.id); await service.maintain?.();
    const table = [...drive.files.values()].find(file => file.appProperties?.backupKind === 'table' && file.appProperties.snapshotId === receipt.file.appProperties?.snapshotId)!;
    drive.setBody(table.id, new Uint8Array([99, 98, 97]));
    await expect(service.restore(receipt.file)).rejects.toMatchObject({ code: 'backup_snapshot_changed' });
    table.trashed = true;
    await expect(service.restore(receipt.file)).rejects.toMatchObject({ code: 'backup_snapshot_incomplete' });
  });

  test('adopts complete v3 folders as readonly snapshots and ignores incomplete folders', async () => {
    const drive = createInMemoryDrive(); const fixture = workspace(); const service = serviceFor(drive);
    const receipt = await service.backup(fixture.data, {}, { source: fixture.source }); service.acknowledgeBackup?.(receipt.file.id); await service.maintain?.();
    const snapshotId = receipt.file.appProperties?.snapshotId!; const snapshot = [...drive.files.values()].find(file => file.appProperties?.snapshotId === snapshotId && file.appProperties.backupKind === 'snapshot')!;
    const children = [...drive.files.values()].filter(file => file.parents?.[0] === snapshot.id);
    snapshot.appProperties = { ...snapshot.appProperties, schemaVersion: '3' }; children.forEach(file => { file.appProperties = { ...file.appProperties, schemaVersion: '3' }; });
    const oldReceipt = [...drive.files.values()].find(file => file.appProperties?.backupKind === 'receipt' && file.appProperties.snapshotId === snapshotId)!; oldReceipt.trashed = true;
    const incompleteFolder = drive.addFile({ id: 'legacy-incomplete', name: '舊版未完成', mimeType: FOLDER_MIME, parents: [rootFor(drive)!.id], appProperties: { backupKey: DRIVE_SNAPSHOT_KEY, backupKind: 'snapshot', schemaVersion: '3', snapshotId: 'legacy-incomplete' } });
    drive.addFile({ id: 'legacy-incomplete-manifest', name: 'manifest.xlsx', mimeType: DRIVE_SNAPSHOT_XLSX, parents: [incompleteFolder.id], appProperties: { backupKey: DRIVE_SNAPSHOT_KEY, backupKind: 'manifest', schemaVersion: '3', snapshotId: 'legacy-incomplete' }, body: new Uint8Array([1]) });
    const coordinator = createSnapshotCoordinator({ tokenProvider: { getAccessToken: async () => TOKEN }, fetchImpl: drive.fetchImpl });
    const adopted = await coordinator.state(rootFor(drive)!.id);
    expect(adopted.versions).toHaveLength(1); expect(adopted.versions[0].id).toBe(snapshotId);
    await expect(coordinator.cleanup()).resolves.toEqual({ cleaned: false });
    expect(snapshot.trashed).not.toBe(true); expect(children.every(file => !file.trashed)).toBe(true);
    const next = workspace(2); const migrated = serviceFor(drive, memoryStorage()); const nextReceipt = await migrated.backup(next.data, {}, { source: next.source });
    expect(nextReceipt.file.appProperties?.snapshotId).not.toBe(snapshotId); expect(snapshot.trashed).not.toBe(true); expect(children.every(file => !file.trashed)).toBe(true);
    expect((await coordinator.state(rootFor(drive)!.id)).versions.map(version => version.id)).toContain(nextReceipt.file.appProperties?.snapshotId);
    // The malformed folder remains in Drive but is never promoted to a version.
    expect(incompleteFolder.trashed).not.toBe(true);
  });
});
