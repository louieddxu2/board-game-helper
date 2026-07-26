import { openDB, type DBSchema } from 'idb';
import type { GameDetail, HomeIDPayload, HomePayload, SubmissionInput, GameSummary, RuleSearchResult, RuleCard, TagSummary } from '../shared/types';

type SearchResponse = { games: GameSummary[]; rules: RuleSearchResult[] };
type PublicTagsResponse = { tags: TagSummary[] };
export type CatalogGamesCache = { games: GameSummary[] };
const HOUR_CACHE_FRESH_MS = 60 * 60 * 1000;
const DAY_CACHE_FRESH_MS = 24 * 60 * 60 * 1000;
type CacheRecord<T> = { key: string; data: T; cachedAt: number };
const searchMemoryCache = new Map<string, CacheRecord<SearchResponse>>();

const getFreshCache = async <T>(key: string, maxAge: number): Promise<CacheRecord<T> | undefined> => {
  const cached = await (await getDatabase()).get('cache', key) as CacheRecord<T> | undefined;
  return cached && Date.now() - cached.cachedAt < maxAge ? cached : undefined;
};
export interface TagCacheRecord {
  key: string;
  data: TagSummary;
  cachedAt: number;
}

export interface GameMetaRecord {
  id: string;
  slug: string;
  displayName: string;
  englishName?: string;
  aliases: string[];
  ruleIds: string[];
  updatedAt: number;
}

export type RuleEntity = RuleCard;

export interface DraftRecord {
  id: string;
  game?: { id: string; slug: string; displayName: string };
  gameQuery: string;
  rules: Array<{ id: string; statement: string; commonMistake?: string; sourceLabel?: string; sourceUrl?: string; tagNames?: string[] }>;
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
  recentGames: { key: string; value: { id: string; slug?: string; displayName?: string; viewedAt: number }; indexes: { viewedAt: number } };
}

const getDb = () => {
  if (typeof indexedDB === 'undefined') return null;
  return openDB<RulesDb>('wrong-board-game-rules', 1, {
    upgrade(db) {
      db.createObjectStore('drafts', { keyPath: 'id' });
      db.createObjectStore('pending', { keyPath: 'id' });
      db.createObjectStore('cache', { keyPath: 'key' });
      const recent = db.createObjectStore('recentGames', { keyPath: 'id' });
      recent.createIndex('viewedAt', 'viewedAt');
    },
  });
};

let dbPromise: ReturnType<typeof getDb> | null = null;
const getDatabase = async () => {
  if (!dbPromise) dbPromise = getDb();
  const db = await dbPromise;
  if (!db) throw new Error('IndexedDB not available');
  return db;
};

const notifyPending = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('rules-pending-change'));
  }
};

