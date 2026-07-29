import { openDB, type DBSchema } from 'idb';
import type { GameCatalogChangesPayload, GameCatalogPayload, GameDetail, HomeIDPayload, HomePayload, PublicTagCatalogChangesPayload, PublicTagCatalogPayload, SubmissionInput, GameSummary, RuleSearchResult, RuleCard, RuleCategory, TagSummary } from '../shared/types';
import { applyGameCatalogChanges, mergeGameCatalogEntries, upsertGameCatalogEntry } from './gameCatalog';
import { applyPublicTagCatalogChanges } from './tagCatalog';

type SearchResponse = { games: GameSummary[]; rules: RuleSearchResult[] };
const HOUR_CACHE_FRESH_MS = 60 * 60 * 1000;
const CATALOG_SYNC_FRESH_MS = 10 * 60 * 1000;
const TAG_ENTITY_CACHE_FRESH_MS = 24 * 60 * 60 * 1000;
export const PUBLIC_TAG_CATALOG_FRESH_MS = 7 * 24 * 60 * 60 * 1000;
const PUBLIC_TAGS_CACHE_KEY = 'publicTags:versioned:v4';
const PUBLIC_GAME_CATALOG_KEY = 'games:list:versioned:v2';
const LOCAL_GAME_CATALOG_OVERRIDES_KEY = 'games:list:local-overrides:v1';
const HOME_VIEW_CACHE_KEY = 'home:view:v1';
type CacheRecord<T> = { key: string; data: T; cachedAt: number };
export type GameCatalogCacheRecord = CacheRecord<GameCatalogPayload> & { snapshotFetchedAt?: number };
const searchMemoryCache = new Map<string, CacheRecord<SearchResponse>>();
let gameCatalogMemoryCache: GameCatalogCacheRecord | undefined;

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

export interface CachedGameRow extends GameSummary {
  aliases: string[];
  cachedAt: number;
  rulesFetchedAt?: number;
  rulesComplete?: boolean;
  rulesVersion?: number;
}

export interface CachedRuleRow extends RuleCard {
  cachedAt: number;
}

export interface DraftRecord {
  id: string;
  game?: { id: string; slug: string; displayName: string; englishName?: string };
  gameQuery: string;
  englishName?: string;
  rules: Array<{ id: string; statement: string; commonMistake?: string; categories?: RuleCategory[]; playerCounts?: number[]; editionNotes?: string[]; editionNote?: string; sourceLabel?: string; sourceUrl?: string; tagNames?: string[] }>;
  sourceLabel?: string;
  sourceUrl?: string;
  playedOn: string;
  privateNote: string;
  updatedAt: number;
}

interface RulesDb extends DBSchema {
  drafts: { key: string; value: DraftRecord };
  pending: { key: string; value: { id: string; payload: SubmissionInput; createdAt: number } };
  cache: { key: string; value: { key: string; data: unknown; cachedAt: number } };
  recentGames: { key: string; value: { id: string; slug?: string; displayName?: string; englishName?: string; viewedAt: number }; indexes: { viewedAt: number } };
  games: { key: string; value: CachedGameRow; indexes: { slug: string } };
  rules: { key: string; value: CachedRuleRow; indexes: { gameId: string } };
}

const getDb = () => {
  if (typeof indexedDB === 'undefined') return null;
  return openDB<RulesDb>('wrong-board-game-rules', 3, {
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
  addPending: async (payload: SubmissionInput) => { const result = await (await getDatabase()).put('pending', { id: payload.idempotencyKey, payload, createdAt: Date.now() }); notifyPending(); return result; },
  removePending: async (id: string) => { await (await getDatabase()).delete('pending', id); notifyPending(); },
  getPending: async () => (await getDatabase()).getAll('pending'),
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
    const existing = await db.get('games', game.id);
    await db.put('games', {
      ...existing,
      ...game,
      aliases: game.aliases ?? existing?.aliases ?? [],
      cachedAt: Date.now(),
    });
    const overrides = await db.get('cache', LOCAL_GAME_CATALOG_OVERRIDES_KEY) as CacheRecord<GameSummary[]> | undefined;
    await db.put('cache', {
      key: LOCAL_GAME_CATALOG_OVERRIDES_KEY,
      data: upsertGameCatalogEntry(overrides?.data ?? [], game),
      cachedAt: Date.now(),
    });
    const catalog = await db.get('cache', PUBLIC_GAME_CATALOG_KEY) as GameCatalogCacheRecord | undefined;
    if (catalog) {
      const updated = { ...catalog, data: { ...catalog.data, games: upsertGameCatalogEntry(catalog.data.games, game) } };
      gameCatalogMemoryCache = updated;
      await db.put('cache', updated);
    }
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
  cacheRuleEntity: async (rule: RuleEntity) => (await getDatabase()).put('rules', { ...rule, cachedAt: Date.now() }),
  getCachedRuleEntity: async (ruleId: string) => {
    const rule = await (await getDatabase()).get('rules', ruleId);
    return rule && Date.now() - rule.cachedAt < HOUR_CACHE_FRESH_MS
      ? { key: `rule:${ruleId}`, data: rule, cachedAt: rule.cachedAt }
      : undefined;
  },
  getLatestRuleEntity: async (ruleId: string) => {
    const rule = await (await getDatabase()).get('rules', ruleId);
    return rule ? { key: `rule:${ruleId}`, data: rule, cachedAt: rule.cachedAt } : undefined;
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
      await rulesStore.put({ ...rule, cachedAt });
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
  invalidateGame: async (identifier: string) => {
    const db = await getDatabase();
    const game = await findCachedGame(db, identifier);
    if (game) await db.put('games', { ...game, rulesFetchedAt: 0 });
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
