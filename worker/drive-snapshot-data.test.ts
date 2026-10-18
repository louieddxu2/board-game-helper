// @vitest-environment node
import { afterEach, describe, expect, test } from 'vitest';
import {
  DRIVE_SNAPSHOT_LEASE_MS, DRIVE_SNAPSHOT_LIMIT, DRIVE_SNAPSHOT_ORPHAN_GRACE_MS,
  SnapshotProtocolError, type BeginDriveSnapshot, type SnapshotFileSignature,
} from '../src/shared/driveSnapshots';
import {
  acquireSnapshotRestore, beginSnapshot, claimSnapshotCleanup, commitSnapshot,
  finishSnapshotCleanup, listSnapshotVersions, readSnapshotOperation, readSnapshotSet,
  releaseSnapshotRestore,
} from './data/driveSnapshots';
import { createDriveSnapshotTestDatabase } from './data/driveSnapshotTestFixture';

const ROOT = 'drive-root-test';
const LEGACY = 'a'.repeat(64);
const sourceRevision = (index: number) => index.toString(16).padStart(64, '0');
const operationId = () => crypto.randomUUID();

const inputFor = (id: string, expectedRevision: number, source = 1): BeginDriveSnapshot => ({
  id, rootId: ROOT, expectedRevision, sourceRevision: sourceRevision(source),
  legacyStamp: LEGACY, fileCount: 2, sourceUpdatedAt: source,
});

const idsFor = (id: string) => [`folder-${id}`, `manifest-${id}`, `table-${id}`];
const inventoryFor = (id: string): SnapshotFileSignature[] => idsFor(id).slice(1).map((fileId, index) => ({
  id: fileId, size: String(100 + index), md5Checksum: `md5-${id}-${index}`,
  modifiedTime: `2026-10-18T00:00:0${index}.000Z`,
}));

const begin = (db: ReturnType<typeof createDriveSnapshotTestDatabase>['db'], id: string, expectedRevision: number, now: number, source = expectedRevision + 1) =>
  beginSnapshot(db, 'google-owner-1', inputFor(id, expectedRevision, source), idsFor(id), now);

const close = (fixture: ReturnType<typeof createDriveSnapshotTestDatabase>) => fixture.sqlite.close();

