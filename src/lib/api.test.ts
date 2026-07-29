import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from './api';
import { localDb } from './localDb';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('api game cache boundary', () => {
  const game = { id: 'game-1', slug: 'emberleaf', displayName: 'Emberleaf', aliases: [], rules: [], ruleCount: 0, updatedAt: 1 };

  test('uses the normal game URL after a cache miss without a bypass query', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), json: async () => ({ game }) });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(localDb, 'getCachedGame').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'cacheGame').mockResolvedValue(undefined);

    await api.game('emberleaf');

    expect(fetchMock).toHaveBeenCalledWith('/api/games/emberleaf', expect.any(Object));
  });

  test('uses the local game cache before making a network request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(localDb, 'getCachedGame').mockResolvedValue({ key: 'game:emberleaf', data: game, cachedAt: Date.now() });

    expect((await api.game('emberleaf')).game).toEqual(game);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('uses the same local game store for the editor catalog detail', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const getCachedGame = vi.spyOn(localDb, 'getCachedGame').mockResolvedValue({ key: 'game:game-1', data: game, cachedAt: Date.now() });

    expect((await api.game('game-1', true)).game).toEqual(game);
    expect(getCachedGame).toHaveBeenCalledWith('game-1', true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('explicitly requests the complete rule set after an editor cache miss', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), json: async () => ({ game, rulesComplete: true }) });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(localDb, 'getCachedGame').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'cacheGame').mockResolvedValue(undefined);

    await api.game('game-1', true);

    expect(fetchMock).toHaveBeenCalledWith('/api/games/game-1?includePrivate=1', expect.any(Object));
  });

  test('writes a freshly fetched game through the API cache boundary', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), json: async () => ({ game }) }));
    vi.spyOn(localDb, 'getCachedGame').mockResolvedValue(undefined);
    const cacheGame = vi.spyOn(localDb, 'cacheGame').mockResolvedValue(undefined);

    await api.game('emberleaf');

    expect(cacheGame).toHaveBeenCalledOnce();
  });

  test('stores the complete set while presenting only published rules publicly', async () => {
    const publishedRule = { id: 'rule-public', gameId: 'game-1', statement: 'Public', status: 'published' as const, sourceLinks: [], tags: [] };
    const hiddenRule = { id: 'rule-hidden', gameId: 'game-1', statement: 'Hidden', status: 'hidden' as const, sourceLinks: [], tags: [] };
    const completeGame = { ...game, rules: [publishedRule, hiddenRule], ruleCount: 2, publishedRuleCount: 1, totalRuleCount: 2 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), json: async () => ({ game: completeGame, rulesComplete: true }) }));
    vi.spyOn(localDb, 'getCachedGame').mockResolvedValue(undefined);
    const cacheGame = vi.spyOn(localDb, 'cacheGame').mockResolvedValue(undefined);

    const result = await api.game('emberleaf');

    expect(result.game.rules).toEqual([publishedRule]);
    expect(result.game.ruleCount).toBe(1);
    expect(cacheGame).toHaveBeenCalledWith(completeGame, true);
  });

  test('requires a complete local rule set for editor detail', async () => {
    vi.spyOn(localDb, 'getCachedGame').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'cacheGame').mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), json: async () => ({ game, rulesComplete: false }) }));

    await expect(api.game('emberleaf', true)).rejects.toMatchObject({ code: 'forbidden', status: 403 });
  });

  test('does not refresh IndexedDB freshness for a service-worker offline fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'X-Offline-Fallback': '1' }),
      json: async () => ({ game }),
    }));
    vi.spyOn(localDb, 'getCachedGame').mockResolvedValue(undefined);
    const cacheGame = vi.spyOn(localDb, 'cacheGame').mockResolvedValue(undefined);

    await api.game('emberleaf');

    expect(cacheGame).not.toHaveBeenCalled();
  });

  test('returns an expired game immediately and publishes a changed background response', async () => {
    const updated = { ...game, displayName: 'Updated Emberleaf', updatedAt: 2 };
    vi.spyOn(localDb, 'getCachedGame').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'getLatestGame').mockResolvedValue({ key: 'game:game-1', data: game, cachedAt: 1 });
    vi.spyOn(localDb, 'cacheGame').mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), json: async () => ({ game: updated, rulesComplete: true }) }));
    const onUpdated = vi.fn();

    const initial = await api.game('emberleaf', false, onUpdated);

    expect(initial.game).toEqual(game);
    await vi.waitFor(() => expect(onUpdated).toHaveBeenCalledWith({ game: updated }));
  });
});

