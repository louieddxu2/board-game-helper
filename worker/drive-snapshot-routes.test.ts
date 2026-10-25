// @vitest-environment node
import { afterEach, describe, expect, test, vi } from 'vitest';
import { sha256Hex } from './utils';
import { app } from './index';
import { beginSnapshot, commitSnapshot, readSnapshotOperation } from './data/driveSnapshots';
import { createDriveSnapshotTestDatabase } from './data/driveSnapshotTestFixture';
import { type DriveSnapshotOperation, DRIVE_SNAPSHOT_KEY, DRIVE_SNAPSHOT_XLSX } from '../src/shared/driveSnapshots';

const CLIENT = 'drive-snapshot-route-test.apps.googleusercontent.com';
const ROOT = 'root-12345678';
const OWNER_ONE = 'drive-owner-route-1';
const OWNER_TWO = 'drive-owner-route-2';
const now = () => Date.now();

type FakeFile = Record<string, unknown> & { id: string; parents?: string[]; trashed?: boolean; visibleToApp?: boolean };

class DriveFixture {
  readonly files = new Map<string, FakeFile>();
  readonly children = new Map<string, FakeFile[]>();
  readonly trashCalls: string[] = [];
  failNextTrash = false;
  readonly fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === 'oauth2.googleapis.com') {
      const authorization = new Headers(init?.headers).get('Authorization') ?? '';
      const token = authorization.replace(/^Bearer\s+/i, '');
      const subject = token.includes('owner-2') ? OWNER_TWO : OWNER_ONE;
      return new Response(JSON.stringify({
        sub: subject, aud: CLIENT, azp: CLIENT,
        scope: 'openid https://www.googleapis.com/auth/drive.file',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const pathParts = url.pathname.split('/').filter(Boolean);
    const method = init?.method ?? 'GET';
    if (pathParts.at(-1) === 'files' && method === 'GET') {
      const query = url.searchParams.get('q') ?? '';
      if (query.includes("dynamic-sheet-primary-workspace-v2")) return this.json({ files: [] });
      const parent = query.match(/'([^']+)' in parents/)?.[1];
      return this.json({ files: (parent ? this.children.get(parent) ?? [] : []).filter(file => !file.trashed && file.visibleToApp !== false) });
    }
    if (pathParts.at(-2) === 'files' && method === 'PATCH') {
      const id = decodeURIComponent(pathParts.at(-1)!);
      this.trashCalls.push(id);
      if (this.failNextTrash) {
        this.failNextTrash = false;
        return this.json({ error: { message: 'provider diagnostic must stay private' } }, 503);
      }
      const file = this.files.get(id);
      if (file) file.trashed = true;
      return new Response(null, { status: 204 });
    }
    if (pathParts.at(-2) === 'files' && method === 'GET') {
      const id = decodeURIComponent(pathParts.at(-1)!);
      const file = this.files.get(id);
      return file ? this.json(file) : this.json({ error: { message: 'not found' } }, 404);
    }
    throw new Error(`Unexpected Drive request ${method} ${url}`);
  });

  addRoot() {
    this.files.set(ROOT, {
      id: ROOT, name: '新版備份', mimeType: 'application/vnd.google-apps.folder',
      parents: ['parent-12345678'], ownedByMe: true, trashed: false,
      appProperties: { backupKey: DRIVE_SNAPSHOT_KEY, backupKind: 'root' },
    });
  }

  addSnapshot(operation: DriveSnapshotOperation, options: { missing?: string; foreign?: string; modified?: string } = {}) {
    const folder: FakeFile = {
      id: operation.folderId, name: operation.id, mimeType: 'application/vnd.google-apps.folder',
      parents: [ROOT], ownedByMe: true, trashed: false,
      appProperties: { backupKey: DRIVE_SNAPSHOT_KEY, backupKind: 'snapshot', snapshotId: operation.id },
    };
    this.files.set(folder.id, folder);
    const files = operation.fileIds.map((id, index) => ({
      id, name: index === 0 ? 'manifest.xlsx' : `table-${index}.xlsx`, mimeType: DRIVE_SNAPSHOT_XLSX,
      parents: [operation.folderId], ownedByMe: true, trashed: false,
      size: String(100 + index), md5Checksum: `checksum-${id}`, modifiedTime: '2026-10-18T00:00:00.000Z',
      appProperties: { backupKey: DRIVE_SNAPSHOT_KEY, backupKind: index === 0 ? 'manifest' : 'table', snapshotId: operation.id },
    } satisfies FakeFile));
    if (options.missing) this.files.delete(options.missing);
    if (options.foreign) {
      const foreign = files.find(file => file.id === options.foreign);
      if (foreign) foreign.ownedByMe = false;
    }
    if (options.modified) {
      const modified = files.find(file => file.id === options.modified);
      if (modified) modified.md5Checksum = 'changed-after-publish';
    }
    const visibleFiles = options.missing ? files.filter(file => file.id !== options.missing) : files;
    visibleFiles.forEach(file => this.files.set(file.id, file));
    this.children.set(operation.folderId, visibleFiles);
  }

  addExternalChild(folderId: string, id: string, visibleToApp = true) {
    const file: FakeFile = {
      id, name: `${id}.txt`, mimeType: 'text/plain', parents: [folderId],
      ownedByMe: true, trashed: false, visibleToApp,
    };
    this.files.set(id, file);
    this.children.set(folderId, [...(this.children.get(folderId) ?? []), file]);
    return file;
  }

  get(id: string) {
    return this.files.get(id);
  }

  private json(value: unknown, status = 200) {
    return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  }
}

