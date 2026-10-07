import { openDB, type DBSchema } from 'idb';
import type { AttributeCatalogPayload, AttributeComparisonResult, AttributeDefinition, AttributeImportCandidate, AttributeMatrixValue, AttributeQuestionPayload, AttributeSubject, FlowStage, GameCatalogChangesPayload, GameCatalogPayload, GameDetail, GameExternalResource, GameSummary, GameVariantSummary, HomeIDPayload, HomePayload, RuleCard, RuleCategory, RuleSearchResult, SubmissionInput, TagSelection, TagSummary } from '../shared/types';
import {
  type AttributeDirectRatingRecord
} from './attributeDirectRatings';
import { applyGameCatalogChanges } from './gameCatalog';

export type SearchResponse = { games: GameSummary[]; rules: RuleSearchResult[] };

export const HOUR_CACHE_FRESH_MS = 60 * 60 * 1000;

export const CATALOG_SYNC_FRESH_MS = 10 * 60 * 1000;

export const ATTRIBUTE_CATALOG_DB_VERSION = 10;

export const RULE_IMPORTANCE_CACHE_FRESH_MS = 10 * 60 * 1000;

export const TAG_ENTITY_CACHE_FRESH_MS = 24 * 60 * 60 * 1000;

export const PUBLIC_TAG_CATALOG_FRESH_MS = 7 * 24 * 60 * 60 * 1000;

export const PUBLIC_TAGS_CACHE_KEY = 'publicTags:versioned:v5';

export const PUBLIC_GAME_CATALOG_KEY = 'games:list:versioned:v2';

export const PUBLIC_ATTRIBUTE_TABLE_KEY = 'attributes:table:versioned:v4';

export const LEGACY_ATTRIBUTE_TABLE_KEY = 'attributes:table:versioned:v3';

export const ATTRIBUTE_CATALOG_META_KEY = 'current';

export const LOCAL_GAME_CATALOG_OVERRIDES_KEY = 'games:list:local-overrides:v1';

export const HOME_VIEW_CACHE_KEY = 'home:view:v1';

export const ruleImportanceCacheKey = (userId: string, gameId: string) => `ruleImportance:${userId}:${gameId}`;

export const ruleImportanceCachePrefix = (userId: string) => `ruleImportance:${userId}:`;

export type CacheRecord<T> = { key: string; data: T; cachedAt: number };

export type GameCatalogCacheRecord = CacheRecord<GameCatalogPayload> & { snapshotFetchedAt?: number };

export type AttributeCatalogCacheRecord = CacheRecord<AttributeCatalogPayload> & { snapshotFetchedAt?: number };

export type AttributeQuestionCacheRecord = CacheRecord<AttributeQuestionPayload> & { scope?: 'all' | 'collection' };

export type CachedRuleUpdate = RuleCard & { gameName?: string; gameSlug?: string };

export interface AttributeCatalogMetaRecord {
  key: string;
  generation: number;
  throughVersion: number;
  generatedAt: number;
  cachedAt: number;
  snapshotFetchedAt: number;
  scoreModelVersion?: string;
  activities: AttributeCatalogPayload['activities'];
}

export type AttributeCatalogStoredValue = AttributeMatrixValue & { key: string };

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

