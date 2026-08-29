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

  test('publishes creator metadata when only cached rule credits changed', async () => {
    const staleRule = { id: 'r1', gameId: 'game-1', statement: 'Rule', status: 'published' as const, sourceLinks: [], tags: [], updatedAt: 1, createdBy: 'u1' };
    const freshRule = { ...staleRule, createdByNickname: 'author' };
    const staleGame = { ...game, rules: [staleRule] };
    const freshGame = { ...game, rules: [freshRule] };
    vi.spyOn(localDb, 'getCachedGame').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'getLatestGame').mockResolvedValue({ key: 'game:game-1', data: staleGame, cachedAt: 1 });
    vi.spyOn(localDb, 'cacheGame').mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), json: async () => ({ game: freshGame, rulesComplete: true }) }));
    const onUpdated = vi.fn();

    expect((await api.game('game-1', false, onUpdated)).game.rules[0].createdByNickname).toBeUndefined();
    await vi.waitFor(() => expect(onUpdated).toHaveBeenCalledWith({
      game: expect.objectContaining({ rules: [freshRule] }),
    }));
  });
});

describe('api rule importance cache boundary', () => {
  test('uses a fresh per-user game vote cache without a network request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(localDb, 'getCachedRuleImportance').mockResolvedValue({
      key: 'ruleImportance:u1:g1', data: { ruleIds: ['r1'] }, cachedAt: Date.now(),
    });

    await expect(api.ruleImportance('g1', 'u1')).resolves.toEqual({ ruleIds: ['r1'] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('returns an expired vote cache first and refreshes it in the background', async () => {
    vi.spyOn(localDb, 'getCachedRuleImportance').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'getLatestRuleImportance').mockResolvedValue({
      key: 'ruleImportance:u1:g1', data: { ruleIds: ['r1'] }, cachedAt: 1,
    });
    vi.spyOn(localDb, 'cacheRuleImportance').mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, headers: new Headers(), json: async () => ({ ruleIds: ['r1', 'r2'] }),
    }));
    const onUpdated = vi.fn();

    await expect(api.ruleImportance('g1', 'u1', onUpdated)).resolves.toEqual({ ruleIds: ['r1'] });
    await vi.waitFor(() => expect(onUpdated).toHaveBeenCalledWith({ ruleIds: ['r1', 'r2'] }));
  });

  test('updates one rule through an explicit PUT mutation', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, headers: new Headers(), json: async () => ({ important: true, count: 4 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.setRuleImportance('r1', true)).resolves.toEqual({ important: true, count: 4 });
    expect(fetchMock).toHaveBeenCalledWith('/api/rules/r1/importance', expect.objectContaining({
      method: 'PUT', body: JSON.stringify({ important: true }),
    }));
  });

});

