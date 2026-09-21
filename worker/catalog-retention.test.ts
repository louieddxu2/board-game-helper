import { DatabaseSync } from 'node:sqlite';
import { describe, expect, test } from 'vitest';
import type { Database, DatabaseStatement } from './data/database';
import {
  ATTRIBUTE_CATALOG_DELTA_PRUNE_LIMIT,
  cleanupAttributeCatalogDeltas,
} from './data/catalogRetention';

const databaseGateway = (sqlite: DatabaseSync): Database => ({
  statement: (sql: string): DatabaseStatement => {
    let bindings: unknown[] = [];
    const statement = {
      bind: (...values: unknown[]) => {
        bindings = values;
        return statement;
      },
      first: async () => sqlite.prepare(sql).get(...(bindings as never[])),
      all: async () => ({ results: sqlite.prepare(sql).all(...(bindings as never[])) }),
      run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...(bindings as never[])).changes) } }),
    };
    return statement as unknown as DatabaseStatement;
  },
  batch: async () => [],
} as unknown as Database);

describe('attribute catalog delta retention', () => {
  test('only removes a bounded oldest page already covered by the active snapshot', async () => {
    const sqlite = new DatabaseSync(':memory:');
    try {
      sqlite.exec(`
        CREATE TABLE attribute_catalog_snapshot_state (
          id INTEGER PRIMARY KEY,
          through_version INTEGER NOT NULL
        );
        CREATE TABLE attribute_catalog_entries (
          entry_key TEXT PRIMARY KEY,
          catalog_version INTEGER NOT NULL UNIQUE
        );
        INSERT INTO attribute_catalog_snapshot_state (id, through_version) VALUES (1, 4);
        INSERT INTO attribute_catalog_entries (entry_key, catalog_version) VALUES
          ('old-1', 1), ('old-2', 2), ('old-3', 3), ('old-4', 4), ('new-1', 5);
      `);

      await cleanupAttributeCatalogDeltas(databaseGateway(sqlite), 2);
      expect(sqlite.prepare('SELECT entry_key FROM attribute_catalog_entries ORDER BY catalog_version').all())
        .toEqual([{ entry_key: 'old-3' }, { entry_key: 'old-4' }, { entry_key: 'new-1' }]);

      await cleanupAttributeCatalogDeltas(databaseGateway(sqlite), ATTRIBUTE_CATALOG_DELTA_PRUNE_LIMIT);
      expect(sqlite.prepare('SELECT entry_key FROM attribute_catalog_entries ORDER BY catalog_version').all())
        .toEqual([{ entry_key: 'new-1' }]);
    } finally {
      sqlite.close();
    }
  });

  test('does nothing when no active snapshot exists', async () => {
    const sqlite = new DatabaseSync(':memory:');
    try {
      sqlite.exec(`
        CREATE TABLE attribute_catalog_snapshot_state (
          id INTEGER PRIMARY KEY,
          through_version INTEGER NOT NULL
        );
        CREATE TABLE attribute_catalog_entries (
          entry_key TEXT PRIMARY KEY,
          catalog_version INTEGER NOT NULL UNIQUE
        );
        INSERT INTO attribute_catalog_entries (entry_key, catalog_version) VALUES ('preserve', 1);
      `);

      await cleanupAttributeCatalogDeltas(databaseGateway(sqlite));
      expect(sqlite.prepare('SELECT entry_key FROM attribute_catalog_entries').all())
        .toEqual([{ entry_key: 'preserve' }]);
    } finally {
      sqlite.close();
    }
  });
});
