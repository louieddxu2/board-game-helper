import { Hono } from 'hono';
import { z } from 'zod';
import { FLOW_STAGES, type FlowStage, type GameDetail, type GameSummary, type HomePayload, type HomeIDPayload, type ReviewBatch, type ReviewContent as SharedReviewContent, type ReviewProposal, type RuleCard, type UserRole } from '../../src/shared/types';
import { requireRole, type AppContext, type AppVariables, exchangeGoogleCredential, signInAsLocalAdmin, signInWithGoogle, signOut } from '../auth';
import type { RouteEnv } from '../env';
import { getDatabase, type DatabaseStatement } from '../data/database';
import { assertMutationOrigin, cleanAliases, cleanOptional, createId, normalizeEmail, normalizeText, now, sha256Hex, slugify, trustedOrigins } from '../utils';
import { normalizedReviewContent, REVIEW_FORMAT, REVIEW_SCHEMA_VERSION, reviewContentHash, reviewContentSchema, reviewFileSchema, sameReviewContent, type ReviewContent, type ReviewFile } from '../review';
import { parseReviewCsv, serializeReviewCsv } from '../review-csv';
import { gameRuleSelect, setNoCache, ruleSelect, homeRuleSelect, toRule, cleanTagNames, tagWriteStatements, toGame, reviewContentFromRow, reviewRuleSelect , RuleRow, GameRow, ReviewRuleRow } from './shared';

const gamesRoutes = new Hono<{ Bindings: RouteEnv; Variables: AppVariables }>();