describe('api versioned game catalog boundary', () => {
  const catalog = {
    generation: 1,
    throughVersion: 10,
    generatedAt: 1,
    games: [{ id: 'game-1', slug: 'emberleaf', displayName: '葉嶼', englishName: 'Emberleaf', aliases: ['葉島'], ruleCount: 2, updatedAt: 1 }],
  };
  const noChanges = { changes: [], throughVersion: 10, hasMore: false };

  test('filters a synchronized IndexedDB catalog without a network request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(localDb, 'getSynchronizedGameCatalog').mockResolvedValue({ key: 'games:list:versioned:v2', data: catalog, cachedAt: 1 });

    expect((await api.searchGames('Ember')).games.map((item) => item.id)).toEqual(['game-1']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('bootstraps the weekly snapshot and immediately applies version changes', async () => {
    vi.spyOn(localDb, 'getSynchronizedGameCatalog').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'getLatestGameCatalog')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue({ key: 'games:list:versioned:v2', data: catalog, cachedAt: 1 });
    const cacheSnapshot = vi.spyOn(localDb, 'cacheGameCatalog').mockResolvedValue(undefined);
    const cacheChanges = vi.spyOn(localDb, 'cacheGameCatalogChanges').mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockImplementation(async (path: string) => ({
      ok: true,
      headers: new Headers(),
      json: async () => path === '/api/game-catalog' ? catalog : noChanges,
    }));
    vi.stubGlobal('fetch', fetchMock);

    await api.searchGames('Ember');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith('/api/game-catalog', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/game-catalog/changes?after=10', expect.any(Object));
    expect(cacheSnapshot).toHaveBeenCalledWith(catalog);
    expect(cacheChanges).toHaveBeenCalledWith(noChanges);
  });

  test('uses an older local catalog offline without refreshing its timestamp', async () => {
    vi.spyOn(localDb, 'getSynchronizedGameCatalog').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'getLatestGameCatalog').mockResolvedValue({ key: 'games:list:versioned:v2', data: catalog, cachedAt: 1 });
    const cacheChanges = vi.spyOn(localDb, 'cacheGameCatalogChanges').mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));

    expect((await api.searchGames('Ember')).games.map((item) => item.id)).toEqual(['game-1']);
    expect(cacheChanges).not.toHaveBeenCalled();
  });

  test('deduplicates concurrent first searches into one snapshot and one delta request', async () => {
    vi.spyOn(localDb, 'getSynchronizedGameCatalog').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'getLatestGameCatalog')
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue({ key: 'games:list:versioned:v2', data: catalog, cachedAt: 1 });
    vi.spyOn(localDb, 'cacheGameCatalog').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'cacheGameCatalogChanges').mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockImplementation(async (path: string) => ({
      ok: true,
      headers: new Headers(),
      json: async () => path === '/api/game-catalog' ? catalog : noChanges,
    }));
    vi.stubGlobal('fetch', fetchMock);

    await Promise.all([api.searchGames('葉嶼'), api.searchGames('Ember')]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('returns an expired catalog immediately and publishes synchronized changes in the background', async () => {
    const updated = { ...catalog, throughVersion: 11, games: [...catalog.games, { id: 'game-2', slug: 'new', displayName: 'New', aliases: [], ruleCount: 0, updatedAt: 2 }] };
    vi.spyOn(localDb, 'getSynchronizedGameCatalog').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'getLatestGameCatalog')
      .mockResolvedValueOnce({ key: 'games:list:versioned:v2', data: catalog, cachedAt: 1 })
      .mockResolvedValue({ key: 'games:list:versioned:v2', data: updated, cachedAt: 2 });
    vi.spyOn(localDb, 'cacheGameCatalogChanges').mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), json: async () => ({
      changes: [{ gameId: 'game-2', catalogVersion: 11, deleted: false, game: updated.games[1] }],
      throughVersion: 11,
      hasMore: false,
    }) }));
    const onUpdated = vi.fn();

    const initial = await api.searchGames('New', onUpdated);

    expect(initial.games).toEqual([]);
    await vi.waitFor(() => expect(onUpdated).toHaveBeenCalledWith({ games: [updated.games[1]] }));
  });

  test('stores a newly created game into the local catalog overlay', async () => {
    const newGame = { id: 'game-2', slug: 'new-game', displayName: '新遊戲', ruleCount: 0, updatedAt: 2 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), json: async () => ({ game: newGame }) }));
    const upsert = vi.spyOn(localDb, 'upsertGameSummary').mockResolvedValue(undefined);

    await api.createGame({ displayName: '新遊戲' });

    expect(upsert).toHaveBeenCalledWith(newGame);
  });
});

