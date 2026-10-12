import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDatabase: vi.fn(),
  findCachedGame: vi.fn(),
}));

vi.mock('./localDbCore', async () => {
  const actual = await vi.importActual<typeof import('./localDbCore')>('./localDbCore');
  return { ...actual, getDatabase: mocks.getDatabase, findCachedGame: mocks.findCachedGame };
});

import { localDbContent } from './localDbContent';

const makeRecentRecord = (index: number, viewedAt = index) => ({
  id: `game-${index}`,
  slug: `game-${index}`,
  displayName: `遊戲 ${index}`,
  englishName: `Game ${index}`,
  viewedAt,
});

describe('local recent game content', () => {
  beforeEach(() => {
    mocks.getDatabase.mockReset();
    mocks.findCachedGame.mockReset();
  });

  afterEach(() => vi.restoreAllMocks());

  test('returns at most twenty records in newest-first order with stored names', async () => {
    const records = Array.from({ length: 25 }, (_, index) => makeRecentRecord(index));
    const expectedIds = records.slice().reverse().slice(0, 20).map((game) => game.id);
    const db = { getAllFromIndex: vi.fn().mockResolvedValue(records) };
    mocks.getDatabase.mockResolvedValue(db);
    mocks.findCachedGame.mockResolvedValue(undefined);

    const recentGames = await localDbContent.recentGames();

    expect(db.getAllFromIndex).toHaveBeenCalledWith('recentGames', 'viewedAt');
    expect(recentGames).toHaveLength(20);
    expect(recentGames.map((game) => game.id)).toEqual(expectedIds);
    expect(recentGames[0]).toMatchObject({ id: 'game-24', displayName: '遊戲 24', englishName: 'Game 24' });
  });

  test('fills incomplete recent records from the cached game and omits records with no game', async () => {
    const stored = [
      { id: 'stored', slug: 'stored-slug', displayName: '已儲存名稱', viewedAt: 10 },
      { id: 'missing', viewedAt: 20 },
      { id: 'fallback', viewedAt: 30 },
    ];
    const db = { getAllFromIndex: vi.fn().mockResolvedValue(stored) };
    mocks.getDatabase.mockResolvedValue(db);
    mocks.findCachedGame.mockImplementation(async (_database: unknown, id: string) => {
      if (id === 'fallback') return { id, slug: 'fallback-slug', displayName: '回填名稱', englishName: 'Fallback Name' };
      if (id === 'stored') return { id, slug: 'stored-slug', displayName: '新名稱', englishName: 'Stored Name' };
      return undefined;
    });

    const recentGames = await localDbContent.recentGames();

    expect(recentGames).toEqual([
      { id: 'fallback', slug: 'fallback-slug', displayName: '回填名稱', englishName: 'Fallback Name' },
      { id: 'stored', slug: 'stored-slug', displayName: '已儲存名稱', englishName: 'Stored Name' },
    ]);
    expect(mocks.findCachedGame).toHaveBeenCalledTimes(3);
  });
});