export const replaceGameInHomeIds = (data: HomeIDPayload, sourceGame: GameSummary | undefined, targetGame: GameSummary): HomeIDPayload => {
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

export const applyAttributeValueUpdates = (
  catalog: AttributeCatalogPayload,
  values: AttributeMatrixValue[],
): AttributeCatalogPayload => {
  if (!values.length) return catalog;
  const replacements = new Map(values.map((value) => [`${value.subjectId}\u0000${value.attributeId}`, value]));
  const retained = catalog.values.filter((value) => !replacements.has(`${value.subjectId}\u0000${value.attributeId}`));
  return { ...catalog, values: [...retained, ...values] };
};

export const getFreshCache = async <T>(key: string, maxAge: number): Promise<CacheRecord<T> | undefined> => {
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
  variants?: GameVariantSummary[];
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

export interface DeferredAttributeSubject {
  subjectId: string;
  bggIds: number[];
  skipCount: number;
  skippedAt: number;
  eligibleAfterQuestion: number;
  eligibleAfterAt: number;
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

export interface RulesDb extends DBSchema {
  drafts: { key: string; value: DraftRecord };
  pending: { key: string; value: { id: string; userId: string; payload: SubmissionInput; createdAt: number } };
  cache: { key: string; value: { key: string; data: unknown; cachedAt: number; scope?: 'all' | 'collection' } };
  recentGames: { key: string; value: { id: string; slug?: string; displayName?: string; englishName?: string; viewedAt: number }; indexes: { viewedAt: number } };
  games: { key: string; value: CachedGameRow; indexes: { slug: string } };
  rules: { key: string; value: CachedRuleRow; indexes: { gameId: string } };
  attributeResponses: { key: string; value: PendingAttributeResponse };
  attributeDirectRatings: { key: string; value: AttributeDirectRatingRecord; indexes: { ownerId: string; ratedAt: number } };
  attributeCollectionIds: { key: number; value: { bggId: number; importedAt: number } };
  attributeDeferredSubjects: { key: string; value: DeferredAttributeSubject };
  attributeCatalogMeta: { key: string; value: AttributeCatalogMetaRecord };
  attributeCatalogAttributes: { key: string; value: AttributeDefinition };
  attributeCatalogSubjects: { key: string; value: AttributeSubject };
  attributeCatalogValues: { key: string; value: AttributeCatalogStoredValue; indexes: { subjectId: string; attributeId: string } };
  attributeCatalogCandidates: { key: string; value: AttributeImportCandidate };
}

export interface PendingAttributeResponse {
  /** Queued ratings and comparison are in this question's display direction. */
  highPole?: 'low' | 'high';
  id: string;
  subjectAId: string;
  subjectBId: string;
  attributeId: string;
  questionToken?: string;
  responseId: string;
  comparison?: AttributeComparisonResult | null;
  ratingA?: number | null;
  ratingB?: number | null;
  sessionId: string;
  createdAt: number;
}

export const getDb = () => {
  if (typeof indexedDB === 'undefined') return null;
  return openDB<RulesDb>('wrong-board-game-rules', ATTRIBUTE_CATALOG_DB_VERSION, {
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
      if (!db.objectStoreNames.contains('attributeDirectRatings')) {
        const directRatings = db.createObjectStore('attributeDirectRatings', { keyPath: 'key' });
        directRatings.createIndex('ownerId', 'ownerId');
        directRatings.createIndex('ratedAt', 'ratedAt');
      }
      if (!db.objectStoreNames.contains('attributeCollectionIds')) db.createObjectStore('attributeCollectionIds', { keyPath: 'bggId' });
      if (!db.objectStoreNames.contains('attributeDeferredSubjects')) db.createObjectStore('attributeDeferredSubjects', { keyPath: 'subjectId' });
      if (!db.objectStoreNames.contains('attributeCatalogMeta')) db.createObjectStore('attributeCatalogMeta', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('attributeCatalogAttributes')) db.createObjectStore('attributeCatalogAttributes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('attributeCatalogSubjects')) db.createObjectStore('attributeCatalogSubjects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('attributeCatalogValues')) {
        const values = db.createObjectStore('attributeCatalogValues', { keyPath: 'key' });
        values.createIndex('subjectId', 'subjectId');
        values.createIndex('attributeId', 'attributeId');
      }
      if (!db.objectStoreNames.contains('attributeCatalogCandidates')) db.createObjectStore('attributeCatalogCandidates', { keyPath: 'id' });
      // Version 7 could overwrite complete subjects with compact value-delta
      // metadata. Clear only the affected local catalog stores so the next
      // request rebuilds them from the complete server snapshot.
      if (oldVersion > 0 && oldVersion < 8) {
        transaction.objectStore('attributeCatalogMeta').clear();
        transaction.objectStore('attributeCatalogAttributes').clear();
        transaction.objectStore('attributeCatalogSubjects').clear();
        transaction.objectStore('attributeCatalogValues').clear();
        transaction.objectStore('attributeCatalogCandidates').clear();
      }
      // Version 10 invalidates the catalog cursor after the merged win-method
      // migration. The old cursor could be ahead of the corresponding entry
      // changes, so applying deltas could never reconstruct the new snapshot.
      if (oldVersion > 0 && oldVersion < ATTRIBUTE_CATALOG_DB_VERSION) {
        transaction.objectStore('attributeCatalogMeta').clear();
        transaction.objectStore('attributeCatalogAttributes').clear();
        transaction.objectStore('attributeCatalogSubjects').clear();
        transaction.objectStore('attributeCatalogValues').clear();
        transaction.objectStore('attributeCatalogCandidates').clear();
      }
      if (oldVersion > 0 && oldVersion < 3) {
        transaction.objectStore('games').clear();
        transaction.objectStore('rules').clear();
      }
    },
  });
};

export type RulesDatabase = Exclude<Awaited<ReturnType<typeof getDb>>, null>;

export let dbPromise: ReturnType<typeof getDb> | null = null;

export let legacyGameCacheCleanup: Promise<void> | null = null;

export let attributeCatalogMigration: Promise<void> | null = null;

export const attributeCatalogValueKey = (value: Pick<AttributeMatrixValue, 'subjectId' | 'attributeId'>) => `${value.subjectId}:${value.attributeId}`;

export const attributeCatalogMetaFromPayload = (
  data: AttributeCatalogPayload,
  cachedAt: number,
  snapshotFetchedAt = cachedAt,
): AttributeCatalogMetaRecord => ({
  key: ATTRIBUTE_CATALOG_META_KEY,
  generation: data.generation,
  throughVersion: data.throughVersion,
  generatedAt: data.generatedAt,
  cachedAt,
  snapshotFetchedAt,
  scoreModelVersion: data.scoreModelVersion,
  activities: data.activities ?? [],
});

export const attributeCatalogPayloadFromStores = async (
  db: RulesDatabase,
  meta?: AttributeCatalogMetaRecord,
): Promise<AttributeCatalogPayload | undefined> => {
  const current = meta ?? await db.get('attributeCatalogMeta', ATTRIBUTE_CATALOG_META_KEY);
  if (!current) return undefined;
  const [attributes, subjects, values, candidates] = await Promise.all([
    db.getAll('attributeCatalogAttributes'),
    db.getAll('attributeCatalogSubjects'),
    db.getAll('attributeCatalogValues'),
    db.getAll('attributeCatalogCandidates'),
  ]);
  return {
    generation: current.generation,
    throughVersion: current.throughVersion,
    generatedAt: current.generatedAt,
    attributes,
    subjects,
    values: values.map(({ key: _key, ...value }) => value),
    candidates,
    activities: current.activities ?? [],
    scoreModelVersion: current.scoreModelVersion,
  };
};

export const migrateLegacyAttributeCatalog = async (db: RulesDatabase) => {
  const existing = await db.get('attributeCatalogMeta', ATTRIBUTE_CATALOG_META_KEY);
  if (existing) return;
  const legacy = await db.get('cache', LEGACY_ATTRIBUTE_TABLE_KEY) as AttributeCatalogCacheRecord | undefined;
  if (!legacy?.data) return;
  const { data } = legacy;
  const transaction = db.transaction([
    'attributeCatalogMeta', 'attributeCatalogAttributes', 'attributeCatalogSubjects',
    'attributeCatalogValues', 'attributeCatalogCandidates', 'cache',
  ], 'readwrite');
  await transaction.objectStore('attributeCatalogMeta').put(attributeCatalogMetaFromPayload(
    data,
    legacy.cachedAt,
    legacy.snapshotFetchedAt ?? data.generatedAt,
  ));
  await Promise.all([
    ...data.attributes.map((attribute) => transaction.objectStore('attributeCatalogAttributes').put(attribute)),
    ...data.subjects.map((subject) => transaction.objectStore('attributeCatalogSubjects').put(subject)),
    ...data.values.map((value) => transaction.objectStore('attributeCatalogValues').put({ ...value, key: attributeCatalogValueKey(value) })),
    ...data.candidates.map((candidate) => transaction.objectStore('attributeCatalogCandidates').put(candidate)),
  ]);
  await transaction.objectStore('cache').delete(LEGACY_ATTRIBUTE_TABLE_KEY);
  await transaction.done;
};

export const getDatabase = async () => {
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
  if (!attributeCatalogMigration) {
    attributeCatalogMigration = migrateLegacyAttributeCatalog(db).catch((error) => {
      attributeCatalogMigration = null;
      throw error;
    });
  }
  await attributeCatalogMigration;
  return db;
};

export const notifyPending = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('rules-pending-change'));
  }
};

export const findCachedGame = async (db: Awaited<ReturnType<typeof getDatabase>>, identifier: string) =>
  (await db.get('games', identifier)) ?? (await db.getFromIndex('games', 'slug', identifier));

export const readCachedGameDetail = async (
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

export const publicRuleOrder: Record<string, number> = {
  setup: 1, round: 2, action: 3, always: 4, end_scoring: 5, edition_player_count: 6, uncategorized: 7,
};

export const sortRules = (rules: RuleCard[], includePrivate: boolean) => [...rules].sort((left, right) => includePrivate
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

export const localDbMemory = {
  searchMemoryCache: new Map<string, CacheRecord<SearchResponse>>(),
  gameCatalogMemoryCache: undefined as GameCatalogCacheRecord | undefined,
  attributeTableMemoryCache: undefined as AttributeCatalogCacheRecord | undefined,
};
