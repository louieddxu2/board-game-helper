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

export interface CachedGameRow extends GameSummary {
  aliases: string[];
  cachedAt: number;
  rulesFetchedAt?: number;
  rulesComplete?: boolean;
}

export interface CachedRuleRow extends RuleCard {
  cachedAt: number;
}

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
  games: { key: string; value: CachedGameRow; indexes: { slug: string } };
  rules: { key: string; value: CachedRuleRow; indexes: { gameId: string } };
}

const getDb = () => {
  if (typeof indexedDB === 'undefined') return null;
  return openDB<RulesDb>('wrong-board-game-rules', 2, {
    upgrade(db) {
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

const catalogGamesMetaKey = 'games:list:editor';

const findCachedGame = async (db: Awaited<ReturnType<typeof getDatabase>>, identifier: string) =>
  (await db.get('games', identifier)) ?? (await db.getFromIndex('games', 'slug', identifier));

const publicRuleOrder: Record<string, number> = {
  setup: 1, round: 2, action: 3, always: 4, end_scoring: 5, edition_player_count: 6, uncategorized: 7,
};

const sortRules = (rules: RuleCard[], includePrivate: boolean) => [...rules].sort((left, right) => includePrivate
  ? (right.updatedAt ?? 0) - (left.updatedAt ?? 0) || right.id.localeCompare(left.id)
  : (publicRuleOrder[left.flowStage ?? 'uncategorized'] ?? 7) - (publicRuleOrder[right.flowStage ?? 'uncategorized'] ?? 7)
    || (right.createdAt ?? 0) - (left.createdAt ?? 0));

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
  cacheCatalogGames: async (data: CatalogGamesCache) => {
    const db = await getDatabase();
    const cachedAt = Date.now();
    const tx = db.transaction(['games', 'rules', 'cache'], 'readwrite');
    const gamesStore = tx.objectStore('games');
    const rulesStore = tx.objectStore('rules');
    const incomingIds = new Set(data.games.map((game) => game.id));
    const existingGames = await gamesStore.getAll();
    for (const game of existingGames.filter((cached) => !incomingIds.has(cached.id))) {
      const orphanedRules = await rulesStore.index('gameId').getAll(game.id);
      await Promise.all(orphanedRules.map((rule) => rulesStore.delete(rule.id)));
      await gamesStore.delete(game.id);
    }
    for (const game of data.games) {
      const existing = existingGames.find((cached) => cached.id === game.id);
      await gamesStore.put({
        ...existing,
        ...game,
        aliases: game.aliases ?? existing?.aliases ?? [],
        cachedAt,
      });
    }
    await tx.objectStore('cache').put({ key: catalogGamesMetaKey, data: true, cachedAt });
    await tx.done;
  },
  getCachedCatalogGames: async () => {
    const meta = await getFreshCache<boolean>(catalogGamesMetaKey, HOUR_CACHE_FRESH_MS);
    if (!meta) return undefined;
    const games = (await (await getDatabase()).getAll('games'))
      .sort((left, right) => left.displayName.localeCompare(right.displayName, 'zh-Hant'))
      .map(({ cachedAt: _cachedAt, rulesFetchedAt: _rulesFetchedAt, rulesComplete: _rulesComplete, ...game }) => ({
        ...game,
        ruleCount: game.totalRuleCount ?? game.ruleCount,
      }));
    return { key: catalogGamesMetaKey, data: { games }, cachedAt: meta.cachedAt };
  },
  invalidateCatalogGames: async () => (await getDatabase()).delete('cache', catalogGamesMetaKey),
  upsertGameSummary: async (game: GameSummary) => {
    const db = await getDatabase();
    const existing = await db.get('games', game.id);
    await db.put('games', {
      ...existing,
      ...game,
      aliases: game.aliases ?? existing?.aliases ?? [],
      cachedAt: Date.now(),
    });
  },
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
  cacheRuleEntity: async (rule: RuleEntity) => (await getDatabase()).put('rules', { ...rule, cachedAt: Date.now() }),
  getCachedRuleEntity: async (ruleId: string) => {
    const rule = await (await getDatabase()).get('rules', ruleId);
    return rule && Date.now() - rule.cachedAt < HOUR_CACHE_FRESH_MS
      ? { key: `rule:${ruleId}`, data: rule, cachedAt: rule.cachedAt }
      : undefined;
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
    } as CachedGameRow);
    await tx.objectStore('recentGames').put({ id: game.id, slug: game.slug, displayName: game.displayName, viewedAt: cachedAt });
    await tx.done;
  },
  getCachedGame: async (identifier: string, includePrivate = false) => {
    const db = await getDatabase();
    const game = await findCachedGame(db, identifier);
    if (!game?.rulesFetchedAt || Date.now() - game.rulesFetchedAt >= HOUR_CACHE_FRESH_MS) return undefined;
    if (includePrivate && !game.rulesComplete) return undefined;
    const storedRules = await db.getAllFromIndex('rules', 'gameId', game.id);
    const rules = sortRules(
      storedRules.filter((rule) => includePrivate || rule.status === 'published'),
      includePrivate,
    );
    const { cachedAt: _cachedAt, rulesFetchedAt, rulesComplete: _rulesComplete, ...summary } = game;
    const detail: GameDetail = { ...summary, rules, ruleCount: rules.length };
    return { key: `game:${game.id}`, data: detail, cachedAt: rulesFetchedAt };
  },
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
      if (r.slug && r.displayName) {
        return { id: r.id, slug: r.slug, displayName: r.displayName };
      }
      const game = await findCachedGame(db, r.id);
      if (game) {
        return { id: r.id, slug: game.slug, displayName: game.displayName };
      }
      return null;
    }));
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
    await db.clear('games');
    await db.clear('rules');
  },
};
