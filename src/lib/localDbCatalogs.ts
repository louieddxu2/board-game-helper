import type { GameCatalogChangesPayload, GameCatalogPayload, GameSummary, HomeIDPayload, HomePayload, PublicTagCatalogChangesPayload, PublicTagCatalogPayload, TagSummary } from '../shared/types';
import { mergeGameCatalogEntries, upsertGameCatalogEntry } from './gameCatalog';
import type { CacheRecord, CachedRuleUpdate, GameCatalogCacheRecord, RuleEntity, SearchResponse, TagCacheRecord } from './localDbCore';
import { CATALOG_SYNC_FRESH_MS, HOME_VIEW_CACHE_KEY, HOUR_CACHE_FRESH_MS, LOCAL_GAME_CATALOG_OVERRIDES_KEY, PUBLIC_GAME_CATALOG_KEY, PUBLIC_TAGS_CACHE_KEY, PUBLIC_TAG_CATALOG_FRESH_MS, TAG_ENTITY_CACHE_FRESH_MS, applyGameCatalogChangesToCache, applyGameReferenceUpdate, getDatabase, getFreshCache, localDbMemory, replaceGameInHomeIds, toStoredRule } from './localDbCore';
import { applyPublicTagCatalogChanges } from './tagCatalog';

export const localDbCatalogs = {
  cacheSearch: async (key: string, data: SearchResponse) => {
    const record = { key: `search:${key}`, data, cachedAt: Date.now() } satisfies CacheRecord<SearchResponse>;
    if (localDbMemory.searchMemoryCache.size >= 100 && !localDbMemory.searchMemoryCache.has(key)) {
      localDbMemory.searchMemoryCache.delete(localDbMemory.searchMemoryCache.keys().next().value as string);
    }
    localDbMemory.searchMemoryCache.set(key, record);
    await (await getDatabase()).put('cache', record);
  },
  getCachedSearch: async (key: string) => {
    const memory = localDbMemory.searchMemoryCache.get(key);
    if (memory) {
      if (Date.now() - memory.cachedAt < HOUR_CACHE_FRESH_MS) return memory;
      localDbMemory.searchMemoryCache.delete(key);
    }
    const cached = await getFreshCache<SearchResponse>(`search:${key}`, HOUR_CACHE_FRESH_MS);
    if (cached) localDbMemory.searchMemoryCache.set(key, cached);
    return cached;
  },
  getCachedSearchPrefix: async (prefix: string, targetKey: string) => {
    for (const [key, cached] of localDbMemory.searchMemoryCache) {
      if (Date.now() - cached.cachedAt >= HOUR_CACHE_FRESH_MS) {
        localDbMemory.searchMemoryCache.delete(key);
        continue;
      }
      if (key.startsWith(prefix) && targetKey.startsWith(key) && cached.data.games.length < 20) return cached;
    }
    return undefined;
  },
  invalidateSearch: async () => {
    localDbMemory.searchMemoryCache.clear();
    const db = await getDatabase();
    const keys = await db.getAllKeys('cache');
    for (const key of keys) {
      if (typeof key === 'string' && key.startsWith('search:')) {
        await db.delete('cache', key);
      }
    }
  },
  cacheGameCatalog: async (data: GameCatalogPayload) => {
    const db = await getDatabase();
    const overrides = await db.get('cache', LOCAL_GAME_CATALOG_OVERRIDES_KEY) as CacheRecord<GameSummary[]> | undefined;
    const mergedData = { ...data, games: mergeGameCatalogEntries(data.games, overrides?.data ?? []) };
    const cachedAt = Date.now();
    const record = {
      key: PUBLIC_GAME_CATALOG_KEY,
      data: mergedData,
      cachedAt,
      snapshotFetchedAt: cachedAt,
    } satisfies GameCatalogCacheRecord;
    localDbMemory.gameCatalogMemoryCache = record;
    await db.put('cache', record);
    if (overrides) {
      const remaining = overrides.data.filter((override) => {
        const serverGame = data.games.find((game) => game.id === override.id);
        return !serverGame || override.updatedAt > serverGame.updatedAt;
      });
      if (remaining.length) await db.put('cache', { ...overrides, data: remaining });
      else await db.delete('cache', LOCAL_GAME_CATALOG_OVERRIDES_KEY);
    }
  },
  getSynchronizedGameCatalog: async () => {
    if (localDbMemory.gameCatalogMemoryCache && Date.now() - localDbMemory.gameCatalogMemoryCache.cachedAt < CATALOG_SYNC_FRESH_MS) return localDbMemory.gameCatalogMemoryCache;
    const cached = await (await getDatabase()).get('cache', PUBLIC_GAME_CATALOG_KEY) as GameCatalogCacheRecord | undefined;
    if (!cached || Date.now() - cached.cachedAt >= CATALOG_SYNC_FRESH_MS) return undefined;
    localDbMemory.gameCatalogMemoryCache = cached;
    return cached;
  },
  getLatestGameCatalog: async () => {
    if (localDbMemory.gameCatalogMemoryCache) return localDbMemory.gameCatalogMemoryCache;
    const cached = await (await getDatabase()).get('cache', PUBLIC_GAME_CATALOG_KEY) as GameCatalogCacheRecord | undefined;
    if (cached) localDbMemory.gameCatalogMemoryCache = cached;
    return cached;
  },
  cacheGameCatalogChanges: async (data: GameCatalogChangesPayload) => {
    const db = await getDatabase();
    const cached = await db.get('cache', PUBLIC_GAME_CATALOG_KEY) as GameCatalogCacheRecord | undefined;
    if (!cached) throw new Error('game_catalog_cache_missing');
    const updated = applyGameCatalogChangesToCache(cached, data);
    localDbMemory.gameCatalogMemoryCache = updated;
    await db.put('cache', updated);
    const overrides = await db.get('cache', LOCAL_GAME_CATALOG_OVERRIDES_KEY) as CacheRecord<GameSummary[]> | undefined;
    if (overrides && data.changes.length) {
      const changedIds = new Set(data.changes.map((change) => change.gameId));
      const remaining = overrides.data.filter((game) => !changedIds.has(game.id));
      if (remaining.length) await db.put('cache', { ...overrides, data: remaining });
      else await db.delete('cache', LOCAL_GAME_CATALOG_OVERRIDES_KEY);
    }
  },
  cacheHome: async (data: HomePayload) => (await getDatabase()).put('cache', { key: 'home', data, cachedAt: Date.now() }),
  getCachedHome: async () => getFreshCache<HomePayload>('home', HOUR_CACHE_FRESH_MS),
  getLatestHome: async () => (await getDatabase()).get('cache', 'home') as Promise<CacheRecord<HomePayload> | undefined>,
  cacheHomeView: async (data: HomePayload) => (await getDatabase()).put('cache', { key: HOME_VIEW_CACHE_KEY, data, cachedAt: Date.now() }),
  getLatestHomeView: async () => (await getDatabase()).get('cache', HOME_VIEW_CACHE_KEY) as Promise<CacheRecord<HomePayload> | undefined>,
  cacheHomeIDs: async (data: HomeIDPayload) => (await getDatabase()).put('cache', { key: 'home_ids', data, cachedAt: Date.now() }),
  getCachedHomeIDs: async () => getFreshCache<HomeIDPayload>('home_ids', HOUR_CACHE_FRESH_MS),
  invalidateHome: async () => {
    const db = await getDatabase();
    await db.delete('cache', 'home');
    await db.delete('cache', 'home_ids');
  },
  upsertGameSummary: async (game: GameSummary) => {
    const db = await getDatabase();
    const cachedAt = Date.now();
    const tx = db.transaction(['games', 'rules', 'recentGames', 'cache'], 'readwrite');
    const existing = await tx.objectStore('games').get(game.id);
    await tx.objectStore('games').put({
      ...existing,
      ...game,
      aliases: game.aliases ?? existing?.aliases ?? [],
      cachedAt,
    });

    const relatedRules = await tx.objectStore('rules').index('gameId').getAll(game.id);
    await Promise.all(relatedRules.map((rule) => tx.objectStore('rules').put({
      ...rule,
      gameName: game.displayName,
      gameSlug: game.slug,
      cachedAt,
    })));

    const recentGame = await tx.objectStore('recentGames').get(game.id);
    if (recentGame) await tx.objectStore('recentGames').put({ ...recentGame, slug: game.slug, displayName: game.displayName, englishName: game.englishName });

    const updateHomeRecord = async (key: string, isView: boolean) => {
      const record = await tx.objectStore('cache').get(key) as CacheRecord<HomePayload> | undefined;
      if (!record) return;
      const updated = applyGameReferenceUpdate(record.data, undefined, game, new Map());
      await tx.objectStore('cache').put({ ...record, data: updated, cachedAt: isView ? cachedAt : record.cachedAt });
    };
    await updateHomeRecord('home', false);
    await updateHomeRecord(HOME_VIEW_CACHE_KEY, true);
    const homeIds = await tx.objectStore('cache').get('home_ids') as CacheRecord<HomeIDPayload> | undefined;
    if (homeIds) await tx.objectStore('cache').put({ ...homeIds, data: replaceGameInHomeIds(homeIds.data, undefined, game) });

    const overrides = await tx.objectStore('cache').get(LOCAL_GAME_CATALOG_OVERRIDES_KEY) as CacheRecord<GameSummary[]> | undefined;
    await tx.objectStore('cache').put({
      key: LOCAL_GAME_CATALOG_OVERRIDES_KEY,
      data: upsertGameCatalogEntry(overrides?.data ?? [], game),
      cachedAt,
    });
    const catalog = await tx.objectStore('cache').get(PUBLIC_GAME_CATALOG_KEY) as GameCatalogCacheRecord | undefined;
    if (catalog) {
      const updated = { ...catalog, data: { ...catalog.data, games: upsertGameCatalogEntry(catalog.data.games, game) } };
      localDbMemory.gameCatalogMemoryCache = updated;
      await tx.objectStore('cache').put(updated);
    }
    await tx.done;
  },
  getCachedPublicTags: async () => getFreshCache<PublicTagCatalogPayload>(PUBLIC_TAGS_CACHE_KEY, PUBLIC_TAG_CATALOG_FRESH_MS),
  getLatestPublicTags: async () => (await getDatabase()).get('cache', PUBLIC_TAGS_CACHE_KEY) as Promise<CacheRecord<PublicTagCatalogPayload> | undefined>,
  cachePublicTagCatalogChanges: async (data: PublicTagCatalogChangesPayload) => {
    const db = await getDatabase();
    const cached = await db.get('cache', PUBLIC_TAGS_CACHE_KEY) as CacheRecord<PublicTagCatalogPayload> | undefined;
    const current = cached?.data ?? { tags: [], throughVersion: 0 };
    await db.put('cache', {
      key: PUBLIC_TAGS_CACHE_KEY,
      data: {
        tags: applyPublicTagCatalogChanges(current.tags, data.changes),
        throughVersion: Math.max(current.throughVersion, data.throughVersion),
      },
      cachedAt: data.hasMore ? (cached?.cachedAt ?? 0) : Date.now(),
    });
  },
  invalidatePublicTags: async () => {
    const db = await getDatabase();
    const cached = await db.get('cache', PUBLIC_TAGS_CACHE_KEY) as CacheRecord<PublicTagCatalogPayload> | undefined;
    if (cached) await db.put('cache', { ...cached, cachedAt: 0 });
  },
  cacheTagEntities: async (tags: TagSummary[]) => {
    const db = await getDatabase();
    const cachedAt = Date.now();
    await Promise.all(tags.map((tag) => db.put('cache', { key: `tag:${tag.id}`, data: tag, cachedAt })));
  },
  getCachedTagEntities: async (ids: string[]) => {
    const records = await Promise.all(ids.map((id) => getFreshCache<TagSummary>(`tag:${id}`, TAG_ENTITY_CACHE_FRESH_MS)));
    return records.filter((record): record is TagCacheRecord => Boolean(record));
  },
  getLatestTagEntities: async (ids: string[]) => {
    const db = await getDatabase();
    const records = await Promise.all(ids.map((id) => db.get('cache', `tag:${id}`) as Promise<TagCacheRecord | undefined>));
    return records.filter((record): record is TagCacheRecord => Boolean(record));
  },
  invalidateTagEntity: async (id: string) => (await getDatabase()).delete('cache', `tag:${id}`),
  cacheRuleEntity: async (rule: RuleEntity & { gameName?: string; gameSlug?: string }) => {
    const db = await getDatabase();
    let gameName = rule.gameName;
    let gameSlug = rule.gameSlug;
    if (!gameName || !gameSlug) {
      const game = await db.get('games', rule.gameId);
      if (game) {
        gameName = gameName || game.displayName;
        gameSlug = gameSlug || game.slug;
      }
    }
    await db.put('rules', { ...toStoredRule(rule), gameName, gameSlug, cachedAt: Date.now() });
  },
  updateCachedRuleEntity: async (rule: CachedRuleUpdate) => {
    const db = await getDatabase();
    const cachedAt = Date.now();
    const tx = db.transaction(['rules', 'games', 'cache'], 'readwrite');
    const existing = await tx.objectStore('rules').get(rule.id);
    const game = await tx.objectStore('games').get(rule.gameId);
    await tx.objectStore('rules').put({
      ...existing,
      ...toStoredRule(rule),
      gameName: rule.gameName ?? game?.displayName,
      gameSlug: rule.gameSlug ?? game?.slug,
      cachedAt,
    });
    if (game) {
      const latestRuleUpdatedAt = Math.max(game.latestRuleUpdatedAt ?? game.rulesVersion ?? 0, rule.updatedAt ?? 0);
      await tx.objectStore('games').put({
        ...game,
        updatedAt: Math.max(game.updatedAt, rule.updatedAt ?? 0),
        latestRuleUpdatedAt,
        rulesVersion: latestRuleUpdatedAt,
        cachedAt,
      });
    }
    const ruleUpdates = new Map([[rule.id, rule]]);
    const referenceGame = game
      ? { ...game, displayName: rule.gameName ?? game.displayName, slug: rule.gameSlug ?? game.slug }
      : { id: rule.gameId, slug: rule.gameSlug ?? '', displayName: rule.gameName ?? '', ruleCount: 0, updatedAt: rule.updatedAt ?? cachedAt };
    for (const key of ['home', HOME_VIEW_CACHE_KEY]) {
      const record = await tx.objectStore('cache').get(key) as CacheRecord<HomePayload> | undefined;
      if (!record) continue;
      await tx.objectStore('cache').put({
        ...record,
        data: applyGameReferenceUpdate(record.data, undefined, referenceGame, ruleUpdates),
        cachedAt: key === HOME_VIEW_CACHE_KEY ? cachedAt : record.cachedAt,
      });
    }
    await tx.done;
  },
};
