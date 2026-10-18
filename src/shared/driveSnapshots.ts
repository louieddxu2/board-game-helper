/** Metadata only: table contents and OAuth tokens never belong in this protocol. */
export const DRIVE_SNAPSHOT_KEY = 'dynamic-sheet-primary-workspace-v3';
export const DRIVE_SNAPSHOT_API = '/api/workspace-backup';
export const DRIVE_SNAPSHOT_LIMIT = 3;
export const DRIVE_SNAPSHOT_LEASE_MS = 60 * 60 * 1000;
export const DRIVE_SNAPSHOT_ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
export const DRIVE_SNAPSHOT_MAX_FILES = 5000;
export const DRIVE_SNAPSHOT_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface SnapshotFileSignature {
  id: string;
  size: string;
  md5Checksum: string;
  modifiedTime: string;
}

export interface DriveSnapshotOperation {
  id: string;
  expectedRevision: number;
  sourceRevision: string;
  legacyStamp: string;
  folderId: string;
  /** Reserved Drive IDs: manifest first, then tables in directory order. */
  fileIds: string[];
  status: 'uploading' | 'committed' | 'deleting' | 'deleted';
  expiresAt: number;
  revision: number | null;
  committedAt: number | null;
  sourceUpdatedAt: number;
  inventory: SnapshotFileSignature[];
}

export interface DriveSnapshotSummary {
  id: string;
  folderId: string;
  manifestId: string;
  modifiedTime: string;
  revision: number | null;
  committedAt: number | null;
  sourceUpdatedAt: number;
}

export const summarizeDriveSnapshot = (op: DriveSnapshotOperation): DriveSnapshotSummary => ({
  id: op.id, folderId: op.folderId, manifestId: op.fileIds[0],
  modifiedTime: op.inventory[0]?.modifiedTime ?? '', revision: op.revision,
  committedAt: op.committedAt, sourceUpdatedAt: op.sourceUpdatedAt,
});

export interface DriveSnapshotState {
  accountKey: string;
  rootId: string | null;
  revision: number;
  legacyStamp: string;
  legacyChanged: boolean;
  versions: DriveSnapshotSummary[];
}

export interface BeginDriveSnapshot {
  id: string;
  rootId: string;
  expectedRevision: number;
  sourceRevision: string;
  legacyStamp: string;
  allowLegacyChange?: boolean;
  fileCount: number;
  sourceUpdatedAt: number;
}

export class SnapshotProtocolError extends Error {
  constructor(readonly code: string, readonly status = 409) {
    super(code);
    this.name = 'SnapshotProtocolError';
  }
}
