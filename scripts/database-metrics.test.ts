import { expect, test } from 'vitest';
import { createDatabase } from '../worker/data/database';
import type { D1PreparedStatement } from '../worker/env';

test('all, first and batch include physical writes reported by D1, including RETURNING statements', async () => {
  const result = { results: [{ id: 1 }], meta: { rows_read: 7, rows_written: 3, changes: 1 } };
  const statement: D1PreparedStatement = { bind() { return this; }, all: async <T>() => result as unknown as { results: T[] },
    first: async <T>() => result.results[0] as T, run: async <T>() => result as unknown as { results: T[] } };
  const db = createDatabase({ DB: { prepare: () => statement, batch: async () => [result] } });
  await db.statement('UPDATE example RETURNING id').all();
  expect(db.metrics()).toEqual({ rowsRead: 7, rowsWritten: 3, queries: 1 });
  await db.statement('UPDATE example RETURNING id').first();
  await db.batch([db.statement('UPDATE example')]);
  expect(db.metrics()).toEqual({ rowsRead: 21, rowsWritten: 9, queries: 3 });
});
