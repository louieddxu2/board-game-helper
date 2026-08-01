import type { AccountDeletionSummary, AccountPayload, ContributionQuota, ContributionsPayload, EditorAdminPayload, FavoriteMutationPayload, GameCatalogChangesPayload, GameCatalogPayload, GameDetail, GameSummary, HomePayload, PersonalHomePayload, PublicTagCatalogChangesPayload, PublicTagCatalogPayload, ReviewBatch, ReviewContent, ReviewProposal, RuleCard, RuleImportanceMutationPayload, RuleImportancePayload, RuleRevision, RuleSearchResult, SessionUser, SubmissionInput, TagSummary } from '../shared/types';
import { localDb, type GameCatalogCacheRecord } from './localDb';
import { filterGameCatalog } from './gameCatalog';
import { homeContentKey } from './homeCache';

export class ApiError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code);
  }
}

type RequestAccess = 'cache-miss' | 'uncached-read' | 'mutation';

const transportResponse = async <T>(path: string, init: RequestInit | undefined, access: RequestAccess): Promise<{ data: T; response: Response }> => {
  if (access === 'mutation' && (!init?.method || init.method === 'GET')) {
    throw new Error(`Mutation request must specify a non-GET method: ${path}`);
  }
  if (access !== 'mutation' && init?.method && init.method !== 'GET') {
    throw new Error(`Read request cannot use a mutating method: ${path}`);
  }
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new ApiError(body.error ?? 'request_failed', response.status);
  return { data: body, response };
};

const transportRequest = async <T>(path: string, init: RequestInit | undefined, access: RequestAccess): Promise<T> =>
  (await transportResponse<T>(path, init, access)).data;

// GET endpoints that intentionally are not cached must explain why. This
// keeps an accidental uncached read visible during review.
const uncachedRead = <T>(path: string, reason: string) => {
  if (!reason.trim()) throw new Error(`Uncached read requires a reason: ${path}`);
  return transportRequest<T>(path, undefined, 'uncached-read');
};

const mutation = <T>(path: string, init: RequestInit) => transportRequest<T>(path, init, 'mutation');

type ApiRule = RuleCard & { gameName: string; gameSlug: string };

type GameResponse = { game: GameDetail; rulesComplete?: boolean };

const fetchGame = async (identifier: string, includePrivate: boolean) => {
  const params = new URLSearchParams();
  if (includePrivate) params.set('includePrivate', '1');
  const query = params.size ? `?${params.toString()}` : '';
  const result = await transportResponse<GameResponse>(
    `/api/games/${encodeURIComponent(identifier)}${query}`,
    undefined,
    'cache-miss',
  );
  return { ...result.data, offlineFallback: result.response.headers.get('X-Offline-Fallback') === '1' };
};

const presentGame = (game: GameDetail, includePrivate: boolean): GameDetail => {
  if (includePrivate) return game;
  const rules = game.rules.filter((rule) => rule.status === 'published');
  return { ...game, rules, ruleCount: game.publishedRuleCount ?? rules.length };
};

let gameCatalogRequest: Promise<GameCatalogPayload> | undefined;
export const GAME_CATALOG_SNAPSHOT_FRESH_MS = 7 * 24 * 60 * 60 * 1000;

const isGameCatalogSnapshotExpired = (record: GameCatalogCacheRecord, currentTime = Date.now()) =>
  currentTime - (record.snapshotFetchedAt ?? record.data.generatedAt) >= GAME_CATALOG_SNAPSHOT_FRESH_MS;

const synchronizeGameCatalog = async (catalog: GameCatalogPayload): Promise<GameCatalogPayload> => {
  let afterVersion = catalog.throughVersion;
  while (true) {
    const changes = await transportRequest<GameCatalogChangesPayload>(
      `/api/game-catalog/changes?after=${afterVersion}`,
      undefined,
      'cache-miss',
    );
    if (changes.hasMore && changes.throughVersion <= afterVersion) throw new Error('game_catalog_sync_stalled');
    await localDb.cacheGameCatalogChanges(changes);
    afterVersion = changes.throughVersion;
    if (!changes.hasMore) break;
  }
  return (await localDb.getLatestGameCatalog())?.data ?? catalog;
};

