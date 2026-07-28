import type { AccountPayload, GameCatalogPayload, GameDetail, GameSummary, HomePayload, ReviewBatch, ReviewContent, ReviewProposal, RuleCard, RuleRevision, RuleSearchResult, SessionUser, SubmissionInput, TagSummary } from '../shared/types';
import { localDb } from './localDb';
import { filterGameCatalog } from './gameCatalog';

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

const readThrough = async <T>(
  readCache: () => Promise<{ data: T } | undefined>,
  fetchFresh: () => Promise<T>,
  writeCache: (data: T) => Promise<unknown>,
): Promise<T> => {
  const cached = await readCache().catch(() => undefined);
  if (cached) return cached.data;
  const data = await fetchFresh();
  await writeCache(data).catch(() => undefined);
  return data;
};

type CacheEntry<T> = { data: T };
type CachedRead<T> = {
  readCache: () => Promise<CacheEntry<T> | undefined>;
  fetchFresh: () => Promise<T>;
  writeCache: (data: T) => Promise<unknown>;
};

// Every cacheable read must enter here. Pages and components do not get to
// choose whether a network request is made.
const cachedRead = <T>({ readCache, fetchFresh, writeCache }: CachedRead<T>) =>
  readThrough(readCache, fetchFresh, writeCache);

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
const gameCatalog = async (): Promise<GameCatalogPayload> => {
  const cached = await localDb.getCachedGameCatalog().catch(() => undefined);
  if (cached) return cached.data;
  if (gameCatalogRequest) return gameCatalogRequest;
  gameCatalogRequest = (async () => {
    try {
      const response = await transportRequest<GameCatalogPayload>('/api/game-catalog', undefined, 'cache-miss');
      await localDb.cacheGameCatalog(response).catch(() => undefined);
      return (await localDb.getLatestGameCatalog().catch(() => undefined))?.data ?? response;
    } catch (error) {
      const stale = await localDb.getLatestGameCatalog().catch(() => undefined);
      if (stale) return stale.data;
      throw error;
    }
  })();
  try { return await gameCatalogRequest; }
  finally { gameCatalogRequest = undefined; }
};

const editorCatalogGames = () => cachedRead({
  readCache: async () => (await localDb.getCachedCatalogGames()) as { data: { games: GameSummary[] } } | undefined,
  fetchFresh: () => transportRequest<{ games: GameSummary[] }>('/api/editor/catalog/games', undefined, 'cache-miss'),
  writeCache: localDb.cacheCatalogGames,
});

const reloadEditorCatalogGames = async () => {
  await localDb.invalidateCatalogGames();
  return editorCatalogGames();
};

