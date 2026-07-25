import { Hono } from 'hono';
import { z } from 'zod';
import { FLOW_STAGES, type FlowStage, type GameDetail, type GameSummary, type HomePayload, type HomeIDPayload, type ReviewBatch, type ReviewContent as SharedReviewContent, type ReviewProposal, type RuleCard, type UserRole } from '../src/shared/types';
import { exchangeGoogleCredential, requireRole, sessionMiddleware, signInAsLocalAdmin, signInWithGoogle, signOut, type AppContext, type AppVariables } from './auth';
import type { D1PreparedStatement, Env, D1Result } from './env';
import { normalizedReviewContent, REVIEW_FORMAT, REVIEW_SCHEMA_VERSION, reviewContentHash, reviewContentSchema, reviewFileSchema, sameReviewContent, type ReviewContent, type ReviewFile } from './review';
import { parseReviewCsv, serializeReviewCsv } from './review-csv';
import { assertMutationOrigin, cleanOptional, createId, normalizeEmail, normalizeText, now, sha256Hex, slugify, trustedOrigins } from './utils';


interface LoggedQueryContext {
  reqPath: string;
  totalRowsRead: number;
  queries: Array<{ name: string; rowsRead: number }>;
}

const logD1Query = <T extends D1Result<unknown>>(c: AppContext, queryName: string, result: T): T => {
  const meta = result?.meta as Record<string, unknown> | undefined;
  const rowsRead = Number(meta?.rows_read ?? meta?.rowsRead ?? meta?.rows_served ?? 0);
  console.log(`[D1_METRICS] [${c.req.path}] ${queryName}: ${rowsRead} rows_read`);
  
  let ctx = c.get('d1Metrics');
  if (!ctx) {
    ctx = { reqPath: c.req.path, totalRowsRead: 0, queries: [] };
    c.set('d1Metrics', ctx);
  }
  ctx.totalRowsRead += rowsRead;
  ctx.queries.push({ name: queryName, rowsRead });
  c.header('X-D1-Rows-Read', String(ctx.totalRowsRead));
  
  return result;
};

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const isPublicCacheableRequest = (method: string, path: string) => method === 'GET' && (
  ['/api/home', '/api/search', '/api/tags', '/api/games/search', '/api/games/resolve', '/api/export/public'].includes(path)
  || /^\/api\/games\/[^/]+$/.test(path)
);

const setNoCache = (c: AppContext) => {
  c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  c.header('Pragma', 'no-cache');
  c.header('Expires', '0');
};

app.use('/api/*', async (c, next) => {
  const origin = c.req.header('Origin')?.replace(/\/$/, '');
  const isTrusted = origin ? trustedOrigins(c.env, c.req.url).has(origin) : false;
  if (c.req.method === 'OPTIONS') {
    const path = new URL(c.req.url).pathname;
    const publicRead = c.req.header('Access-Control-Request-Method') === 'GET'
      && isPublicCacheableRequest('GET', path);
    if (!origin || (!isTrusted && !publicRead)) return c.json({ error: 'forbidden_origin' }, 403);
    c.header('Access-Control-Allow-Origin', publicRead ? '*' : origin);
    c.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, If-None-Match');
    c.header('Access-Control-Max-Age', '86400');
    c.header('Vary', 'Origin');
    c.header('Cache-Control', 'public, max-age=86400');
    return c.body(null, 204);
  }
  await next();
  const path = new URL(c.req.url).pathname;
  if (isPublicCacheableRequest(c.req.method, path)) {
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Access-Control-Expose-Headers', 'ETag, X-API-Version, X-D1-Rows-Read');
  } else if (origin && isTrusted) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Expose-Headers', 'ETag, X-API-Version, X-D1-Rows-Read');
    c.header('Vary', 'Origin');
  }
});

app.use('/api/*', async (c, next) => {
  const isRead = ['GET', 'HEAD'].includes(c.req.method);
  const limiter = isRead ? c.env.PUBLIC_RATE_LIMITER : c.env.WRITE_RATE_LIMITER;
  const client = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? 'local';
  const scope = isRead ? 'read' : 'write';
  const { success } = await limiter.limit({ key: `${scope}:${client}` });
  if (!success) {
    c.header('Retry-After', '60');
    c.header('Cache-Control', 'no-store');
    return c.json({ error: 'rate_limited' }, 429);
  }
  await next();
});

app.use('/api/*', sessionMiddleware);

app.use('/api/*', async (c, next) => {
  await next();
  const metrics = c.get('d1Metrics');
  if (metrics && c.res) {
    const headers = new Headers(c.res.headers);
    headers.set('X-D1-Rows-Read', String(metrics.totalRowsRead));
    headers.set('X-Robots-Tag', 'noindex, nofollow');
    headers.set('X-API-Version', '1');
    c.res = new Response(c.res.body, {
      status: c.res.status,
      statusText: c.res.statusText,
      headers,
    });
  } else if (c.res) {
    c.header('X-Robots-Tag', 'noindex, nofollow');
    c.header('X-API-Version', '1');
  }
  const path = new URL(c.req.url).pathname;
  if (!isPublicCacheableRequest(c.req.method, path) || c.req.query('fresh') === '1') {
    c.header('Cache-Control', 'no-store');
  }
});

app.onError((error, c) => {
  console.error('api_error', error);
  const message = error instanceof Error ? error.message : '';
  const safeCodes = new Set([
    'google_auth_not_configured', 'invalid_google_identity', 'google_identity_conflict', 'not_found',
    'session_creation_failed', 'game_not_found', 'rule_not_found',
    'unknown_tag', 'tag_not_found',
  ]);
  return c.json({ error: safeCodes.has(message) ? message : 'internal_error' }, 500);
});

app.use('/api/*', async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && !assertMutationOrigin(c)) {
    return c.json({ error: 'forbidden_origin' }, 403);
  }
  await next();
});

app.get('/api/health', (c) => c.json({ ok: true, service: 'wrong-board-game-rules' }));

const ruleSelect = `
  SELECT r.id, r.game_id, r.statement, r.common_mistake, r.details,
    r.flow_stage, r.player_count_note, r.edition_note, r.status,
    r.is_featured, r.created_at, r.updated_at,
    s.source_label, s.source_url,
    (SELECT COALESCE(json_group_array(json_object('label', ss.label, 'url', ss.url)), '[]')
      FROM submission_sources ss WHERE ss.submission_id = s.id ORDER BY ss.position) AS sources_json,
    (SELECT COALESCE(json_group_array(json_object('id', t.id, 'slug', t.slug, 'name', t.name)), '[]')
      FROM rule_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.rule_id = r.id) AS tags_json
  FROM rules r JOIN submissions s ON s.id = r.submission_id
`;

const homeRuleSelect = ruleSelect.replace(
  'FROM rules r',
  ', g.display_name, g.slug FROM rules r',
);

interface RuleRow {
  id: string;
  game_id: string;
  statement: string;
  common_mistake: string | null;
  details: string | null;
  flow_stage: FlowStage;
  player_count_note: string | null;
  edition_note: string | null;
  status: 'draft' | 'published' | 'hidden';
  is_featured: number;
  source_label: string | null;
  source_url: string | null;
  created_at: number;
  updated_at: number;
  tags_json: string | null;
  sources_json: string | null;
}

const toRule = (row: RuleRow): RuleCard => ({
  id: row.id,
  gameId: row.game_id,
  statement: row.statement,
  commonMistake: row.common_mistake ?? undefined,
  details: row.details ?? undefined,
  flowStage: row.flow_stage && row.flow_stage !== 'uncategorized' ? row.flow_stage : undefined,
  playerCountNote: row.player_count_note ?? undefined,
  editionNote: row.edition_note ?? undefined,
  sourceLabel: row.source_label ?? undefined,
  sourceUrl: row.source_url ?? undefined,
  sourceLinks: (() => {
    try {
      const links = JSON.parse(row.sources_json ?? '[]') as RuleCard['sourceLinks'];
      return links.length ? links : (row.source_url ? [{ label: row.source_label ?? undefined, url: row.source_url }] : []);
    } catch { return row.source_url ? [{ label: row.source_label ?? undefined, url: row.source_url }] : []; }
  })(),
  status: row.status,
  isFeatured: Boolean(row.is_featured),
  tags: (() => {
    try { return JSON.parse(row.tags_json ?? '[]') as RuleCard['tags']; } catch { return []; }
  })(),
});