const refreshGameCatalog = async (knownBase?: GameCatalogCacheRecord | null): Promise<GameCatalogPayload> => {
  if (gameCatalogRequest) return gameCatalogRequest;
  gameCatalogRequest = (async () => {
    const existing = knownBase === null ? undefined : knownBase ?? await localDb.getLatestGameCatalog().catch(() => undefined);
    let base = existing?.data;
    if (!base || (existing && isGameCatalogSnapshotExpired(existing))) {
      base = await transportRequest<GameCatalogPayload>('/api/game-catalog', undefined, 'cache-miss');
      await localDb.cacheGameCatalog(base);
    }
    return synchronizeGameCatalog(base);
  })();
  try { return await gameCatalogRequest; }
  finally { gameCatalogRequest = undefined; }
};

const gameCatalog = async (onUpdated?: (data: GameCatalogPayload) => void): Promise<GameCatalogPayload> => {
  const cached = await localDb.getSynchronizedGameCatalog().catch(() => undefined);
  if (cached) return cached.data;
  const stale = await localDb.getLatestGameCatalog().catch(() => undefined);
  if (!stale) return refreshGameCatalog(null);
  void refreshGameCatalog(stale).then((updated) => {
    if (updated.throughVersion !== stale.data.throughVersion) onUpdated?.(updated);
  }).catch(() => undefined);
  return stale.data;
};

const toCatalog = (catalog: GameCatalogPayload, includePrivate: boolean) => ({
  games: catalog.games.map((game) => ({
    ...game,
    ruleCount: includePrivate ? game.totalRuleCount ?? game.ruleCount : game.publishedRuleCount ?? game.ruleCount,
  })),
});

const catalogGames = async (includePrivate: boolean, onUpdated?: (data: { games: GameSummary[] }) => void) =>
  toCatalog(await gameCatalog((updated) => onUpdated?.(toCatalog(updated, includePrivate))), includePrivate);

const syncCatalogGames = async (includePrivate: boolean) => {
  await localDb.invalidateGameCatalogSync();
  return toCatalog(await refreshGameCatalog(), includePrivate);
};

const gameContentKey = (game: GameDetail): string => JSON.stringify({
  id: game.id,
  slug: game.slug,
  displayName: game.displayName,
  englishName: game.englishName,
  updatedAt: game.updatedAt,
  latestRuleUpdatedAt: game.latestRuleUpdatedAt,
  reviewStatus: game.reviewStatus,
  reviewedByNickname: game.reviewedByNickname,
  rules: game.rules.map((rule) => [rule.id, rule.updatedAt, rule.status, rule.categories, rule.reviewStatus, rule.reviewedByNickname]),
});

const gameRefreshRequests = new Map<string, Promise<{ game: GameDetail }>>();
const refreshGame = (identifier: string, includePrivate: boolean): Promise<{ game: GameDetail }> => {
  const key = `${identifier}:${includePrivate ? 'private' : 'public'}`;
  const existing = gameRefreshRequests.get(key);
  if (existing) return existing;
  const request = (async () => {
    const response = await fetchGame(identifier, includePrivate);
    const rulesComplete = Boolean(response.rulesComplete);
    if (includePrivate && !rulesComplete) throw new ApiError('forbidden', 403);
    if (!response.offlineFallback) await localDb.cacheGame(response.game, rulesComplete).catch(() => undefined);
    return { game: presentGame(response.game, includePrivate) };
  })().finally(() => { if (gameRefreshRequests.get(key) === request) gameRefreshRequests.delete(key); });
  gameRefreshRequests.set(key, request);
  return request;
};

