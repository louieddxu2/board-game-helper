import type { GameDetail, GameExternalResource, GameSummary, HomeIDPayload, HomePayload } from '../shared/types';
import { upsertGameCatalogEntry } from './gameCatalog';
import type { CachedGameRow, CacheRecord, GameCatalogCacheRecord } from './localDbCore';
import { applyGameReferenceUpdate, findCachedGame, getDatabase, getFreshCache, HOME_VIEW_CACHE_KEY, HOUR_CACHE_FRESH_MS, LOCAL_GAME_CATALOG_OVERRIDES_KEY, localDbMemory, PUBLIC_GAME_CATALOG_KEY, readCachedGameDetail, replaceGameInHomeIds, RULE_IMPORTANCE_CACHE_FRESH_MS, ruleImportanceCacheKey, ruleImportanceCachePrefix, toStoredRule } from './localDbCore';

export const localDbContent = {
  updateCachedGameExternalResources: async (
    gameId: string,
    update: (resources: GameExternalResource[]) => GameExternalResource[],
  ) => {
    const db = await getDatabase();
    const tx = db.transaction('games', 'readwrite');
    const game = await tx.store.get(gameId);
    if (game) {
      await tx.store.put({
        ...game,
        externalResources: update(game.externalResources ?? []),
        cachedAt: Date.now(),
      });
    }
    await tx.done;
  },
  mergeCachedGame: async (sourceGame: GameSummary, targetGame: GameSummary, movedRuleIds: string[] = []) => {
    const db = await getDatabase();
    const cachedAt = Date.now();
    const tx = db.transaction(['games', 'rules', 'recentGames', 'cache'], 'readwrite');
    const source = await tx.objectStore('games').get(sourceGame.id);
    const target = await tx.objectStore('games').get(targetGame.id);
    const sourceRules = await tx.objectStore('rules').index('gameId').getAll(sourceGame.id);
    const movedIds = movedRuleIds.length ? new Set(movedRuleIds) : undefined;
    for (const rule of sourceRules) {
      if (movedIds && !movedIds.has(rule.id)) continue;
      await tx.objectStore('rules').put({
        ...rule,
        gameId: targetGame.id,
        gameName: targetGame.displayName,
        gameSlug: targetGame.slug,
        cachedAt,
      });
    }
    await tx.objectStore('games').put({
      ...target,
      ...targetGame,
      aliases: targetGame.aliases ?? target?.aliases ?? [],
      rulesFetchedAt: 0,
      rulesComplete: false,
      cachedAt,
    } as CachedGameRow);
    await tx.objectStore('games').delete(sourceGame.id);

    const recentSource = await tx.objectStore('recentGames').get(sourceGame.id);
    if (recentSource) {
      await tx.objectStore('recentGames').delete(sourceGame.id);
      const recentTarget = await tx.objectStore('recentGames').get(targetGame.id);
      if (!recentTarget || recentSource.viewedAt > recentTarget.viewedAt) {
        await tx.objectStore('recentGames').put({
          id: targetGame.id,
          slug: targetGame.slug,
          displayName: targetGame.displayName,
          englishName: targetGame.englishName,
          viewedAt: recentSource.viewedAt,
        });
      }
    }

    const updateHomeRecord = async (key: string, isView: boolean) => {
      const record = await tx.objectStore('cache').get(key) as CacheRecord<HomePayload> | undefined;
      if (!record) return;
      const updated = applyGameReferenceUpdate(record.data, sourceGame, targetGame, new Map());
      await tx.objectStore('cache').put({ ...record, data: updated, cachedAt: isView ? cachedAt : record.cachedAt });
    };
    await updateHomeRecord('home', false);
    await updateHomeRecord(HOME_VIEW_CACHE_KEY, true);
    const homeIds = await tx.objectStore('cache').get('home_ids') as CacheRecord<HomeIDPayload> | undefined;
    if (homeIds) await tx.objectStore('cache').put({ ...homeIds, data: replaceGameInHomeIds(homeIds.data, sourceGame, targetGame) });

    const catalog = await tx.objectStore('cache').get(PUBLIC_GAME_CATALOG_KEY) as GameCatalogCacheRecord | undefined;
    if (catalog) {
      const games = catalog.data.games.filter((game) => game.id !== sourceGame.id);
      const updated = { ...catalog, data: { ...catalog.data, games: upsertGameCatalogEntry(games, targetGame) } };
      localDbMemory.gameCatalogMemoryCache = updated;
      await tx.objectStore('cache').put(updated);
    }
    const overrides = await tx.objectStore('cache').get(LOCAL_GAME_CATALOG_OVERRIDES_KEY) as CacheRecord<GameSummary[]> | undefined;
    if (overrides) {
      const games = overrides.data.filter((game) => game.id !== sourceGame.id);
      await tx.objectStore('cache').put({ ...overrides, data: upsertGameCatalogEntry(games, targetGame), cachedAt });
    }

    const keys = await tx.objectStore('cache').getAllKeys();
    for (const key of keys) {
      if (typeof key !== 'string' || !key.endsWith(`:${sourceGame.id}`) || !key.startsWith('ruleImportance:')) continue;
      const sourceImportance = await tx.objectStore('cache').get(key) as CacheRecord<{ ruleIds: string[] }> | undefined;
      if (!sourceImportance) continue;
      const targetKey = key.slice(0, -sourceGame.id.length) + targetGame.id;
      const targetImportance = await tx.objectStore('cache').get(targetKey) as CacheRecord<{ ruleIds: string[] }> | undefined;
      await tx.objectStore('cache').put({
        key: targetKey,
        data: { ruleIds: Array.from(new Set([...(targetImportance?.data.ruleIds ?? []), ...sourceImportance.data.ruleIds])).sort() },
        cachedAt: Math.max(sourceImportance.cachedAt, targetImportance?.cachedAt ?? 0),
      });
      await tx.objectStore('cache').delete(key);
    }
    await tx.done;
    localDbMemory.searchMemoryCache.clear();
  },
  getCachedRuleEntity: async (ruleId: string) => {
    const db = await getDatabase();
    const rule = await db.get('rules', ruleId);
    if (!rule || Date.now() - rule.cachedAt >= HOUR_CACHE_FRESH_MS) return undefined;
    if (!rule.gameName || !rule.gameSlug) {
      const game = await db.get('games', rule.gameId);
      if (game) {
        rule.gameName = rule.gameName || game.displayName;
        rule.gameSlug = rule.gameSlug || game.slug;
      }
    }
    return { key: `rule:${ruleId}`, data: rule, cachedAt: rule.cachedAt };
  },
  getLatestRuleEntity: async (ruleId: string) => {
    const db = await getDatabase();
    const rule = await db.get('rules', ruleId);
    if (!rule) return undefined;
    if (!rule.gameName || !rule.gameSlug) {
      const game = await db.get('games', rule.gameId);
      if (game) {
        rule.gameName = rule.gameName || game.displayName;
        rule.gameSlug = rule.gameSlug || game.slug;
      }
    }
    return { key: `rule:${ruleId}`, data: rule, cachedAt: rule.cachedAt };
  },
  invalidateRuleEntity: async (ruleId: string) => {
    const db = await getDatabase();
    const rule = await db.get('rules', ruleId);
    await db.delete('rules', ruleId);
    if (rule) {
      const game = await db.get('games', rule.gameId);
      if (game) await db.put('games', { ...game, rulesFetchedAt: 0 });
    }
  },
  cacheGame: async (game: GameDetail, rulesComplete = false) => {
    const db = await getDatabase();
    const cachedAt = Date.now();
    const tx = db.transaction(['games', 'rules', 'recentGames'], 'readwrite');
    const rulesStore = tx.objectStore('rules');
    const previousRules = await rulesStore.index('gameId').getAll(game.id);
    await Promise.all(previousRules.map((rule) => rulesStore.delete(rule.id)));
    for (const rule of game.rules) {
      await rulesStore.put({
        ...toStoredRule(rule),
        gameName: (rule as any).gameName || game.displayName,
        gameSlug: (rule as any).gameSlug || game.slug,
        cachedAt,
      });
    }
    const { rules: _rules, ...gameSummary } = game;
    await tx.objectStore('games').put({
      ...gameSummary,
      aliases: game.aliases ?? [],
      cachedAt,
      rulesFetchedAt: cachedAt,
      rulesComplete,
      rulesVersion: game.latestRuleUpdatedAt,
    } as CachedGameRow);
    await tx.objectStore('recentGames').put({ id: game.id, slug: game.slug, displayName: game.displayName, englishName: game.englishName, viewedAt: cachedAt });
    await tx.done;
  },
  getCachedGame: async (identifier: string, includePrivate = false) => {
    const db = await getDatabase();
    return readCachedGameDetail(db, identifier, includePrivate, true);
  },
  getLatestGame: async (identifier: string, includePrivate = false) =>
    readCachedGameDetail(await getDatabase(), identifier, includePrivate, false),
  getCachedRuleImportance: async (userId: string, gameId: string) =>
    getFreshCache<{ ruleIds: string[] }>(ruleImportanceCacheKey(userId, gameId), RULE_IMPORTANCE_CACHE_FRESH_MS),
  getLatestRuleImportance: async (userId: string, gameId: string) => {
    const key = ruleImportanceCacheKey(userId, gameId);
    return await (await getDatabase()).get('cache', key) as CacheRecord<{ ruleIds: string[] }> | undefined;
  },
  cacheRuleImportance: async (userId: string, gameId: string, data: { ruleIds: string[] }) => {
    const key = ruleImportanceCacheKey(userId, gameId);
    await (await getDatabase()).put('cache', { key, data: { ruleIds: [...new Set(data.ruleIds)].sort() }, cachedAt: Date.now() });
  },
  updateCachedRuleImportance: async (userId: string, gameId: string, ruleIds: string[]) => {
    const key = ruleImportanceCacheKey(userId, gameId);
    const db = await getDatabase();
    const existing = await db.get('cache', key);
    if (existing) await db.put('cache', { key, data: { ruleIds: [...new Set(ruleIds)].sort() }, cachedAt: existing.cachedAt });
  },
  clearCachedRuleImportance: async (userId: string) => {
    const db = await getDatabase();
    const prefix = ruleImportanceCachePrefix(userId);
    const keys = await db.getAllKeys('cache');
    await Promise.all(keys
      .filter((key) => typeof key === 'string' && key.startsWith(prefix))
      .map((key) => db.delete('cache', key)));
  },
  updateRuleImportanceCount: async (ruleId: string, count: number) => {
    const db = await getDatabase();
    const rule = await db.get('rules', ruleId);
    if (rule) await db.put('rules', { ...rule, importanceCount: Math.max(0, count) });
  },
  invalidateGame: async (identifier: string) => {
    const db = await getDatabase();
    const game = await findCachedGame(db, identifier);
    if (game) await db.put('games', { ...game, rulesFetchedAt: 0 });
  },
  invalidateAllGames: async () => {
    const db = await getDatabase();
    const tx = db.transaction('games', 'readwrite');
    let cursor = await tx.store.openCursor();
    while (cursor) {
      await cursor.update({ ...cursor.value, rulesFetchedAt: 0 });
      cursor = await cursor.continue();
    }
    await tx.done;
  },
  recentGameIds: async () => {
    const db = await getDatabase();
    const all = await db.getAllFromIndex('recentGames', 'viewedAt');
    return all.reverse().slice(0, 8).map((r) => r.id);
  },
  recentGames: async () => {
    const db = await getDatabase();
    const all = await db.getAllFromIndex('recentGames', 'viewedAt');
    const recentRecords = all.reverse().slice(0, 8);
    const resolved = await Promise.all(recentRecords.map(async (r: any) => {
      const game = await findCachedGame(db, r.id);
      if (r.slug && r.displayName) {
        return { id: r.id, slug: r.slug, displayName: r.displayName, englishName: r.englishName ?? game?.englishName };
      }
      if (game) {
        return { id: r.id, slug: game.slug, displayName: game.displayName, englishName: game.englishName };
      }
      return null;
    }));
    return resolved.filter(Boolean) as Array<{ id: string; slug: string; displayName: string; englishName?: string }>;
  },
  clearCache: async (options: { includeTags?: boolean } = {}) => {
    localDbMemory.searchMemoryCache.clear();
    localDbMemory.gameCatalogMemoryCache = undefined;
    const db = await getDatabase();
    const keys = await db.getAllKeys('cache');
    for (const key of keys) {
      if (options.includeTags || (typeof key === 'string' && !key.startsWith('tag:'))) {
        await db.delete('cache', key);
      }
    }
    await db.clear('games');
    await db.clear('rules');
  },
};
