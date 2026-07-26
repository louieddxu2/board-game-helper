import type { AccountPayload, GameDetail, GameSummary, HomePayload, ReviewBatch, ReviewContent, ReviewProposal, RuleRevision, RuleSearchResult, SessionUser, SubmissionInput, TagSummary } from '../shared/types';

export class ApiError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code);
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
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
  return body;
};

export const api = {
  session: () => request<{ user: SessionUser | null; googleClientId: string | null; localDevLogin: boolean }>('/api/session'),
  account: () => request<AccountPayload>('/api/account'),
  updateNickname: (nickname: string) => request<{ user: SessionUser }>('/api/account/nickname', {
    method: 'PATCH', body: JSON.stringify({ nickname }),
  }),
  googleLogin: (credential: string) => request<{ user: SessionUser }>('/api/auth/google', {
    method: 'POST', body: JSON.stringify({ credential }),
  }),
  devLogin: () => request<{ user: SessionUser }>('/api/auth/dev', { method: 'POST', body: '{}' }),
  logout: () => request<{ ok: true }>('/api/logout', { method: 'POST', body: '{}' }),
  home: () => request<HomePayload>('/api/home'),
  searchGames: (query: string) => request<{ games: GameSummary[] }>(`/api/games/search?q=${encodeURIComponent(query)}`),
  search: (query: string) => request<{ games: GameSummary[]; rules: RuleSearchResult[] }>(`/api/search?q=${encodeURIComponent(query)}`),
  tags: (ids?: string[]) => request<{ tags: TagSummary[] }>(ids?.length ? `/api/tags?ids=${encodeURIComponent(ids.join(','))}` : '/api/tags'),
  adminTags: () => request<{ tags: TagSummary[] }>('/api/admin/tags'),
  createAdminTag: (input: { name: string; description?: string; isPublic?: boolean; aliases?: string[] }) => request<{ ok: true; tagId: string }>('/api/admin/tags', {
    method: 'POST', body: JSON.stringify(input),
  }),
  updateAdminTag: (id: string, input: { name?: string; description?: string; isPublic?: boolean; aliases?: string[] }) => request<{ ok: true }>(`/api/admin/tags/${id}`, {
    method: 'PATCH', body: JSON.stringify(input),
  }),
  game: (identifier: string, fresh = false) => request<{ game: GameDetail }>(
    `/api/games/${encodeURIComponent(identifier)}${fresh ? `?fresh=${encodeURIComponent(crypto.randomUUID())}` : ''}`,
    fresh ? { cache: 'no-store' } : undefined,
  ),
  editorCatalogGames: () => request<{ games: GameSummary[] }>('/api/editor/catalog/games'),
  editorCatalogGame: (identifier: string) => request<{ game: GameDetail }>(`/api/editor/catalog/games/${encodeURIComponent(identifier)}`),
  recordView: (gameId: string, ruleId?: string) => request<{ success: boolean }>(`/api/games/${gameId}/view${ruleId ? `?ruleId=${ruleId}` : ''}`, { method: 'POST', body: '{}' }),
  createGame: (input: { displayName: string; englishName?: string; aliases?: string[] }) => request<{ game: GameSummary }>('/api/games', {
    method: 'POST', body: JSON.stringify(input),
  }),
  patchGame: (id: string, input: { displayName: string; englishName?: string; aliases?: string[] }) => request<{ ok: true }>(`/api/games/${id}`, {
    method: 'PATCH', body: JSON.stringify(input),
  }),
  submit: (input: SubmissionInput) => request<{ submissionId: string; ruleIds?: string[]; reused: boolean }>('/api/submissions', {
    method: 'POST', body: JSON.stringify(input),
  }),
  rule: (id: string) => request<{ rule: import('../shared/types').RuleCard & { gameName: string; gameSlug: string } }>(`/api/rules/${id}`),
  patchRule: (id: string, input: Record<string, unknown>) => request<{ ok: true }>(`/api/rules/${id}`, {
    method: 'PATCH', body: JSON.stringify(input),
  }),
  hideRule: (id: string) => request<{ ok: true }>(`/api/rules/${id}/hide`, { method: 'POST', body: '{}' }),
  restoreRule: (id: string) => request<{ ok: true }>(`/api/rules/${id}/restore`, { method: 'POST', body: '{}' }),
  ruleRevisions: (id: string) => request<{ revisions: RuleRevision[] }>(`/api/rules/${id}/revisions`),
  restoreRevision: (ruleId: string, revisionId: string) => request<{ ok: true }>(`/api/rules/${ruleId}/revisions/${revisionId}/restore`, { method: 'POST', body: '{}' }),
  mergeGame: (id: string, targetGameId: string) => request<{ ok: true }>(`/api/games/${id}/merge`, {
    method: 'POST', body: JSON.stringify({ targetGameId }),
  }),
  editors: () => request<{ users: Array<Record<string, unknown>>; invitations: Array<Record<string, unknown>> }>('/api/admin/editors'),
  inviteEditor: (email: string, role: 'admin' | 'editor') => request<{ ok: true }>('/api/admin/editors/invite', {
    method: 'POST', body: JSON.stringify({ email, role }),
  }),
  revokeEditor: (userId: string, role: 'admin' | 'editor') => request<{ ok: true }>(`/api/admin/editors/${userId}?role=${role}`, { method: 'DELETE', body: '{}' }),
  revokeInvitation: (id: string) => request<{ ok: true }>(`/api/admin/editors/invitations/${id}`, { method: 'DELETE', body: '{}' }),
  importRows: (status = 'pending') => request<{ rows: Array<Record<string, unknown>> }>(`/api/admin/import-rows?status=${status}`),
  confirmImport: (id: string, rules?: string[], gameId?: string) => request<{ ok: true; importedRules: number }>(`/api/admin/import-rows/${id}/confirm`, {
    method: 'POST', body: JSON.stringify({ rules, gameId }),
  }),
  skipImport: (id: string) => request<{ ok: true }>(`/api/admin/import-rows/${id}/skip`, { method: 'POST', body: '{}' }),
  hiddenRules: () => request<{ rules: import('../shared/types').RuleCard[] }>('/api/admin/hidden-rules'),
  reviewBatches: () => request<{ batches: ReviewBatch[] }>('/api/admin/review/batches'),
  reviewProposals: (status = 'pending', batchId = '', limit = 20, cursor = '') =>
    request<{ proposals: ReviewProposal[]; nextCursor: string | null }>(`/api/admin/review/proposals?status=${encodeURIComponent(status)}&batchId=${encodeURIComponent(batchId)}&limit=${limit}&cursor=${encodeURIComponent(cursor)}`),
  importReviewFile: (file: unknown) => request<{ batchId: string; imported: number; pending?: number; conflicts?: number; skipped?: number; reused: boolean }>('/api/admin/review/import', {
    method: 'POST', body: JSON.stringify({ file }),
  }),
  importReviewCsv: (content: string) => request<{ batchId: string; imported: number; pending?: number; conflicts?: number; skipped?: number; reused: boolean }>('/api/admin/review/import', {
    method: 'POST', body: JSON.stringify({ format: 'csv', content }),
  }),
  claimReviewProposal: (id: string) => request<{ ok: true; claimedUntil: number; version: number }>(`/api/admin/review/proposals/${id}/claim`, {
    method: 'POST', body: '{}',
  }),
  decideReviewProposals: (decisions: Array<{ proposalId: string; version: number; decision: 'accept' | 'reject'; proposed?: ReviewContent }>) =>
    request<{ outcomes: Array<{ proposalId: string; status: string }> }>('/api/admin/review/decisions', {
      method: 'POST', body: JSON.stringify({ decisions }),
    }),
};