const ruleRefreshRequests = new Map<string, Promise<ApiRule>>();
const refreshRule = (id: string): Promise<ApiRule> => {
  const existing = ruleRefreshRequests.get(id);
  if (existing) return existing;
  const request = transportRequest<{ rule: ApiRule }>(`/api/rules/${id}`, undefined, 'cache-miss')
    .then(async (response) => {
      await localDb.cacheRuleEntity(response.rule).catch(() => undefined);
      return response.rule;
    })
    .finally(() => { if (ruleRefreshRequests.get(id) === request) ruleRefreshRequests.delete(id); });
  ruleRefreshRequests.set(id, request);
  return request;
};

const ruleContentKey = (rule: ApiRule): string => JSON.stringify([
  rule.id, rule.updatedAt, rule.status, rule.statement, rule.commonMistake, rule.details, rule.categories, rule.tagIds,
  rule.reviewStatus, rule.reviewedByNickname, rule.reviewedAt,
]);

const ruleImportanceRequests = new Map<string, Promise<RuleImportancePayload>>();
const refreshRuleImportance = (gameId: string, userId: string) => {
  const key = `${userId}:${gameId}`;
  const existing = ruleImportanceRequests.get(key);
  if (existing) return existing;
  const request = transportRequest<RuleImportancePayload>(
    `/api/games/${encodeURIComponent(gameId)}/rule-importance`, undefined, 'cache-miss',
  ).then(async (data) => {
    await localDb.cacheRuleImportance(userId, gameId, data).catch(() => undefined);
    return data;
  }).finally(() => { if (ruleImportanceRequests.get(key) === request) ruleImportanceRequests.delete(key); });
  ruleImportanceRequests.set(key, request);
  return request;
};

let publicTagsRefreshRequest: Promise<PublicTagCatalogPayload> | undefined;
const refreshPublicTags = async () => {
  if (publicTagsRefreshRequest) return publicTagsRefreshRequest;
  publicTagsRefreshRequest = (async () => {
    const existing = (await localDb.getLatestPublicTags().catch(() => undefined))?.data
      ?? { tags: [], throughVersion: 0 };
    let afterVersion = existing.throughVersion;
    while (true) {
      const changes = await transportRequest<PublicTagCatalogChangesPayload>(
        `/api/tags/changes?after=${afterVersion}`,
        undefined,
        'cache-miss',
      );
      if (changes.hasMore && changes.throughVersion <= afterVersion) throw new Error('public_tag_catalog_sync_stalled');
      await localDb.cachePublicTagCatalogChanges(changes);
      afterVersion = changes.throughVersion;
      if (!changes.hasMore) break;
    }
    const updated = (await localDb.getLatestPublicTags())?.data ?? existing;
    await localDb.cacheTagEntities(updated.tags);
    return updated;
  })();
  try { return await publicTagsRefreshRequest; }
  finally { publicTagsRefreshRequest = undefined; }
};

const tagCollectionKey = (tags: TagSummary[]) => JSON.stringify(tags.map((tag) => [
  tag.id, tag.updatedAt, tag.slug, tag.name, tag.isPublic, tag.usageCount, tag.aliases, tag.categoryHints, tag.detectionKeywords,
]));

let homeRefreshRequest: Promise<HomePayload> | undefined;
const refreshHome = async (): Promise<HomePayload> => {
  if (homeRefreshRequest) return homeRefreshRequest;
  homeRefreshRequest = (async () => {
    const result = await transportResponse<HomePayload>('/api/home', undefined, 'cache-miss');
    if (result.response.headers.get('X-Offline-Fallback') !== '1') {
      await localDb.cacheHome(result.data).catch(() => undefined);
    }
    return result.data;
  })();
  try { return await homeRefreshRequest; }
  finally { homeRefreshRequest = undefined; }
};