const cleanTagNames = (names: string[] | undefined): string[] => Array.from(new Map((names ?? [])
  .map((name) => name.trim().replace(/^#/, '').slice(0, 40))
  .filter(Boolean)
  .map((name) => [normalizeText(name), name] as const)).values()).slice(0, 8);

const tagWriteStatements = async (c: AppContext, ruleId: string, names: string[], userId: string, timestamp: number, replace = true) => {
  const statements: D1PreparedStatement[] = replace
    ? [c.env.DB.prepare('DELETE FROM rule_tags WHERE rule_id = ?').bind(ruleId)]
    : [];
  const userRoles = c.get('user')?.roles ?? [];
  const canCreate = userRoles.includes('admin') || userRoles.includes('editor');
  for (const name of cleanTagNames(names)) {
    const normalized = normalizeText(name);
    if (!normalized) continue;
    const existing = await c.env.DB.prepare(`
      SELECT t.id FROM tags t LEFT JOIN tag_aliases ta ON ta.tag_id = t.id
      WHERE (t.normalized_name = ? OR ta.normalized_alias = ?) LIMIT 1
    `).bind(normalized, normalized).first<{ id: string }>();
    const suffix = (await sha256Hex(normalized)).slice(0, 20);
    const tagId = existing?.id ?? `tag_${suffix}`;
    if (!existing && !canCreate) throw new Error('unknown_tag');
    if (!existing) {
      statements.push(c.env.DB.prepare(`
        INSERT OR IGNORE INTO tags (id, slug, name, normalized_name, created_by, created_at, updated_at, is_public)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      `).bind(tagId, slugify(name), name, normalized, userId, timestamp, timestamp));
      statements.push(c.env.DB.prepare(`
        INSERT OR IGNORE INTO tag_aliases (id, tag_id, alias, normalized_alias, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(`ta_${suffix}`, tagId, name, normalized, timestamp));
    } else {
      statements.push(c.env.DB.prepare(`
        UPDATE tags SET is_public = 1, updated_at = ? WHERE id = ?
      `).bind(timestamp, tagId));
    }
    statements.push(c.env.DB.prepare(`
      INSERT OR IGNORE INTO rule_tags (rule_id, tag_id, created_by, created_at) VALUES (?, ?, ?, ?)
    `).bind(ruleId, tagId, userId, timestamp));
  }
  return statements;
};

interface GameRow {
  id: string;
  slug: string;
  display_name: string;
  english_name: string | null;
  aliases_str?: string | null;
  rule_count: number;
  updated_at: number;
}

const toGame = (row: GameRow): GameSummary => ({
  id: row.id,
  slug: row.slug,
  displayName: row.display_name,
  englishName: row.english_name ?? undefined,
  aliases: row.aliases_str ? row.aliases_str.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
  ruleCount: row.rule_count,
  updatedAt: row.updated_at,
});

interface ReviewRuleRow {
  id: string;
  submission_id: string;
  game_id: string;
  game_name: string;
  game_slug: string;
  statement: string;
  common_mistake: string | null;
  details: string | null;
  flow_stage: FlowStage;
  player_count_note: string | null;
  edition_note: string | null;
  source_label: string | null;
  source_url: string | null;
  updated_at: number;
  tags_json: string | null;
}

const reviewContentFromRow = (row: ReviewRuleRow): ReviewContent => normalizedReviewContent({
  statement: row.statement,
  commonMistake: row.common_mistake,
  details: row.details,
  flowStage: row.flow_stage,
  playerCountNote: row.player_count_note,
  editionNote: row.edition_note,
  sourceLabel: row.source_label,
  sourceUrl: row.source_url,
  tagNames: (() => {
    try {
      return (JSON.parse(row.tags_json ?? '[]') as Array<{ name: string }>).map((tag) => tag.name);
    } catch { return []; }
  })(),
});

const reviewRuleSelect = `
  SELECT r.id, r.submission_id, r.game_id, g.display_name game_name, g.slug game_slug,
    r.statement, r.common_mistake, r.details, r.flow_stage, r.player_count_note,
    r.edition_note, r.updated_at, s.source_label, s.source_url,
    (SELECT COALESCE(json_group_array(json_object('name', t.name)), '[]')
      FROM rule_tags rt JOIN tags t ON t.id = rt.tag_id
      WHERE rt.rule_id = r.id) AS tags_json
  FROM rules r
  JOIN games g ON g.id = r.game_id
  JOIN submissions s ON s.id = r.submission_id
`;

app.get('/api/session', (c) => c.json({
  user: c.get('user') ?? null,
  googleClientId: c.env.GOOGLE_CLIENT_ID ?? null,
  localDevLogin: ['localhost', '127.0.0.1'].includes(new URL(c.req.url).hostname),
}));

app.post('/api/auth/google', async (c) => {
  const body = await c.req.json<{ credential?: unknown }>();
  if (typeof body.credential !== 'string' || body.credential.length > 10_000) {
    return c.json({ error: 'invalid_credential' }, 400);
  }
  const user = await signInWithGoogle(c, body.credential);
  return c.json({ user });
});

app.post('/api/auth/google/exchange', async (c) => {
  const origin = c.req.header('Origin')?.replace(/\/$/, '');
  if (!origin || !trustedOrigins(c.env, c.req.url).has(origin)) {
    return c.json({ error: 'forbidden_origin' }, 403);
  }
  const body = await c.req.json<{ credential?: unknown }>();
  if (typeof body.credential !== 'string' || body.credential.length > 10_000) {
    return c.json({ error: 'invalid_credential' }, 400);
  }
  const session = await exchangeGoogleCredential(c, body.credential);
  return c.json({ ...session, tokenType: 'Bearer' as const });
});

app.post('/api/auth/dev', async (c) => {
  const user = await signInAsLocalAdmin(c);
  return c.json({ user });
});

app.post('/api/logout', async (c) => {
  await signOut(c);
  return c.json({ ok: true });
});

app.get('/api/home', async (c) => {
  const d1Logs: Array<{ name: string; rowsRead: number; meta: unknown }> = [];
  const track = <T extends D1Result<unknown>>(name: string, res: T): T => {
    const rowsRead = Number(res.meta?.rows_read ?? (res.meta as any)?.rowsRead ?? 0);
    d1Logs.push({ name, rowsRead, meta: res.meta });
    return res;
  };

  const windowResult = track('home:window-start', await c.env.DB.prepare(`
    WITH recent_games AS (
      SELECT game_id, MIN(view_date) as min_date, MAX(created_at) as last_seen
      FROM daily_views
      WHERE view_date >= DATE('now', '-30 days')
      GROUP BY game_id
      ORDER BY last_seen DESC
      LIMIT 6
    )
    SELECT MIN(min_date) as window_start FROM recent_games;
  `).all<{ window_start: string | null }>());

  const windowRow = windowResult.results?.[0];
  let startDateStr = '';
  if (windowRow && windowRow.window_start) {
    startDateStr = new Date(new Date(windowRow.window_start).getTime() - 7 * 86400000).toISOString().slice(0, 10);
  }
  const viewDateCondition = startDateStr ? `view_date >= '${startDateStr}'` : `view_date >= DATE('now', '-7 days')`;

  // 2. 統計階段 (100% 只查 daily_views，加上 LIMIT 100 硬上限熔斷保護)
  const [popularGameIdsRaw, recentRaw] = await Promise.all([
    c.env.DB.prepare(`
      WITH scoped_views AS (
        SELECT game_id, user_id, created_at
        FROM daily_views
        WHERE ${viewDateCondition}
        ORDER BY created_at DESC
        LIMIT 100
      )
      SELECT game_id, COUNT(DISTINCT user_id) AS view_count
      FROM scoped_views
      GROUP BY game_id
      ORDER BY view_count DESC, MAX(created_at) DESC
      LIMIT 6
    `).all<{ game_id: string }>(),
    c.env.DB.prepare(`
      SELECT id FROM rules
      WHERE status = 'published'
      ORDER BY created_at DESC LIMIT 6
    `).all<{ id: string }>(),
  ]);

  const popularGameIdsResult = track('home:popular-games', popularGameIdsRaw);
  const recentResult = track('home:recent-rules', recentRaw);

  let popularGameIds = (popularGameIdsResult.results ?? []).map((r) => r.game_id);

  if (popularGameIds.length < 6) {
    const fallbackGameIdsResult = track('home:fallback-games', await c.env.DB.prepare(`
      SELECT g.id FROM games g
      WHERE g.merged_into_game_id IS NULL
      ORDER BY g.updated_at DESC LIMIT 6
    `).all<{ id: string }>());
    const extraIds = (fallbackGameIdsResult.results ?? []).map((g) => g.id);
    popularGameIds = Array.from(new Set([...popularGameIds, ...extraIds])).slice(0, 6);
  }

  if (popularGameIds.length === 0) {
    setNoCache(c);
    return c.json({ generatedAt: now(), featured: [], featuredRules: [], recentRules: [], popularGames: [], debugD1Metrics: d1Logs });
  }

  // 3. 點對點極速解析內容 (WHERE id IN)
  const placeholders = popularGameIds.map(() => '?').join(',');

  const gamesResult = track('home:games-meta', await c.env.DB.prepare(`
    SELECT g.id, g.slug, g.display_name, g.english_name, g.updated_at,
      0 AS rule_count
    FROM games g
    WHERE g.id IN (${placeholders}) AND g.merged_into_game_id IS NULL
  `).bind(...popularGameIds).all<GameRow>());

  const gameMap = new Map((gamesResult.results ?? []).map((g) => [g.id, toGame(g)]));

  const featuredRuleIdsResult = track('home:featured-rule-ids', await c.env.DB.prepare(`
    WITH scoped_views AS (
      SELECT game_id, rule_id, user_id, created_at
      FROM daily_views
      WHERE game_id IN (${placeholders}) AND rule_id != '' AND ${viewDateCondition}
      ORDER BY created_at DESC
      LIMIT 100
    )
    SELECT game_id, rule_id, COUNT(DISTINCT user_id) AS view_count
    FROM scoped_views
    GROUP BY game_id, rule_id
    ORDER BY view_count DESC, MAX(created_at) DESC
  `).bind(...popularGameIds).all<{ game_id: string; rule_id: string }>());

  const featuredRuleIdByGame = new Map<string, string>();
  (featuredRuleIdsResult.results ?? []).forEach((row) => {
    if (!featuredRuleIdByGame.has(row.game_id)) {
      featuredRuleIdByGame.set(row.game_id, row.rule_id);
    }
  });

  const recentRuleIds = (recentResult.results ?? []).map((r) => r.id);
  const featuredPromises = popularGameIds.map(async (id) => {
    let ruleId = featuredRuleIdByGame.get(id);
    if (!ruleId) {
      const fallback = track('home:fallback-rule-id', await c.env.DB.prepare(`
        SELECT id FROM rules
        WHERE game_id = ? AND status = 'published'
        ORDER BY is_featured DESC, created_at DESC
        LIMIT 1
      `).bind(id).all<{ id: string }>());
      ruleId = fallback.results?.[0]?.id ?? '';
    }
    return {
      gameSlug: gameMap.get(id)?.slug ?? '',
      gameName: gameMap.get(id)?.displayName ?? '',
      ruleId,
    };
  });

  const featured = await Promise.all(featuredPromises);
  const featuredRuleIds = featured.map((f) => f.ruleId).filter(Boolean);

  setNoCache(c);
  return c.json({
    generatedAt: now(),
    popularGameIds,
    recentRuleIds,
    featuredRuleIds,
    featured,
    debugD1Metrics: d1Logs,
  });
});

app.get('/api/rules/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(`
    SELECT r.id, r.game_id, g.display_name game_name, g.slug game_slug,
      r.statement, r.common_mistake, r.details, r.flow_stage,
      r.player_count_note, r.edition_note, r.status, r.is_featured, r.created_at, r.updated_at
    FROM rules r
    JOIN games g ON g.id = r.game_id
    WHERE r.id = ? AND r.status = 'published'
    LIMIT 1
  `).bind(id).first<RuleRow & { game_name: string; game_slug: string }>();

  if (!row) return c.json({ error: 'rule_not_found' }, 404);
  setNoCache(c);
  return c.json({ rule: { ...toRule(row), gameName: row.game_name, gameSlug: row.game_slug } });
});

app.get('/api/games/search', async (c) => {
  const rawQuery = (c.req.query('q') ?? '').trim().slice(0, 100);
  if (rawQuery.length < 1) return c.json({ games: [] });
  const query = normalizeText(rawQuery);
  const result = await c.env.DB.prepare(`
    SELECT g.id, g.slug, g.display_name, g.english_name, g.updated_at,
      GROUP_CONCAT(DISTINCT a.alias) AS aliases_str
    FROM games g
    LEFT JOIN game_aliases a ON a.game_id = g.id
    WHERE g.merged_into_game_id IS NULL
      AND (g.normalized_name LIKE ? OR LOWER(g.english_name) LIKE ? OR a.normalized_alias LIKE ?)
    GROUP BY g.id
    ORDER BY CASE WHEN g.normalized_name = ? THEN 0 ELSE 1 END,
      g.display_name
    LIMIT 20
  `).bind(`%${query}%`, `%${query}%`, `%${query}%`, query).all<GameRow>();
  setNoCache(c);
  return c.json({ games: (result.results ?? []).map(toGame) });
});

app.get('/api/games/resolve', async (c) => {
  const rawName = (c.req.query('name') ?? '').trim().slice(0, 120);
  if (!rawName) return c.json({ game: null, suggestions: [] });
  const name = normalizeText(rawName);
  const exact = await c.env.DB.prepare(`
    SELECT g.id, g.slug, g.display_name, g.english_name, g.updated_at,
      0 AS rule_count,
      GROUP_CONCAT(DISTINCT a.alias) AS aliases_str
    FROM games g
    LEFT JOIN game_aliases a ON a.game_id = g.id
    WHERE g.merged_into_game_id IS NULL
      AND (g.normalized_name = ? OR a.normalized_alias = ?)
    GROUP BY g.id
    LIMIT 1
  `).bind(name, name).first<GameRow>();
  if (exact) {
    setNoCache(c);
    return c.json({ game: toGame(exact), suggestions: [] });
  }
  const result = await c.env.DB.prepare(`
    SELECT g.id, g.slug, g.display_name, g.english_name, g.updated_at,
      0 AS rule_count,
      GROUP_CONCAT(DISTINCT a.alias) AS aliases_str
    FROM games g
    LEFT JOIN game_aliases a ON a.game_id = g.id
    WHERE g.merged_into_game_id IS NULL
      AND (g.normalized_name LIKE ? OR a.normalized_alias LIKE ?)
    GROUP BY g.id
    ORDER BY g.display_name
    LIMIT 5
  `).bind(`%${name}%`, `%${name}%`).all<GameRow>();
  setNoCache(c);
  return c.json({ game: null, suggestions: (result.results ?? []).map(toGame) });
});

app.get('/api/search', async (c) => {
  const rawQuery = (c.req.query('q') ?? '').trim().slice(0, 100);
  if (!rawQuery) return c.json({ games: [], rules: [] });
  const query = normalizeText(rawQuery);
  const result = await c.env.DB.prepare(`
    SELECT g.id, g.slug, g.display_name, g.english_name, g.updated_at,
      GROUP_CONCAT(DISTINCT a.alias) AS aliases_str
    FROM games g LEFT JOIN game_aliases a ON a.game_id = g.id
    WHERE g.merged_into_game_id IS NULL AND (g.normalized_name LIKE ? OR LOWER(g.english_name) LIKE ? OR a.normalized_alias LIKE ?)
    GROUP BY g.id ORDER BY CASE WHEN g.normalized_name = ? THEN 0 ELSE 1 END, g.display_name LIMIT 8
  `).bind(`%${query}%`, `%${query}%`, `%${query}%`, query).all<GameRow>();
  setNoCache(c);
  return c.json({
    games: (result.results ?? []).map(toGame),
    rules: [],
  });
});

app.get('/api/tags', async (c) => {
  const rawQuery = (c.req.query('q') ?? '').trim().slice(0, 100);
  const gameId = (c.req.query('gameId') ?? '').trim();
  const query = normalizeText(rawQuery);

  let sql = `
    SELECT t.id, t.slug, t.name, t.is_public, COUNT(DISTINCT rt.rule_id) AS usage_count
    FROM tags t
    LEFT JOIN tag_aliases ta ON ta.tag_id = t.id
    LEFT JOIN rule_tags rt ON rt.tag_id = t.id
  `;
  const conditions = ["t.status = 'active'"];
  const params: unknown[] = [];

  if (query) {
    conditions.push('(t.normalized_name LIKE ? OR ta.normalized_alias LIKE ?)');
    params.push(`%${query}%`, `%${query}%`);
  }

  if (gameId) {
    conditions.push('(t.is_public = 1 OR rt.rule_id IN (SELECT id FROM rules WHERE game_id = ?))');
    params.push(gameId);
  }

  sql += ` GROUP BY t.id ORDER BY usage_count DESC, t.name LIMIT 20`;

  const result = await c.env.DB.prepare(sql).bind(...params).all<{ id: string; slug: string; name: string; is_public: number; usage_count: number }>();
  setNoCache(c);
  return c.json({
    tags: (result.results ?? []).map((tag) => ({
      id: tag.id,
      slug: tag.slug,
      name: tag.name,
      isPublic: Boolean(tag.is_public),
      usageCount: tag.usage_count,
    })),
  });
});

app.post('/api/games/:id/view', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const game = await c.env.DB.prepare('SELECT id FROM games WHERE id = ?').bind(c.req.param('id')).first();
  if (!game) return c.json({ error: 'game_not_found' }, 404);

  const ruleId = c.req.query('ruleId') || null;
  if (ruleId) {
    const rule = await c.env.DB.prepare('SELECT id FROM rules WHERE id = ? AND game_id = ?').bind(ruleId, game.id).first();
    if (!rule) return c.json({ error: 'rule_not_found' }, 404);
  }

  const timestamp = now();
  const viewDate = new Date(timestamp).toISOString().slice(0, 10);
  await c.env.DB.prepare(`
    INSERT INTO daily_views (game_id, rule_id, user_id, view_date, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(game_id, rule_id, user_id, view_date) DO NOTHING
  `).bind(game.id, ruleId ?? '', user.id, viewDate, timestamp).run();
  return c.json({ success: true });
});

app.get('/api/games/:identifier', async (c) => {
  const identifier = c.req.param('identifier');
  const game = await c.env.DB.prepare(`
    SELECT g.id, g.slug, g.display_name, g.english_name, g.updated_at,
      0 AS rule_count
    FROM games g
    WHERE (g.id = ? OR g.slug = ?) AND g.merged_into_game_id IS NULL
    LIMIT 1
  `).bind(identifier, identifier).first<GameRow>();
  if (!game) return c.json({ error: 'game_not_found' }, 404);

  setNoCache(c);

  const [aliasesResult, rulesResult] = await Promise.all([
    c.env.DB.prepare('SELECT alias FROM game_aliases WHERE game_id = ? ORDER BY alias')
      .bind(game.id).all<{ alias: string }>(),
    c.env.DB.prepare(`${ruleSelect}
      WHERE r.game_id = ? AND r.status = 'published'
      ORDER BY CASE r.flow_stage
        WHEN 'setup' THEN 1 WHEN 'round' THEN 2 WHEN 'action' THEN 3
        WHEN 'always' THEN 4 WHEN 'end_scoring' THEN 5
        WHEN 'edition_player_count' THEN 6 ELSE 7 END,
        r.created_at DESC
    `).bind(game.id).all<RuleRow>(),
  ]);
  const detail: GameDetail = {
    ...toGame(game),
    ruleCount: rulesResult.results?.length ?? 0,
    aliases: (aliasesResult.results ?? []).map((row) => row.alias),
    rules: (rulesResult.results ?? []).map(toRule),
  };
  setNoCache(c);
  return c.json({ game: detail });
});

app.get('/api/export/public', requireRole('editor'), async (c) => {
  const metadata = await c.env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM games WHERE merged_into_game_id IS NULL) AS game_count,
      (SELECT COUNT(*) FROM rules WHERE status = 'published') AS rule_count,
      (SELECT COUNT(*) FROM tags WHERE status = 'active') AS tag_count,
      COALESCE((SELECT MAX(updated_at) FROM games WHERE merged_into_game_id IS NULL), 0) AS games_updated_at,
      COALESCE((SELECT MAX(updated_at) FROM rules WHERE status = 'published'), 0) AS rules_updated_at,
      COALESCE((SELECT MAX(updated_at) FROM tags WHERE status = 'active'), 0) AS tags_updated_at
  `).first<{
    game_count: number;
    rule_count: number;
    tag_count: number;
    games_updated_at: number;
    rules_updated_at: number;
    tags_updated_at: number;
  }>();
  const values = metadata ?? {
    game_count: 0, rule_count: 0, tag_count: 0,
    games_updated_at: 0, rules_updated_at: 0, tags_updated_at: 0,
  };
  const updatedAt = Math.max(values.games_updated_at, values.rules_updated_at, values.tags_updated_at);
  const datasetVersion = `v1-${updatedAt}-${values.game_count}-${values.rule_count}-${values.tag_count}`;
  const etag = `W/"${datasetVersion}"`;
  c.header('ETag', etag);
  setNoCache(c);
  c.header('Content-Disposition', 'attachment; filename="wrong-board-game-rules-public-v1.json"');
  if (c.req.header('If-None-Match') === etag) return c.body(null, 304);

  const [gamesResult, aliasesResult, rulesResult] = await Promise.all([
    c.env.DB.prepare(`
      SELECT g.id, g.slug, g.display_name, g.english_name, g.updated_at,
        COUNT(r.id) AS rule_count
      FROM games g
      LEFT JOIN rules r ON r.game_id = g.id AND r.status = 'published'
      WHERE g.merged_into_game_id IS NULL
      GROUP BY g.id
      ORDER BY g.display_name, g.id
    `).all<GameRow>(),
    c.env.DB.prepare(`
      SELECT a.game_id, a.alias
      FROM game_aliases a JOIN games g ON g.id = a.game_id
      WHERE g.merged_into_game_id IS NULL
      ORDER BY a.game_id, a.alias
    `).all<{ game_id: string; alias: string }>(),
    c.env.DB.prepare(`${ruleSelect}
      JOIN games g ON g.id = r.game_id
      WHERE r.status = 'published' AND g.merged_into_game_id IS NULL
      ORDER BY r.game_id, r.created_at, r.id
    `).all<RuleRow>(),
  ]);
  const aliasesByGame = new Map<string, string[]>();
  for (const alias of aliasesResult.results ?? []) {
    const aliases = aliasesByGame.get(alias.game_id) ?? [];
    aliases.push(alias.alias);
    aliasesByGame.set(alias.game_id, aliases);
  }
  const rulesByGame = new Map<string, RuleCard[]>();
  for (const row of rulesResult.results ?? []) {
    const rules = rulesByGame.get(row.game_id) ?? [];
    rules.push(toRule(row));
    rulesByGame.set(row.game_id, rules);
  }
  return c.json({
    schemaVersion: 1,
    datasetVersion,
    updatedAt,
    counts: {
      games: values.game_count,
      rules: values.rule_count,
      tags: values.tag_count,
    },
    games: (gamesResult.results ?? []).map((game) => ({
      ...toGame(game),
      aliases: aliasesByGame.get(game.id) ?? [],
      rules: rulesByGame.get(game.id) ?? [],
    })),
  });
});

const gameSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  englishName: z.string().trim().max(120).optional(),
  aliases: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
});

app.post('/api/games', requireRole('editor'), async (c) => {
  const parsed = gameSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid_game', issues: parsed.error.issues }, 400);
  const normalizedName = normalizeText(parsed.data.displayName);
  const existing = await c.env.DB.prepare(`
    SELECT g.id, g.slug, g.display_name, g.english_name, g.updated_at,
      COUNT(DISTINCT r.id) AS rule_count
    FROM games g
    LEFT JOIN game_aliases a ON a.game_id = g.id
    LEFT JOIN rules r ON r.game_id = g.id AND r.status = 'published'
    WHERE g.merged_into_game_id IS NULL
      AND (g.normalized_name = ? OR a.normalized_alias = ?)
    GROUP BY g.id
    LIMIT 1
  `).bind(normalizedName, normalizedName).first<GameRow>();
  if (existing) return c.json({ game: toGame(existing), reused: true });
  const user = c.get('user')!;
  const id = createId('game');
  const timestamp = now();
  const baseSlug = slugify(parsed.data.englishName || parsed.data.displayName);
  const slugExists = await c.env.DB.prepare('SELECT 1 found FROM games WHERE slug = ?').bind(baseSlug).first();
  const slug = slugExists ? `${baseSlug}-${id.slice(-6)}` : baseSlug;
  const aliases = new Set([
    parsed.data.displayName,
    parsed.data.englishName,
    ...(parsed.data.aliases ?? []),
  ].filter((value): value is string => Boolean(value?.trim())));
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(`
      INSERT INTO games (id, slug, display_name, english_name, normalized_name, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, slug, parsed.data.displayName, parsed.data.englishName ?? null, normalizedName, user.id, timestamp, timestamp),
  ];
  for (const alias of aliases) {
    statements.push(c.env.DB.prepare(`
      INSERT INTO game_aliases (id, game_id, alias, normalized_alias, alias_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(createId('alias'), id, alias, normalizeText(alias), alias === parsed.data.displayName ? 'official' : 'alias', timestamp));
  }
  await c.env.DB.batch(statements);
  return c.json({ game: { id, slug, displayName: parsed.data.displayName, englishName: parsed.data.englishName, ruleCount: 0, updatedAt: timestamp } }, 201);
});

app.patch('/api/games/:id', requireRole('editor'), async (c) => {
  const parsed = gameSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid_game', issues: parsed.error.issues }, 400);
  const game = await c.env.DB.prepare('SELECT id, slug FROM games WHERE id = ? AND merged_into_game_id IS NULL')
    .bind(c.req.param('id')).first<{ id: string; slug: string }>();
  if (!game) return c.json({ error: 'game_not_found' }, 404);
  const timestamp = now();
  const aliases = new Set([parsed.data.displayName, parsed.data.englishName, ...(parsed.data.aliases ?? [])]
    .filter((value): value is string => Boolean(value?.trim())));
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(`
      UPDATE games SET display_name = ?, english_name = ?, normalized_name = ?, updated_at = ? WHERE id = ?
    `).bind(parsed.data.displayName, cleanOptional(parsed.data.englishName, 120) ?? null, normalizeText(parsed.data.displayName), timestamp, c.req.param('id')),
    c.env.DB.prepare('DELETE FROM game_aliases WHERE game_id = ?').bind(c.req.param('id')),
  ];
  for (const alias of aliases) {
    statements.push(c.env.DB.prepare(`
      INSERT INTO game_aliases (id, game_id, alias, normalized_alias, alias_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(createId('alias'), c.req.param('id'), alias, normalizeText(alias), alias === parsed.data.displayName ? 'official' : 'alias', timestamp));
  }
  await c.env.DB.batch(statements);
  const cache = (caches as any).default;
  c.executionCtx.waitUntil(Promise.all([
    cache.delete(new Request(new URL(`/api/games/${game.slug}`, c.req.url))),
    cache.delete(new Request(new URL('/api/home', c.req.url))),
  ]));
  return c.json({ ok: true });
});

const submissionSchema = z.object({
  gameId: z.string().min(1).max(100),
  playedOn: z.string().max(20).optional(),
  sourceLabel: z.string().trim().max(300).optional(),
  sourceUrl: z.url().max(2000).optional().or(z.literal('')),
  privateNote: z.string().trim().max(2000).optional(),
  idempotencyKey: z.string().min(8).max(120),
  rules: z.array(z.object({
    statement: z.string().trim().min(1).max(2000),
    commonMistake: z.string().trim().max(2000).optional(),
    details: z.string().trim().max(5000).optional(),
    flowStage: z.enum(FLOW_STAGES).optional(),
    playerCountNote: z.string().trim().max(300).optional(),
    editionNote: z.string().trim().max(300).optional(),
    tagNames: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
  })).min(1).max(20),
});

app.post('/api/submissions', requireRole('editor'), async (c) => {
  const contentLength = Number(c.req.header('content-length') ?? 0);
  if (contentLength > 64 * 1024) return c.json({ error: 'request_too_large' }, 413);
  const parsed = submissionSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid_submission', issues: parsed.error.issues }, 400);
  const user = c.get('user')!;
  const existing = await c.env.DB.prepare(`
    SELECT id FROM submissions WHERE author_id = ? AND idempotency_key = ?
  `).bind(user.id, parsed.data.idempotencyKey).first<{ id: string }>();
  if (existing) return c.json({ submissionId: existing.id, reused: true });
  const game = await c.env.DB.prepare('SELECT id FROM games WHERE id = ? AND merged_into_game_id IS NULL')
    .bind(parsed.data.gameId).first();
  if (!game) return c.json({ error: 'game_not_found' }, 404);
  const submissionId = createId('sub');
  const timestamp = now();
  const ruleIds: string[] = [];
  const statements: D1PreparedStatement[] = [c.env.DB.prepare(`
    INSERT INTO submissions (
      id, game_id, author_id, idempotency_key, played_on, source_label,
      source_url, private_note, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    submissionId, parsed.data.gameId, user.id, parsed.data.idempotencyKey,
    cleanOptional(parsed.data.playedOn, 20) ?? null,
    cleanOptional(parsed.data.sourceLabel, 300) ?? null,
    cleanOptional(parsed.data.sourceUrl, 2000) ?? null,
    cleanOptional(parsed.data.privateNote, 2000) ?? null,
    timestamp,
  )];
  if (parsed.data.sourceUrl) {
    statements.push(c.env.DB.prepare(`
      INSERT INTO submission_sources (id, submission_id, label, url, position, created_at)
      VALUES (?, ?, ?, ?, 0, ?)
    `).bind(createId('source'), submissionId, cleanOptional(parsed.data.sourceLabel, 300) ?? null, parsed.data.sourceUrl, timestamp));
  }
  for (const input of parsed.data.rules) {
    const ruleId = createId('rule');
    ruleIds.push(ruleId);
    statements.push(c.env.DB.prepare(`
      INSERT INTO rules (
        id, submission_id, game_id, statement, common_mistake, details,
        flow_stage, player_count_note, edition_note, status, created_by,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?)
    `).bind(
      ruleId, submissionId, parsed.data.gameId, input.statement,
      cleanOptional(input.commonMistake, 2000) ?? null,
      cleanOptional(input.details, 5000) ?? null,
      input.flowStage ?? 'uncategorized',
      cleanOptional(input.playerCountNote, 300) ?? null,
      cleanOptional(input.editionNote, 300) ?? null,
      user.id, timestamp, timestamp,
    ));
    statements.push(...await tagWriteStatements(c, ruleId, input.tagNames ?? [], user.id, timestamp, false));
  }
  statements.push(c.env.DB.prepare('UPDATE games SET updated_at = ? WHERE id = ?').bind(timestamp, parsed.data.gameId));
  await c.env.DB.batch(statements);
  return c.json({ submissionId, ruleIds, reused: false }, 201);
});

const rulePatchSchema = z.object({
  statement: z.string().trim().min(1).max(2000).optional(),
  commonMistake: z.string().trim().max(2000).nullable().optional(),
  details: z.string().trim().max(5000).nullable().optional(),
  flowStage: z.enum(FLOW_STAGES).optional(),
  playerCountNote: z.string().trim().max(300).nullable().optional(),
  editionNote: z.string().trim().max(300).nullable().optional(),
  isFeatured: z.boolean().optional(),
  featuredOrder: z.number().int().min(0).max(9999).nullable().optional(),
  reason: z.string().trim().max(300).optional(),
  tagNames: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
  sourceLabel: z.string().trim().max(300).nullable().optional(),
  sourceUrl: z.url().max(2000).nullable().optional().or(z.literal('')),
});

app.patch('/api/rules/:id', requireRole('editor'), async (c) => {
  const parsed = rulePatchSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid_rule', issues: parsed.error.issues }, 400);
  const row = await c.env.DB.prepare(`SELECT r.*, s.source_label, s.source_url FROM rules r JOIN submissions s ON s.id = r.submission_id WHERE r.id = ?`)
    .bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!row) return c.json({ error: 'rule_not_found' }, 404);
  const existingTags = await c.env.DB.prepare(`SELECT t.name FROM rule_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.rule_id = ? ORDER BY t.name`)
    .bind(c.req.param('id')).all<{ name: string }>();
  const user = c.get('user')!;
  const timestamp = now();
  const updated = {
    statement: parsed.data.statement ?? row.statement,
    commonMistake: parsed.data.commonMistake === undefined ? row.common_mistake : parsed.data.commonMistake,
    details: parsed.data.details === undefined ? row.details : parsed.data.details,
    flowStage: parsed.data.flowStage ?? row.flow_stage,
    playerCountNote: parsed.data.playerCountNote === undefined ? row.player_count_note : parsed.data.playerCountNote,
    editionNote: parsed.data.editionNote === undefined ? row.edition_note : parsed.data.editionNote,
    isFeatured: parsed.data.isFeatured === undefined ? row.is_featured : (parsed.data.isFeatured ? 1 : 0),
    featuredOrder: parsed.data.featuredOrder === undefined ? row.featured_order : parsed.data.featuredOrder,
  };
  await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO rule_revisions (id, rule_id, previous_json, edited_by, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(createId('rev'), c.req.param('id'), JSON.stringify({ ...row, tag_names: (existingTags.results ?? []).map((tag) => tag.name) }), user.id, parsed.data.reason ?? 'edit', timestamp),
    c.env.DB.prepare(`
      UPDATE rules SET statement = ?, common_mistake = ?, details = ?, flow_stage = ?,
        player_count_note = ?, edition_note = ?, is_featured = ?, featured_order = ?,
        updated_at = ? WHERE id = ?
    `).bind(
      updated.statement, updated.commonMistake, updated.details, updated.flowStage,
      updated.playerCountNote, updated.editionNote, updated.isFeatured,
      updated.featuredOrder, timestamp, c.req.param('id'),
    ),
    ...(parsed.data.sourceLabel === undefined && parsed.data.sourceUrl === undefined ? [] : [c.env.DB.prepare(`
      UPDATE submissions SET source_label = ?, source_url = ? WHERE id = ?
    `).bind(
      parsed.data.sourceLabel === undefined ? row.source_label : parsed.data.sourceLabel,
      parsed.data.sourceUrl === undefined ? row.source_url : (parsed.data.sourceUrl || null),
      row.submission_id,
    ), c.env.DB.prepare('DELETE FROM submission_sources WHERE submission_id = ?').bind(row.submission_id),
    ...(parsed.data.sourceUrl ? [c.env.DB.prepare(`INSERT INTO submission_sources (id, submission_id, label, url, position, created_at) VALUES (?, ?, ?, ?, 0, ?)`)
      .bind(createId('source'), row.submission_id, parsed.data.sourceLabel === undefined ? row.source_label : parsed.data.sourceLabel, parsed.data.sourceUrl, timestamp)] : [])]),
    ...(parsed.data.tagNames === undefined ? [] : await tagWriteStatements(c, c.req.param('id'), parsed.data.tagNames, user.id, timestamp)),
    c.env.DB.prepare('UPDATE games SET updated_at = ? WHERE id = ?').bind(timestamp, row.game_id as string),
  ]);
  const cache = (caches as any).default;
  const gameSlug = await c.env.DB.prepare('SELECT g.slug FROM games g JOIN rules r ON r.game_id = g.id WHERE r.id = ?').bind(c.req.param('id')).first<{ slug: string }>();
  if (gameSlug) {
    c.executionCtx.waitUntil(Promise.all([
      cache.delete(new Request(new URL(`/api/games/${gameSlug.slug}`, c.req.url))),
      cache.delete(new Request(new URL('/api/home', c.req.url))),
    ]));
  }
  return c.json({ ok: true, updatedAt: timestamp });
});

const changeRuleVisibility = async (c: AppContext, status: 'hidden' | 'published') => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT * FROM rules WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!row) return c.json({ error: 'rule_not_found' }, 404);
  const user = c.get('user')!;
  const timestamp = now();
  await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO rule_revisions (id, rule_id, previous_json, edited_by, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(createId('rev'), id, JSON.stringify(row), user.id, status === 'hidden' ? 'hide' : 'restore', timestamp),
    c.env.DB.prepare(`
      UPDATE rules SET status = ?, hidden_at = ?, hidden_by = ?, updated_at = ? WHERE id = ?
    `).bind(status, status === 'hidden' ? timestamp : null, status === 'hidden' ? user.id : null, timestamp, id),
  ]);
  const cache = (caches as any).default;
  const gameSlug = await c.env.DB.prepare('SELECT g.slug FROM games g JOIN rules r ON r.game_id = g.id WHERE r.id = ?').bind(id).first<{ slug: string }>();
  if (gameSlug) {
    c.executionCtx.waitUntil(Promise.all([
      cache.delete(new Request(new URL(`/api/games/${gameSlug.slug}`, c.req.url))),
      cache.delete(new Request(new URL('/api/home', c.req.url))),
    ]));
  }
  return c.json({ ok: true });
};

