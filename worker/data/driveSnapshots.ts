import {
  DRIVE_SNAPSHOT_LEASE_MS, DRIVE_SNAPSHOT_LIMIT, DRIVE_SNAPSHOT_ORPHAN_GRACE_MS,
  SnapshotProtocolError, type BeginDriveSnapshot, type DriveSnapshotOperation, type DriveSnapshotSummary, type SnapshotFileSignature,
} from '../../src/shared/driveSnapshots';
import type { Database } from './database';

interface OperationRow {
  id: string; expected_revision: number; source_revision: string; legacy_stamp: string; folder_id: string;
  file_ids_json: string; status: DriveSnapshotOperation['status']; expires_at: number;
  committed_revision: number | null; committed_at: number | null; source_updated_at: number; inventory_json: string;
}
export interface SnapshotSet { root_id: string; revision: number; head_id: string | null; legacy_stamp: string | null }
const operation = (row: OperationRow): DriveSnapshotOperation => ({
  id: row.id, expectedRevision: row.expected_revision, sourceRevision: row.source_revision,
  legacyStamp: row.legacy_stamp,
  folderId: row.folder_id, fileIds: JSON.parse(row.file_ids_json), status: row.status,
  expiresAt: row.expires_at, revision: row.committed_revision, committedAt: row.committed_at,
  sourceUpdatedAt: row.source_updated_at, inventory: JSON.parse(row.inventory_json),
});

export const readSnapshotSet = (db: Database, owner: string) => db.statement(
  'SELECT root_id, revision, head_id, legacy_stamp FROM drive_backup_sets WHERE owner_sub = ?',
).bind(owner).first<SnapshotSet>();

export const readSnapshotOperation = async (db: Database, owner: string, id: string) => {
  const row = await db.statement('SELECT * FROM drive_backup_operations WHERE owner_sub = ? AND id = ?')
    .bind(owner, id).first<OperationRow>();
  return row ? operation(row) : null;
};

export const listSnapshotVersions = async (db: Database, owner: string) => {
  const rows = await db.statement(`SELECT id, folder_id folderId, committed_revision revision,
    committed_at committedAt, source_updated_at sourceUpdatedAt,
    json_extract(file_ids_json, '$[0]') manifestId,
    json_extract(inventory_json, '$[0].modifiedTime') modifiedTime FROM drive_backup_operations
    WHERE owner_sub = ? AND status = 'committed' ORDER BY committed_revision DESC LIMIT ?`)
    .bind(owner, DRIVE_SNAPSHOT_LIMIT).all<DriveSnapshotSummary>();
  return rows.results ?? [];
};

export const beginSnapshot = async (db: Database, owner: string, input: BeginDriveSnapshot, ids: string[], now: number) => {
  await db.statement(`INSERT INTO drive_backup_sets (owner_sub, root_id, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(owner_sub) DO NOTHING`).bind(owner, input.rootId, now).run();
  const set = await readSnapshotSet(db, owner);
  if (set?.root_id !== input.rootId) throw new SnapshotProtocolError('backup_root_changed');
  const existing = await readSnapshotOperation(db, owner, input.id);
  if (existing) {
    if (existing.status !== 'committed' && existing.status !== 'uploading') throw new SnapshotProtocolError('backup_operation_expired');
    if (existing.expectedRevision !== input.expectedRevision || existing.sourceRevision !== input.sourceRevision || existing.legacyStamp !== input.legacyStamp
      || existing.fileIds.length !== input.fileCount || existing.sourceUpdatedAt !== input.sourceUpdatedAt) {
      throw new SnapshotProtocolError('backup_operation_mismatch');
    }
    return existing;
  }
  if (set.revision !== input.expectedRevision) throw new SnapshotProtocolError('backup_revision_conflict');
  if (set.legacy_stamp && set.legacy_stamp !== input.legacyStamp && !input.allowLegacyChange) throw new SnapshotProtocolError('backup_legacy_changed');
  await db.statement(`INSERT INTO drive_backup_operations
    (owner_sub, id, expected_revision, source_revision, legacy_stamp, folder_id, file_ids_json, created_at, expires_at, source_updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_sub, id) DO NOTHING`)
    .bind(owner, input.id, input.expectedRevision, input.sourceRevision, input.legacyStamp, ids[0], JSON.stringify(ids.slice(1)), now,
      now + DRIVE_SNAPSHOT_LEASE_MS, input.sourceUpdatedAt).run();
  const result = await readSnapshotOperation(db, owner, input.id);
  if (!result || result.sourceRevision !== input.sourceRevision || result.expectedRevision !== input.expectedRevision
    || result.fileIds.length !== input.fileCount || result.legacyStamp !== input.legacyStamp) throw new SnapshotProtocolError('backup_operation_mismatch');
  return result;
};

export const renewSnapshot = async (db: Database, owner: string, id: string, now: number) => {
  const updated = await db.statement(`UPDATE drive_backup_operations SET expires_at = ?
    WHERE owner_sub = ? AND id = ? AND status = 'uploading' AND expires_at > ? RETURNING id`)
    .bind(now + DRIVE_SNAPSHOT_LEASE_MS, owner, id, now).first();
  if (!updated) throw new SnapshotProtocolError('backup_operation_expired');
};