describe('api mutation cache synchronization', () => {
  const game = { id: 'game-1', slug: 'emberleaf', displayName: 'Emberleaf', aliases: [], ruleCount: 1, updatedAt: 1 };
  const rule = { id: 'rule-1', gameId: game.id, gameName: game.displayName, gameSlug: game.slug, statement: 'Updated', status: 'published' as const, sourceLinks: [], tags: [], updatedAt: 2 };
  const resource = { id: 'resource-1', gameId: 'game-1', name: '官方教學', category: 'teaching' as const, url: 'https://example.com/teach', createdAt: 2, updatedAt: 2 };
  const sourceGame = { ...game, id: 'game-source', slug: 'old-name', displayName: 'Old name' };
  const targetGame = { ...game, id: 'game-target', slug: 'new-name', displayName: 'New name' };

  test('updates the local rule entity after editing a rule', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), json: async () => ({ ok: true, rule }) }));
    const update = vi.spyOn(localDb, 'updateCachedRuleEntity').mockResolvedValue(undefined);

    await api.patchRule(rule.id, { statement: rule.statement });

    expect(update).toHaveBeenCalledWith(rule);
  });

  test('updates the local game summary after changing a game name', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), json: async () => ({ ok: true, game }) }));
    const update = vi.spyOn(localDb, 'upsertGameSummary').mockResolvedValue(undefined);

    await api.patchGame(game.id, { displayName: game.displayName });

    expect(update).toHaveBeenCalledWith(game);
  });

  test('adds a newly created external resource to the local game cache', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), json: async () => ({ resource }) }));
    const update = vi.spyOn(localDb, 'updateCachedGameExternalResources').mockResolvedValue(undefined);

    await api.createGameExternalResource('game-1', { name: resource.name, category: resource.category, url: resource.url });

    expect(update).toHaveBeenCalledWith('game-1', expect.any(Function));
    const updater = update.mock.calls[0][1];
    expect(updater([])).toEqual([resource]);
  });

  test('removes a deleted external resource from the local game cache', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), json: async () => ({ ok: true }) }));
    const update = vi.spyOn(localDb, 'updateCachedGameExternalResources').mockResolvedValue(undefined);

    await api.deleteGameExternalResource('game-1', resource.id);

    expect(update).toHaveBeenCalledWith('game-1', expect.any(Function));
    const updater = update.mock.calls[0][1];
    expect(updater([resource])).toEqual([]);
  });

  test('merges the local source game cache into the target game cache', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), json: async () => ({
      ok: true, sourceGameId: sourceGame.id, targetGameId: targetGame.id, sourceGame, targetGame,
    }) }));
    const merge = vi.spyOn(localDb, 'mergeCachedGame').mockResolvedValue(undefined);

    await api.mergeGame(sourceGame.id, targetGame.id);

    expect(merge).toHaveBeenCalledWith(sourceGame, targetGame);
  });
});

describe('api account deletion boundary', () => {
  test('loads a current private summary only when requested', async () => {
    const payload = { deletableRuleCount: 2, retainedRuleCount: 1, isLastAdmin: false };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), json: async () => payload });
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.accountDeletionSummary()).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith('/api/account/deletion-summary', expect.any(Object));
  });

  test('sends both an explicit confirmation and the safe-rule choice', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, headers: new Headers(), json: async () => ({ ok: true, deletedRuleCount: 2 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.deleteAccount(true)).resolves.toEqual({ ok: true, deletedRuleCount: 2 });
    expect(fetchMock).toHaveBeenCalledWith('/api/account', expect.objectContaining({
      method: 'DELETE',
      body: JSON.stringify({ confirmation: '刪除帳號', deleteOwnUnmodifiedRules: true }),
    }));
  });
});

