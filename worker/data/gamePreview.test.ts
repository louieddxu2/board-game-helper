// @vitest-environment node
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, test } from 'vitest';
import type { Database } from './database';
import { queryPublicGamePreview } from './gamePreview';

let sqlite: DatabaseSync;
let queries: number;
let db: Database;
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:'); queries = 0;
  sqlite.exec(`
    CREATE TABLE games (id TEXT, slug TEXT, display_name TEXT, english_name TEXT, visibility TEXT, merged_into_game_id TEXT);
    CREATE TABLE rules (id TEXT, game_id TEXT, statement TEXT, status TEXT, created_at INTEGER);
    INSERT INTO games VALUES ('public', 'shipyard', '船廠', 'Shipyard', 'public', NULL), ('hidden', 'hidden', '秘密名稱', NULL, 'hidden', NULL), ('merged', 'merged', '舊遊戲', NULL, 'public', 'public');
    INSERT INTO rules VALUES ('a', 'public', '公開摘要', 'published', 1), ('b', 'public', '不公開的最新規則', 'hidden', 99), ('c', 'public', '草稿', 'draft', 100);
  `);
  db = { statement(sql: string) {
    let values: unknown[] = [];
    return { bind(...args: unknown[]) { values = args; return this; }, async first() { queries++; return sqlite.prepare(sql).get(...values as (string | number)[]) ?? null; } };
  } } as unknown as Database;
});
afterEach(() => sqlite.close());

test('uses one query for public game metadata and only a published statement', async () => {
  expect(await queryPublicGamePreview(db, 'shipyard')).toEqual({ slug: 'shipyard', displayName: '船廠', englishName: 'Shipyard', statement: '公開摘要' });
  expect(queries).toBe(1);
  expect((await queryPublicGamePreview(db, 'public'))?.slug).toBe('shipyard');
});

test.each(['hidden', 'merged', 'missing'])("does not disclose hidden, merged, or missing games: %s", async identifier => {
  expect(await queryPublicGamePreview(db, identifier)).toBeNull();
});
