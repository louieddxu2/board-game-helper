-- These tables contain Drive identifiers and receipts, never workspace rows or tokens.
CREATE TABLE drive_backup_sets (
  owner_sub TEXT PRIMARY KEY,
  root_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  head_id TEXT,
  legacy_stamp TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE drive_backup_operations (
  owner_sub TEXT NOT NULL REFERENCES drive_backup_sets(owner_sub) ON DELETE CASCADE,
  id TEXT NOT NULL,
  expected_revision INTEGER NOT NULL CHECK (expected_revision >= 0),
  source_revision TEXT NOT NULL,
  legacy_stamp TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  file_ids_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'committed', 'deleting', 'deleted')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  committed_revision INTEGER,
  committed_at INTEGER,
  source_updated_at INTEGER NOT NULL,
  inventory_json TEXT NOT NULL DEFAULT '[]',
  cleanup_retry_at INTEGER NOT NULL DEFAULT 0,
  cleanup_error TEXT,
  PRIMARY KEY (owner_sub, id),
  UNIQUE (owner_sub, folder_id)
);
CREATE INDEX idx_drive_backup_versions ON drive_backup_operations(owner_sub, status, committed_revision DESC);
CREATE INDEX idx_drive_backup_expiry ON drive_backup_operations(owner_sub, status, expires_at);
CREATE INDEX idx_drive_backup_receipts ON drive_backup_operations(owner_sub, status, created_at);
CREATE INDEX idx_drive_backup_cleanup ON drive_backup_operations(owner_sub, created_at)
WHERE status IN ('uploading', 'committed', 'deleting');

CREATE TABLE drive_backup_restore_leases (
  owner_sub TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (owner_sub, snapshot_id, id),
  FOREIGN KEY (owner_sub, snapshot_id) REFERENCES drive_backup_operations(owner_sub, id) ON DELETE CASCADE
);

-- A single UPDATE publishes both the immutable receipt and its head pointer.
-- RAISE also rolls back the receipt when another device won the revision race.
CREATE TRIGGER drive_backup_publish_guard
BEFORE UPDATE OF status ON drive_backup_operations
WHEN NEW.status = 'committed' AND OLD.status = 'uploading'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM drive_backup_sets
    WHERE owner_sub = NEW.owner_sub AND revision = NEW.expected_revision
  ) THEN RAISE(ABORT, 'backup_revision_conflict') END;
END;

CREATE TRIGGER drive_backup_publish_head
AFTER UPDATE OF status ON drive_backup_operations
WHEN NEW.status = 'committed' AND OLD.status = 'uploading'
BEGIN
  UPDATE drive_backup_sets
  SET revision = NEW.committed_revision, head_id = NEW.id, updated_at = NEW.committed_at, legacy_stamp = NEW.legacy_stamp
  WHERE owner_sub = NEW.owner_sub AND revision = NEW.expected_revision;
END;
