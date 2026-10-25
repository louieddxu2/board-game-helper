// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { createNode, createTable, emptyWorkspace } from '../model';
import type { WorkspaceData } from '../types';
import { workspaceBackupTableSummary, type WorkspaceBackupSource } from '../workspaceBackupSource';
import { createInMemoryDrive, type InMemoryDriveFixture } from './backupTestFixture';
import { createGoogleDriveSnapshotBackup } from './snapshotBackup';
import { createSnapshotCoordinator } from './snapshotCoordinator';
import { RemoteBackupConflictError } from './folderBackup';
import { DRIVE_SNAPSHOT_KEY } from '../../shared/driveSnapshots';
import { FOLDER_MIME } from './googleDriveApi';

const TOKEN = 'snapshot-network-drive-token';
const memoryStorage = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; };
const workspace = (suffix: number) => {
  const tables = ['網路測試甲', '網路測試乙'].map((name, tableIndex) => {
    const table = createTable(`${name}-${suffix}`); table.updatedAt = 100 + suffix; table.changeRevision = `network-${suffix}-${tableIndex}`;
    table.rows = Array.from({ length: 2 }, (_, rowIndex) => ({ ...table.rows[0], id: `network-${suffix}-${tableIndex}-${rowIndex}`, name: `列 ${rowIndex}`, values: { [table.columns[0].id]: `值 ${suffix}-${rowIndex}` } }));
    return table;
  });
  const nodes = tables.map((table, index) => createNode('table', table.name, null, index, table.id));
  const data: WorkspaceData = { ...emptyWorkspace(), structureRevision: `network-structure-${suffix}`, nodes, tables: [], activeNodeId: nodes[0].id, bottomNavigationTableIds: tables.map(table => table.id) };
  const source: WorkspaceBackupSource = { tables: tables.map(workspaceBackupTableSummary), readTable: async id => tables.find(table => table.id === id)!, verify: async () => undefined };
  return { data, source, tables };
};
const serviceFor = (drive: InMemoryDriveFixture, fetchImpl = drive.fetchImpl, storage = memoryStorage()) => createGoogleDriveSnapshotBackup({
  folderPath: ['BoardGameHelper', '動態表格備份'], backupKey: 'dynamic-sheet-primary-workspace-v2', retainedVersions: 3,
  tokenProvider: { getAccessToken: async () => TOKEN }, fetchImpl, storage,
});
const coordinatorFor = (drive: InMemoryDriveFixture, fetchImpl = drive.fetchImpl) => createSnapshotCoordinator({ tokenProvider: { getAccessToken: async () => TOKEN }, fetchImpl });
const rootFor = (drive: InMemoryDriveFixture) => [...drive.files.values()].find(file => file.appProperties?.backupKind === 'root')!;
const markLegacy = (drive: InMemoryDriveFixture, snapshotId: string) => {
  const folder = [...drive.files.values()].find(file => file.appProperties?.backupKind === 'snapshot' && file.appProperties.snapshotId === snapshotId)!;
  const children = [...drive.files.values()].filter(file => file.parents?.[0] === folder.id && !file.trashed);
  folder.appProperties = { ...folder.appProperties, schemaVersion: '3' }; children.forEach(file => { file.appProperties = { ...file.appProperties, schemaVersion: '3' }; });
  [...drive.files.values()].find(file => file.appProperties?.backupKind === 'receipt' && file.appProperties.snapshotId === snapshotId)!.trashed = true;
  return { folder, manifest: children.find(file => file.appProperties?.backupKind === 'manifest')!, table: children.find(file => file.appProperties?.backupKind === 'table')! };
};
const createLegacyFixture = async () => {
  const drive = createInMemoryDrive(); const setup = serviceFor(drive); const snapshots: Array<ReturnType<typeof markLegacy>> = [];
  for (let suffix = 1; suffix <= 3; suffix += 1) { const fixture = workspace(suffix); const receipt = await setup.backup(fixture.data, { sourceUpdatedAt: suffix }, { source: fixture.source }); setup.acknowledgeBackup?.(receipt.file.id); await setup.maintain?.(); snapshots.push(markLegacy(drive, receipt.file.appProperties?.snapshotId!)); }
  const emptyIds = Array.from({ length: 10 }, (_, index) => `empty-v3-${index}`);
  emptyIds.forEach(id => drive.addFile({ id, name: `舊版空資料夾-${id}`, mimeType: FOLDER_MIME, parents: [rootFor(drive).id], appProperties: { backupKey: DRIVE_SNAPSHOT_KEY, backupKind: 'snapshot', schemaVersion: '3', snapshotId: id } }));
  return { drive, snapshots, emptyIds };
};

