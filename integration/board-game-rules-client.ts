export type RulesRole = 'admin' | 'editor';

export interface RulesUser {
  id: string;
  email: string;
  displayName?: string;
  avatarUrl?: string;
  roles: RulesRole[];
}

export interface RulesGameSummary {
  id: string;
  slug: string;
  displayName: string;
  englishName?: string;
  ruleCount: number;
  updatedAt: number;
}

export interface RulesGameDetail extends RulesGameSummary {
  aliases: string[];
  rules: Array<{
    id: string;
    gameId: string;
    statement: string;
    commonMistake?: string;
    details?: string;
    flowStage: string;
    playerCountNote?: string;
    editionNote?: string;
    sourceLabel?: string;
    sourceUrl?: string;
    sourceLinks: Array<{ label?: string; url: string }>;
    tags: Array<{ id: string; slug: string; name: string }>;
    createdAt: number;
    updatedAt: number;
  }>;
}

export interface RulesSubmissionInput {
  gameId: string;
  idempotencyKey: string;
  playedOn?: string;
  sourceLabel?: string;
  sourceUrl?: string;
  privateNote?: string;
  rules: Array<{
    statement: string;
    commonMistake?: string;
    details?: string;
    flowStage?: string;
    playerCountNote?: string;
    editionNote?: string;
    tagNames?: string[];
  }>;
}

export interface RulesClientOptions {
  baseUrl: string;
  getAccessToken?: () => string | undefined;
}

export class BoardGameRulesClient {
  private accessToken?: string;
  private readonly baseUrl: string;
  private readonly externalToken?: () => string | undefined;

  constructor(options: RulesClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.externalToken = options.getAccessToken;
  }

  setAccessToken(token?: string): void {
    this.accessToken = token;
  }

  clearAccessToken(): void {
    this.accessToken = undefined;
  }

  static createIdempotencyKey(): string {
    return crypto.randomUUID();
  }

  async exchangeGoogleCredential(credential: string): Promise<{
    accessToken: string;
    tokenType: 'Bearer';
    expiresAt: number;
    user: RulesUser;
  }> {
    const result = await this.request<{
      accessToken: string;
      tokenType: 'Bearer';
      expiresAt: number;
      user: RulesUser;
    }>('/api/auth/google/exchange', {
      method: 'POST',
      body: JSON.stringify({ credential }),
    });
    this.accessToken = result.accessToken;
    return result;
  }

  session(): Promise<{ user: RulesUser | null }> {
    return this.request('/api/session', {}, true);
  }

  searchGames(query: string): Promise<{ games: RulesGameSummary[] }> {
    return this.request(`/api/games/search?q=${encodeURIComponent(query)}`);
  }

  resolveGame(name: string): Promise<{ game: RulesGameSummary | null; suggestions: RulesGameSummary[] }> {
    return this.request(`/api/games/resolve?name=${encodeURIComponent(name)}`);
  }

  game(identifier: string): Promise<{ game: RulesGameDetail }> {
    return this.request(`/api/games/${encodeURIComponent(identifier)}`);
  }

  submit(input: RulesSubmissionInput): Promise<{ submissionId: string; ruleIds?: string[]; reused: boolean }> {
    return this.request('/api/submissions', {
      method: 'POST',
      body: JSON.stringify(input),
    }, true);
  }

  async logout(): Promise<void> {
    try {
      await this.request('/api/logout', { method: 'POST' }, true);
    } finally {
      this.clearAccessToken();
    }
  }

  private token(): string | undefined {
    return this.externalToken?.() ?? this.accessToken;
  }

  private async request<T>(path: string, init: RequestInit = {}, authenticated = false): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body) headers.set('Content-Type', 'application/json');
    if (authenticated) {
      const token = this.token();
      if (!token) throw new Error('rules_authentication_required');
      headers.set('Authorization', `Bearer ${token}`);
    }
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      mode: 'cors',
      headers,
    });
    const payload = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? `rules_http_${response.status}`);
    return payload;
  }
}
