// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeAll, describe, expect, test } from 'vitest';
import type { Database, DatabaseStatement } from './database';
import { findGameByRequestedName } from './gameNameMatch';

// Real schema and index hints: a typed name must find the game it names by an indexed lookup.
const sqlite = new DatabaseSync(':memory:');
const statement = (sql: string, params: unknown[] = []): DatabaseStatement => ({
  bind: (...values: unknown[]) => statement(sql, values),
  first: async () => (sqlite.prepare(sql).get(...(params as never[])) ?? null) as never,
  all: async () => ({ results: sqlite.prepare(sql).all(...(params as never[])), success: true, meta: {} }) as never,
  run: async () => {
    const result = sqlite.prepare(sql).run(...(params as never[]));
    return { results: [], success: true, meta: { changes: Number(result.changes) } } as never;
  },
});
const db: Database = {
  statement: (sql) => statement(sql),
  batch: async (items) => { const results = []; for (const item of items) results.push(await item.run()); return results; },
};

beforeAll(() => {
  for (const file of readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(`migrations/${file}`, 'utf8'));
  }
  sqlite.exec(`
    INSERT INTO games (id, slug, display_name, english_name, normalized_name, created_at, updated_at, visibility, review_status, attribute_enabled, bgg_id, entity_kind)
    VALUES ('game_bgg_9000001', 'bgg-9000001', '測試之旅', 'Test Journey: Second Edition', '測試之旅', 1, 1, 'public', 'pending', 1, 9000001, 'base'),
      ('game_bgg_9000002', 'bgg-9000002', '隱藏之旅', 'Hidden Journey', '隱藏之旅', 1, 1, 'hidden', 'pending', 1, 9000002, 'base');
    INSERT INTO game_aliases (id, game_id, alias, normalized_alias, alias_type, created_at)
    VALUES ('alias-test-journey', 'game_bgg_9000001', '測試旅程', '測試旅程', 'alias', 1);
  `);
});

describe('new-game submissions find the catalog game a name already names', () => {
  test('by its display name or alias', async () => {
    await expect(findGameByRequestedName(db, ['測試之旅'])).resolves.toEqual({ id: 'game_bgg_9000001', slug: 'bgg-9000001' });
    await expect(findGameByRequestedName(db, ['測試旅程'])).resolves.toEqual({ id: 'game_bgg_9000001', slug: 'bgg-9000001' });
  });

  test('by either submitted name, ignoring case and punctuation', async () => {
    await expect(findGameByRequestedName(db, ['新名稱', '測試 旅程！'])).resolves.toEqual({ id: 'game_bgg_9000001', slug: 'bgg-9000001' });
  });

  test('never by a hidden game or a name the catalog lacks', async () => {
    await expect(findGameByRequestedName(db, ['Hidden Journey'])).resolves.toBeNull();
    await expect(findGameByRequestedName(db, ['Unknown Journey'])).resolves.toBeNull();
    await expect(findGameByRequestedName(db, ['  '])).resolves.toBeNull();
  });
});