app.post('/api/rules/:id/hide', requireRole('editor'), (c) => changeRuleVisibility(c, 'hidden'));
app.post('/api/rules/:id/restore', requireRole('editor'), (c) => changeRuleVisibility(c, 'published'));

app.get('/api/rules/:id/revisions', requireRole('editor'), async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT rr.id, rr.previous_json, rr.reason, rr.created_at, u.email editor_email
    FROM rule_revisions rr LEFT JOIN users u ON u.id = rr.edited_by
    WHERE rr.rule_id = ? ORDER BY rr.created_at DESC LIMIT 30
  `).bind(c.req.param('id')).all<{ id: string; previous_json: string; reason: string | null; created_at: number; editor_email: string | null }>();
  return c.json({ revisions: (result.results ?? []).map((row) => {
    let previousStatement = '先前版本';
    try { previousStatement = String((JSON.parse(row.previous_json) as Record<string, unknown>).statement ?? previousStatement); } catch { /* retain fallback */ }
    return { id: row.id, reason: row.reason ?? 'edit', createdAt: row.created_at, editorEmail: row.editor_email ?? undefined, previousStatement };
  }) });
});

app.post('/api/rules/:id/revisions/:revisionId/restore', requireRole('editor'), async (c) => {
  const [current, revision] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM rules WHERE id = ?').bind(c.req.param('id')).first<Record<string, unknown>>(),
    c.env.DB.prepare('SELECT previous_json FROM rule_revisions WHERE id = ? AND rule_id = ?')
      .bind(c.req.param('revisionId'), c.req.param('id')).first<{ previous_json: string }>(),
  ]);
  if (!current || !revision) return c.json({ error: 'revision_not_found' }, 404);
  let previous: Record<string, unknown>;
  try { previous = JSON.parse(revision.previous_json) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_revision' }, 409); }
  const restoredTagNames = Array.isArray(previous.tag_names) ? previous.tag_names.filter((name): name is string => typeof name === 'string') : undefined;
  const timestamp = now();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO rule_revisions (id, rule_id, previous_json, edited_by, reason, created_at) VALUES (?, ?, ?, ?, 'restore_revision', ?)`)
      .bind(createId('rev'), c.req.param('id'), JSON.stringify(current), c.get('user')!.id, timestamp),
    c.env.DB.prepare(`
      UPDATE rules SET statement = ?, common_mistake = ?, details = ?, flow_stage = ?, player_count_note = ?,
        edition_note = ?, status = ?, is_featured = ?, featured_order = ?, hidden_at = ?, hidden_by = ?, updated_at = ? WHERE id = ?
    `).bind(
      previous.statement, previous.common_mistake ?? null, previous.details ?? null, previous.flow_stage,
      previous.player_count_note ?? null, previous.edition_note ?? null, previous.status ?? 'published',
      previous.is_featured ?? 0, previous.featured_order ?? null, previous.hidden_at ?? null,
      previous.hidden_by ?? null, timestamp, c.req.param('id'),
    ),
    ...(restoredTagNames ? await tagWriteStatements(c, c.req.param('id'), restoredTagNames, c.get('user')!.id, timestamp) : []),
  ]);
  return c.json({ ok: true });
});

