import { afterEach, describe, expect, test, vi } from 'vitest';
import type { AttributeCatalogChangesPayload, AttributeCatalogPayload } from '../shared/types';
import { api } from './api';
import { applyAttributeCatalogChanges } from './attributeCatalog';
import { localDb } from './localDb';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
    vi.spyOn(localDb, 'getSynchronizedAttributeCatalog').mockResolvedValue({ key: 'attributes:table:versioned:v3', data: table, cachedAt: Date.now() });

    await expect(api.attributeTable()).resolves.toEqual(table);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('bootstraps the snapshot and then applies only newer attribute changes', async () => {
    const noChanges = { changes: [], throughVersion: 10, hasMore: false, snapshot: { generation: table.generation, generatedAt: table.generatedAt } };
    vi.spyOn(localDb, 'getSynchronizedAttributeCatalog').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'getLatestAttributeCatalog').mockResolvedValueOnce(undefined).mockResolvedValue({ key: 'attributes:table:versioned:v3', data: table, cachedAt: Date.now() });
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
    expect(fetchMock).toHaveBeenCalledWith(`/api/attributes/table/changes?after=10&generation=${table.generation}&generatedAt=${table.generatedAt}`, expect.any(Object));
    expect(cacheSnapshot).toHaveBeenCalledWith(table);
    expect(cacheChanges).toHaveBeenCalledWith(noChanges);
  });

  test('finishes every delta page before returning the synchronized attribute table', async () => {
    let cached: AttributeCatalogPayload = { ...table, attributes: [
      { ...table.attributes[0], id: 'score', name: '得分取勝' },
      { ...table.attributes[0], id: 'condition', name: '條件取勝' },
    ] };
    const merged = { ...table.attributes[0], id: 'win', name: '取勝方式' };
    vi.spyOn(localDb, 'getSynchronizedAttributeCatalog').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'getLatestAttributeCatalog').mockResolvedValueOnce(undefined)
      .mockImplementation(async () => ({ key: 'attributes:table:versioned:v3', data: cached, cachedAt: Date.now() }));
    vi.spyOn(localDb, 'cacheAttributeCatalog').mockResolvedValue(undefined);
    const cacheChanges = vi.spyOn(localDb, 'cacheAttributeCatalogChanges').mockImplementation(async (page) => {
      cached = applyAttributeCatalogChanges(cached, page.changes, page.throughVersion);
    });
    const pages: AttributeCatalogChangesPayload[] = [
      { changes: [], throughVersion: 11, hasMore: true, snapshot: { generation: table.generation, generatedAt: table.generatedAt } },
      { changes: [
        { entryKey: 'attribute:score', catalogVersion: 12, deleted: true },
        { entryKey: 'attribute:condition', catalogVersion: 13, deleted: true },
        { entryKey: 'attribute:win', catalogVersion: 14, deleted: false, attribute: merged },
      ], throughVersion: 14, hasMore: false, snapshot: { generation: table.generation, generatedAt: table.generatedAt } },
    ];
    const fetchMock = vi.fn().mockImplementation(async (path: string) => ({
      ok: true, headers: new Headers(),
      json: async () => path === '/api/attributes/table' ? table : pages.shift(),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.attributeTable();

    expect(fetchMock).toHaveBeenCalledWith(`/api/attributes/table/changes?after=11&generation=${table.generation}&generatedAt=${table.generatedAt}`, expect.any(Object));
    expect(cacheChanges).toHaveBeenCalledTimes(2);
    expect(result.attributes).toEqual([merged]);
    expect(result.throughVersion).toBe(14);
  });

  test('replaces a cached generation-one table that lost flat candidate entries', async () => {
    const legacy = { ...table, generation: 1, candidates: [] };
    const repaired = { ...legacy, candidates: [{ id: 'candidate-1', displayName: '待對應遊戲', values: [8], matchStatus: 'pending' as const, sourceRowNumber: 3 }] };
    const cacheRecord = { key: 'attributes:table:versioned:v3', data: legacy, cachedAt: Date.now() };
    vi.spyOn(localDb, 'getSynchronizedAttributeCatalog').mockResolvedValue(cacheRecord);
    vi.spyOn(localDb, 'getLatestAttributeCatalog').mockResolvedValue({ ...cacheRecord, data: repaired });
    const cacheSnapshot = vi.spyOn(localDb, 'cacheAttributeCatalog').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'cacheAttributeCatalogChanges').mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockImplementation(async (path: string) => ({
      ok: true,
      headers: new Headers(),
      json: async () => path === '/api/attributes/table'
        ? repaired
        : { changes: [], throughVersion: repaired.throughVersion, hasMore: false, snapshot: { generation: repaired.generation, generatedAt: repaired.generatedAt } },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.attributeTable()).resolves.toEqual(repaired);
    expect(fetchMock).toHaveBeenCalledWith('/api/attributes/table', expect.any(Object));
    expect(cacheSnapshot).toHaveBeenCalledWith(repaired);
  });

  test('returns a stale table immediately and publishes background deltas', async () => {
    const stale = { key: 'attributes:table:versioned:v3', data: table, cachedAt: 1 };
    const updated = { ...table, throughVersion: 11, values: [{ subjectId: 'subject-a', attributeId: 'attribute-luck', score: 8, ratingDeviation: 2, directCount: 1, comparisonCount: 0, decisiveComparisonCount: 0, evidenceCount: 1, modelVersion: 'glicko-rd-v1' }] };
    vi.spyOn(localDb, 'getSynchronizedAttributeCatalog').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'getLatestAttributeCatalog').mockResolvedValueOnce(stale).mockResolvedValue({ key: stale.key, data: updated, cachedAt: Date.now() });
    vi.spyOn(localDb, 'cacheAttributeCatalogChanges').mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: async () => ({ changes: [{ entryKey: 'value:subject-a:attribute-luck', catalogVersion: 11, deleted: false, value: updated.values[0] }], throughVersion: 11, hasMore: false, snapshot: { generation: table.generation, generatedAt: table.generatedAt } }),
    }));
    const onUpdated = vi.fn();

    await expect(api.attributeTable(onUpdated)).resolves.toEqual(table);
    await vi.waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated));
  });

  test('replaces the local table when the cloud snapshot is newer', async () => {
    const replacement = { ...table, generation: 2, generatedAt: table.generatedAt + 1, subjects: [...table.subjects, { id: 'subject-b', slug: 'game-b', kind: 'game' as const, displayName: '遊戲乙' }] };
    const stale = { key: 'attributes:table:versioned:v3', data: table, cachedAt: 1 };
    vi.spyOn(localDb, 'getSynchronizedAttributeCatalog').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'invalidateAttributeCatalogSync').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'getLatestAttributeCatalog').mockResolvedValueOnce(stale).mockResolvedValue({ key: stale.key, data: replacement, cachedAt: Date.now() });
    const cacheSnapshot = vi.spyOn(localDb, 'cacheAttributeCatalog').mockResolvedValue(undefined);
    const cacheChanges = vi.spyOn(localDb, 'cacheAttributeCatalogChanges').mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (path: string) => ({
      ok: true,
      headers: new Headers(),
      json: async () => path === '/api/attributes/table'
        ? replacement
        : { changes: [], throughVersion: table.throughVersion, hasMore: false, snapshot: { generation: replacement.generation, generatedAt: replacement.generatedAt } },
    })));

    await expect(api.syncAttributeTable()).resolves.toEqual(replacement);
    expect(cacheSnapshot).toHaveBeenCalledWith(replacement);
    expect(cacheChanges).toHaveBeenCalledTimes(1);
  });
});