gamesRoutes.get('/api/games/search', async (c) => {
  const rawQuery = (c.req.query('q') ?? '').trim().slice(0, 100);
  if (rawQuery.length < 1) return c.json({ games: [] });
  const query = normalizeText(rawQuery);
  const result = await getDatabase(c).statement(`
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

gamesRoutes.get('/api/games/resolve', async (c) => {
  const rawName = (c.req.query('name') ?? '').trim().slice(0, 120);
  if (!rawName) return c.json({ game: null, suggestions: [] });
  const name = normalizeText(rawName);
  const exact = await getDatabase(c).statement(`
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
  const result = await getDatabase(c).statement(`
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

gamesRoutes.post('/api/games/:id/view', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'unauthorized' }, 401);
  const game = await getDatabase(c).statement('SELECT id FROM games WHERE id = ?').bind(c.req.param('id')).first();
  if (!game) return c.json({ error: 'game_not_found' }, 404);

  const ruleId = c.req.query('ruleId') || null;
  if (ruleId) {
    const rule = await getDatabase(c).statement('SELECT id FROM rules WHERE id = ? AND game_id = ?').bind(ruleId, game.id).first();
    if (!rule) return c.json({ error: 'rule_not_found' }, 404);
  }

  const timestamp = now();
  const viewDate = new Date(timestamp).toISOString().slice(0, 10);
  await getDatabase(c).statement(`
    INSERT INTO daily_views (game_id, rule_id, user_id, view_date, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(game_id, rule_id, user_id, view_date) DO NOTHING
  `).bind(game.id, ruleId ?? '', user.id, viewDate, timestamp).run();
  return c.json({ success: true });
});

gamesRoutes.get('/api/games/:identifier', async (c) => {
  const identifier = c.req.param('identifier');
  const includePrivate = c.req.query('includePrivate') === '1'
    && Boolean(c.get('user')?.roles.some((role) => role === 'editor' || role === 'admin'));
  const game = await getDatabase(c).statement(`
    SELECT g.id, g.slug, g.display_name, g.english_name, g.updated_at,
      ${includePrivate ? 'g.total_rule_count' : 'g.published_rule_count'} AS rule_count,
      g.published_rule_count, g.total_rule_count, g.latest_rule_updated_at
    FROM games g
    WHERE (g.id = ? OR g.slug = ?) AND g.merged_into_game_id IS NULL
    LIMIT 1
  `).bind(identifier, identifier).first<GameRow>();
  if (!game) return c.json({ error: 'game_not_found' }, 404);

  setNoCache(c);

  const [aliasesResult, rulesResult] = await Promise.all([
    getDatabase(c).statement('SELECT alias FROM game_aliases WHERE game_id = ? ORDER BY alias')
      .bind(game.id).all<{ alias: string }>(),
    getDatabase(c).statement(`${gameRuleSelect}
      WHERE r.game_id = ?${includePrivate ? '' : " AND r.status = 'published'"}
      ORDER BY CASE r.flow_stage
        WHEN 'setup' THEN 1 WHEN 'round' THEN 2 WHEN 'action' THEN 3
        WHEN 'always' THEN 4 WHEN 'end_scoring' THEN 5
        WHEN 'edition_player_count' THEN 6 ELSE 7 END,
        r.created_at DESC
    `).bind(game.id).all<RuleRow>(),
  ]);
  const ruleRows = rulesResult.results ?? [];
  const detail: GameDetail = {
    ...toGame(game),
    ruleCount: ruleRows.length,
    aliases: (aliasesResult.results ?? []).map((row) => row.alias),
    rules: ruleRows.map((row) => toRule(row)),
  };
  setNoCache(c);
  return c.json({ game: detail, rulesComplete: includePrivate });
});

const gameSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  englishName: z.string().trim().max(120).optional(),
  aliases: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
});

gamesRoutes.post('/api/games', requireRole('editor'), async (c) => {
  const parsed = gameSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid_game', issues: parsed.error.issues }, 400);
  const normalizedName = normalizeText(parsed.data.displayName);
  const existing = await getDatabase(c).statement(`
    SELECT g.id, g.slug, g.display_name, g.english_name, g.updated_at,
      g.published_rule_count AS rule_count, g.published_rule_count,
      g.total_rule_count, g.latest_rule_updated_at
    FROM games g
    LEFT JOIN game_aliases a ON a.game_id = g.id
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
  const slugExists = await getDatabase(c).statement('SELECT 1 found FROM games WHERE slug = ?').bind(baseSlug).first();
  const slug = slugExists ? `${baseSlug}-${id.slice(-6)}` : baseSlug;
  const aliases = cleanAliases(parsed.data.aliases ?? [], parsed.data.displayName, parsed.data.englishName);
  const statements: DatabaseStatement[] = [
    getDatabase(c).statement(`
      INSERT INTO games (id, slug, display_name, english_name, normalized_name, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, slug, parsed.data.displayName, parsed.data.englishName ?? null, normalizedName, user.id, timestamp, timestamp),
  ];
  for (const alias of aliases) {
    statements.push(getDatabase(c).statement(`
      INSERT INTO game_aliases (id, game_id, alias, normalized_alias, alias_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(createId('alias'), id, alias, normalizeText(alias), alias === parsed.data.displayName ? 'official' : 'alias', timestamp));
  }
  await getDatabase(c).batch(statements);
  return c.json({ game: { id, slug, displayName: parsed.data.displayName, englishName: parsed.data.englishName, ruleCount: 0, publishedRuleCount: 0, totalRuleCount: 0, updatedAt: timestamp } }, 201);
});

gamesRoutes.patch('/api/games/:id', requireRole('editor'), async (c) => {
  const parsed = gameSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid_game', issues: parsed.error.issues }, 400);
  const game = await getDatabase(c).statement('SELECT id, slug FROM games WHERE id = ? AND merged_into_game_id IS NULL')
    .bind(c.req.param('id')).first<{ id: string; slug: string }>();
  if (!game) return c.json({ error: 'game_not_found' }, 404);
  const timestamp = now();
  const aliases = cleanAliases(parsed.data.aliases ?? [], parsed.data.displayName, parsed.data.englishName);
  const statements: DatabaseStatement[] = [
    getDatabase(c).statement(`
      UPDATE games SET display_name = ?, english_name = ?, normalized_name = ?, updated_at = ? WHERE id = ?
    `).bind(parsed.data.displayName, cleanOptional(parsed.data.englishName, 120) ?? null, normalizeText(parsed.data.displayName), timestamp, c.req.param('id')),
    getDatabase(c).statement('DELETE FROM game_aliases WHERE game_id = ?').bind(c.req.param('id')),
  ];
  for (const alias of aliases) {
    statements.push(getDatabase(c).statement(`
      INSERT INTO game_aliases (id, game_id, alias, normalized_alias, alias_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(createId('alias'), c.req.param('id'), alias, normalizeText(alias), alias === parsed.data.displayName ? 'official' : 'alias', timestamp));
  }
  await getDatabase(c).batch(statements);
  const cache = (caches as any).default;
  c.executionCtx.waitUntil(Promise.all([
    cache.delete(new Request(new URL(`/api/games/${game.slug}`, c.req.url))),
    cache.delete(new Request(new URL('/api/home', c.req.url))),
  ]));
  const updatedGame = await getDatabase(c).statement(`
    SELECT g.id, g.slug, g.display_name, g.english_name, g.updated_at,
      g.published_rule_count AS rule_count, g.published_rule_count,
      g.total_rule_count, g.latest_rule_updated_at,
      GROUP_CONCAT(DISTINCT a.alias) AS aliases_str
    FROM games g
    LEFT JOIN game_aliases a ON a.game_id = g.id
    WHERE g.id = ?
    GROUP BY g.id
  `).bind(c.req.param('id')).first<GameRow>();
  return c.json({ ok: true, game: toGame(updatedGame!) });
});

const mergeSchema = z.object({ targetGameId: z.string().min(1), reason: z.string().max(300).optional() });
gamesRoutes.post('/api/games/:id/merge', requireRole('editor'), async (c) => {
  const parsed = mergeSchema.safeParse(await c.req.json());
  if (!parsed.success || parsed.data.targetGameId === c.req.param('id')) return c.json({ error: 'invalid_merge' }, 400);
  const [source, target] = await Promise.all([
    getDatabase(c).statement('SELECT * FROM games WHERE id = ? AND merged_into_game_id IS NULL').bind(c.req.param('id')).first<Record<string, unknown>>(),
    getDatabase(c).statement('SELECT * FROM games WHERE id = ? AND merged_into_game_id IS NULL').bind(parsed.data.targetGameId).first<Record<string, unknown>>(),
  ]);
  if (!source || !target) return c.json({ error: 'game_not_found' }, 404);
  const timestamp = now();
  await getDatabase(c).batch([
    getDatabase(c).statement(`
      INSERT OR IGNORE INTO game_aliases (id, game_id, alias, normalized_alias, alias_type, created_at)
      SELECT ?, ?, display_name, normalized_name, 'legacy', ? FROM games WHERE id = ?
    `).bind(createId('alias'), parsed.data.targetGameId, timestamp, c.req.param('id')),
    getDatabase(c).statement(`
      INSERT OR IGNORE INTO game_aliases (id, game_id, alias, normalized_alias, alias_type, created_at)
      SELECT 'm_' || id, ?, alias, normalized_alias, 'legacy', ? FROM game_aliases WHERE game_id = ?
    `).bind(parsed.data.targetGameId, timestamp, c.req.param('id')),
    getDatabase(c).statement(`
      UPDATE OR REPLACE daily_views
      SET created_at = MAX(
            daily_views.created_at,
            COALESCE((
              SELECT target_view.created_at
              FROM daily_views target_view
              WHERE target_view.game_id = ?
                AND target_view.rule_id = daily_views.rule_id
                AND target_view.user_id = daily_views.user_id
                AND target_view.view_date = daily_views.view_date
            ), daily_views.created_at)
          ),
          game_id = ?
      WHERE rowid IN (
        SELECT rowid
        FROM daily_views
        WHERE view_date >= DATE('now', '-37 days')
        ORDER BY view_date DESC, created_at DESC
        LIMIT 100
      )
        AND game_id = ?
    `).bind(parsed.data.targetGameId, parsed.data.targetGameId, c.req.param('id')),
    getDatabase(c).statement('UPDATE submissions SET game_id = ? WHERE game_id = ?').bind(parsed.data.targetGameId, c.req.param('id')),
    getDatabase(c).statement('UPDATE rules SET game_id = ?, updated_at = ? WHERE game_id = ?').bind(parsed.data.targetGameId, timestamp, c.req.param('id')),
    getDatabase(c).statement('UPDATE games SET merged_into_game_id = ?, updated_at = ? WHERE id = ?').bind(parsed.data.targetGameId, timestamp, c.req.param('id')),
    getDatabase(c).statement('UPDATE games SET updated_at = ? WHERE id = ?').bind(timestamp, parsed.data.targetGameId),
  ]);
  return c.json({ ok: true, targetGameId: parsed.data.targetGameId });
});


export { gamesRoutes };