describe('api versioned game catalog boundary', () => {
  const catalog = {
    generation: 1,
    throughVersion: 10,
    generatedAt: Date.now(),
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
    await vi.waitFor(() => expect(onUpdated).toHaveBeenCalledWith({ games: [] }));
  });

  test('includes zero-rule games when the contribution picker explicitly requests them', async () => {
    const withEmptyGame = { ...catalog, games: [...catalog.games, { id: 'game-2', slug: 'santorini', displayName: '聖托里尼', ruleCount: 0, updatedAt: 2 }] };
    vi.spyOn(localDb, 'getSynchronizedGameCatalog').mockResolvedValue({ key: 'games:list:versioned:v2', data: withEmptyGame, cachedAt: 1 });

    expect((await api.searchGames('聖托里尼', undefined, { includeGamesWithoutPublishedRules: true })).games)
      .toEqual([withEmptyGame.games[1]]);
  });

  test('replaces a full snapshot downloaded more than one week ago before requesting deltas', async () => {
    const now = Date.UTC(2026, 6, 29, 12);
    const old = { ...catalog, generatedAt: now - 8 * 24 * 60 * 60 * 1000 };
    const fresh = { ...catalog, generation: 2, throughVersion: 20, generatedAt: now };
    vi.spyOn(Date, 'now').mockReturnValue(now);
    vi.spyOn(localDb, 'getSynchronizedGameCatalog').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'getLatestGameCatalog')
      .mockResolvedValueOnce({ key: 'games:list:versioned:v2', data: old, cachedAt: 1, snapshotFetchedAt: now - 8 * 24 * 60 * 60 * 1000 })
      .mockResolvedValue({ key: 'games:list:versioned:v2', data: fresh, cachedAt: now, snapshotFetchedAt: now });
    const cacheSnapshot = vi.spyOn(localDb, 'cacheGameCatalog').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'cacheGameCatalogChanges').mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockImplementation(async (path: string) => ({
      ok: true,
      headers: new Headers(),
      json: async () => path === '/api/game-catalog'
        ? fresh
        : { changes: [], throughVersion: 20, hasMore: false },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await api.searchGames('Ember');
    await vi.waitFor(() => expect(cacheSnapshot).toHaveBeenCalledWith(fresh));

    expect(fetchMock).toHaveBeenCalledWith('/api/game-catalog', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/game-catalog/changes?after=20', expect.any(Object));
    expect(fetchMock).not.toHaveBeenCalledWith('/api/game-catalog/changes?after=10', expect.any(Object));
  });

});

describe('api versioned attribute table boundary', () => {
  const table = {
    generation: 2,
    throughVersion: 10,
    generatedAt: Date.now(),
    attributes: [{ id: 'attribute-luck', key: 'luck', name: '運氣', minValue: 0, maxValue: 10, sortOrder: 0 }],
    subjects: [{ id: 'subject-a', slug: 'game-a', kind: 'game' as const, displayName: '遊戲甲', gameSlug: 'game-a' }],
    values: [],
    candidates: [],
    activities: [],
    scoreModelVersion: 'glicko-rd-v1',
  };

  test('uses the synchronized local attribute table without a network request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(localDb, 'getSynchronizedAttributeCatalog').mockResolvedValue({ key: 'attributes:table:versioned:v2', data: table, cachedAt: Date.now() });

    await expect(api.attributeTable()).resolves.toEqual(table);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('bootstraps the snapshot and then applies only newer attribute changes', async () => {
    const noChanges = { changes: [], throughVersion: 10, hasMore: false };
    vi.spyOn(localDb, 'getSynchronizedAttributeCatalog').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'getLatestAttributeCatalog').mockResolvedValueOnce(undefined).mockResolvedValue({ key: 'attributes:table:versioned:v2', data: table, cachedAt: Date.now() });
    const cacheSnapshot = vi.spyOn(localDb, 'cacheAttributeCatalog').mockResolvedValue(undefined);
    const cacheChanges = vi.spyOn(localDb, 'cacheAttributeCatalogChanges').mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockImplementation(async (path: string) => ({
      ok: true,
      headers: new Headers(),
      json: async () => path === '/api/attributes/table' ? table : noChanges,
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.attributeTable()).resolves.toEqual(table);

    expect(fetchMock).toHaveBeenCalledWith('/api/attributes/table', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/api/attributes/table/changes?after=10', expect.any(Object));
    expect(cacheSnapshot).toHaveBeenCalledWith(table);
    expect(cacheChanges).toHaveBeenCalledWith(noChanges);
  });

  test('replaces a cached generation-one table that lost flat candidate entries', async () => {
    const legacy = { ...table, generation: 1, candidates: [] };
    const repaired = { ...legacy, candidates: [{ id: 'candidate-1', displayName: '待對應遊戲', values: [8], matchStatus: 'pending' as const, sourceRowNumber: 3 }] };
    const cacheRecord = { key: 'attributes:table:versioned:v2', data: legacy, cachedAt: Date.now() };
    vi.spyOn(localDb, 'getSynchronizedAttributeCatalog').mockResolvedValue(cacheRecord);
    vi.spyOn(localDb, 'getLatestAttributeCatalog').mockResolvedValue({ ...cacheRecord, data: repaired });
    const cacheSnapshot = vi.spyOn(localDb, 'cacheAttributeCatalog').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'cacheAttributeCatalogChanges').mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockImplementation(async (path: string) => ({
      ok: true,
      headers: new Headers(),
      json: async () => path === '/api/attributes/table'
        ? repaired
        : { changes: [], throughVersion: repaired.throughVersion, hasMore: false },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.attributeTable()).resolves.toEqual(repaired);
    expect(fetchMock).toHaveBeenCalledWith('/api/attributes/table', expect.any(Object));
    expect(cacheSnapshot).toHaveBeenCalledWith(repaired);
  });

  test('returns a stale table immediately and publishes background deltas', async () => {
    const stale = { key: 'attributes:table:versioned:v2', data: table, cachedAt: 1 };
    const updated = { ...table, throughVersion: 11, values: [{ subjectId: 'subject-a', attributeId: 'attribute-luck', score: 8, ratingDeviation: 2, directCount: 1, comparisonCount: 0, decisiveComparisonCount: 0, evidenceCount: 1, modelVersion: 'glicko-rd-v1' }] };
    vi.spyOn(localDb, 'getSynchronizedAttributeCatalog').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'getLatestAttributeCatalog').mockResolvedValueOnce(stale).mockResolvedValue({ key: stale.key, data: updated, cachedAt: Date.now() });
    vi.spyOn(localDb, 'cacheAttributeCatalogChanges').mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: async () => ({ changes: [{ entryKey: 'value:subject-a:attribute-luck', catalogVersion: 11, deleted: false, value: updated.values[0] }], throughVersion: 11, hasMore: false }),
    }));
    const onUpdated = vi.fn();

    await expect(api.attributeTable(onUpdated)).resolves.toEqual(table);
    await vi.waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated));
  });
});

