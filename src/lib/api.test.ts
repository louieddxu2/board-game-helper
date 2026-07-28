import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from './api';
import { localDb } from './localDb';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('api game cache boundary', () => {
  test('uses the normal game URL after a cache miss without a bypass query', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: async () => ({ game: { id: 'game-1', rules: [] } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(localDb, 'getCachedGame').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'cacheGame').mockResolvedValue(undefined);

    await api.game('emberleaf');

    expect(fetchMock).toHaveBeenCalledWith('/api/games/emberleaf', expect.any(Object));
  });

  test('uses the local game cache before making a network request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const cachedGame = { id: 'game-1', slug: 'emberleaf', displayName: 'Emberleaf', aliases: [], rules: [], ruleCount: 0, updatedAt: 1 };
    vi.spyOn(localDb, 'getCachedGame').mockResolvedValue({ key: 'game:emberleaf', data: cachedGame, cachedAt: Date.now() });

    const result = await api.game('emberleaf');

    expect(result.game).toEqual(cachedGame);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('uses the same local game store for the editor catalog detail', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const editorGame = { id: 'game-1', slug: 'emberleaf', displayName: 'Emberleaf', aliases: [], rules: [], ruleCount: 0, updatedAt: 1 };
    const getCachedGame = vi.spyOn(localDb, 'getCachedGame').mockResolvedValue({ key: 'game:game-1', data: editorGame, cachedAt: Date.now() });

    const result = await api.game('game-1', true);

    expect(result.game).toEqual(editorGame);
    expect(getCachedGame).toHaveBeenCalledWith('game-1', true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('explicitly requests the complete rule set after an editor cache miss', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: async () => ({ game: { id: 'game-1', slug: 'emberleaf', displayName: 'Emberleaf', aliases: [], rules: [], ruleCount: 0, updatedAt: 1 }, rulesComplete: true }),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(localDb, 'getCachedGame').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'cacheGame').mockResolvedValue(undefined);

    await api.game('game-1', true);

    expect(fetchMock).toHaveBeenCalledWith('/api/games/game-1?includePrivate=1', expect.any(Object));
  });

  test('writes a freshly fetched game through the API cache boundary', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: async () => ({ game: { id: 'game-1', slug: 'emberleaf', displayName: 'Emberleaf', aliases: [], rules: [], ruleCount: 0, updatedAt: 1 } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(localDb, 'getCachedGame').mockResolvedValue(undefined);
    const cacheGame = vi.spyOn(localDb, 'cacheGame').mockResolvedValue(undefined);

    await api.game('emberleaf');

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(cacheGame).toHaveBeenCalledOnce();
  });

  test('stores the editor rule set once while presenting only published rules on the game page', async () => {
    const publishedRule = { id: 'rule-public', gameId: 'game-1', statement: 'Public', status: 'published' as const, sourceLinks: [], tags: [] };
    const hiddenRule = { id: 'rule-hidden', gameId: 'game-1', statement: 'Hidden', status: 'hidden' as const, sourceLinks: [], tags: [] };
    const game = { id: 'game-1', slug: 'emberleaf', displayName: 'Emberleaf', aliases: [], rules: [publishedRule, hiddenRule], ruleCount: 2, publishedRuleCount: 1, totalRuleCount: 2, updatedAt: 1 };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: async () => ({ game, rulesComplete: true }),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(localDb, 'getCachedGame').mockResolvedValue(undefined);
    const cacheGame = vi.spyOn(localDb, 'cacheGame').mockResolvedValue(undefined);

    const publicResult = await api.game('emberleaf');

    expect(publicResult.game.rules).toEqual([publishedRule]);
    expect(publicResult.game.ruleCount).toBe(1);
    expect(cacheGame).toHaveBeenCalledWith(game, true);
  });

  test('requires a complete local rule set for the editor catalog', async () => {
    const getCachedGame = vi.spyOn(localDb, 'getCachedGame').mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: async () => ({ game: { id: 'game-1', slug: 'emberleaf', displayName: 'Emberleaf', aliases: [], rules: [], ruleCount: 0, updatedAt: 1 }, rulesComplete: false }),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(localDb, 'cacheGame').mockResolvedValue(undefined);

    await expect(api.game('emberleaf', true)).rejects.toMatchObject({ code: 'forbidden', status: 403 });

    expect(getCachedGame).toHaveBeenCalledWith('emberleaf', true);
  });

  test('does not refresh IndexedDB freshness for a service-worker offline fallback', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'X-Offline-Fallback': '1' }),
      json: async () => ({ game: { id: 'game-1', slug: 'emberleaf', displayName: 'Emberleaf', aliases: [], rules: [], ruleCount: 0, updatedAt: 1 } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(localDb, 'getCachedGame').mockResolvedValue(undefined);
    const cacheGame = vi.spyOn(localDb, 'cacheGame').mockResolvedValue(undefined);

    await api.game('emberleaf');

    expect(cacheGame).not.toHaveBeenCalled();
  });
});

describe('api daily game catalog boundary', () => {
  const catalog = {
    catalogDate: '2026-07-29',
    generatedAt: 1,
    games: [
      { id: 'game-1', slug: 'emberleaf', displayName: '火葉', englishName: 'Emberleaf', aliases: ['燼葉'], ruleCount: 2, updatedAt: 1 },
    ],
  };

  test('filters a same-day IndexedDB catalog without a network request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(localDb, 'getCachedGameCatalog').mockResolvedValue({ key: 'games:list:public:v1', data: catalog, cachedAt: 1 });

    const result = await api.searchGames('Ember');

    expect(result.games.map((game) => game.id)).toEqual(['game-1']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('fetches the one-row catalog only once, then uses the stored catalog for later queries', async () => {
    let cached: { key: string; data: typeof catalog; cachedAt: number } | undefined;
    vi.spyOn(localDb, 'getCachedGameCatalog').mockImplementation(async () => cached);
    vi.spyOn(localDb, 'getLatestGameCatalog').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'cacheGameCatalog').mockImplementation(async (data) => {
      cached = { key: 'games:list:public:v1', data: data as typeof catalog, cachedAt: 1 };
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: async () => catalog,
    });
    vi.stubGlobal('fetch', fetchMock);

    await api.searchGames('火葉');
    await api.searchGames('燼葉');

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('/api/game-catalog', expect.any(Object));
  });

  test('uses an older local catalog offline without marking it as today', async () => {
    vi.spyOn(localDb, 'getCachedGameCatalog').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'getLatestGameCatalog').mockResolvedValue({ key: 'games:list:public:v1', data: catalog, cachedAt: 1 });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));

    const result = await api.searchGames('火葉');

    expect(result.games.map((game) => game.id)).toEqual(['game-1']);
  });

  test('deduplicates concurrent first searches into one catalog request', async () => {
    vi.spyOn(localDb, 'getCachedGameCatalog').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'getLatestGameCatalog').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'cacheGameCatalog').mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), json: async () => catalog });
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([api.searchGames('火葉'), api.searchGames('Ember')]);

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  test('stores a newly created game into the local catalog overlay', async () => {
    const game = { id: 'game-2', slug: 'new-game', displayName: '新遊戲', ruleCount: 0, updatedAt: 2 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), json: async () => ({ game }) }));
    const upsert = vi.spyOn(localDb, 'upsertGameSummary').mockResolvedValue(undefined);

    await api.createGame({ displayName: '新遊戲' });

    expect(upsert).toHaveBeenCalledWith(game);
  });
});