export const commitSnapshot = async (db: Database, owner: string, id: string, inventory: SnapshotFileSignature[], now: number) => {
  const existing = await readSnapshotOperation(db, owner, id);
  if (existing?.revision != null) {
    if (existing.status !== 'committed') throw new SnapshotProtocolError('backup_snapshot_unavailable');
    return existing; // Stable receipt while the published snapshot remains available.
  }
  try {
    const row = await db.statement(`UPDATE drive_backup_operations SET status = 'committed',
      committed_revision = expected_revision + 1, committed_at = ?, inventory_json = ?
      WHERE owner_sub = ? AND id = ? AND status = 'uploading' AND expires_at > ? RETURNING *`)
      .bind(now, JSON.stringify(inventory), owner, id, now).first<OperationRow>();
    if (row) return operation(row);
  } catch (error) {
    if (!String(error).includes('backup_revision_conflict')) throw error;
    throw new SnapshotProtocolError('backup_revision_conflict');
  }
  const retried = await readSnapshotOperation(db, owner, id);
  if (retried?.status === 'committed') return retried;
  throw new SnapshotProtocolError('backup_operation_expired');
};

export const acquireSnapshotRestore = async (db: Database, owner: string, id: string, leaseId: string, now: number) => {
  await db.statement('DELETE FROM drive_backup_restore_leases WHERE owner_sub = ? AND expires_at <= ?').bind(owner, now).run();
  const row = await db.statement(`INSERT INTO drive_backup_restore_leases (owner_sub, snapshot_id, id, expires_at)
    SELECT owner_sub, id, ?, ? FROM drive_backup_operations WHERE owner_sub = ? AND id = ? AND status = 'committed'
    ON CONFLICT(owner_sub, snapshot_id, id) DO UPDATE SET expires_at = excluded.expires_at RETURNING id`)
    .bind(leaseId, now + DRIVE_SNAPSHOT_LEASE_MS, owner, id).first();
  if (!row) throw new SnapshotProtocolError('backup_snapshot_unavailable');
};

export const releaseSnapshotRestore = (db: Database, owner: string, id: string, leaseId: string) => db.statement(
  'DELETE FROM drive_backup_restore_leases WHERE owner_sub = ? AND snapshot_id = ? AND id = ?',
).bind(owner, id, leaseId).run();

export const claimSnapshotCleanup = async (db: Database, owner: string, now: number) => {
  const row = await db.statement(`UPDATE drive_backup_operations SET status = 'deleting', cleanup_retry_at = ? WHERE owner_sub = ? AND id = (
    SELECT o.id FROM drive_backup_operations o JOIN drive_backup_sets s ON s.owner_sub = o.owner_sub
    WHERE o.owner_sub = ? AND o.status IN ('uploading', 'committed', 'deleting')
    AND o.id IS NOT s.head_id AND o.cleanup_retry_at <= ? AND (
      (o.status IN ('committed', 'deleting') AND o.committed_revision <= s.revision - ?)
      OR (o.status = 'deleting' AND o.committed_revision IS NULL)
      OR (o.status = 'uploading' AND o.expires_at < ?)
    ) AND NOT EXISTS (SELECT 1 FROM drive_backup_restore_leases l
      WHERE l.owner_sub = o.owner_sub AND l.snapshot_id = o.id AND l.expires_at > ?)
    ORDER BY o.created_at LIMIT 1
  ) RETURNING *`).bind(now + 5 * 60_000, owner, owner, now, DRIVE_SNAPSHOT_LIMIT, now - DRIVE_SNAPSHOT_ORPHAN_GRACE_MS, now).first<OperationRow>();
  return row ? operation(row) : null;
};

export const finishSnapshotCleanup = (db: Database, owner: string, id: string) => db.statement(
  "UPDATE drive_backup_operations SET status = 'deleted', inventory_json = '[]', cleanup_error = NULL WHERE owner_sub = ? AND id = ? AND status = 'deleting'",
).bind(owner, id).run();

export const noteSnapshotCleanupFailure = (db: Database, owner: string, id: string, code: string) => db.statement(
  "UPDATE drive_backup_operations SET cleanup_error = ? WHERE owner_sub = ? AND id = ? AND status = 'deleting'",
).bind(code, owner, id).run();

export const continueSnapshotCleanup = (db: Database, owner: string, id: string) => db.statement(
  "UPDATE drive_backup_operations SET cleanup_retry_at = 0 WHERE owner_sub = ? AND id = ? AND status = 'deleting'",
).bind(owner, id).run();

export const pruneSnapshotReceipts = (db: Database, owner: string, now: number) => db.statement(`
  DELETE FROM drive_backup_operations WHERE owner_sub = ? AND id IN (
    SELECT id FROM drive_backup_operations WHERE owner_sub = ? AND status = 'deleted' AND created_at < ?
    ORDER BY created_at LIMIT 100
  )
`).bind(owner, owner, now - 30 * 24 * 60 * 60_000).run();
