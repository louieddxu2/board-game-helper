import { openDB, type DBSchema } from 'idb';
import type { AttributeCatalogChangesPayload, AttributeCatalogPayload, AttributeComparisonResult, AttributeQuestionPayload, GameCatalogChangesPayload, GameCatalogPayload, GameDetail, GameExternalResource, HomeIDPayload, HomePayload, PublicTagCatalogChangesPayload, PublicTagCatalogPayload, SubmissionInput, GameSummary, RuleSearchResult, RuleCard, FlowStage, RuleCategory, TagSelection, TagSummary } from '../shared/types';
import { applyGameCatalogChanges, mergeGameCatalogEntries, upsertGameCatalogEntry } from './gameCatalog';
import { applyAttributeCatalogChanges } from './attributeCatalog';
import { applyPublicTagCatalogChanges } from './tagCatalog';

type SearchResponse = { games: GameSummary[]; rules: RuleSearchResult[] };
const HOUR_CACHE_FRESH_MS = 60 * 60 * 1000;
const CATALOG_SYNC_FRESH_MS = 10 * 60 * 1000;
export const RULE_IMPORTANCE_CACHE_FRESH_MS = 10 * 60 * 1000;
const TAG_ENTITY_CACHE_FRESH_MS = 24 * 60 * 60 * 1000;
export const PUBLIC_TAG_CATALOG_FRESH_MS = 7 * 24 * 60 * 60 * 1000;
const PUBLIC_TAGS_CACHE_KEY = 'publicTags:versioned:v5';
const PUBLIC_GAME_CATALOG_KEY = 'games:list:versioned:v2';
const PUBLIC_ATTRIBUTE_TABLE_KEY = 'attributes:table:versioned:v1';
const LOCAL_GAME_CATALOG_OVERRIDES_KEY = 'games:list:local-overrides:v1';
const HOME_VIEW_CACHE_KEY = 'home:view:v1';
const ruleImportanceCacheKey = (userId: string, gameId: string) => `ruleImportance:${userId}:${gameId}`;
const ruleImportanceCachePrefix = (userId: string) => `ruleImportance:${userId}:`;
type CacheRecord<T> = { key: string; data: T; cachedAt: number };
export type GameCatalogCacheRecord = CacheRecord<GameCatalogPayload> & { snapshotFetchedAt?: number };
export type AttributeCatalogCacheRecord = CacheRecord<AttributeCatalogPayload> & { snapshotFetchedAt?: number };
export type CachedRuleUpdate = RuleCard & { gameName?: string; gameSlug?: string };
const searchMemoryCache = new Map<string, CacheRecord<SearchResponse>>();
let gameCatalogMemoryCache: GameCatalogCacheRecord | undefined;
let attributeTableMemoryCache: AttributeCatalogCacheRecord | undefined;

export const applyGameReferenceUpdate = (
  home: HomePayload,
  sourceGame: GameSummary | undefined,
  targetGame: GameSummary,
  ruleUpdates: Map<string, CachedRuleUpdate>,
): HomePayload => {
  const updateRule = <T extends CachedRuleUpdate>(rule: T): T => {
    const updated = ruleUpdates.get(rule.id);
    const next = updated ? { ...rule, ...updated } : { ...rule };
    const movedFromSource = sourceGame && next.gameId === sourceGame.id;
    const belongsToTarget = next.gameId === targetGame.id;
    if (movedFromSource || belongsToTarget) {
      return { ...next, gameId: targetGame.id, gameName: targetGame.displayName, gameSlug: targetGame.slug } as T;
    }
    return next as T;
  };
  const sourceSlug = sourceGame?.slug;
  const targetSlug = targetGame.slug;
  const updatedFeatured = (home.featured ?? []).map((item) => (
    (sourceSlug && item.gameSlug === sourceSlug) || item.gameSlug === targetSlug
      ? { ...item, gameSlug: targetGame.slug, gameName: targetGame.displayName }
      : item
  ));
  const popularGames = home.popularGames ?? [];
  const hadSourceGame = Boolean(sourceGame && popularGames.some((game) => game.id === sourceGame.id));
  const updatedPopularGames = popularGames
    .filter((game) => !sourceGame || game.id !== sourceGame.id)
    .reduce<GameSummary[]>((games, game) => game.id === targetGame.id ? [...games.filter((item) => item.id !== targetGame.id), targetGame] : [...games, game], []);
  if (hadSourceGame && !updatedPopularGames.some((game) => game.id === targetGame.id)) updatedPopularGames.push(targetGame);
  return {
    ...home,
    featured: updatedFeatured,
    featuredRules: (home.featuredRules ?? []).map(updateRule),
    recentRules: (home.recentRules ?? []).map(updateRule),
    popularGames: updatedPopularGames,
  };
};