describe('Drive snapshot coordination data contract', () => {
  const fixtures: Array<ReturnType<typeof createDriveSnapshotTestDatabase>> = [];
  afterEach(() => { while (fixtures.length) close(fixtures.pop()!); });

  test('two writers at one revision have exactly one committed head', async () => {
    const fixture = createDriveSnapshotTestDatabase(); fixtures.push(fixture);
    const now = 1_800_000_000_000;
    await begin(fixture.db, '00000000-0000-4000-8000-000000000001', 0, now);
    await begin(fixture.db, '00000000-0000-4000-8000-000000000002', 0, now + 1);

    const winner = await commitSnapshot(fixture.db, 'google-owner-1', '00000000-0000-4000-8000-000000000001', inventoryFor('00000000-0000-4000-8000-000000000001'), now + 2);
    expect(winner).toMatchObject({ status: 'committed', revision: 1 });
    await expect(commitSnapshot(fixture.db, 'google-owner-1', '00000000-0000-4000-8000-000000000002', inventoryFor('00000000-0000-4000-8000-000000000002'), now + 3))
      .rejects.toMatchObject({ code: 'backup_revision_conflict' });
    expect(await readSnapshotSet(fixture.db, 'google-owner-1')).toMatchObject({ revision: 1, head_id: winner.id });
    expect((await listSnapshotVersions(fixture.db, 'google-owner-1')).map(version => version.id)).toEqual([winner.id]);
  });

  test('a lost response can be retried as a stable receipt after later versions commit', async () => {
    const fixture = createDriveSnapshotTestDatabase(); fixtures.push(fixture);
    const now = 1_800_000_000_000;
    const firstId = '00000000-0000-4000-8000-000000000011';
    await begin(fixture.db, firstId, 0, now);
    const first = await commitSnapshot(fixture.db, 'google-owner-1', firstId, inventoryFor(firstId), now + 1);
    const secondId = '00000000-0000-4000-8000-000000000012';
    await begin(fixture.db, secondId, 1, now + 2);
    const second = await commitSnapshot(fixture.db, 'google-owner-1', secondId, inventoryFor(secondId), now + 3);

    const retry = await commitSnapshot(fixture.db, 'google-owner-1', firstId, inventoryFor(firstId), now + 4);
    expect(retry).toEqual(first);
    expect((await readSnapshotSet(fixture.db, 'google-owner-1'))?.head_id).toBe(second.id);
  });

  test('an expired upload cannot be committed', async () => {
    const fixture = createDriveSnapshotTestDatabase(); fixtures.push(fixture);
    const now = 1_800_000_000_000;
    const id = '00000000-0000-4000-8000-000000000021';
    await begin(fixture.db, id, 0, now);
    await expect(commitSnapshot(fixture.db, 'google-owner-1', id, inventoryFor(id), now + DRIVE_SNAPSHOT_LEASE_MS + 1))
      .rejects.toMatchObject({ code: 'backup_operation_expired' });
    expect((await readSnapshotOperation(fixture.db, 'google-owner-1', id))?.status).toBe('uploading');
  });

  test('version listing keeps the latest three and cleanup claims the fourth-oldest receipt', async () => {
    const fixture = createDriveSnapshotTestDatabase(); fixtures.push(fixture);
    const now = 1_800_000_000_000;
    const ids: string[] = [];
    for (let revision = 0; revision < 4; revision += 1) {
      const id = `00000000-0000-4000-8000-0000000000${31 + revision}`;
      ids.push(id);
      await begin(fixture.db, id, revision, now + revision * 10, revision + 1);
      await commitSnapshot(fixture.db, 'google-owner-1', id, inventoryFor(id), now + revision * 10 + 1);
    }
    expect((await listSnapshotVersions(fixture.db, 'google-owner-1')).map(version => version.revision))
      .toEqual([4, 3, 2].slice(0, DRIVE_SNAPSHOT_LIMIT));
    const claimed = await claimSnapshotCleanup(fixture.db, 'google-owner-1', now + 100);
    expect(claimed).toMatchObject({ id: ids[0], status: 'deleting', revision: 1 });
    await finishSnapshotCleanup(fixture.db, 'google-owner-1', ids[0]);
    expect((await listSnapshotVersions(fixture.db, 'google-owner-1')).map(version => version.revision)).toEqual([4, 3, 2]);
  });

  test('an active restore lease prevents cleanup, then releases its snapshot for cleanup', async () => {
    const fixture = createDriveSnapshotTestDatabase(); fixtures.push(fixture);
    const now = 1_800_000_000_000;
    const ids: string[] = [];
    for (let revision = 0; revision < 4; revision += 1) {
      const id = `00000000-0000-4000-8000-0000000000${41 + revision}`;
      ids.push(id);
      await begin(fixture.db, id, revision, now + revision * 10, revision + 1);
      await commitSnapshot(fixture.db, 'google-owner-1', id, inventoryFor(id), now + revision * 10 + 1);
    }
    await acquireSnapshotRestore(fixture.db, 'google-owner-1', ids[0], '00000000-0000-4000-8000-000000000099', now + 100);
    expect(await claimSnapshotCleanup(fixture.db, 'google-owner-1', now + 101)).toBeNull();
    await releaseSnapshotRestore(fixture.db, 'google-owner-1', ids[0], '00000000-0000-4000-8000-000000000099');
    expect(await claimSnapshotCleanup(fixture.db, 'google-owner-1', now + 102)).toMatchObject({ id: ids[0], status: 'deleting' });
  });

  test('an expired orphan is eligible only after the grace period', async () => {
    const fixture = createDriveSnapshotTestDatabase(); fixtures.push(fixture);
    const now = 1_800_000_000_000;
    const id = '00000000-0000-4000-8000-000000000061';
    const created = now - DRIVE_SNAPSHOT_ORPHAN_GRACE_MS - DRIVE_SNAPSHOT_LEASE_MS - 1;
    await begin(fixture.db, id, 0, created);
    expect(await claimSnapshotCleanup(fixture.db, 'google-owner-1', now - 1)).toBeNull();
    expect(await claimSnapshotCleanup(fixture.db, 'google-owner-1', now)).toMatchObject({ id, status: 'deleting' });
  });

  test('owners cannot read or clean another owner’s snapshots', async () => {
    const fixture = createDriveSnapshotTestDatabase(); fixtures.push(fixture);
    const id = '00000000-0000-4000-8000-000000000071';
    await begin(fixture.db, id, 0, 1_800_000_000_000);
    await commitSnapshot(fixture.db, 'google-owner-1', id, inventoryFor(id), 1_800_000_000_001);
    expect(await readSnapshotOperation(fixture.db, 'google-owner-2', id)).toBeNull();
    expect(await listSnapshotVersions(fixture.db, 'google-owner-2')).toEqual([]);
    expect(await claimSnapshotCleanup(fixture.db, 'google-owner-2', 1_800_000_000_002)).toBeNull();
  });

  test('migration does not store workspace rows or OAuth tokens', () => {
    const fixture = createDriveSnapshotTestDatabase(); fixtures.push(fixture);
    const tables = fixture.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'drive_backup_%' ORDER BY name").all() as Array<{ name: string }>;
    expect(tables.map(table => table.name)).toEqual([
      'drive_backup_operations', 'drive_backup_restore_leases', 'drive_backup_sets',
    ]);
    const columns = fixture.sqlite.prepare('PRAGMA table_info(drive_backup_operations)').all() as Array<{ name: string }>;
    expect(columns.map(column => column.name)).not.toContain('access_token');
    expect(columns.map(column => column.name)).not.toContain('workspace_rows');
  });

  test('restore cannot be acquired for a non-committed or foreign operation', async () => {
    const fixture = createDriveSnapshotTestDatabase(); fixtures.push(fixture);
    const id = '00000000-0000-4000-8000-000000000081';
    await begin(fixture.db, id, 0, 1_800_000_000_000);
    await expect(acquireSnapshotRestore(fixture.db, 'google-owner-1', id, operationId(), 1_800_000_000_001))
      .rejects.toMatchObject({ code: 'backup_snapshot_unavailable' });
    await expect(acquireSnapshotRestore(fixture.db, 'google-owner-2', id, operationId(), 1_800_000_000_001))
      .rejects.toMatchObject({ code: 'backup_snapshot_unavailable' });
  });

  test('invalid protocol errors retain their public code and status', () => {
    const error = new SnapshotProtocolError('backup_snapshot_invalid', 422);
    expect(error).toMatchObject({ code: 'backup_snapshot_invalid', status: 422 });
  });
});