interface RequestLog { phase: string; method: string; path: string; query: string; }
const loggedFetch = (drive: InMemoryDriveFixture, logs: RequestLog[], phase: () => string) => async (input: RequestInfo | URL, init?: RequestInit) => { const url = new URL(String(input)); logs.push({ phase: phase(), method: init?.method ?? 'GET', path: url.pathname, query: decodeURIComponent(url.search).replace(/\+/g, ' ') }); return drive.fetchImpl(input, init); };
const mediaDownloads = (logs: RequestLog[], ids: string[]) => logs.filter(log => log.path.includes('/files/') && log.query.includes('alt=media') && ids.some(id => log.path.endsWith(`/files/${id}`)));
const emptyChildQueries = (logs: RequestLog[], ids: string[]) => logs.filter(log => ids.some(id => log.query.includes(`'${id}' in parents`)));
const historyDiscovery = (logs: RequestLog[]) => logs.filter(log => log.path.endsWith('/files') && log.query.includes('q='));
const metadataGets = (logs: RequestLog[]) => logs.filter(log => log.method === 'GET' && log.path.includes('/files/') && !log.query.includes('alt=media'));
const metadataPatches = (logs: RequestLog[]) => logs.filter(log => log.method === 'PATCH' && log.path.includes('/files/'));