const mergeSchema = z.object({ targetGameId: z.string().min(1), reason: z.string().max(300).optional() });
app.post('/api/games/:id/merge', requireRole('editor'), async (c) => {
  const parsed = mergeSchema.safeParse(await c.req.json());
  if (!parsed.success || parsed.data.targetGameId === c.req.param('id')) return c.json({ error: 'invalid_merge' }, 400);
  const [source, target] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM games WHERE id = ? AND merged_into_game_id IS NULL').bind(c.req.param('id')).first<Record<string, unknown>>(),
    c.env.DB.prepare('SELECT * FROM games WHERE id = ? AND merged_into_game_id IS NULL').bind(parsed.data.targetGameId).first<Record<string, unknown>>(),
  ]);
  if (!source || !target) return c.json({ error: 'game_not_found' }, 404);
  const timestamp = now();
  await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT OR IGNORE INTO game_aliases (id, game_id, alias, normalized_alias, alias_type, created_at)
      SELECT ?, ?, display_name, normalized_name, 'legacy', ? FROM games WHERE id = ?
    `).bind(createId('alias'), parsed.data.targetGameId, timestamp, c.req.param('id')),
    c.env.DB.prepare(`
      INSERT OR IGNORE INTO game_aliases (id, game_id, alias, normalized_alias, alias_type, created_at)
      SELECT 'm_' || id, ?, alias, normalized_alias, 'legacy', ? FROM game_aliases WHERE game_id = ?
    `).bind(parsed.data.targetGameId, timestamp, c.req.param('id')),
    c.env.DB.prepare('UPDATE submissions SET game_id = ? WHERE game_id = ?').bind(parsed.data.targetGameId, c.req.param('id')),
    c.env.DB.prepare('UPDATE rules SET game_id = ?, updated_at = ? WHERE game_id = ?').bind(parsed.data.targetGameId, timestamp, c.req.param('id')),
    c.env.DB.prepare('UPDATE games SET merged_into_game_id = ?, updated_at = ? WHERE id = ?').bind(parsed.data.targetGameId, timestamp, c.req.param('id')),
    c.env.DB.prepare('UPDATE games SET updated_at = ? WHERE id = ?').bind(timestamp, parsed.data.targetGameId),
  ]);
  return c.json({ ok: true, targetGameId: parsed.data.targetGameId });
});

app.get('/api/admin/review/export', requireRole('editor'), async (c) => {
  const gameIds = (c.req.query('gameIds') ?? c.req.query('gameId') ?? '')
    .split(',').map((value) => value.trim()).filter(Boolean).slice(0, 50);
  const flowStages = (c.req.query('flowStages') ?? c.req.query('flowStage') ?? '')
    .split(',').map((value) => value.trim()).filter((value): value is FlowStage => FLOW_STAGES.includes(value as FlowStage));
  const tag = (c.req.query('tag') ?? '').trim().slice(0, 40);
  const query = (c.req.query('q') ?? '').trim().slice(0, 120);
  const missingSource = c.req.query('missingSource') === '1';
  const updatedAfter = Math.max(0, Number(c.req.query('updatedAfter') ?? 0) || 0);
  const limit = Math.min(500, Math.max(1, Number(c.req.query('limit') ?? 100) || 100));
  const conditions = [`r.status = 'published'`, 'g.merged_into_game_id IS NULL'];
  const bindings: unknown[] = [];
  if (gameIds.length) {
    conditions.push(`r.game_id IN (${gameIds.map(() => '?').join(',')})`);
    bindings.push(...gameIds);
  }
  if (flowStages.length) {
    conditions.push(`r.flow_stage IN (${flowStages.map(() => '?').join(',')})`);
    bindings.push(...flowStages);
  }
  if (tag) {
    conditions.push(`EXISTS (
      SELECT 1 FROM rule_tags filter_rt JOIN tags filter_t ON filter_t.id = filter_rt.tag_id
      WHERE filter_rt.rule_id = r.id AND (filter_t.slug = ? OR filter_t.normalized_name = ?)
    )`);
    bindings.push(tag, normalizeText(tag));
  }
  if (query) {
    conditions.push('(r.statement LIKE ? COLLATE NOCASE OR r.common_mistake LIKE ? COLLATE NOCASE OR r.details LIKE ? COLLATE NOCASE)');
    bindings.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }
  if (missingSource) conditions.push(`COALESCE(s.source_url, '') = '' AND COALESCE(s.source_label, '') = ''`);
  if (updatedAfter) {
    conditions.push('r.updated_at >= ?');
    bindings.push(updatedAfter);
  }
  const result = await c.env.DB.prepare(`${reviewRuleSelect}
    WHERE ${conditions.join(' AND ')}
    ORDER BY g.display_name, r.updated_at DESC, r.id
    LIMIT ?
  `).bind(...bindings, limit).all<ReviewRuleRow>();
  const rows = result.results ?? [];
  const items = await Promise.all(rows.map(async (row) => {
    const current = reviewContentFromRow(row);
    return {
      action: 'unchanged' as const,
      target: {
        type: 'rule' as const,
        id: row.id,
        gameId: row.game_id,
        gameName: row.game_name,
        gameSlug: row.game_slug,
      },
      base: { updatedAt: row.updated_at, contentHash: await reviewContentHash(current) },
      current,
      proposed: current,
      reason: '',
    };
  }));
  const scope = { gameIds, flowStages, tag: tag || undefined, query: query || undefined, missingSource, updatedAfter: updatedAfter || undefined, limit };
  const datasetVersion = await sha256Hex(JSON.stringify(items.map((item) => [item.target.id, item.base.updatedAt, item.base.contentHash])));
  const timestamp = now();
  const file: ReviewFile = {
    format: REVIEW_FORMAT,
    schemaVersion: REVIEW_SCHEMA_VERSION,
    name: `校稿包 ${new Date(timestamp).toISOString().slice(0, 10)}`,
    exportedAt: timestamp,
    datasetVersion,
    scope,
    instructions: [
      '只修改 proposed、reason 與 action；不要修改 target、base 或 current。',
      '需要提出修改時將 action 設為 propose；需要隱藏時設為 hide；不處理則保留 unchanged。',
      'proposed 必須保留完整欄位；tagNames 使用既有標籤名稱。',
    ],
    items,
  };
  if (c.req.query('format') === 'csv') {
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="board-game-rules-review-${new Date(timestamp).toISOString().slice(0, 10)}.csv"`);
    return c.body(serializeReviewCsv(file));
  }
  c.header('Content-Disposition', `attachment; filename="board-game-rules-review-${new Date(timestamp).toISOString().slice(0, 10)}.json"`);
  return c.json(file);
});

