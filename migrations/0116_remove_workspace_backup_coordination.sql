-- Explicit removal of all Workspace-specific server records. Drive files and local IndexedDB are untouched.
-- Apply after deploying the database-independent client and the retired Workspace API guard.
DROP TRIGGER IF EXISTS drive_backup_publish_guard;
DROP TRIGGER IF EXISTS drive_backup_publish_head;
DROP TABLE IF EXISTS drive_backup_restore_leases;
DROP TABLE IF EXISTS drive_backup_operations;
DROP TABLE IF EXISTS drive_backup_sets;
