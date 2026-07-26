import { openDB, type DBSchema } from 'idb';
import type { GameDetail, HomeIDPayload, HomePayload, SubmissionInput, GameSummary, RuleSearchResult, RuleCard, TagSummary } from '../shared/types';

type SearchResponse = { games: GameSummary[]; rules: RuleSearchResult[] };
type PublicTagsResponse = { tags: TagSummary[] };
export type CatalogGamesCache = { games: GameSummary[] };
const RULE_CACHE_FRESH_MS = 60 * 60 * 1000;
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

export const localDb = {
  getDraft: async () => (await getDatabase()).get('drafts', 'active'),
  saveDraft: async (draft: Omit<DraftRecord, 'id'>) => (await getDatabase()).put('drafts', { ...draft, id: 'active' }),
  clearDraft: async () => (await getDatabase()).delete('drafts', 'active'),
  addPending: async (payload: SubmissionInput) => { const result = await (await getDatabase()).put('pending', { id: payload.idempotencyKey, payload, createdAt: Date.now() }); notifyPending(); return result; },
  removePending: async (id: string) => { await (await getDatabase()).delete('pending', id); notifyPending(); },
  getPending: async () => (await getDatabase()).getAll('pending'),
  cacheSearch: async (key: string, data: SearchResponse) => (await getDatabase()).put('cache', { key: `search:${key}`, data, cachedAt: Date.now() }),
  getCachedSearch: async (key: string) => (await getDatabase()).get('cache', `search:${key}`) as Promise<{ key: string; data: SearchResponse; cachedAt: number } | undefined>,
  invalidateSearch: async () => {
    const db = await getDatabase();
    const keys = await db.getAllKeys('cache');
    for (const key of keys) {
      if (typeof key === 'string' && key.startsWith('search:')) {
        await db.delete('cache', key);
      }
    }
  },
  cacheHome: async (data: HomePayload) => (await getDatabase()).put('cache', { key: 'home', data, cachedAt: Date.now() }),
  getCachedHome: async () => (await getDatabase()).get('cache', 'home') as Promise<{ key: string; data: HomePayload; cachedAt: number } | undefined>,
  cacheHomeIDs: async (data: HomeIDPayload) => (await getDatabase()).put('cache', { key: 'home_ids', data, cachedAt: Date.now() }),
  getCachedHomeIDs: async () => (await getDatabase()).get('cache', 'home_ids') as Promise<{ key: string; data: HomeIDPayload; cachedAt: number } | undefined>,
  invalidateHome: async () => {
    const db = await getDatabase();
    await db.delete('cache', 'home');
    await db.delete('cache', 'home_ids');
  },
  cacheCatalogGames: async (data: CatalogGamesCache) => (await getDatabase()).put('cache', { key: 'catalog:games', data, cachedAt: Date.now() }),
  getCachedCatalogGames: async () => (await getDatabase()).get('cache', 'catalog:games') as Promise<{ key: string; data: CatalogGamesCache; cachedAt: number } | undefined>,
  cacheCatalogGame: async (game: GameDetail) => (await getDatabase()).put('cache', { key: `catalog:game:${game.id}`, data: game, cachedAt: Date.now() }),
  getCachedCatalogGame: async (id: string) => (await getDatabase()).get('cache', `catalog:game:${id}`) as Promise<{ key: string; data: GameDetail; cachedAt: number } | undefined>,
  invalidateCatalogGame: async (id: string) => (await getDatabase()).delete('cache', `catalog:game:${id}`),
  cacheGameMeta: async (meta: GameMetaRecord) => (await getDatabase()).put('cache', { key: `gameMeta:${meta.slug}`, data: meta, cachedAt: Date.now() }),
  getCachedGameMeta: async (slug: string) => (await getDatabase()).get('cache', `gameMeta:${slug}`) as Promise<{ key: string; data: GameMetaRecord; cachedAt: number } | undefined>,
  invalidateGameMeta: async (slug: string) => (await getDatabase()).delete('cache', `gameMeta:${slug}`),
  cachePublicTags: async (data: PublicTagsResponse) => (await getDatabase()).put('cache', { key: 'publicTags', data, cachedAt: Date.now() }),
  getCachedPublicTags: async () => (await getDatabase()).get('cache', 'publicTags') as Promise<{ key: string; data: PublicTagsResponse; cachedAt: number } | undefined>,
  invalidatePublicTags: async () => (await getDatabase()).delete('cache', 'publicTags'),
  cacheTagEntities: async (tags: TagSummary[]) => {
    const db = await getDatabase();
    const cachedAt = Date.now();
    await Promise.all(tags.map((tag) => db.put('cache', { key: `tag:${tag.id}`, data: tag, cachedAt })));
  },
  getCachedTagEntities: async (ids: string[]) => {
    const db = await getDatabase();
    const records = await Promise.all(ids.map((id) => db.get('cache', `tag:${id}`) as Promise<TagCacheRecord | undefined>));
    return records.filter((record): record is TagCacheRecord => Boolean(record));
  },
  invalidateTagEntity: async (id: string) => (await getDatabase()).delete('cache', `tag:${id}`),
  cacheRuleEntity: async (rule: RuleEntity) => (await getDatabase()).put('cache', { key: `rule:${rule.id}`, data: rule, cachedAt: Date.now() }),
  getCachedRuleEntity: async (ruleId: string) => {
    const cached = await (await getDatabase()).get('cache', `rule:${ruleId}`) as { key: string; data: RuleEntity; cachedAt: number } | undefined;
    return cached && Date.now() - cached.cachedAt < RULE_CACHE_FRESH_MS ? cached : undefined;
  },
  invalidateRuleEntity: async (ruleId: string) => (await getDatabase()).delete('cache', `rule:${ruleId}`),
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
  getCachedGame: async (slug: string) => (await getDatabase()).get('cache', `game:${slug}`) as Promise<{ key: string; data: GameDetail; cachedAt: number } | undefined>,
  invalidateGame: async (slug: string) => (await getDatabase()).delete('cache', `game:${slug}`),
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
    const db = await getDatabase();
    const keys = await db.getAllKeys('cache');
    for (const key of keys) {
      if (options.includeTags || (typeof key === 'string' && !key.startsWith('tag:'))) {
        await db.delete('cache', key);
      }
    }
  },
};