describe('api editor catalog cache boundary', () => {
  const catalog = {
    generation: 1,
    throughVersion: 10,
    generatedAt: 1,
    games: [{ id: 'game-1', slug: 'emberleaf', displayName: 'Emberleaf', aliases: [], ruleCount: 1, totalRuleCount: 2, updatedAt: 1 }],
  };

  test('reuses the synchronized public catalog and exposes editor rule counts', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(localDb, 'getSynchronizedGameCatalog').mockResolvedValue({ key: 'games:list:versioned:v2', data: catalog, cachedAt: 1 });

    const result = await (api.editorCatalogGames as (...args: unknown[]) => ReturnType<typeof api.editorCatalogGames>)(true);

    expect(result.games[0].ruleCount).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('manual sync expires only the ten-minute cursor and requests only version changes', async () => {
    const invalidate = vi.spyOn(localDb, 'invalidateGameCatalogSync').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'getSynchronizedGameCatalog').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'getLatestGameCatalog').mockResolvedValue({ key: 'games:list:versioned:v2', data: catalog, cachedAt: 1 });
    vi.spyOn(localDb, 'cacheGameCatalogChanges').mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), json: async () => ({ changes: [], throughVersion: 10, hasMore: false }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.syncEditorCatalogGames();

    expect(result.games[0].ruleCount).toBe(2);
    expect(invalidate).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('/api/game-catalog/changes?after=10', expect.any(Object));
  });
});

describe('api home stale-while-revalidate boundary', () => {
  const stale = {
    generatedAt: 1,
    featured: [{ gameSlug: 'old', gameName: 'Old', ruleId: 'old-rule' }],
    featuredRules: [],
    recentRules: [],
    popularGames: [],
  };
  const fresh = {
    generatedAt: 2,
    featured: [{ gameSlug: 'new', gameName: 'New', ruleId: 'new-rule' }],
    featuredRules: [],
    recentRules: [],
    popularGames: [],
  };

  test('returns an expired home cache immediately and publishes a changed background response', async () => {
    vi.spyOn(localDb, 'getCachedHome').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'getLatestHome').mockResolvedValue({ key: 'home', data: stale, cachedAt: 1 });
    vi.spyOn(localDb, 'cacheHome').mockResolvedValue('home');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), json: async () => fresh }));
    const onUpdated = vi.fn();

    const initial = await api.home(onUpdated);

    expect(initial).toEqual(stale);
    await vi.waitFor(() => expect(onUpdated).toHaveBeenCalledWith(fresh));
  });
});

describe('api public entity stale-while-revalidate boundary', () => {
  test('returns an expired rule while refreshing it in the background', async () => {
    const staleRule = { id: 'r1', gameId: 'g1', gameName: 'Game', gameSlug: 'game', statement: 'Old', status: 'published' as const, sourceLinks: [], tags: [], updatedAt: 1 };
    const freshRule = { ...staleRule, statement: 'New', updatedAt: 2 };
    vi.spyOn(localDb, 'getCachedRuleEntity').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'getLatestRuleEntity').mockResolvedValue({ key: 'rule:r1', data: { ...staleRule, cachedAt: 1 }, cachedAt: 1 });
    vi.spyOn(localDb, 'cacheRuleEntity').mockResolvedValue('r1');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), json: async () => ({ rule: freshRule }) }));
    const onUpdated = vi.fn();

    expect((await api.rule('r1', onUpdated)).rule.statement).toBe('Old');
    await vi.waitFor(() => expect(onUpdated).toHaveBeenCalledWith({ rule: freshRule }));
  });

  test('returns expired public tags while refreshing them in the background', async () => {
    const stale = { tags: [{ id: 't1', slug: 'old', name: 'Old', updatedAt: 1 }], throughVersion: 1 };
    const fresh = { tags: [{ id: 't1', slug: 'new', name: 'New', updatedAt: 2 }], throughVersion: 2 };
    vi.spyOn(localDb, 'getCachedPublicTags').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'getLatestPublicTags')
      .mockResolvedValueOnce({ key: 'publicTags:versioned:v3', data: stale, cachedAt: 1 })
      .mockResolvedValueOnce({ key: 'publicTags:versioned:v3', data: stale, cachedAt: 1 })
      .mockResolvedValue({ key: 'publicTags:versioned:v3', data: fresh, cachedAt: 2 });
    vi.spyOn(localDb, 'cachePublicTagCatalogChanges').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'cacheTagEntities').mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: async () => ({
        changes: [{ tagId: 't1', catalogVersion: 2, deleted: false, tag: fresh.tags[0] }],
        throughVersion: 2,
        hasMore: false,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const onUpdated = vi.fn();

    expect((await api.tags(undefined, onUpdated)).tags[0].name).toBe('Old');
    await vi.waitFor(() => expect(onUpdated).toHaveBeenCalledWith(fresh));
    expect(fetchMock).toHaveBeenCalledWith('/api/tags/changes?after=1', expect.any(Object));
  });
});