const envFor = (fixture: ReturnType<typeof createDriveSnapshotTestDatabase>, overrides: Record<string, unknown> = {}) => ({
  DB: fixture.raw,
  PUBLIC_RATE_LIMITER: { limit: async () => ({ success: true }) },
  WRITE_RATE_LIMITER: { limit: async () => ({ success: true }) },
  APP_ORIGIN: 'https://rules.test',
  TRUSTED_APP_ORIGINS: '',
  GOOGLE_DRIVE_CLIENT_ID: CLIENT,
  ...overrides,
} as never);

const makeCommitted = async (fixture: ReturnType<typeof createDriveSnapshotTestDatabase>, id: string, revision: number, tableCount = 1) => {
  const legacyStamp = await sha256Hex('[]');
  const ids = [`folder-${id}`, `manifest-${id}`, ...Array.from({ length: tableCount }, (_, index) => `table-${id}${index ? `-${index}` : ''}`)];
  await beginSnapshot(fixture.db, OWNER_ONE, {
    id, rootId: ROOT, expectedRevision: revision, sourceRevision: revision.toString(16).padStart(64, '0'),
    legacyStamp, fileCount: tableCount + 1, sourceUpdatedAt: revision + 1,
  }, ids, 1_800_000_000_000 + revision);
  return commitSnapshot(fixture.db, OWNER_ONE, id, ids.slice(1).map((fileId, index) => ({
    id: fileId, size: String(100 + index), md5Checksum: `checksum-${fileId}`,
    modifiedTime: '2026-10-18T00:00:00.000Z',
  })), 1_800_000_000_001 + revision);
};