const reviewImportSchema = z.union([
  z.object({ file: z.unknown() }),
  z.object({ format: z.literal('csv'), content: z.string().min(1).max(3 * 1024 * 1024) }),
]);
app.post('/api/admin/review/import', requireRole('editor'), async (c) => {
  const contentLength = Number(c.req.header('content-length') ?? 0);
  if (contentLength > 3 * 1024 * 1024) return c.json({ error: 'request_too_large' }, 413);
  const body = reviewImportSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: 'invalid_review_file' }, 400);
  let reviewInput: unknown;
  try {
    reviewInput = 'content' in body.data ? parseReviewCsv(body.data.content) : body.data.file;
  } catch {
    return c.json({ error: 'invalid_review_file' }, 400);
  }
  const parsed = reviewFileSchema.safeParse(reviewInput);
  if (!parsed.success) return c.json({ error: 'invalid_review_file', issues: parsed.error.issues }, 400);
  const sourceHash = await sha256Hex(JSON.stringify(parsed.data));
  const existing = await c.env.DB.prepare('SELECT id, proposal_count FROM review_batches WHERE source_hash = ?')
    .bind(sourceHash).first<{ id: string; proposal_count: number }>();
  if (existing) return c.json({ batchId: existing.id, imported: existing.proposal_count, reused: true });

  const candidates = parsed.data.items.filter((item) =>
    item.action !== 'unchanged' && (item.action === 'hide' || !sameReviewContent(item.current, item.proposed)));
  const targetIds = Array.from(new Set(candidates.map((item) => item.target.id)));
  const currentRows = new Map<string, ReviewRuleRow>();
  for (let index = 0; index < targetIds.length; index += 50) {
    const ids = targetIds.slice(index, index + 50);
    if (!ids.length) continue;
    const result = await c.env.DB.prepare(`${reviewRuleSelect}
      WHERE r.id IN (${ids.map(() => '?').join(',')})
    `).bind(...ids).all<ReviewRuleRow>();
    for (const row of result.results ?? []) currentRows.set(row.id, row);
  }

  const timestamp = now();
  const user = c.get('user')!;
  const batchId = createId('review_batch');
  const proposals: Array<{
    id: string; item: (typeof candidates)[number]; status: 'pending' | 'conflict';
    original: ReviewContent; proposed: ReviewContent;
  }> = [];
  let skipped = 0;
  for (const item of candidates) {
    const row = currentRows.get(item.target.id);
    if (!row) { skipped += 1; continue; }
    const original = reviewContentFromRow(row);
    const proposed = normalizedReviewContent(item.proposed);
    if (item.action !== 'hide' && sameReviewContent(original, proposed)) { skipped += 1; continue; }
    const currentHash = await reviewContentHash(original);
    proposals.push({
      id: createId('review'),
      item,
      status: row.updated_at === item.base.updatedAt && currentHash === item.base.contentHash ? 'pending' : 'conflict',
      original,
      proposed,
    });
  }
  await c.env.DB.prepare(`
    INSERT INTO review_batches (
      id, name, source_type, source_hash, base_dataset_version, scope_json,
      proposal_count, pending_count, created_by, created_at, updated_at
    ) VALUES (?, ?, 'file', ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    batchId, parsed.data.name, sourceHash, parsed.data.datasetVersion,
    JSON.stringify(parsed.data.scope), proposals.length,
    proposals.filter((proposal) => proposal.status === 'pending').length,
    user.id, timestamp, timestamp,
  ).run();
  try {
    for (let index = 0; index < proposals.length; index += 50) {
      const statements = proposals.slice(index, index + 50).map(({ id, item, status, original, proposed }) =>
        c.env.DB.prepare(`
          INSERT INTO review_proposals (
            id, batch_id, target_id, operation, base_updated_at, base_content_hash,
            original_json, proposed_json, reason, status, created_by, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          id, batchId, item.target.id, item.action === 'hide' ? 'hide' : 'edit',
          item.base.updatedAt, item.base.contentHash, JSON.stringify(original),
          JSON.stringify(proposed), cleanOptional(item.reason, 1000) ?? null,
          status, user.id, timestamp, timestamp,
        ));
      if (statements.length) await c.env.DB.batch(statements);
    }
  } catch (error) {
    await c.env.DB.prepare('DELETE FROM review_batches WHERE id = ?').bind(batchId).run();
    throw error;
  }
  return c.json({
    batchId,
    imported: proposals.length,
    pending: proposals.filter((proposal) => proposal.status === 'pending').length,
    conflicts: proposals.filter((proposal) => proposal.status === 'conflict').length,
    skipped,
    reused: false,
  }, 201);
});