describe('Drive snapshot network budget', () => {
  test('bounds cold discovery, backup, and maintenance while reporting the request budget', async () => {
    const fixture = await createLegacyFixture(); const logs: RequestLog[] = []; let phase = 'cold-find'; const fetchImpl = loggedFetch(fixture.drive, logs, () => phase); const service = serviceFor(fixture.drive, fetchImpl);
    const legacyManifestIds = fixture.snapshots.map(snapshot => snapshot.manifest.id); const remote = await service.findRemoteFile(); const beforeBackup = logs.length; const coldDownloads = mediaDownloads(logs, legacyManifestIds).length;
    phase = 'backup'; const next = workspace(10); const committed = await service.backup(next.data, { sourceUpdatedAt: 10 }, { source: next.source, expectedRemoteFileId: remote?.id }); service.acknowledgeBackup?.(committed.file.id); const beforeMaintain = logs.length;
    phase = 'maintain'; await service.maintain?.();
    const report = { coldRequests: beforeBackup, backupRequests: beforeMaintain - beforeBackup, maintenanceRequests: logs.length - beforeMaintain, foregroundRequests: beforeMaintain, totalRequests: logs.length, coldLegacyManifestDownloads: coldDownloads, totalLegacyManifestDownloads: mediaDownloads(logs, legacyManifestIds).length, emptyChildQueries: emptyChildQueries(logs, fixture.emptyIds).length };
    process.stdout.write(`[snapshot-network-budget] ${JSON.stringify(report)}\n`);
    expect(coldDownloads).toBeLessThanOrEqual(legacyManifestIds.length);
    expect(report.totalLegacyManifestDownloads).toBeLessThanOrEqual(legacyManifestIds.length);
    expect(report.emptyChildQueries).toBe(0);
    expect(report.foregroundRequests).toBeLessThanOrEqual(72);
    expect(report.totalRequests).toBeLessThanOrEqual(80);
    await expect(service.backup(next.data, { sourceUpdatedAt: 10 }, { source: next.source, expectedRemoteFileId: remote?.id })).rejects.toBeInstanceOf(RemoteBackupConflictError);
  });

  test('observes changed legacy metadata and newly completed legacy folders without re-downloading unchanged manifests', async () => {
    const fixture = await createLegacyFixture(); const logs: RequestLog[] = []; let phase = 'state-before'; const fetchImpl = loggedFetch(fixture.drive, logs, () => phase); const coordinator = coordinatorFor(fixture.drive, fetchImpl); const root = rootFor(fixture.drive);
    const before = await coordinator.state(root.id); const oldIds = fixture.snapshots.map(snapshot => snapshot.folder.appProperties!.snapshotId!); const firstManifest = fixture.snapshots[0].manifest; const firstTable = fixture.snapshots[0].table;
    const changedManifestTime = new Date(Date.parse(firstManifest.modifiedTime!) + 60_000).toISOString(); const changedTableTime = new Date(Date.parse(firstTable.modifiedTime!) + 60_000).toISOString(); firstManifest.modifiedTime = changedManifestTime; firstTable.modifiedTime = changedTableTime;
    const setup = serviceFor(fixture.drive); const next = workspace(11); const receipt = await setup.backup(next.data, { sourceUpdatedAt: 11 }, { source: next.source }); setup.acknowledgeBackup?.(receipt.file.id); await setup.maintain?.(); const newLegacy = markLegacy(fixture.drive, receipt.file.appProperties?.snapshotId!);
    phase = 'state-after'; const after = await coordinator.state(root.id); const afterOperation = await coordinator.operation(oldIds[0]); const legacyIds = [...fixture.snapshots.map(snapshot => snapshot.manifest.id), newLegacy.manifest.id];
    expect(before.versions.map(version => version.id)).toEqual(expect.arrayContaining(oldIds)); expect(after.versions.map(version => version.id)).toContain(newLegacy.folder.appProperties!.snapshotId); expect(after.versions.find(version => version.id === oldIds[0])?.modifiedTime).toBe(changedManifestTime); expect(afterOperation?.inventory.find(file => file.id === firstTable.id)?.modifiedTime).toBe(changedTableTime);
    expect(fixture.snapshots.slice(1).every(snapshot => mediaDownloads(logs, [snapshot.manifest.id]).length <= 1)).toBe(true); expect(mediaDownloads(logs, [firstManifest.id]).length).toBeGreaterThan(1); expect(mediaDownloads(logs, [newLegacy.manifest.id]).length).toBeGreaterThanOrEqual(1); expect(mediaDownloads(logs, legacyIds).length).toBeGreaterThanOrEqual(5); expect(emptyChildQueries(logs, fixture.emptyIds)).toHaveLength(0);
  });

  test('operation and renew reuse loaded history instead of another full legacy discovery', async () => {
    const fixture = await createLegacyFixture(); const logs: RequestLog[] = []; let phase = 'warm'; const fetchImpl = loggedFetch(fixture.drive, logs, () => phase); const coordinator = coordinatorFor(fixture.drive, fetchImpl); const root = rootFor(fixture.drive); const state = await coordinator.state(root.id);
    const operation = await coordinator.begin({ id: 'network-probe', rootId: root.id, expectedRevision: state.revision, sourceRevision: 'network-probe-source', legacyStamp: state.legacyStamp, fileCount: 2, sourceUpdatedAt: 12 }); const legacyIds = fixture.snapshots.map(snapshot => snapshot.manifest.id); logs.length = 0; phase = 'probe';
    await expect(coordinator.operation(operation.id)).resolves.toMatchObject({ id: operation.id }); const operationLogs = logs.splice(0); await expect(coordinator.renew(operation.id)).resolves.toBeUndefined(); const renewLogs = logs.splice(0);
    expect(metadataGets(operationLogs).length).toBeLessThanOrEqual(2);
    expect(metadataPatches(operationLogs)).toHaveLength(0);
    expect(historyDiscovery(operationLogs)).toHaveLength(0);
    expect(mediaDownloads(operationLogs, legacyIds)).toHaveLength(0);
    expect(operationLogs.length).toBeLessThanOrEqual(2);
    expect(metadataGets(renewLogs).length).toBeLessThanOrEqual(2);
    expect(metadataPatches(renewLogs)).toHaveLength(1);
    expect(historyDiscovery(renewLogs)).toHaveLength(0);
    expect(mediaDownloads(renewLogs, legacyIds)).toHaveLength(0);
    expect(renewLogs.length).toBeLessThanOrEqual(3);
  });
});