const request = (url: string, env: any, token = 'route-owner-1', init: RequestInit = {}) => app.request(
  `https://rules.test${url}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  }, env,
);

describe('Drive snapshot Hono routes', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('rejects empty reservations before any Drive calls or new backup state', async () => {
    const fixture = createDriveSnapshotTestDatabase();
    const drive = new DriveFixture(); drive.addRoot();
    vi.stubGlobal('fetch', drive.fetch);
    try {
      const response = await request('/api/workspace-backup/begin', envFor(fixture), 'route-owner-1', {
        method: 'POST', body: JSON.stringify({ id: crypto.randomUUID(), rootId: ROOT, expectedRevision: 0,
          sourceRevision: '0'.repeat(64), legacyStamp: '0'.repeat(64), fileCount: 1, sourceUpdatedAt: now() }),
        headers: { 'content-type': 'application/json' },
      });
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: 'backup_snapshot_empty' });
      expect(drive.fetch.mock.calls.some(([url]) => String(url).includes('www.googleapis.com'))).toBe(false);
      expect(fixture.sqlite.prepare('SELECT * FROM drive_backup_operations').all()).toEqual([]);
    } finally { fixture.sqlite.close(); }
  });

  test('rejects an empty candidate from an old client without advancing the existing head', async () => {
    const fixture = createDriveSnapshotTestDatabase();
    const drive = new DriveFixture(); drive.addRoot();
    vi.stubGlobal('fetch', drive.fetch);
    try {
      const head = await makeCommitted(fixture, crypto.randomUUID(), 0);
      const id = crypto.randomUUID();
      await beginSnapshot(fixture.db, OWNER_ONE, { id, rootId: ROOT, expectedRevision: 1,
        sourceRevision: '1'.repeat(64), legacyStamp: await sha256Hex('[]'), fileCount: 1, sourceUpdatedAt: now() },
      [`folder-${id}`, `manifest-${id}`], now());
      const response = await request(`/api/workspace-backup/operations/${id}/commit`, envFor(fixture), 'route-owner-1', { method: 'POST' });
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: 'backup_snapshot_empty' });
      expect((await readSnapshotOperation(fixture.db, OWNER_ONE, id))?.status).toBe('uploading');
      expect(fixture.sqlite.prepare('SELECT revision, head_id FROM drive_backup_sets').get())
        .toEqual({ revision: 1, head_id: head.id });
      expect(drive.trashCalls).toEqual([]);
    } finally { fixture.sqlite.close(); }
  });

  test('returns a sanitized 422 for incomplete restore data and does not touch session/outbox SQL', async () => {
    const fixture = createDriveSnapshotTestDatabase();
    const drive = new DriveFixture(); drive.addRoot();
    const operation = await makeCommitted(fixture, '00000000-0000-4000-8000-000000000101', 0);
    drive.addSnapshot(operation, { missing: operation.fileIds[1] });
    vi.stubGlobal('fetch', drive.fetch);
    const sql: string[] = [];
    const originalPrepare = fixture.raw.prepare;
    fixture.raw.prepare = ((query: string) => { sql.push(query); return originalPrepare(query); }) as typeof originalPrepare;

    const response = await request(`/api/workspace-backup/operations/${operation.id}/restore`, envFor(fixture), 'route-owner-1', {
      method: 'POST', body: JSON.stringify({ leaseId: crypto.randomUUID(), action: 'verify' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'backup_snapshot_incomplete' });
    expect(sql.some(query => /sessions|catalog_outbox/i.test(query))).toBe(false);
    fixture.sqlite.close();
  });

  test('rejects a foreign-owned file during restore before returning any operation data', async () => {
    const fixture = createDriveSnapshotTestDatabase();
    const drive = new DriveFixture(); drive.addRoot();
    const operation = await makeCommitted(fixture, '00000000-0000-4000-8000-000000000102', 0);
    drive.addSnapshot(operation, { foreign: operation.fileIds[1] });
    vi.stubGlobal('fetch', drive.fetch);
    const response = await request(`/api/workspace-backup/operations/${operation.id}/restore`, envFor(fixture), 'route-owner-1', {
      method: 'POST', body: JSON.stringify({ leaseId: crypto.randomUUID(), action: 'verify' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'backup_snapshot_invalid' });
    fixture.sqlite.close();
  });

  test('detects a published file modified after commit and releases the restore lease', async () => {
    const fixture = createDriveSnapshotTestDatabase();
    const drive = new DriveFixture(); drive.addRoot();
    const operation = await makeCommitted(fixture, '00000000-0000-4000-8000-000000000103', 0);
    drive.addSnapshot(operation, { modified: operation.fileIds[1] });
    vi.stubGlobal('fetch', drive.fetch);
    const leaseId = crypto.randomUUID();
    const response = await request(`/api/workspace-backup/operations/${operation.id}/restore`, envFor(fixture), 'route-owner-1', {
      method: 'POST', body: JSON.stringify({ leaseId, action: 'verify' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'backup_snapshot_changed' });
    expect(fixture.sqlite.prepare('SELECT * FROM drive_backup_restore_leases').all()).toEqual([]);
    fixture.sqlite.close();
  });

  test('opt-in whole-folder cleanup retries after a transient trash failure', async () => {
    const fixture = createDriveSnapshotTestDatabase();
    const drive = new DriveFixture(); drive.addRoot();
    const operations: DriveSnapshotOperation[] = [];
    for (let revision = 0; revision < 4; revision += 1) {
      const operation = await makeCommitted(fixture, `00000000-0000-4000-8000-0000000001${10 + revision}`, revision);
      operations.push(operation); drive.addSnapshot(operation);
    }
    drive.failNextTrash = true;
    vi.stubGlobal('fetch', drive.fetch);
    const env = envFor(fixture, { GOOGLE_DRIVE_SNAPSHOT_FOLDER_CLEANUP: 'enabled' });
    const first = await request('/api/workspace-backup/cleanup', env, 'route-owner-1', { method: 'POST' });
    expect(first.status).toBe(503);
    expect(await first.json()).toEqual({ error: 'backup_drive_unavailable' });
    fixture.sqlite.prepare('UPDATE drive_backup_operations SET cleanup_retry_at = 0 WHERE id = ?').run(operations[0].id);

    const second = await request('/api/workspace-backup/cleanup', env, 'route-owner-1', { method: 'POST' });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ cleaned: true });
    expect(drive.trashCalls).toEqual([operations[0].folderId, operations[0].folderId]);
    expect((await readSnapshotOperation(fixture.db, OWNER_ONE, operations[0].id))?.status).toBe('deleted');
    fixture.sqlite.close();
  });

  test('default cleanup trashes only known obsolete files and preserves external children and protected versions', async () => {
    const fixture = createDriveSnapshotTestDatabase();
    const drive = new DriveFixture(); drive.addRoot();
    const operations: DriveSnapshotOperation[] = [];
    for (let revision = 0; revision < 4; revision += 1) {
      const operation = await makeCommitted(fixture, `00000000-0000-4000-8000-0000000002${10 + revision}`, revision);
      operations.push(operation); drive.addSnapshot(operation);
    }
    const visibleExternal = drive.addExternalChild(operations[0].folderId, 'manual-visible');
    const hiddenExternal = drive.addExternalChild(operations[0].folderId, 'manual-hidden', false);
    vi.stubGlobal('fetch', drive.fetch);

    const response = await request('/api/workspace-backup/cleanup', envFor(fixture), 'route-owner-1', { method: 'POST' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ cleaned: true });
    expect(drive.trashCalls).toEqual(operations[0].fileIds);
    expect(drive.trashCalls).not.toContain(operations[0].folderId);
    expect(drive.get(operations[0].folderId)?.trashed).toBe(false);
    expect(drive.get(visibleExternal.id)?.trashed).toBe(false);
    expect(drive.get(hiddenExternal.id)?.trashed).toBe(false);
    expect(drive.get(hiddenExternal.id)?.visibleToApp).toBe(false);
    for (const operation of operations.slice(1)) {
      for (const id of [operation.folderId, ...operation.fileIds]) expect(drive.trashCalls).not.toContain(id);
      expect(operation.fileIds.every(id => !drive.get(id)?.trashed)).toBe(true);
    }
    expect((await readSnapshotOperation(fixture.db, OWNER_ONE, operations[0].id))?.status).toBe('deleted');
    fixture.sqlite.close();
  });

  test('default cleanup resumes a bounded known-file deletion on the next request', async () => {
    const fixture = createDriveSnapshotTestDatabase();
    const drive = new DriveFixture(); drive.addRoot();
    const operation = await makeCommitted(fixture, '00000000-0000-4000-8000-000000000230', 0, 21);
    drive.addSnapshot(operation);
    for (let revision = 1; revision < 4; revision += 1) {
      const head = await makeCommitted(fixture, `00000000-0000-4000-8000-00000000023${revision}`, revision);
      drive.addSnapshot(head);
    }
    vi.stubGlobal('fetch', drive.fetch);

    const first = await request('/api/workspace-backup/cleanup', envFor(fixture), 'route-owner-1', { method: 'POST' });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ cleaned: true });
    expect(drive.trashCalls).toEqual(operation.fileIds.slice(0, 20));
    expect((await readSnapshotOperation(fixture.db, OWNER_ONE, operation.id))?.status).toBe('deleting');

    const second = await request('/api/workspace-backup/cleanup', envFor(fixture), 'route-owner-1', { method: 'POST' });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ cleaned: true });
    expect(drive.trashCalls).toEqual(operation.fileIds);
    expect((await readSnapshotOperation(fixture.db, OWNER_ONE, operation.id))?.status).toBe('deleted');
    fixture.sqlite.close();
  });

  test('does not expose one owner’s operation to another verified Drive subject', async () => {
    const fixture = createDriveSnapshotTestDatabase();
    const drive = new DriveFixture(); drive.addRoot();
    const operation = await makeCommitted(fixture, '00000000-0000-4000-8000-000000000120', 0);
    drive.addSnapshot(operation); vi.stubGlobal('fetch', drive.fetch);
    const response = await request(`/api/workspace-backup/operations/${operation.id}`, envFor(fixture), 'route-owner-2');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'backup_operation_not_found' });
    fixture.sqlite.close();
  });

  test('state exposes lightweight version summaries without file inventory details', async () => {
    const fixture = createDriveSnapshotTestDatabase();
    const drive = new DriveFixture(); drive.addRoot();
    const operation = await makeCommitted(fixture, '00000000-0000-4000-8000-000000000121', 0);
    drive.addSnapshot(operation); vi.stubGlobal('fetch', drive.fetch);

    const response = await request('/api/workspace-backup/state', envFor(fixture), 'route-owner-1');
    expect(response.status).toBe(200);
    const state = await response.json() as { versions: Array<Record<string, unknown>> };
    expect(state.versions).toHaveLength(1);
    expect(state.versions[0]).toMatchObject({
      id: operation.id,
      folderId: operation.folderId,
      manifestId: operation.fileIds[0],
      revision: operation.revision,
      committedAt: operation.committedAt,
      sourceUpdatedAt: operation.sourceUpdatedAt,
    });
    expect(state.versions[0]).not.toHaveProperty('fileIds');
    expect(state.versions[0]).not.toHaveProperty('inventory');
    fixture.sqlite.close();
  });
});