const replaceGameInHomeIds = (data: HomeIDPayload, sourceGame: GameSummary | undefined, targetGame: GameSummary): HomeIDPayload => {
  const replace = (ids: string[]) => Array.from(new Set(ids.map((id) => sourceGame && id === sourceGame.id ? targetGame.id : id)));
  return { ...data, popularGameIds: replace(data.popularGameIds), recentRuleIds: [...data.recentRuleIds], featuredRuleIds: [...data.featuredRuleIds] };
};

export const applyGameCatalogChangesToCache = (
  cached: GameCatalogCacheRecord,
  data: GameCatalogChangesPayload,
  currentTime = Date.now(),
): GameCatalogCacheRecord => ({
  key: PUBLIC_GAME_CATALOG_KEY,
  data: {
    ...cached.data,
    throughVersion: Math.max(cached.data.throughVersion, data.throughVersion),
    games: applyGameCatalogChanges(cached.data.games, data.changes),
  },
  cachedAt: data.hasMore ? cached.cachedAt : currentTime,
  snapshotFetchedAt: cached.snapshotFetchedAt ?? cached.data.generatedAt,
});

const getFreshCache = async <T>(key: string, maxAge: number): Promise<CacheRecord<T> | undefined> => {
  const cached = await (await getDatabase()).get('cache', key) as CacheRecord<T> | undefined;
  return cached && Date.now() - cached.cachedAt < maxAge ? cached : undefined;
};
export interface TagCacheRecord {
  key: string;
  data: TagSummary;
  cachedAt: number;
}

export type RuleEntity = RuleCard;

export const toStoredRule = <T extends RuleCard>(rule: T): T => ({ ...rule, tags: [] });

export interface CachedGameRow extends GameSummary {
  aliases: string[];
  externalResources?: GameExternalResource[];
  cachedAt: number;
  rulesFetchedAt?: number;
  rulesComplete?: boolean;
  rulesVersion?: number;
}

export interface CachedRuleRow extends RuleCard {
  gameName?: string;
  gameSlug?: string;
  cachedAt: number;
}

export interface DraftRecord {
  id: string;
  game?: { id: string; slug: string; displayName: string; englishName?: string };
  gameQuery: string;
  englishName?: string;
  rules: Array<{ id: string; statement: string; commonMistake?: string; details?: string; flowStage?: FlowStage; categories?: RuleCategory[]; playerCounts?: number[]; editionNotes?: string[]; editionNote?: string; sourceLabel?: string; sourceUrl?: string; tagSelections?: TagSelection[]; tagNames?: string[] }>;
  sourceLabel?: string;
  sourceUrl?: string;
  updatedAt: number;
}

interface RulesDb extends DBSchema {
  drafts: { key: string; value: DraftRecord };
  pending: { key: string; value: { id: string; userId: string; payload: SubmissionInput; createdAt: number } };
  cache: { key: string; value: { key: string; data: unknown; cachedAt: number } };
  recentGames: { key: string; value: { id: string; slug?: string; displayName?: string; englishName?: string; viewedAt: number }; indexes: { viewedAt: number } };
  games: { key: string; value: CachedGameRow; indexes: { slug: string } };
  rules: { key: string; value: CachedRuleRow; indexes: { gameId: string } };
  attributeResponses: { key: string; value: PendingAttributeResponse };
  attributeCollectionIds: { key: number; value: { bggId: number; importedAt: number } };
}

export interface PendingAttributeResponse {
  id: string;
  subjectAId: string;
  subjectBId: string;
  attributeId: string;
  questionToken: string;
  responseId: string;
  comparison?: AttributeComparisonResult | null;
  ratingA?: number | null;
  ratingB?: number | null;
  sessionId: string;
  createdAt: number;
}