const manualProposalSchema = z.object({
  targetId: z.string().min(1).max(100),
  proposed: reviewContentSchema,
  reason: z.string().trim().max(1000).optional(),
  operation: z.enum(['edit', 'hide']).default('edit'),
});
app.post('/api/admin/review/proposals', requireRole('editor'), async (c) => {
  const parsed = manualProposalSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid_review_proposal', issues: parsed.error.issues }, 400);
  const row = await c.env.DB.prepare(`${reviewRuleSelect} WHERE r.id = ?`)
    .bind(parsed.data.targetId).first<ReviewRuleRow>();
  if (!row) return c.json({ error: 'rule_not_found' }, 404);
  const original = reviewContentFromRow(row);
  const proposed = normalizedReviewContent(parsed.data.proposed);
  if (parsed.data.operation === 'edit' && sameReviewContent(original, proposed)) {
    return c.json({ error: 'proposal_has_no_changes' }, 409);
  }
  const id = createId('review');
  const timestamp = now();
  await c.env.DB.prepare(`
    INSERT INTO review_proposals (
      id, target_id, operation, base_updated_at, base_content_hash,
      original_json, proposed_json, reason, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, row.id, parsed.data.operation, row.updated_at, await reviewContentHash(original),
    JSON.stringify(original), JSON.stringify(proposed), parsed.data.reason ?? null,
    c.get('user')!.id, timestamp, timestamp,
  ).run();
  return c.json({ proposalId: id }, 201);
});

app.get('/api/admin/review/batches', requireRole('editor'), async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT id, name, source_type, status, proposal_count, pending_count,
      accepted_count, rejected_count, created_at, updated_at
    FROM review_batches
    ORDER BY updated_at DESC LIMIT 50
  `).all<{
    id: string; name: string; source_type: ReviewBatch['sourceType']; status: ReviewBatch['status'];
    proposal_count: number; pending_count: number; accepted_count: number; rejected_count: number;
    created_at: number; updated_at: number;
  }>();
  return c.json({ batches: (result.results ?? []).map((row): ReviewBatch => ({
    id: row.id, name: row.name, sourceType: row.source_type, status: row.status,
    proposalCount: row.proposal_count, pendingCount: row.pending_count,
    acceptedCount: row.accepted_count, rejectedCount: row.rejected_count,
    createdAt: row.created_at, updatedAt: row.updated_at,
  })) });
});

