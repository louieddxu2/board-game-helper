import { describe, expect, test } from 'vitest';
import { filterGameCatalog, mergeGameCatalogEntries, taipeiDateKey, upsertGameCatalogEntry } from './gameCatalog';
import type { GameSummary } from '../shared/types';

const games: GameSummary[] = [
  { id: '2', slug: 'brass-birmingham', displayName: '工業革命：伯明翰', englishName: 'Brass: Birmingham', aliases: ['伯明翰'], ruleCount: 3, updatedAt: 2 },
  { id: '1', slug: 'brass-lancashire', displayName: '工業革命：蘭開夏', englishName: 'Brass: Lancashire', aliases: ['蘭開夏'], ruleCount: 2, updatedAt: 1 },
];

describe('local versioned game catalog', () => {
  test('searches display names, English names, and aliases locally', () => {
    expect(filterGameCatalog(games, 'Birmingham').map((game) => game.id)).toEqual(['2']);
    expect(filterGameCatalog(games, '伯明翰').map((game) => game.id)).toEqual(['2']);
    expect(filterGameCatalog(games, 'brass').map((game) => game.id)).toEqual(['2', '1']);
  });

  test('normalizes punctuation and ranks exact matches first', () => {
    expect(filterGameCatalog(games, 'Brass Birmingham')[0]?.id).toBe('2');
  });

  test('uses Taipei calendar days instead of a rolling 24-hour age', () => {
    expect(taipeiDateKey(Date.UTC(2026, 6, 28, 15, 59))).toBe('2026-07-28');
    expect(taipeiDateKey(Date.UTC(2026, 6, 28, 16, 0))).toBe('2026-07-29');
  });

  test('adds or updates a game in the creator local catalog without a server refresh', () => {
    const created = { id: '3', slug: 'new-game', displayName: '新遊戲', ruleCount: 0, updatedAt: 3 };
    expect(upsertGameCatalogEntry(games, created)).toContainEqual(created);
    expect(upsertGameCatalogEntry(games, { ...games[0], displayName: '新名稱' }))
      .toHaveLength(games.length);
    expect(upsertGameCatalogEntry(games, { ...games[0], displayName: '新名稱' })[0].displayName).toBe('新名稱');
  });

  test('keeps a local creation made before the first daily catalog fetch', () => {
    const created = { id: '3', slug: 'new-game', displayName: '新遊戲', ruleCount: 0, updatedAt: 3 };
    expect(mergeGameCatalogEntries(games, [created])).toContainEqual(created);
  });

  test('does not let an older local override replace a newer daily snapshot', () => {
    const stale = { ...games[0], displayName: '舊名稱', updatedAt: 1 };
    expect(mergeGameCatalogEntries(games, [stale])[0].displayName).toBe(games[0].displayName);
  });
});
