// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeAll, describe, expect, test } from 'vitest';
import { slugify } from '../utils';

// Real schema and imported games: migration 0133 renames bgg-<id> addresses to name-based slugs.
const sqlite = new DatabaseSync(':memory:');
const migrationFile = '0133_name_based_bgg_slugs.sql';
const slugOf = (id: string) => (sqlite.prepare('SELECT slug FROM games WHERE id = ?').get(id) as { slug: string }).slug;

// Test games use BGG ids and names no import uses.
const games: Array<[id: string, bggId: number, displayName: string, englishName: string | null]> = [
  ['game_bgg_9000001', 9000001, 'Zeta Brass: Birmingham', null],
  ['game_bgg_9000002', 9000002, '測試寶石', 'Zeta Splendor'],
  ['game_bgg_9000003', 9000003, 'Zeta Café International', null],
  ['game_bgg_9000004', 9000004, "Zeta Rock 'n' Roll -- The Game!", null],
  ['game_bgg_9000005', 9000005, 'Zeta Twins', null],
  ['game_bgg_9000006', 9000006, 'Zeta Twins', null],
  ['game_bgg_9000007', 9000007, 'Zeta Taken', null],
  ['game_bgg_9000008', 9000008, '測試卡卡頌', null],
];
let importedBggSlugs: Array<{ id: string; display_name: string; english_name: string | null }> = [];

beforeAll(() => {
  const files = readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort();
  for (const file of files.filter((name) => name < migrationFile)) sqlite.exec(readFileSync(`migrations/${file}`, 'utf8'));
  importedBggSlugs = sqlite.prepare("SELECT id, display_name, english_name FROM games WHERE slug GLOB 'bgg-[0-9]*'").all() as typeof importedBggSlugs;
  // Contributions and imports start pending, as the triggers require, and are reviewed afterwards.
  const insert = sqlite.prepare(`
    INSERT INTO games (id, slug, display_name, english_name, normalized_name, created_at, updated_at, review_status, bgg_id)
    VALUES (?, ?, ?, ?, ?, 1, 1, 'pending', ?)
  `);
  for (const [id, bggId, displayName, englishName] of games) {
    insert.run(id, `bgg-${bggId}`, displayName, englishName, displayName.toLowerCase(), bggId);
  }
  insert.run('game-user', 'zeta-taken', 'Zeta Taken', null, 'zetataken', null);
  insert.run('game_bgg_9000009', 'custom-slug', 'Zeta Custom', null, 'zetacustom', 9000009);
  sqlite.exec("UPDATE games SET review_status = 'reviewed' WHERE review_status = 'pending'");
  sqlite.exec('DELETE FROM catalog_change_outbox');
  for (const file of files.filter((name) => name >= migrationFile)) sqlite.exec(readFileSync(`migrations/${file}`, 'utf8'));
});

describe('name-based BGG slugs', () => {
  test('match the slugs the site creates for new games', () => {
    expect(slugOf('game_bgg_9000001')).toBe(slugify('Zeta Brass: Birmingham'));
    expect(slugOf('game_bgg_9000002')).toBe('zeta-splendor');
    expect(slugOf('game_bgg_9000003')).toBe('zeta-cafe-international');
    expect(slugOf('game_bgg_9000004')).toBe('zeta-rock-n-roll-the-game');
    expect(slugOf('game_bgg_9000008')).toBe(slugify('測試卡卡頌'));
  });

  test('keep the BGG id when a name is shared or already taken, and leave other slugs alone', () => {
    expect(slugOf('game_bgg_9000005')).toBe('zeta-twins-9000005');
    expect(slugOf('game_bgg_9000006')).toBe('zeta-twins-9000006');
    expect(slugOf('game_bgg_9000007')).toBe('zeta-taken-9000007');
    expect(slugOf('game-user')).toBe('zeta-taken');
    expect(slugOf('game_bgg_9000009')).toBe('custom-slug');
  });

  test('gives every imported game a clean, readable address', () => {
    expect(importedBggSlugs.length).toBeGreaterThan(100);
    for (const game of importedBggSlugs) expect(slugOf(game.id)).toMatch(/^[a-z0-9㐀-鿿]+(?:-[a-z0-9㐀-鿿]+)*$/u);
    expect(sqlite.prepare("SELECT COUNT(*) count FROM games WHERE slug GLOB 'bgg-[0-9]*'").get()).toEqual({ count: 0 });
  });

  test('advance the game catalog so cached catalogs pick up the new links', () => {
    const queued = sqlite.prepare("SELECT COUNT(*) count FROM catalog_change_outbox WHERE catalog = 'game'").get() as { count: number };
    expect(queued.count).toBe(importedBggSlugs.length + games.length);
  });
});