app.get('/api/admin/review/proposals', requireRole('editor'), async (c) => {
  const status = c.req.query('status') ?? 'pending';
  if (!['pending', 'accepted', 'rejected', 'conflict', 'cancelled'].includes(status)) {
    return c.json({ error: 'invalid_review_status' }, 400);
  }
  const batchId = (c.req.query('batchId') ?? '').trim();
  const limit = Math.min(50, Math.max(1, Number(c.req.query('limit') ?? 20) || 20));
  const [cursorTimeText, cursorId = ''] = (c.req.query('cursor') ?? '').split('|');
  const cursorTime = Math.max(0, Number(cursorTimeText) || 0);
  const result = await c.env.DB.prepare(`
    SELECT p.*, b.name batch_name, g.id game_id, g.display_name game_name, g.slug game_slug,
      claimant.email claimed_email
    FROM review_proposals p
    JOIN rules r ON r.id = p.target_id
    JOIN games g ON g.id = r.game_id
    LEFT JOIN review_batches b ON b.id = p.batch_id
    LEFT JOIN users claimant ON claimant.id = p.claimed_by
    WHERE p.status = ? AND (? = '' OR p.batch_id = ?)
      AND (? = 0 OR p.created_at < ? OR (p.created_at = ? AND p.id < ?))
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT ?
  `).bind(status, batchId, batchId, cursorTime, cursorTime, cursorTime, cursorId, limit + 1).all<{
    id: string; batch_id: string | null; batch_name: string | null; target_id: string;
    game_id: string; game_name: string; game_slug: string; operation: 'edit' | 'hide';
    base_updated_at: number; original_json: string; proposed_json: string; reason: string | null;
    status: ReviewProposal['status']; version: number; claimed_email: string | null;
    claimed_until: number | null; created_at: number;
  }>();
  const rows = result.results ?? [];
  const visibleRows = rows.slice(0, limit);
  const last = visibleRows.at(-1);
  return c.json({ proposals: visibleRows.map((row): ReviewProposal => ({
    id: row.id, batchId: row.batch_id ?? undefined, batchName: row.batch_name ?? undefined,
    targetId: row.target_id, gameId: row.game_id, gameName: row.game_name, gameSlug: row.game_slug,
    operation: row.operation, baseUpdatedAt: row.base_updated_at,
    original: JSON.parse(row.original_json) as SharedReviewContent,
    proposed: JSON.parse(row.proposed_json) as SharedReviewContent,
    reason: row.reason ?? undefined, status: row.status, version: row.version,
    claimedBy: row.claimed_email ?? undefined, claimedUntil: row.claimed_until ?? undefined,
    createdAt: row.created_at,
  })), nextCursor: rows.length > limit && last ? `${last.created_at}|${last.id}` : null });
});

app.post('/api/admin/review/proposals/:id/claim', requireRole('editor'), async (c) => {
  const timestamp = now();
  const until = timestamp + 10 * 60 * 1000;
  const result = await c.env.DB.prepare(`
    UPDATE review_proposals
    SET claimed_by = ?, claimed_until = ?, version = version + 1, updated_at = ?
    WHERE id = ? AND status = 'pending'
      AND (claimed_by IS NULL OR claimed_by = ? OR claimed_until < ?)
  `).bind(c.get('user')!.id, until, timestamp, c.req.param('id'), c.get('user')!.id, timestamp).run();
  if (!result.meta?.changes) return c.json({ error: 'proposal_claimed' }, 409);
  const claimed = await c.env.DB.prepare('SELECT version FROM review_proposals WHERE id = ?')
    .bind(c.req.param('id')).first<{ version: number }>();
  return c.json({ ok: true, claimedUntil: until, version: claimed?.version ?? 1 });
});

const reviewDecisionSchema = z.object({
  decisions: z.array(z.object({
    proposalId: z.string().min(1).max(100),
    version: z.number().int().positive(),
    decision: z.enum(['accept', 'reject']),
    proposed: reviewContentSchema.optional(),
  })).min(1).max(50),
});
app.post('/api/admin/review/decisions', requireRole('editor'), async (c) => {
  const parsed = reviewDecisionSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid_review_decisions', issues: parsed.error.issues }, 400);
  const ids = Array.from(new Set(parsed.data.decisions.map((decision) => decision.proposalId)));
  const result = await c.env.DB.prepare(`
    SELECT p.*, r.submission_id, r.game_id, r.updated_at rule_updated_at
    FROM review_proposals p JOIN rules r ON r.id = p.target_id
    WHERE p.id IN (${ids.map(() => '?').join(',')})
  `).bind(...ids).all<{
    id: string; batch_id: string | null; target_id: string; operation: 'edit' | 'hide';
    base_updated_at: number; original_json: string; proposed_json: string;
    status: ReviewProposal['status']; version: number; submission_id: string;
    game_id: string; rule_updated_at: number; claimed_by: string | null; claimed_until: number | null;
  }>();
  const rows = new Map((result.results ?? []).map((row) => [row.id, row]));
  const statements: D1PreparedStatement[] = [];
  const affectedBatches = new Set<string>();
  const outcomes: Array<{ proposalId: string; status: 'accepted' | 'rejected' | 'conflict' | 'stale' }> = [];
  const user = c.get('user')!;
  const timestamp = now();
  for (const decision of parsed.data.decisions) {
    const row = rows.get(decision.proposalId);
    if (!row || row.status !== 'pending' || row.version !== decision.version) {
      outcomes.push({ proposalId: decision.proposalId, status: 'stale' });
      continue;
    }
    if (row.claimed_by && row.claimed_by !== user.id && (row.claimed_until ?? 0) >= timestamp) {
      outcomes.push({ proposalId: decision.proposalId, status: 'stale' });
      continue;
    }
    if (row.batch_id) affectedBatches.add(row.batch_id);
    if (decision.decision === 'reject') {
      statements.push(c.env.DB.prepare(`
        UPDATE review_proposals SET status = 'rejected', reviewed_by = ?, reviewed_at = ?,
          claimed_by = NULL, claimed_until = NULL, version = version + 1, updated_at = ?
        WHERE id = ? AND status = 'pending' AND version = ?
      `).bind(user.id, timestamp, timestamp, row.id, decision.version));
      outcomes.push({ proposalId: row.id, status: 'rejected' });
      continue;
    }
    if (row.rule_updated_at !== row.base_updated_at) {
      statements.push(c.env.DB.prepare(`
        UPDATE review_proposals SET status = 'conflict', reviewed_by = ?, reviewed_at = ?,
          claimed_by = NULL, claimed_until = NULL, version = version + 1, updated_at = ?
        WHERE id = ? AND status = 'pending' AND version = ?
      `).bind(user.id, timestamp, timestamp, row.id, decision.version));
      outcomes.push({ proposalId: row.id, status: 'conflict' });
      continue;
    }
    const original = JSON.parse(row.original_json) as ReviewContent;
    const proposed = normalizedReviewContent(decision.proposed ?? JSON.parse(row.proposed_json) as ReviewContent);
    statements.push(c.env.DB.prepare(`
      INSERT INTO rule_revisions (id, rule_id, previous_json, edited_by, reason, created_at)
      VALUES (?, ?, ?, ?, 'review_accept', ?)
    `).bind(createId('rev'), row.target_id, JSON.stringify({ ...original, tag_names: original.tagNames }), user.id, timestamp));
    if (row.operation === 'hide') {
      statements.push(c.env.DB.prepare(`
        UPDATE rules SET status = 'hidden', hidden_at = ?, hidden_by = ?, updated_at = ?
        WHERE id = ? AND updated_at = ?
      `).bind(timestamp, user.id, timestamp, row.target_id, row.base_updated_at));
    } else {
      statements.push(c.env.DB.prepare(`
        UPDATE rules SET statement = ?, common_mistake = ?, details = ?, flow_stage = ?,
          player_count_note = ?, edition_note = ?, updated_at = ?
        WHERE id = ? AND updated_at = ?
      `).bind(
        proposed.statement, proposed.commonMistake ?? null, proposed.details ?? null,
        proposed.flowStage, proposed.playerCountNote ?? null, proposed.editionNote ?? null,
        timestamp, row.target_id, row.base_updated_at,
      ));
      statements.push(
        c.env.DB.prepare('UPDATE submissions SET source_label = ?, source_url = ? WHERE id = ?')
          .bind(proposed.sourceLabel ?? null, proposed.sourceUrl || null, row.submission_id),
        c.env.DB.prepare('DELETE FROM submission_sources WHERE submission_id = ?').bind(row.submission_id),
      );
      if (proposed.sourceUrl) {
        statements.push(c.env.DB.prepare(`
          INSERT INTO submission_sources (id, submission_id, label, url, position, created_at)
          VALUES (?, ?, ?, ?, 0, ?)
        `).bind(createId('source'), row.submission_id, proposed.sourceLabel ?? null, proposed.sourceUrl, timestamp));
      }
      statements.push(...await tagWriteStatements(c, row.target_id, proposed.tagNames, user.id, timestamp));
    }
    statements.push(
      c.env.DB.prepare('UPDATE games SET updated_at = ? WHERE id = ?').bind(timestamp, row.game_id),
      c.env.DB.prepare(`
        UPDATE review_proposals SET status = 'accepted', proposed_json = ?, reviewed_by = ?,
          reviewed_at = ?, claimed_by = NULL, claimed_until = NULL,
          version = version + 1, updated_at = ?
        WHERE id = ? AND status = 'pending' AND version = ?
      `).bind(JSON.stringify(proposed), user.id, timestamp, timestamp, row.id, decision.version),
    );
    outcomes.push({ proposalId: row.id, status: 'accepted' });
  }
  for (const batchId of affectedBatches) {
    statements.push(c.env.DB.prepare(`
      UPDATE review_batches SET
        pending_count = (SELECT COUNT(*) FROM review_proposals WHERE batch_id = ? AND status = 'pending'),
        accepted_count = (SELECT COUNT(*) FROM review_proposals WHERE batch_id = ? AND status = 'accepted'),
        rejected_count = (SELECT COUNT(*) FROM review_proposals WHERE batch_id = ? AND status = 'rejected'),
        status = CASE WHEN EXISTS (
          SELECT 1 FROM review_proposals WHERE batch_id = ? AND status IN ('pending', 'conflict')
        ) THEN 'open' ELSE 'completed' END,
        completed_at = CASE WHEN EXISTS (
          SELECT 1 FROM review_proposals WHERE batch_id = ? AND status IN ('pending', 'conflict')
        ) THEN NULL ELSE ? END,
        updated_at = ?
      WHERE id = ?
    `).bind(batchId, batchId, batchId, batchId, batchId, timestamp, timestamp, batchId));
  }
  if (statements.length) await c.env.DB.batch(statements);
  return c.json({ outcomes });
});

app.get('/api/admin/editors', requireRole('admin'), async (c) => {
  const [users, invites] = await Promise.all([
    c.env.DB.prepare(`
      SELECT u.id, u.email, u.display_name, ur.role, ur.granted_at, ur.revoked_at
      FROM user_roles ur JOIN users u ON u.id = ur.user_id
      ORDER BY ur.revoked_at IS NOT NULL, ur.granted_at DESC
    `).all(),
    c.env.DB.prepare(`
      SELECT id, email_normalized email, role, invited_at, claimed_at, revoked_at
      FROM editor_invitations ORDER BY invited_at DESC
    `).all(),
  ]);
  return c.json({ users: users.results ?? [], invitations: invites.results ?? [] });
});

