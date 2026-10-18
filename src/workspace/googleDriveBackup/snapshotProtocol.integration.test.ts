// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { app } from '../../../worker/index';
import { createDriveSnapshotTestDatabase } from '../../../worker/data/driveSnapshotTestFixture';
import { createInMemoryDrive } from './backupTestFixture';
import { createGoogleDriveSnapshotBackup } from './snapshotBackup';
import { createSnapshotCoordinator } from './snapshotCoordinator';
import { RemoteBackupConflictError } from './folderBackup';
import { createNode, createTable, emptyWorkspace } from '../model';
import type { WorkspaceData } from '../types';
import { workspaceBackupTableSummary, type WorkspaceBackupSource } from '../workspaceBackupSource';

const CLIENT_ID = 'snapshot-protocol.integration.apps.googleusercontent.com';
const OWNER = 'snapshot-protocol-owner';
const TOKEN = `snapshot-protocol-token-${crypto.randomUUID()}`;
const API_BASE = 'https://rules.test/api/workspace-backup';

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
};

const createFixture = () => {
  const database = createDriveSnapshotTestDatabase();
  const drive = createInMemoryDrive();
  const environment = {
    DB: database.raw,
    PUBLIC_RATE_LIMITER: { limit: async () => ({ success: true }) },
    WRITE_RATE_LIMITER: { limit: async () => ({ success: true }) },
    APP_ORIGIN: 'https://rules.test', TRUSTED_APP_ORIGINS: '', GOOGLE_DRIVE_CLIENT_ID: CLIENT_ID,
  } as never;
  const fetchBridge: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === 'oauth2.googleapis.com') {
      return new Response(JSON.stringify({ sub: OWNER, aud: CLIENT_ID, azp: CLIENT_ID,
        scope: 'openid https://www.googleapis.com/auth/drive.file', exp: Math.floor(Date.now() / 1000) + 3600 }),
      { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.hostname === 'rules.test') return app.request(url.toString(), init, environment);
    return drive.fetchImpl(input, init);
  };
  return { database, drive, environment, fetchBridge };
};

const createWorkspace = () => {
  const table = createTable('整合測試');
  table.updatedAt = 100; table.changeRevision = 'table-revision-1';
  table.rows = [{ ...table.rows[0], id: 'row-1', name: '第一列', values: { [table.columns[0].id]: '內容' } }];
  const node = createNode('table', table.name, null, 0, table.id);
  const data: WorkspaceData = { ...emptyWorkspace(), structureRevision: 'structure-revision-1', nodes: [node], tables: [], activeNodeId: node.id,
    bottomNavigationTableIds: [table.id] };
  const source: WorkspaceBackupSource = {
    tables: [workspaceBackupTableSummary(table)],
    readTable: async (id) => { if (id !== table.id) throw new Error('unexpected table'); return table; },
    verify: async () => undefined,
  };
  return { data, source, table };
};

const createClient = (fixture: ReturnType<typeof createFixture>) => {
  const tokenProvider = { getAccessToken: async () => TOKEN };
  const coordinator = createSnapshotCoordinator({ tokenProvider, fetchImpl: fixture.fetchBridge, baseUrl: API_BASE });
  const service = createGoogleDriveSnapshotBackup({
    folderPath: ['BoardGameHelper', '動態表格備份'], backupKey: 'dynamic-sheet-primary-workspace-v2', retainedVersions: 3,
    tokenProvider, fetchImpl: fixture.fetchBridge, coordinator, storage: memoryStorage(),
  });
  return { coordinator, service };
};