const home = async (onUpdated?: (data: HomePayload) => void): Promise<HomePayload> => {
  const cached = await localDb.getCachedHome().catch(() => undefined);
  if (cached) return cached.data;
  const stale = await localDb.getLatestHome().catch(() => undefined);
  if (!stale) return refreshHome();
  void refreshHome().then((updated) => {
    if (homeContentKey(updated) !== homeContentKey(stale.data)) onUpdated?.(updated);
  }).catch(() => undefined);
  return stale.data;
};

export const api = {
  session: () => uncachedRead<{ user: SessionUser | null; googleClientId: string | null; localDevLogin: boolean }>('/api/session', 'session is request-scoped authentication state'),
  account: () => uncachedRead<AccountPayload>('/api/account', 'account data is user-specific'),
  contributions: () => uncachedRead<ContributionsPayload>('/api/account/contributions', 'contribution quota and history are user-specific'),
  editorContributions: () => uncachedRead<{ games: Array<{ gameId: string; pendingRuleCount: number }>; pendingGameIds: string[] }>('/api/editor/contributions', 'review queue is editor-specific'),
  personalHome: () => uncachedRead<PersonalHomePayload>('/api/account/home', 'favorite data is user-specific'),
  favoriteStatus: (gameId: string) => uncachedRead<{ favorite: boolean; favoriteCount: number }>(`/api/account/favorites/${encodeURIComponent(gameId)}`, 'favorite status is user-specific'),
  addFavorite: (gameId: string) => mutation<FavoriteMutationPayload>(`/api/account/favorites/${encodeURIComponent(gameId)}`, { method: 'POST', body: '{}' }),
  removeFavorite: (gameId: string) => mutation<FavoriteMutationPayload>(`/api/account/favorites/${encodeURIComponent(gameId)}`, { method: 'DELETE', body: '{}' }),
  clearFavorites: () => mutation<FavoriteMutationPayload>('/api/account/favorites', { method: 'DELETE', body: '{}' }),
  accountDeletionSummary: () => uncachedRead<AccountDeletionSummary>('/api/account/deletion-summary', 'account deletion preview is private and must be current'),
  deleteAccount: (deleteOwnUnmodifiedRules: boolean) => mutation<{ ok: true; deletedRuleCount: number }>('/api/account', {
    method: 'DELETE', body: JSON.stringify({ confirmation: '刪除帳號', deleteOwnUnmodifiedRules }),
  }),
  markFavoriteSeen: (gameId: string) => mutation<{ ok: true }>(`/api/account/favorites/${encodeURIComponent(gameId)}/seen`, { method: 'POST', body: '{}' }),
  ruleImportance: async (gameId: string, userId: string, onUpdated?: (data: RuleImportancePayload) => void) => {
    const cached = await localDb.getCachedRuleImportance(userId, gameId).catch(() => undefined);
    if (cached) return cached.data;
    const stale = await localDb.getLatestRuleImportance(userId, gameId).catch(() => undefined);
    if (!stale) return refreshRuleImportance(gameId, userId);
    void refreshRuleImportance(gameId, userId).then((updated) => {
      if (JSON.stringify(updated.ruleIds) !== JSON.stringify(stale.data.ruleIds)) onUpdated?.(updated);
    }).catch(() => undefined);
    return stale.data;
  },
  setRuleImportance: (ruleId: string, important: boolean) => mutation<RuleImportanceMutationPayload>(
    `/api/rules/${encodeURIComponent(ruleId)}/importance`,
    { method: 'PUT', body: JSON.stringify({ important }) },
  ),
  updateNickname: (nickname: string, showNickname = false) => mutation<{ user: SessionUser }>('/api/account/nickname', {
    method: 'PATCH', body: JSON.stringify({ nickname, showNickname }),
  }),
  googleLogin: (credential: string) => mutation<{ user: SessionUser }>('/api/auth/google', {
    method: 'POST', body: JSON.stringify({ credential }),
  }),
  devLogin: () => mutation<{ user: SessionUser }>('/api/auth/dev', { method: 'POST', body: '{}' }),
  logout: () => mutation<{ ok: true }>('/api/logout', { method: 'POST', body: '{}' }),
  home,
  searchGames: async (query: string, onUpdated?: (data: { games: GameSummary[] }) => void) => ({
    games: filterGameCatalog((await gameCatalog((updated) => onUpdated?.({ games: filterGameCatalog(updated.games, query, 20) }))).games, query, 20),
  }),
  search: async (query: string, onUpdated?: (data: { games: GameSummary[]; rules: RuleSearchResult[] }) => void) => ({
    games: filterGameCatalog((await gameCatalog((updated) => onUpdated?.({ games: filterGameCatalog(updated.games, query, 8), rules: [] }))).games, query, 8),
    rules: [] as RuleSearchResult[],
  }),
  invalidateSearchCache: () => localDb.invalidateSearch(),
  tags: async (ids?: string[], onUpdated?: (data: { tags: TagSummary[] }) => void) => {
    if (!ids?.length) {
      const cached = await localDb.getCachedPublicTags().catch(() => undefined);
      if (cached) return cached.data;
      const stale = await localDb.getLatestPublicTags().catch(() => undefined);
      if (!stale) return refreshPublicTags();
      void refreshPublicTags().then((updated) => {
        if (tagCollectionKey(updated.tags) !== tagCollectionKey(stale.data.tags)) onUpdated?.(updated);
      }).catch(() => undefined);
      return stale.data;
    }
    const uniqueIds = Array.from(new Set(ids));
    const cached = await localDb.getCachedTagEntities(uniqueIds).catch(() => []);
    const cachedById = new Map(cached.map((record) => [record.data.id, record.data]));
    const publicTags = await localDb.getCachedPublicTags().catch(() => undefined);
    if (publicTags) {
      const matchingPublicTags = publicTags.data.tags.filter((tag) => uniqueIds.includes(tag.id));
      matchingPublicTags.forEach((tag) => cachedById.set(tag.id, tag));
      await localDb.cacheTagEntities(matchingPublicTags).catch(() => undefined);
    }
    const missingIds = uniqueIds.filter((id) => !cachedById.has(id));
    const stale = await localDb.getLatestTagEntities(missingIds).catch(() => []);
    stale.forEach((record) => cachedById.set(record.data.id, record.data));
    const unavailableIds = uniqueIds.filter((id) => !cachedById.has(id));
    if (!missingIds.length) return { tags: uniqueIds.map((id) => cachedById.get(id)!) };
    if (!unavailableIds.length) {
      void transportRequest<{ tags: TagSummary[] }>(`/api/tags?ids=${encodeURIComponent(missingIds.join(','))}&v=2`, undefined, 'cache-miss')
        .then(async (data) => {
          await localDb.cacheTagEntities(data.tags);
          const updated = uniqueIds.map((id) => data.tags.find((tag) => tag.id === id) ?? cachedById.get(id)!).filter(Boolean);
          const previous = uniqueIds.map((id) => cachedById.get(id)!).filter(Boolean);
          if (tagCollectionKey(updated) !== tagCollectionKey(previous)) onUpdated?.({ tags: updated });
        }).catch(() => undefined);
      return { tags: uniqueIds.map((id) => cachedById.get(id)!) };
    }
    const data = await transportRequest<{ tags: TagSummary[] }>(`/api/tags?ids=${encodeURIComponent(unavailableIds.join(','))}&v=2`, undefined, 'cache-miss');
    await localDb.cacheTagEntities(data.tags).catch(() => undefined);
    return { tags: [...uniqueIds.map((id) => cachedById.get(id)).filter((tag): tag is TagSummary => Boolean(tag)), ...data.tags] };
  },
  adminTags: () => uncachedRead<{ tags: TagSummary[] }>('/api/admin/tags', 'admin tag management is private and intentionally always current'),
  createAdminTag: (input: { name: string; description?: string; isPublic?: boolean; aliases?: string[]; categoryHints?: TagSummary['categoryHints']; detectionKeywords?: string[] }) => mutation<{ ok: true; tagId: string }>('/api/admin/tags', {
    method: 'POST', body: JSON.stringify(input),
  }),
  updateAdminTag: (id: string, input: { name?: string; description?: string; isPublic?: boolean; aliases?: string[]; categoryHints?: TagSummary['categoryHints']; detectionKeywords?: string[] }) => mutation<{ ok: true }>(`/api/admin/tags/${id}`, {
    method: 'PATCH', body: JSON.stringify(input),
  }),
  mergeAdminTag: (sourceTagId: string, targetTagId: string) => mutation<{ ok: true; sourceTagId: string; targetTagId: string }>(`/api/admin/tags/${sourceTagId}/merge`, {
    method: 'POST', body: JSON.stringify({ targetTagId }),
  }),
  game: async (identifier: string, includePrivate = false, onUpdated?: (data: { game: GameDetail }) => void) => {
    const cached = await localDb.getCachedGame(identifier, includePrivate).catch(() => undefined);
    if (cached) return { game: cached.data };
    const stale = await localDb.getLatestGame(identifier, includePrivate).catch(() => undefined);
    if (!stale) return refreshGame(identifier, includePrivate);
    void refreshGame(identifier, includePrivate).then((updated) => {
      if (gameContentKey(updated.game) !== gameContentKey(stale.data)) onUpdated?.(updated);
    }).catch(() => undefined);
    return { game: stale.data };
  },
  catalogGames,
  syncCatalogGames,
  recordView: (gameId: string) => mutation<{ success: boolean; counted: boolean }>(`/api/games/${gameId}/view`, { method: 'POST', body: '{}' }),
  patchGame: async (id: string, input: { displayName: string; englishName?: string; aliases?: string[] }) => {
    const response = await mutation<{ ok: true; game: GameSummary }>(`/api/games/${id}`, {
      method: 'PATCH', body: JSON.stringify(input),
    });
    await localDb.upsertGameSummary(response.game).catch(() => undefined);
    return response;
  },
  submit: (input: SubmissionInput) => mutation<{ submissionId: string; ruleIds?: string[]; gameId: string; gameSlug: string; gameCreated: boolean; quota?: ContributionQuota; reused: boolean }>('/api/submissions', {
    method: 'POST', body: JSON.stringify(input),
  }),
  rule: async (id: string, onUpdated?: (data: { rule: ApiRule }) => void) => {
    const cached = await localDb.getCachedRuleEntity(id).catch(() => undefined) as { data: ApiRule } | undefined;
    if (cached) return { rule: cached.data };
    const stale = await localDb.getLatestRuleEntity(id).catch(() => undefined) as { data: ApiRule } | undefined;
    if (!stale) return { rule: await refreshRule(id) };
    void refreshRule(id).then((updated) => {
      if (ruleContentKey(updated) !== ruleContentKey(stale.data)) onUpdated?.({ rule: updated });
    }).catch(() => undefined);
    return { rule: stale.data };
  },
  patchRule: (id: string, input: Record<string, unknown>) => mutation<{ ok: true }>(`/api/rules/${id}`, {
    method: 'PATCH', body: JSON.stringify(input),
  }),
  reviewRule: (id: string) => mutation<{ ok: true; reviewStatus: 'reviewed'; reviewedByNickname: string; reviewedAt: number }>(`/api/rules/${id}/review`, { method: 'POST', body: '{}' }),
  reviewGame: (id: string) => mutation<{ ok: true; reviewStatus: 'reviewed'; reviewedByNickname: string; reviewedAt: number }>(`/api/games/${id}/review`, { method: 'POST', body: '{}' }),
  hideRule: (id: string) => mutation<{ ok: true }>(`/api/rules/${id}/hide`, { method: 'POST', body: '{}' }),
  restoreRule: (id: string) => mutation<{ ok: true }>(`/api/rules/${id}/restore`, { method: 'POST', body: '{}' }),
  ruleRevisions: (id: string) => uncachedRead<{ revisions: RuleRevision[] }>(`/api/rules/${id}/revisions`, 'revision history is a private editor view'),
  restoreRevision: (ruleId: string, revisionId: string) => mutation<{ ok: true }>(`/api/rules/${ruleId}/revisions/${revisionId}/restore`, { method: 'POST', body: '{}' }),
  mergeGame: async (id: string, targetGameId: string) => {
    const response = await mutation<{ ok: true }>(`/api/games/${id}/merge`, {
      method: 'POST', body: JSON.stringify({ targetGameId }),
    });
    await localDb.invalidateGameCatalogSync().catch(() => undefined);
    return response;
  },
  editors: () => uncachedRead<EditorAdminPayload>('/api/admin/editors', 'editor administration is private and intentionally always current'),
  inviteEditor: (email: string, role: 'admin' | 'editor', note?: string) => mutation<{ ok: true }>('/api/admin/editors/invite', {
    method: 'POST', body: JSON.stringify({ email, role, note }),
  }),
  revokeEditor: (userId: string, role: 'admin' | 'editor') => mutation<{ ok: true }>(`/api/admin/editors/${userId}?role=${role}`, { method: 'DELETE', body: '{}' }),
  revokeInvitation: (id: string) => mutation<{ ok: true }>(`/api/admin/editors/invitations/${id}`, { method: 'DELETE', body: '{}' }),
  importRows: (status = 'pending') => uncachedRead<{ rows: Array<Record<string, unknown>> }>(`/api/admin/import-rows?status=${status}`, 'import queue is a private admin workspace'),
  confirmImport: (id: string, rules?: string[], gameId?: string) => mutation<{ ok: true; importedRules: number }>(`/api/admin/import-rows/${id}/confirm`, {
    method: 'POST', body: JSON.stringify({ rules, gameId }),
  }),
  skipImport: (id: string) => mutation<{ ok: true }>(`/api/admin/import-rows/${id}/skip`, { method: 'POST', body: '{}' }),
  hiddenRules: () => uncachedRead<{ rules: import('../shared/types').RuleCard[] }>('/api/admin/hidden-rules', 'hidden rules are a private admin workspace'),
  reviewBatches: () => uncachedRead<{ batches: ReviewBatch[] }>('/api/admin/review/batches', 'review batches are a private admin workspace'),
  reviewProposals: (status = 'pending', batchId = '', limit = 20, cursor = '') =>
    uncachedRead<{ proposals: ReviewProposal[]; nextCursor: string | null }>(`/api/admin/review/proposals?status=${encodeURIComponent(status)}&batchId=${encodeURIComponent(batchId)}&limit=${limit}&cursor=${encodeURIComponent(cursor)}`, 'review proposals are a private admin workspace'),
  importReviewFile: (file: unknown) => mutation<{ batchId: string; imported: number; pending?: number; conflicts?: number; skipped?: number; reused: boolean }>('/api/admin/review/import', {
    method: 'POST', body: JSON.stringify({ file }),
  }),
  importReviewCsv: (content: string) => mutation<{ batchId: string; imported: number; pending?: number; conflicts?: number; skipped?: number; reused: boolean }>('/api/admin/review/import', {
    method: 'POST', body: JSON.stringify({ format: 'csv', content }),
  }),
  claimReviewProposal: (id: string) => mutation<{ ok: true; claimedUntil: number; version: number }>(`/api/admin/review/proposals/${id}/claim`, {
    method: 'POST', body: '{}',
  }),
  decideReviewProposals: (decisions: Array<{ proposalId: string; version: number; decision: 'accept' | 'reject'; proposed?: ReviewContent }>) =>
    mutation<{ outcomes: Array<{ proposalId: string; status: string }> }>('/api/admin/review/decisions', {
      method: 'POST', body: JSON.stringify({ decisions }),
    }),
};