const inviteSchema = z.object({ email: z.email(), role: z.enum(['admin', 'editor']) });
app.post('/api/admin/editors', requireRole('admin'), async (c) => {
  const parsed = inviteSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid_invitation' }, 400);
  const email = normalizeEmail(parsed.data.email);
  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email_normalized = ?').bind(email).first<{ id: string }>();
  const timestamp = now();
  if (existing) {
    await c.env.DB.prepare(`
      INSERT INTO user_roles (user_id, role, granted_by, granted_at, revoked_at)
      VALUES (?, ?, ?, ?, NULL)
      ON CONFLICT(user_id, role) DO UPDATE SET revoked_at = NULL, granted_by = excluded.granted_by, granted_at = excluded.granted_at
    `).bind(existing.id, parsed.data.role, c.get('user')!.id, timestamp).run();
    return c.json({ ok: true, userId: existing.id });
  }
  const id = createId('invite');
  await c.env.DB.prepare(`
    INSERT INTO editor_invitations (id, email_normalized, role, invited_by, invited_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, email, parsed.data.role, c.get('user')!.id, timestamp).run();
  return c.json({ ok: true, invitationId: id }, 201);
});

app.delete('/api/admin/editors/:userId/:role', requireRole('admin'), async (c) => {
  const role = c.req.param('role') as UserRole;
  if (!['admin', 'editor'].includes(role)) return c.json({ error: 'invalid_role' }, 400);
  if (c.req.param('userId') === c.get('user')!.id && role === 'admin') {
    return c.json({ error: 'cannot_revoke_own_admin' }, 409);
  }
  await c.env.DB.prepare(`
    UPDATE user_roles SET revoked_at = ? WHERE user_id = ? AND role = ?
  `).bind(now(), c.req.param('userId'), role).run();
  return c.json({ ok: true });
});

app.delete('/api/admin/invitations/:id', requireRole('admin'), async (c) => {
  await c.env.DB.prepare(`UPDATE editor_invitations SET revoked_at = ? WHERE id = ? AND claimed_at IS NULL`)
    .bind(now(), c.req.param('id')).run();
  return c.json({ ok: true });
});

app.get('/api/admin/imports', requireRole('editor'), async (c) => {
  const status = c.req.query('status') ?? 'pending';
  const result = await c.env.DB.prepare(`
    SELECT * FROM legacy_import_rows WHERE status = ? ORDER BY source_row_number LIMIT 100
  `).bind(status).all();
  return c.json({ rows: result.results ?? [] });
});

const importConfirmSchema = z.object({
  rules: z.array(z.string().trim().min(1).max(2000)).min(1).max(20).optional(),
  gameId: z.string().min(1).optional(),
});

app.post('/api/admin/imports/:id/confirm', requireRole('editor'), async (c) => {
  const parsed = importConfirmSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid_import_confirmation' }, 400);
  const row = await c.env.DB.prepare(`
    SELECT * FROM legacy_import_rows WHERE id = ? AND status = 'pending'
  `).bind(c.req.param('id')).first<{
    id: string; matched_game_id: string | null; proposed_rules_json: string;
    raw_source_label: string | null; raw_source_url: string | null; raw_timestamp: string | null;
    raw_category: string | null;
  }>();
  if (!row) return c.json({ error: 'import_row_not_found' }, 404);
  const gameId = parsed.data.gameId ?? row.matched_game_id;
  if (!gameId) return c.json({ error: 'game_required' }, 400);
  const rules = parsed.data.rules ?? JSON.parse(row.proposed_rules_json) as string[];
  const timestamp = now();
  const submissionId = createId('sub');
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(`
      INSERT INTO submissions (id, game_id, author_id, played_on, source_label, source_url, legacy_import_row_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      submissionId, gameId, c.get('user')!.id, row.raw_timestamp?.slice(0, 10) ?? null,
      row.raw_source_label ?? null, row.raw_source_url?.match(/https?:\/\/[^\s]+/)?.[0] ?? null,
      row.id, timestamp,
    ),
  ];
  for (const statement of rules) {
    statements.push(c.env.DB.prepare(`
      INSERT INTO rules (id, submission_id, game_id, statement, flow_stage, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'published', ?, ?, ?)
    `).bind(createId('rule'), submissionId, gameId, statement, row.raw_category?.includes('起始') ? 'setup' : row.raw_category?.includes('計分') ? 'end_scoring' : 'uncategorized', c.get('user')!.id, timestamp, timestamp));
  }
  statements.push(c.env.DB.prepare(`UPDATE legacy_import_rows SET status = 'imported', matched_game_id = ? WHERE id = ?`).bind(gameId, row.id));
  await c.env.DB.batch(statements);
  return c.json({ ok: true, importedRules: rules.length });
});

app.post('/api/admin/imports/:id/skip', requireRole('editor'), async (c) => {
  await c.env.DB.prepare(`UPDATE legacy_import_rows SET status = 'skipped' WHERE id = ? AND status = 'pending'`).bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

app.get('/api/admin/hidden-rules', requireRole('editor'), async (c) => {
  const result = await c.env.DB.prepare(`${ruleSelect}
    WHERE r.status = 'hidden' ORDER BY r.updated_at DESC LIMIT 100
  `).all<RuleRow>();
  return c.json({ rules: (result.results ?? []).map(toRule) });
});

const tagAdminSchema = z.object({
  name: z.string().min(1).max(40),
  description: z.string().max(200).optional().nullable(),
  isPublic: z.boolean().default(true),
  aliases: z.array(z.string()).optional(),
});

app.get('/api/admin/tags', requireRole('editor'), async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT t.id, t.slug, t.name, t.description, t.is_public, COUNT(DISTINCT rt.rule_id) AS usage_count
    FROM tags t
    LEFT JOIN rule_tags rt ON rt.tag_id = t.id
    WHERE t.status = 'active'
    GROUP BY t.id
    ORDER BY t.is_public DESC, usage_count DESC, t.name
  `).all<{ id: string; slug: string; name: string; description: string | null; is_public: number; usage_count: number }>();

  const aliasesResult = await c.env.DB.prepare(`SELECT tag_id, alias FROM tag_aliases ORDER BY alias`).all<{ tag_id: string; alias: string }>();
  const aliasMap = new Map<string, string[]>();
  (aliasesResult.results ?? []).forEach((row) => {
    const list = aliasMap.get(row.tag_id) ?? [];
    list.push(row.alias);
    aliasMap.set(row.tag_id, list);
  });

  return c.json({
    tags: (result.results ?? []).map((tag) => ({
      id: tag.id,
      slug: tag.slug,
      name: tag.name,
      description: tag.description ?? undefined,
      isPublic: Boolean(tag.is_public),
      usageCount: tag.usage_count,
      aliases: aliasMap.get(tag.id) ?? [],
    })),
  });
});

app.post('/api/admin/tags', requireRole('admin'), async (c) => {
  const parsed = tagAdminSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);

  const { name, description, isPublic, aliases } = parsed.data;
  const normalized = normalizeText(name);
  const existing = await c.env.DB.prepare(`
    SELECT id FROM tags WHERE status = 'active' AND normalized_name = ? LIMIT 1
  `).bind(normalized).first<{ id: string }>();

  const timestamp = Date.now();
  const userId = c.get('user')!.id;

  if (existing) {
    await c.env.DB.prepare(`
      UPDATE tags SET is_public = ?, description = COALESCE(?, description), updated_at = ? WHERE id = ?
    `).bind(isPublic ? 1 : 0, description || null, timestamp, existing.id).run();
    return c.json({ ok: true, tagId: existing.id });
  }

  const suffix = (await sha256Hex(normalized)).slice(0, 20);
  const tagId = `tag_${suffix}`;

  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(`
      INSERT INTO tags (id, slug, name, normalized_name, description, is_public, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(tagId, slugify(name), name, normalized, description || null, isPublic ? 1 : 0, userId, timestamp, timestamp),
  ];

  for (const alias of cleanTagNames(aliases)) {
    const normAlias = normalizeText(alias);
    const aliasSuffix = (await sha256Hex(normAlias)).slice(0, 20);
    statements.push(
      c.env.DB.prepare(`
        INSERT OR IGNORE INTO tag_aliases (id, tag_id, alias, normalized_alias, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(`ta_${aliasSuffix}`, tagId, alias, normAlias, timestamp)
    );
  }

  await c.env.DB.batch(statements);
  return c.json({ ok: true, tagId });
});

app.patch('/api/admin/tags/:id', requireRole('admin'), async (c) => {
  const tagId = c.req.param('id');
  const parsed = tagAdminSchema.partial().safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);

  const existing = await c.env.DB.prepare(`SELECT id FROM tags WHERE id = ? AND status = 'active'`).bind(tagId).first();
  if (!existing) return c.json({ error: 'tag_not_found' }, 404);

  const timestamp = Date.now();
  const updates: string[] = ['updated_at = ?'];
  const bindings: unknown[] = [timestamp];

  if (parsed.data.name !== undefined) {
    updates.push('name = ?', 'slug = ?', 'normalized_name = ?');
    bindings.push(parsed.data.name, slugify(parsed.data.name), normalizeText(parsed.data.name));
  }
  if (parsed.data.description !== undefined) {
    updates.push('description = ?');
    bindings.push(parsed.data.description || null);
  }
  if (parsed.data.isPublic !== undefined) {
    updates.push('is_public = ?');
    bindings.push(parsed.data.isPublic ? 1 : 0);
  }

  bindings.push(tagId);
  await c.env.DB.prepare(`UPDATE tags SET ${updates.join(', ')} WHERE id = ?`).bind(...bindings).run();

  if (parsed.data.aliases !== undefined) {
    await c.env.DB.prepare(`DELETE FROM tag_aliases WHERE tag_id = ?`).bind(tagId).run();
    const aliasStatements: D1PreparedStatement[] = [];
    for (const alias of cleanTagNames(parsed.data.aliases)) {
      const normAlias = normalizeText(alias);
      const aliasSuffix = (await sha256Hex(normAlias)).slice(0, 20);
      aliasStatements.push(
        c.env.DB.prepare(`
          INSERT OR IGNORE INTO tag_aliases (id, tag_id, alias, normalized_alias, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).bind(`ta_${aliasSuffix}`, tagId, alias, normAlias, timestamp)
      );
    }
    if (aliasStatements.length > 0) {
      await c.env.DB.batch(aliasStatements);
    }
  }

  return c.json({ ok: true });
});

export default app;