export const api = {
  session: () => uncachedRead<{ user: SessionUser | null; googleClientId: string | null; localDevLogin: boolean }>('/api/session', 'session is request-scoped authentication state'),
  account: () => uncachedRead<AccountPayload>('/api/account', 'account data is user-specific'),
  updateNickname: (nickname: string, showNickname = false) => mutation<{ user: SessionUser }>('/api/account/nickname', {
    method: 'PATCH', body: JSON.stringify({ nickname, showNickname }),
  }),
  googleLogin: (credential: string) => mutation<{ user: SessionUser }>('/api/auth/google', {
    method: 'POST', body: JSON.stringify({ credential }),
  }),
  devLogin: () => mutation<{ user: SessionUser }>('/api/auth/dev', { method: 'POST', body: '{}' }),
  logout: () => mutation<{ ok: true }>('/api/logout', { method: 'POST', body: '{}' }),
  home: () => cachedRead({
    readCache: localDb.getCachedHome,
    fetchFresh: () => transportRequest<HomePayload>('/api/home', undefined, 'cache-miss'),
    writeCache: localDb.cacheHome,
  }),
  searchGames: async (query: string) => ({ games: filterGameCatalog((await gameCatalog()).games, query, 20) }),
  search: async (query: string) => ({ games: filterGameCatalog((await gameCatalog()).games, query, 8), rules: [] as RuleSearchResult[] }),
  invalidateSearchCache: () => localDb.invalidateSearch(),
  tags: async (ids?: string[]) => {
    if (!ids?.length) {
      return cachedRead({
        readCache: localDb.getCachedPublicTags,
        fetchFresh: () => transportRequest<{ tags: TagSummary[] }>('/api/tags?v=2', undefined, 'cache-miss'),
        writeCache: async (data) => { await localDb.cachePublicTags(data); await localDb.cacheTagEntities(data.tags); },
      });
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
    if (!missingIds.length) return { tags: uniqueIds.map((id) => cachedById.get(id)!) };
    const data = await transportRequest<{ tags: TagSummary[] }>(`/api/tags?ids=${encodeURIComponent(missingIds.join(','))}&v=2`, undefined, 'cache-miss');
    await localDb.cacheTagEntities(data.tags).catch(() => undefined);
    return { tags: [...uniqueIds.map((id) => cachedById.get(id)).filter((tag): tag is TagSummary => Boolean(tag)), ...data.tags] };
  },
  adminTags: () => uncachedRead<{ tags: TagSummary[] }>('/api/admin/tags', 'admin tag management is private and intentionally always current'),
  createAdminTag: (input: { name: string; description?: string; isPublic?: boolean; aliases?: string[] }) => mutation<{ ok: true; tagId: string }>('/api/admin/tags', {
    method: 'POST', body: JSON.stringify(input),
  }),
  updateAdminTag: (id: string, input: { name?: string; description?: string; isPublic?: boolean; aliases?: string[] }) => mutation<{ ok: true }>(`/api/admin/tags/${id}`, {
    method: 'PATCH', body: JSON.stringify(input),
  }),
  game: async (identifier: string, includePrivate = false) => {
    const cached = await localDb.getCachedGame(identifier, includePrivate).catch(() => undefined);
    if (cached) return { game: cached.data };
    const response = await fetchGame(identifier, includePrivate);
    const rulesComplete = Boolean(response.rulesComplete);
    if (!response.offlineFallback) await localDb.cacheGame(response.game, rulesComplete).catch(() => undefined);
    if (includePrivate && !rulesComplete) throw new ApiError('forbidden', 403);
    return { game: presentGame(response.game, includePrivate) };
  },
  editorCatalogGames,
  reloadEditorCatalogGames,
  recordView: (gameId: string, ruleId?: string) => mutation<{ success: boolean }>(`/api/games/${gameId}/view${ruleId ? `?ruleId=${ruleId}` : ''}`, { method: 'POST', body: '{}' }),
  createGame: async (input: { displayName: string; englishName?: string; aliases?: string[] }) => {
    const response = await mutation<{ game: GameSummary }>('/api/games', {
      method: 'POST', body: JSON.stringify(input),
    });
    await localDb.upsertGameSummary(response.game).catch(() => undefined);
    return response;
  },
  patchGame: async (id: string, input: { displayName: string; englishName?: string; aliases?: string[] }) => {
    const response = await mutation<{ ok: true; game: GameSummary }>(`/api/games/${id}`, {
      method: 'PATCH', body: JSON.stringify(input),
    });
    await localDb.upsertGameSummary(response.game).catch(() => undefined);
    return response;
  },
  submit: (input: SubmissionInput) => mutation<{ submissionId: string; ruleIds?: string[]; reused: boolean }>('/api/submissions', {
    method: 'POST', body: JSON.stringify(input),
  }),
  rule: async (id: string) => ({ rule: await cachedRead<ApiRule>({
    readCache: async () => (await localDb.getCachedRuleEntity(id)) as { data: ApiRule } | undefined,
    fetchFresh: () => transportRequest<{ rule: ApiRule }>(`/api/rules/${id}`, undefined, 'cache-miss').then((response) => response.rule),
    writeCache: localDb.cacheRuleEntity,
  }) }),
  patchRule: (id: string, input: Record<string, unknown>) => mutation<{ ok: true }>(`/api/rules/${id}`, {
    method: 'PATCH', body: JSON.stringify(input),
  }),
  hideRule: (id: string) => mutation<{ ok: true }>(`/api/rules/${id}/hide`, { method: 'POST', body: '{}' }),
  restoreRule: (id: string) => mutation<{ ok: true }>(`/api/rules/${id}/restore`, { method: 'POST', body: '{}' }),
  ruleRevisions: (id: string) => uncachedRead<{ revisions: RuleRevision[] }>(`/api/rules/${id}/revisions`, 'revision history is a private editor view'),
  restoreRevision: (ruleId: string, revisionId: string) => mutation<{ ok: true }>(`/api/rules/${ruleId}/revisions/${revisionId}/restore`, { method: 'POST', body: '{}' }),
  mergeGame: async (id: string, targetGameId: string) => {
    const response = await mutation<{ ok: true }>(`/api/games/${id}/merge`, {
      method: 'POST', body: JSON.stringify({ targetGameId }),
    });
    await localDb.invalidateCatalogGames().catch(() => undefined);
    return response;
  },
  editors: () => uncachedRead<{ users: Array<Record<string, unknown>>; invitations: Array<Record<string, unknown>> }>('/api/admin/editors', 'editor administration is private and intentionally always current'),
  inviteEditor: (email: string, role: 'admin' | 'editor') => mutation<{ ok: true }>('/api/admin/editors/invite', {
    method: 'POST', body: JSON.stringify({ email, role }),
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