describe('Drive snapshot protocol integration', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('initializes the root, uploads and validates XLSX files, enforces CAS, restores, and keeps the latest three', async () => {
    const fixture = createFixture();
    vi.stubGlobal('fetch', fixture.fetchBridge);
    const workspace = createWorkspace();
    const firstClient = createClient(fixture);
    const first = await firstClient.service.backup(workspace.data, { sourceUpdatedAt: 100 }, { source: workspace.source });
    firstClient.service.acknowledgeBackup?.(first.file.id);
    const firstOperation = await firstClient.coordinator.operation(first.file.appProperties?.snapshotId!);
    expect(firstOperation).not.toBeNull();
    const externalVisible = fixture.drive.addFile({
      id: 'manual-visible-child', name: 'manual-visible.txt', mimeType: 'text/plain', parents: [firstOperation!.folderId],
    });
    const externalHidden = fixture.drive.addFile({
      id: 'manual-hidden-child', name: 'manual-hidden.txt', mimeType: 'text/plain', parents: [firstOperation!.folderId], visibleToApp: false,
    });

    const root = fixture.drive.liveFiles().find(file => file.appProperties?.backupKind === 'root');
    expect(root).toBeDefined();
    expect(root?.appProperties?.backupKey).toBe('dynamic-sheet-primary-workspace-v3');
    expect(fixture.drive.calls.uploads.filter(upload => upload.metadata.appProperties?.backupKind === 'table')).toHaveLength(1);
    expect(fixture.database.sqlite.prepare('SELECT revision, head_id FROM drive_backup_sets').all()).toEqual([
      { revision: 1, head_id: first.file.appProperties?.snapshotId },
    ]);

    const secondClient = createClient(fixture);
    const race = await Promise.allSettled([
      firstClient.service.backup(workspace.data, { sourceUpdatedAt: 100 }, { source: workspace.source }),
      secondClient.service.backup(workspace.data, { sourceUpdatedAt: 100 }, { source: workspace.source }),
    ]);
    expect(race.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(race.filter(result => result.status === 'rejected').map(result => result.reason)).toEqual([
      expect.any(RemoteBackupConflictError),
    ]);
    const winner = race.find((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof firstClient.service.backup>>> => result.status === 'fulfilled');
    expect(winner).toBeDefined();
    const winnerClient = race[0].status === 'fulfilled' ? firstClient : secondClient;
    winnerClient.service.acknowledgeBackup?.(winner!.value.file.id);

    for (let index = 0; index < 2; index += 1) {
      const receipt = await winnerClient.service.backup(workspace.data, { sourceUpdatedAt: 100 + index + 1 }, { source: workspace.source });
      winnerClient.service.acknowledgeBackup?.(receipt.file.id);
    }

    await winnerClient.service.maintain?.();
    const state = await winnerClient.coordinator.state();
    expect(state.revision).toBe(4);
    expect(state.versions).toHaveLength(3);
    expect(new Set(state.versions.map(version => version.id)).size).toBe(3);
    const committedIds = new Set(state.versions.map(version => version.id));
    expect(fixture.drive.liveFiles().filter(file => committedIds.has(file.appProperties?.snapshotId ?? '') && file.appProperties?.backupKind === 'snapshot')).toHaveLength(3);
    expect(fixture.drive.liveFiles().filter(file => committedIds.has(file.appProperties?.snapshotId ?? '') && ['manifest', 'table'].includes(file.appProperties?.backupKind ?? '')).length).toBe(6);
    expect(fixture.drive.get(firstOperation!.folderId)?.trashed).toBe(false);
    expect(firstOperation!.fileIds.every(id => fixture.drive.get(id)?.trashed)).toBe(true);
    expect(externalVisible.trashed ?? false).toBe(false);
    expect(externalHidden.trashed ?? false).toBe(false);
    expect(externalHidden.visibleToApp).toBe(false);
    expect(fixture.drive.liveFiles()).toContain(externalHidden);

    const selected = await winnerClient.service.findRemoteFile();
    const restored = await winnerClient.service.restore(selected ?? undefined);
    expect(restored.tables).toHaveLength(1);
    expect(restored.tables[0].id).toBe(workspace.table.id);
    expect(restored.tables[0].rows[0].values[restored.tables[0].columns[0].id]).toBe('內容');
  });
});