const getDb = () => {
  if (typeof indexedDB === 'undefined') return null;
  return openDB<RulesDb>('wrong-board-game-rules', 5, {
    upgrade(db, oldVersion, _newVersion, transaction) {
      if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('pending')) db.createObjectStore('pending', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('recentGames')) {
        const recent = db.createObjectStore('recentGames', { keyPath: 'id' });
        recent.createIndex('viewedAt', 'viewedAt');
      }
      if (!db.objectStoreNames.contains('games')) {
        const games = db.createObjectStore('games', { keyPath: 'id' });
        games.createIndex('slug', 'slug', { unique: true });
      }
      if (!db.objectStoreNames.contains('rules')) {
        const rules = db.createObjectStore('rules', { keyPath: 'id' });
        rules.createIndex('gameId', 'gameId');
      }
      if (!db.objectStoreNames.contains('attributeResponses')) db.createObjectStore('attributeResponses', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('attributeCollectionIds')) db.createObjectStore('attributeCollectionIds', { keyPath: 'bggId' });
      if (oldVersion > 0 && oldVersion < 3) {
        transaction.objectStore('games').clear();
        transaction.objectStore('rules').clear();
      }
    },
  });
};

let dbPromise: ReturnType<typeof getDb> | null = null;
let legacyGameCacheCleanup: Promise<void> | null = null;
const getDatabase = async () => {
  if (!dbPromise) dbPromise = getDb();
  const db = await dbPromise;
  if (!db) throw new Error('IndexedDB not available');
  if (!legacyGameCacheCleanup) {
    legacyGameCacheCleanup = (async () => {
      const keys = await db.getAllKeys('cache');
      await Promise.all(keys
        .filter((key): key is string => typeof key === 'string' && (
          key === 'catalog:games'
          || key.startsWith('catalog:game:')
          || key.startsWith('game:')
          || key.startsWith('gameMeta:')
          || key.startsWith('rule:')
        ))
        .map((key) => db.delete('cache', key)));
    })();
  }
  await legacyGameCacheCleanup;
  return db;
};

const notifyPending = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('rules-pending-change'));
  }
};

const findCachedGame = async (db: Awaited<ReturnType<typeof getDatabase>>, identifier: string) =>
  (await db.get('games', identifier)) ?? (await db.getFromIndex('games', 'slug', identifier));

const readCachedGameDetail = async (
  db: Awaited<ReturnType<typeof getDatabase>>,
  identifier: string,
  includePrivate: boolean,
  requireFresh: boolean,
) => {
  const game = await findCachedGame(db, identifier);
  if (!game || (requireFresh && !isCachedRuleSetUsable(game, includePrivate)) || (includePrivate && !game.rulesComplete)) return undefined;
  const storedRules = await db.getAllFromIndex('rules', 'gameId', game.id);
  const rules = sortRules(storedRules.filter((rule) => includePrivate || rule.status === 'published'), includePrivate);
  const { cachedAt: _cachedAt, rulesFetchedAt = 0, rulesComplete: _rulesComplete, rulesVersion: _rulesVersion, ...summary } = game;
  const ruleCount = includePrivate ? game.totalRuleCount ?? rules.length : game.publishedRuleCount ?? rules.length;
  const detail: GameDetail = { ...summary, rules, ruleCount };
  return { key: `game:${game.id}`, data: detail, cachedAt: rulesFetchedAt };
};

const publicRuleOrder: Record<string, number> = {
  setup: 1, round: 2, action: 3, always: 4, end_scoring: 5, edition_player_count: 6, uncategorized: 7,
};

const sortRules = (rules: RuleCard[], includePrivate: boolean) => [...rules].sort((left, right) => includePrivate
  ? (right.updatedAt ?? 0) - (left.updatedAt ?? 0) || right.id.localeCompare(left.id)
  : (publicRuleOrder[left.flowStage ?? 'uncategorized'] ?? 7) - (publicRuleOrder[right.flowStage ?? 'uncategorized'] ?? 7)
    || (right.createdAt ?? 0) - (left.createdAt ?? 0));

export const isCachedRuleSetUsable = (
  game: CachedGameRow,
  includePrivate: boolean,
  currentTime = Date.now(),
) => Boolean(
  game.rulesFetchedAt
  && currentTime - game.rulesFetchedAt < HOUR_CACHE_FRESH_MS
  && (!includePrivate || game.rulesComplete)
  && game.rulesVersion === game.latestRuleUpdatedAt
);

