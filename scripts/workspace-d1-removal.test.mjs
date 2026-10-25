// @vitest-environment node
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { buildMigratedSchema } from './check-d1-trigger-fanout.mjs';

const removal = readFileSync('migrations/0116_remove_workspace_backup_coordination.sql', 'utf8');
const remainingObjects = db => db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'drive_backup_%'").all();

test('removes every Workspace server row, table, index, and trigger while preserving unrelated data', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('CREATE TABLE unrelated_rules (id TEXT PRIMARY KEY, value TEXT); INSERT INTO unrelated_rules VALUES (\'rule-1\', \'keep\')');
    db.exec(readFileSync('migrations/0115_drive_snapshot_coordination.sql', 'utf8'));
    db.exec(`INSERT INTO drive_backup_sets(owner_sub, root_id, updated_at) VALUES ('owner-1', 'root-1', 1);
      INSERT INTO drive_backup_operations(owner_sub, id, expected_revision, source_revision, legacy_stamp, folder_id, file_ids_json, created_at, expires_at, source_updated_at)
      VALUES ('owner-1', 'op-1', 0, 'source', 'legacy', 'folder-1', '["manifest-1","table-1"]', 1, 2, 1);
      INSERT INTO drive_backup_restore_leases VALUES ('owner-1', 'op-1', 'lease-1', 2)`);
    expect(db.prepare('SELECT COUNT(*) count FROM drive_backup_operations').get()).toEqual({ count: 1 });
    db.exec(removal);
    expect(remainingObjects(db)).toEqual([]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'idx_drive_backup_%'").all()).toEqual([]);
    expect(db.prepare('SELECT * FROM unrelated_rules').all()).toEqual([{ id: 'rule-1', value: 'keep' }]);
    expect(() => db.exec(removal)).not.toThrow();
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});

test('a fresh application schema contains no Workspace database objects', () => {
  const db = buildMigratedSchema();
  try {
    expect(remainingObjects(db)).toEqual([]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'games'").get()).toEqual({ name: 'games' });
  } finally { db.close(); }
});