const invalidateCatalogCaches = async (db: Awaited<ReturnType<typeof getDatabase>>) => {
  const keys = await db.getAllKeys('cache');
  await Promise.all(keys
    .filter((key): key is string => typeof key === 'string' && (key === 'catalog:games' || key.startsWith('catalog:game:')))
    .map((key) => db.delete('cache', key)));
};

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
  cacheHome: async (data: HomePayload) => (await getDatabase()).put('cache', { key: 'home', data, cachedAt: Date.now() }),
  getCachedHome: async () => getFreshCache<HomePayload>('home', HOUR_CACHE_FRESH_MS),
  cacheHomeIDs: async (data: HomeIDPayload) => (await getDatabase()).put('cache', { key: 'home_ids', data, cachedAt: Date.now() }),
  getCachedHomeIDs: async () => getFreshCache<HomeIDPayload>('home_ids', HOUR_CACHE_FRESH_MS),
  invalidateHome: async () => {
    const db = await getDatabase();
    await db.delete('cache', 'home');
    await db.delete('cache', 'home_ids');
  },
  cacheCatalogGames: async (data: CatalogGamesCache) => (await getDatabase()).put('cache', { key: 'catalog:games', data, cachedAt: Date.now() }),
  getCachedCatalogGames: async () => getFreshCache<CatalogGamesCache>('catalog:games', HOUR_CACHE_FRESH_MS),
  cacheCatalogGame: async (game: GameDetail) => (await getDatabase()).put('cache', { key: `catalog:game:${game.id}`, data: game, cachedAt: Date.now() }),
  getCachedCatalogGame: async (id: string) => getFreshCache<GameDetail>(`catalog:game:${id}`, HOUR_CACHE_FRESH_MS),
  invalidateCatalogGame: async (id: string) => (await getDatabase()).delete('cache', `catalog:game:${id}`),
  invalidateCatalogGames: async () => invalidateCatalogCaches(await getDatabase()),
  cacheGameMeta: async (meta: GameMetaRecord) => (await getDatabase()).put('cache', { key: `gameMeta:${meta.slug}`, data: meta, cachedAt: Date.now() }),
  getCachedGameMeta: async (slug: string) => getFreshCache<GameMetaRecord>(`gameMeta:${slug}`, HOUR_CACHE_FRESH_MS),
  invalidateGameMeta: async (slug: string) => (await getDatabase()).delete('cache', `gameMeta:${slug}`),
  cachePublicTags: async (data: PublicTagsResponse) => (await getDatabase()).put('cache', { key: 'publicTags', data, cachedAt: Date.now() }),
  getCachedPublicTags: async () => getFreshCache<PublicTagsResponse>('publicTags', DAY_CACHE_FRESH_MS),
  invalidatePublicTags: async () => (await getDatabase()).delete('cache', 'publicTags'),
  cacheTagEntities: async (tags: TagSummary[]) => {
    const db = await getDatabase();
    const cachedAt = Date.now();
    await Promise.all(tags.map((tag) => db.put('cache', { key: `tag:${tag.id}`, data: tag, cachedAt })));
  },
  getCachedTagEntities: async (ids: string[]) => {
    const records = await Promise.all(ids.map((id) => getFreshCache<TagSummary>(`tag:${id}`, DAY_CACHE_FRESH_MS)));
    return records.filter((record): record is TagCacheRecord => Boolean(record));
  },
  invalidateTagEntity: async (id: string) => (await getDatabase()).delete('cache', `tag:${id}`),
  cacheRuleEntity: async (rule: RuleEntity) => (await getDatabase()).put('cache', { key: `rule:${rule.id}`, data: rule, cachedAt: Date.now() }),
  getCachedRuleEntity: async (ruleId: string) => getFreshCache<RuleEntity>(`rule:${ruleId}`, HOUR_CACHE_FRESH_MS),
  invalidateRuleEntity: async (ruleId: string) => {
    const db = await getDatabase();
    await db.delete('cache', `rule:${ruleId}`);
    await invalidateCatalogCaches(db);
  },
  cacheGame: async (game: GameDetail) => {
    const db = await getDatabase();
    const meta: GameMetaRecord = {
      id: game.id,
      slug: game.slug,
      displayName: game.displayName,
      englishName: game.englishName,
      aliases: game.aliases,
      ruleIds: game.rules.map(r => r.id),
      updatedAt: Date.now()
    };
    await db.put('cache', { key: `gameMeta:${game.slug}`, data: meta, cachedAt: Date.now() });
    for (const rule of game.rules) {
      await db.put('cache', { key: `rule:${rule.id}`, data: { ...rule, gameName: game.displayName, gameSlug: game.slug } as RuleEntity, cachedAt: Date.now() });
    }
    await db.put('cache', { key: `game:${game.slug}`, data: game, cachedAt: Date.now() });
    await db.put('recentGames', { id: game.id, slug: game.slug, displayName: game.displayName, viewedAt: Date.now() });
  },
  getCachedGame: async (slug: string) => getFreshCache<GameDetail>(`game:${slug}`, HOUR_CACHE_FRESH_MS),
  invalidateGame: async (slug: string) => {
    const db = await getDatabase();
    await db.delete('cache', `game:${slug}`);
    await db.delete('cache', `gameMeta:${slug}`);
    await invalidateCatalogCaches(db);
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
    const allCache = await db.getAll('cache');
    const resolved = recentRecords.map((r: any) => {
      if (r.slug && r.displayName) {
        return { id: r.id, slug: r.slug, displayName: r.displayName };
      }
      const matched = allCache.find((item: any) => item.data && (item.data.id === r.id || item.data.slug === r.id));
      if (matched?.data) {
        const game = matched.data as GameDetail;
        return { id: r.id, slug: game.slug, displayName: game.displayName };
      }
      return null;
    });
    return resolved.filter(Boolean) as Array<{ id: string; slug: string; displayName: string }>;
  },
  clearCache: async (options: { includeTags?: boolean } = {}) => {
    searchMemoryCache.clear();
    const db = await getDatabase();
    const keys = await db.getAllKeys('cache');
    for (const key of keys) {
      if (options.includeTags || (typeof key === 'string' && !key.startsWith('tag:'))) {
        await db.delete('cache', key);
      }
    }
  },
};