export const localDb = {
  getDraft: async () => (await getDatabase()).get('drafts', 'active'),
  saveDraft: async (draft: Omit<DraftRecord, 'id'>) => (await getDatabase()).put('drafts', { ...draft, id: 'active' }),
  clearDraft: async () => (await getDatabase()).delete('drafts', 'active'),
  addPending: async (userId: string, payload: SubmissionInput) => { const result = await (await getDatabase()).put('pending', { id: payload.idempotencyKey, userId, payload, createdAt: Date.now() }); notifyPending(); return result; },
  removePending: async (id: string) => { await (await getDatabase()).delete('pending', id); notifyPending(); },
  getPending: async (userId: string) => (await (await getDatabase()).getAll('pending')).filter((item) => item.userId === userId),
  cacheAttributeQuestion: async (data: AttributeQuestionPayload) => (await getDatabase()).put('cache', { key: 'attributes:question:v1', data, cachedAt: Date.now() }),
  getLatestAttributeQuestion: async () => (await getDatabase()).get('cache', 'attributes:question:v1') as Promise<CacheRecord<AttributeQuestionPayload> | undefined>,
  replaceAttributeCollectionIds: async (bggIds: number[]) => {
    const db = await getDatabase();
    const transaction = db.transaction('attributeCollectionIds', 'readwrite');
    await transaction.store.clear();
    const importedAt = Date.now();
    for (const bggId of [...new Set(bggIds)]) await transaction.store.put({ bggId, importedAt });
    await transaction.done;
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('attribute-collection-change'));
  },
  getAttributeCollectionIds: async () => (await getDatabase()).getAll('attributeCollectionIds').then((rows) => rows.map((row) => row.bggId)),
  clearAttributeCollectionIds: async () => {
    const db = await getDatabase();
    await db.clear('attributeCollectionIds');
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('attribute-collection-change'));
  },
  addPendingAttributeResponse: async (payload: Omit<PendingAttributeResponse, 'id' | 'createdAt'> & { id?: string; createdAt?: number }) => {
    const item: PendingAttributeResponse = { ...payload, id: payload.id ?? payload.responseId, createdAt: payload.createdAt ?? Date.now() };
    return (await getDatabase()).put('attributeResponses', item);
  },
  getPendingAttributeResponses: async () => (await getDatabase()).getAll('attributeResponses'),
  removePendingAttributeResponse: async (id: string) => (await getDatabase()).delete('attributeResponses', id),
  cacheSearch: async (key: string, data: SearchResponse) => {
    const record = { key: `search:${key}`, data, cachedAt: Date.now() } satisfies CacheRecord<SearchResponse>;
    if (searchMemoryCache.size >= 100 && !searchMemoryCache.has(key)) {
      searchMemoryCache.delete(searchMemoryCache.keys().next().value as string);
    }
    searchMemoryCache.set(key, record);
    await (await getDatabase()).put('cache', record);
  },
  getCachedSearch: async (key: string) => {
    const memory = searchMemoryCache.get(key);
    if (memory) {
      if (Date.now() - memory.cachedAt < HOUR_CACHE_FRESH_MS) return memory;
      searchMemoryCache.delete(key);
    }
    const cached = await getFreshCache<SearchResponse>(`search:${key}`, HOUR_CACHE_FRESH_MS);
    if (cached) searchMemoryCache.set(key, cached);
    return cached;
  },
  getCachedSearchPrefix: async (prefix: string, targetKey: string) => {
    for (const [key, cached] of searchMemoryCache) {
      if (Date.now() - cached.cachedAt >= HOUR_CACHE_FRESH_MS) {
        searchMemoryCache.delete(key);
        continue;
      }
      if (key.startsWith(prefix) && targetKey.startsWith(key) && cached.data.games.length < 20) return cached;
    }
    return undefined;
  },
  invalidateSearch: async () => {
    searchMemoryCache.clear();
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
    gameCatalogMemoryCache = record;
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
    if (gameCatalogMemoryCache && Date.now() - gameCatalogMemoryCache.cachedAt < CATALOG_SYNC_FRESH_MS) return gameCatalogMemoryCache;
    const cached = await (await getDatabase()).get('cache', PUBLIC_GAME_CATALOG_KEY) as GameCatalogCacheRecord | undefined;
    if (!cached || Date.now() - cached.cachedAt >= CATALOG_SYNC_FRESH_MS) return undefined;
    gameCatalogMemoryCache = cached;
    return cached;
  },
  getLatestGameCatalog: async () => {
    if (gameCatalogMemoryCache) return gameCatalogMemoryCache;
    const cached = await (await getDatabase()).get('cache', PUBLIC_GAME_CATALOG_KEY) as GameCatalogCacheRecord | undefined;
    if (cached) gameCatalogMemoryCache = cached;
    return cached;
  },
  cacheGameCatalogChanges: async (data: GameCatalogChangesPayload) => {
    const db = await getDatabase();
    const cached = await db.get('cache', PUBLIC_GAME_CATALOG_KEY) as GameCatalogCacheRecord | undefined;
    if (!cached) throw new Error('game_catalog_cache_missing');
    const updated = applyGameCatalogChangesToCache(cached, data);
    gameCatalogMemoryCache = updated;
    await db.put('cache', updated);
    const overrides = await db.get('cache', LOCAL_GAME_CATALOG_OVERRIDES_KEY) as CacheRecord<GameSummary[]> | undefined;
    if (overrides && data.changes.length) {
      const changedIds = new Set(data.changes.map((change) => change.gameId));
      const remaining = overrides.data.filter((game) => !changedIds.has(game.id));
      if (remaining.length) await db.put('cache', { ...overrides, data: remaining });
      else await db.delete('cache', LOCAL_GAME_CATALOG_OVERRIDES_KEY);
    }
  },
  cacheAttributeCatalog: async (data: AttributeCatalogPayload) => {
    const db = await getDatabase();
    const cachedAt = Date.now();
    const record = {
      key: PUBLIC_ATTRIBUTE_TABLE_KEY,
      data,
      cachedAt,
      snapshotFetchedAt: cachedAt,
    } satisfies AttributeCatalogCacheRecord;
    attributeTableMemoryCache = record;
    await db.put('cache', record);
  },
  getSynchronizedAttributeCatalog: async () => {
    if (attributeTableMemoryCache && Date.now() - attributeTableMemoryCache.cachedAt < CATALOG_SYNC_FRESH_MS) return attributeTableMemoryCache;
    const cached = await (await getDatabase()).get('cache', PUBLIC_ATTRIBUTE_TABLE_KEY) as AttributeCatalogCacheRecord | undefined;
    if (!cached || Date.now() - cached.cachedAt >= CATALOG_SYNC_FRESH_MS) return undefined;
    attributeTableMemoryCache = cached;
    return cached;
  },
  getLatestAttributeCatalog: async () => {
    if (attributeTableMemoryCache) return attributeTableMemoryCache;
    const cached = await (await getDatabase()).get('cache', PUBLIC_ATTRIBUTE_TABLE_KEY) as AttributeCatalogCacheRecord | undefined;
    if (cached) attributeTableMemoryCache = cached;
    return cached;
  },
  cacheAttributeCatalogChanges: async (data: AttributeCatalogChangesPayload) => {
    const db = await getDatabase();
    const cached = attributeTableMemoryCache ?? await db.get('cache', PUBLIC_ATTRIBUTE_TABLE_KEY) as AttributeCatalogCacheRecord | undefined;
    if (!cached) throw new Error('attribute_catalog_cache_missing');
    const updated = {
      ...cached,
      data: applyAttributeCatalogChanges(cached.data, data.changes, data.throughVersion),
      cachedAt: data.hasMore ? cached.cachedAt : Date.now(),
      snapshotFetchedAt: cached.snapshotFetchedAt ?? cached.data.generatedAt,
    } satisfies AttributeCatalogCacheRecord;
    attributeTableMemoryCache = updated;
    await db.put('cache', updated);
  },
  invalidateAttributeCatalogSync: async () => {
    const db = await getDatabase();
    const cached = attributeTableMemoryCache ?? await db.get('cache', PUBLIC_ATTRIBUTE_TABLE_KEY) as AttributeCatalogCacheRecord | undefined;
    if (!cached) return;
    const invalidated = { ...cached, cachedAt: 0 };
    attributeTableMemoryCache = invalidated;
    await db.put('cache', invalidated);
  },
  invalidateGameCatalogSync: async () => {
    const db = await getDatabase();
    const cached = await db.get('cache', PUBLIC_GAME_CATALOG_KEY) as GameCatalogCacheRecord | undefined;
    if (!cached) return;
    const invalidated = { ...cached, cachedAt: 0 };
    gameCatalogMemoryCache = invalidated;
    await db.put('cache', invalidated);
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
      gameCatalogMemoryCache = updated;
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
      gameCatalogMemoryCache = updated;
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
    searchMemoryCache.clear();
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
    searchMemoryCache.clear();
    gameCatalogMemoryCache = undefined;
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
