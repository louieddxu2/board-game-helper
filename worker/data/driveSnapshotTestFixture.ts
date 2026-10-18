// Test-only SQLite/D1 bridge for the Drive snapshot coordination contract.
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import type { DatabaseStatement } from './database';
import { createDatabase } from './database';

interface SqliteStatement extends DatabaseStatement {
  bind(...values: SQLInputValue[]): SqliteStatement;
}

export const createDriveSnapshotTestDatabase = () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('migrations/0115_drive_snapshot_coordination.sql', 'utf8'));
  sqlite.exec('PRAGMA foreign_keys = ON');

  const prepare = (sql: string, args: SQLInputValue[] = []): SqliteStatement => {
    const statement = {
      bind: (...values: SQLInputValue[]) => prepare(sql, values),
      first: async <T = Record<string, unknown>>() => {
        const result = await statement.all<T>();
        return result.results?.[0] ?? null;
      },
      all: async <T = Record<string, unknown>>() => {
        const prepared = sqlite.prepare(sql);
        if (prepared.columns().length) {
          return { results: prepared.all(...args) as T[], meta: { changes: 0 } };
        }
        const result = prepared.run(...args);
        return { results: [] as T[], meta: { changes: Number(result.changes) } };
      },
      run: async <T = Record<string, unknown>>() => statement.all<T>(),
    } as SqliteStatement;
    return statement;
  };

  const raw = {
      prepare,
      batch: async (statements: SqliteStatement[]) => {
        sqlite.exec('BEGIN');
        try {
          const results = [];
          for (const statement of statements) results.push(await statement.all());
          sqlite.exec('COMMIT');
          return results;
        } catch (error) {
          sqlite.exec('ROLLBACK');
          throw error;
        }
      },
  };
  const db = createDatabase({ DB: raw } as unknown as Parameters<typeof createDatabase>[0]);

  return { sqlite, db, raw };
};