describe('api editor catalog cache boundary', () => {
  const catalog = {
    generation: 1,
    throughVersion: 10,
    generatedAt: Date.now(),
    games: [{ id: 'game-1', slug: 'emberleaf', displayName: 'Emberleaf', aliases: [], ruleCount: 1, totalRuleCount: 2, updatedAt: 1 }],
  };

  test('reuses the synchronized public catalog and exposes editor rule counts', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(localDb, 'getSynchronizedGameCatalog').mockResolvedValue({ key: 'games:list:versioned:v2', data: catalog, cachedAt: 1 });

    const result = await (api.catalogGames as (...args: unknown[]) => ReturnType<typeof api.catalogGames>)(true);

    expect(result.games[0].ruleCount).toBe(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('reuses the same cache while hiding private rule counts from ordinary users', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(localDb, 'getSynchronizedGameCatalog').mockResolvedValue({ key: 'games:list:versioned:v2', data: catalog, cachedAt: 1 });

    const result = await api.catalogGames(false);

    expect(result.games[0].ruleCount).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('manual sync requests only version changes while the weekly snapshot is still current', async () => {
    const invalidate = vi.spyOn(localDb, 'invalidateGameCatalogSync').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'getSynchronizedGameCatalog').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'getLatestGameCatalog').mockResolvedValue({ key: 'games:list:versioned:v2', data: catalog, cachedAt: 1 });
    vi.spyOn(localDb, 'cacheGameCatalogChanges').mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), json: async () => ({ changes: [], throughVersion: 10, hasMore: false }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.syncCatalogGames(true);

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
    vi.spyOn(localDb, 'cacheRuleEntity').mockResolvedValue(undefined);
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

describe('api favorite boundary', () => {
  test('keeps favorite reads user-specific and uncached', async () => {
    const payload = { favorites: [], recentUpdates: [] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), json: async () => payload });
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.personalHome()).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith('/api/account/home', expect.objectContaining({ credentials: 'same-origin' }));
  });

  test('uses explicit mutations for favorite changes and seen state', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, headers: new Headers(), json: async () => ({ favorite: true, favoriteCount: 1, wasFirst: true }) });
    vi.stubGlobal('fetch', fetchMock);

    await api.addFavorite('game/1');
    await api.removeFavorite('game/1');
    await api.markFavoriteSeen('game/1');

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/account/favorites/game%2F1', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/account/favorites/game%2F1', expect.objectContaining({ method: 'DELETE' }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/account/favorites/game%2F1/seen', expect.objectContaining({ method: 'POST' }));
  });
});
