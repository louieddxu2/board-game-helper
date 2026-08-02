import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { FLOW_STAGES, type FlowStage, type GameDetail, type GameSummary, type HomePayload, type HomeIDPayload, type ReviewBatch, type ReviewContent as SharedReviewContent, type ReviewProposal, type RuleCard, type UserRole } from '../../src/shared/types';
import { requireRole, requireUser, type AppContext, type AppVariables, exchangeGoogleCredential, signInAsLocalAdmin, signInWithGoogle, signOut } from '../auth';
import type { RouteEnv } from '../env';
import { getDatabase, type DatabaseStatement } from '../data/database';
import { assertMutationOrigin, cleanAliases, cleanOptional, createId, normalizeEmail, normalizeText, now, sha256Hex, trustedOrigins } from '../utils';
import { normalizedReviewContent, REVIEW_FORMAT, REVIEW_SCHEMA_VERSION, reviewContentHash, reviewContentSchema, reviewFileSchema, sameReviewContent, type ReviewContent, type ReviewFile } from '../review';
import { parseReviewCsv, serializeReviewCsv } from '../review-csv';
import { gameRuleSelect, setNoCache, ruleSelect, homeRuleSelect, toRule, cleanTagNames, tagWriteStatements, toGame, resolvePublicNicknames, reviewContentFromRow, reviewRuleSelect , RuleRow, GameRow, ReviewRuleRow } from './shared';
import { gameCatalogChangesPayload, gameCatalogPayload, queryGameCatalogChanges, queryGameCatalogSnapshot } from '../data/gameCatalog';
import { filterGameCatalog } from '../../src/lib/gameCatalog';
import { logD1Query } from './shared';
import { canEditContributionGame } from '../contributions';
import {
  anonymousGameViewKey,
  dailyViewToken,
  GAME_VIEW_COOKIE,
  recordAnonymousGameView,
  secondsUntilNextUtcDay,
  utcDate,
} from '../data/gameViews';

const gamesRoutes = new Hono<{ Bindings: RouteEnv; Variables: AppVariables }>();

gamesRoutes.get('/api/games/search', async (c) => {
  const rawQuery = (c.req.query('q') ?? '').trim().slice(0, 100);
  if (rawQuery.length < 1) return c.json({ games: [] });
  const snapshot = await queryGameCatalogSnapshot(getDatabase(c));
  logD1Query(c, 'game_catalog_snapshot_state', snapshot.state);
  logD1Query(c, 'game_catalog_snapshot_chunks', snapshot.chunks);
  setNoCache(c);
  return c.json({ games: filterGameCatalog(gameCatalogPayload(snapshot).games, rawQuery, 20) });
});

gamesRoutes.get('/api/game-catalog', async (c) => {
  const snapshot = await queryGameCatalogSnapshot(getDatabase(c));
  logD1Query(c, 'game_catalog_snapshot_state', snapshot.state);
  logD1Query(c, 'game_catalog_snapshot_chunks', snapshot.chunks);
  setNoCache(c);
  return c.json(gameCatalogPayload(snapshot));
});

gamesRoutes.get('/api/game-catalog/changes', async (c) => {
  const rawAfter = c.req.query('after') ?? '0';
  const after = Number(rawAfter);
  if (!Number.isSafeInteger(after) || after < 0) return c.json({ error: 'invalid_catalog_version' }, 400);
  const result = logD1Query(c, 'game_catalog_changes', await queryGameCatalogChanges(getDatabase(c), after));
  setNoCache(c);
  return c.json(gameCatalogChangesPayload(result, after));
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
    WHERE g.merged_into_game_id IS NULL AND g.visibility = 'public'
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
    WHERE g.merged_into_game_id IS NULL AND g.visibility = 'public'
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
  const game = await getDatabase(c).statement("SELECT id FROM games WHERE id = ? AND visibility = 'public'").bind(c.req.param('id')).first();
  if (!game) return c.json({ error: 'game_not_found' }, 404);

  const timestamp = now();
  const viewDate = utcDate(timestamp);
  const viewToken = dailyViewToken(getCookie(c, GAME_VIEW_COOKIE), timestamp);
  if (viewToken.created) {
    const isLocalhost = ['localhost', '127.0.0.1'].includes(new URL(c.req.url).hostname);
    setCookie(c, GAME_VIEW_COOKIE, viewToken.token, {
      httpOnly: true,
      secure: !isLocalhost,
      sameSite: 'Lax',
      path: '/api/games',
      maxAge: secondsUntilNextUtcDay(timestamp),
    });
  }
  const gameId = String(game.id);
  const counted = await recordAnonymousGameView(
    getDatabase(c),
    gameId,
    viewDate,
    await anonymousGameViewKey(viewToken.token, gameId, viewDate),
    timestamp,
  );
  return c.json({ success: true, counted });
});

gamesRoutes.get('/api/games/:identifier', async (c) => {
  const identifier = c.req.param('identifier');
  const includePrivate = c.req.query('includePrivate') === '1'
    && Boolean(c.get('user')?.roles.some((role) => role === 'editor' || role === 'admin'));
  const game = await getDatabase(c).statement(`
    SELECT g.id, g.slug, g.display_name, g.english_name, g.updated_at,
      g.rename_owner_id, g.rename_locked, g.visibility, g.review_status,
      CASE WHEN reviewer.show_nickname = 1 THEN g.reviewed_by_nickname END reviewed_by_nickname,
      g.reviewed_at,
      ${includePrivate ? 'g.total_rule_count' : 'g.published_rule_count'} AS rule_count,
      g.published_rule_count, g.total_rule_count, g.latest_rule_updated_at
    FROM games g
    LEFT JOIN users reviewer ON reviewer.id = g.reviewed_by
    WHERE (g.id = ? OR g.slug = ?) AND g.merged_into_game_id IS NULL
      AND (g.visibility = 'public' OR ? = 1)
    LIMIT 1
  `).bind(identifier, identifier, includePrivate ? 1 : 0).first<GameRow>();
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
  const nicknameMap = await resolvePublicNicknames(getDatabase(c), ruleRows);
  const detail: GameDetail = {
    ...toGame(game),
    ruleCount: ruleRows.length,
    aliases: (aliasesResult.results ?? []).map((row) => row.alias),
    rules: ruleRows.map((row) => toRule(row, undefined, nicknameMap)),
  };
  setNoCache(c);
  return c.json({ game: detail, rulesComplete: includePrivate });
});

const gameSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  englishName: z.string().trim().max(120).optional(),
  aliases: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
});

gamesRoutes.patch('/api/games/:id', requireUser, async (c) => {
  const parsed = gameSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid_game', issues: parsed.error.issues }, 400);
  const game = await getDatabase(c).statement('SELECT id, slug, created_by, rename_owner_id, rename_locked, review_status, visibility FROM games WHERE id = ? AND merged_into_game_id IS NULL')
    .bind(c.req.param('id')).first<{ id: string; slug: string; created_by: string | null; rename_owner_id: string | null; rename_locked: number; review_status: 'not_required' | 'pending' | 'reviewed'; visibility: string }>();
  if (!game) return c.json({ error: 'game_not_found' }, 404);
  const user = c.get('user')!;
  if (!canEditContributionGame(game, user)
    || (game.review_status === 'not_required' && !user.roles.includes('admin')
      && (Boolean(game.rename_locked) || game.rename_owner_id !== user.id))) {
    return c.json({ error: 'game_name_locked' }, 403);
  }
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

gamesRoutes.post('/api/games/:id/review', requireRole('editor'), async (c) => {
  const user = c.get('user')!;
  const reviewer = await getDatabase(c).statement(`
    SELECT nickname FROM users
    WHERE id = ? AND show_nickname = 1 AND nickname IS NOT NULL
  `).bind(user.id).first<{ nickname: string }>();
  if (!reviewer) return c.json({ error: 'reviewer_nickname_required' }, 409);
  const game = await getDatabase(c).statement(`
    SELECT id, slug, review_status FROM games WHERE id = ? AND merged_into_game_id IS NULL
  `).bind(c.req.param('id')).first<{ id: string; slug: string; review_status: string }>();
  if (!game) return c.json({ error: 'game_not_found' }, 404);
  if (game.review_status !== 'pending') return c.json({ error: 'game_not_pending_review' }, 409);
  const timestamp = now();
  await getDatabase(c).statement(`
    UPDATE games SET review_status = 'reviewed', reviewed_by = ?, reviewed_by_nickname = ?, reviewed_at = ?
    WHERE id = ? AND review_status = 'pending'
  `).bind(user.id, reviewer.nickname, timestamp, game.id).run();
  const cache = (caches as any).default;
  c.executionCtx.waitUntil(Promise.all([
    cache.delete(new Request(new URL(`/api/games/${game.id}`, c.req.url))),
    cache.delete(new Request(new URL(`/api/games/${game.slug}`, c.req.url))),
    cache.delete(new Request(new URL('/api/home', c.req.url))),
  ]));
  return c.json({ ok: true, reviewStatus: 'reviewed', reviewedByNickname: reviewer.nickname, reviewedAt: timestamp });
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
      INSERT INTO game_daily_view_counts (game_id, view_date, view_count, last_view_at)
      SELECT ?, view_date, view_count, last_view_at
      FROM game_daily_view_counts
      WHERE game_id = ?
      ON CONFLICT(game_id, view_date) DO UPDATE SET
        view_count = game_daily_view_counts.view_count + excluded.view_count,
        last_view_at = MAX(game_daily_view_counts.last_view_at, excluded.last_view_at)
    `).bind(parsed.data.targetGameId, c.req.param('id')),
    getDatabase(c).statement('DELETE FROM game_daily_view_counts WHERE game_id = ?').bind(c.req.param('id')),
    getDatabase(c).statement('DELETE FROM game_view_dedup WHERE game_id = ?').bind(c.req.param('id')),
    getDatabase(c).statement(`
      UPDATE user_game_favorites
      SET seen_rule_updated_at = MAX(seen_rule_updated_at, COALESCE((
            SELECT source.seen_rule_updated_at FROM user_game_favorites source
            WHERE source.user_id = user_game_favorites.user_id AND source.game_id = ?
          ), seen_rule_updated_at)),
          created_at = MAX(created_at, COALESCE((
            SELECT source.created_at FROM user_game_favorites source
            WHERE source.user_id = user_game_favorites.user_id AND source.game_id = ?
          ), created_at))
      WHERE game_id = ?
    `).bind(c.req.param('id'), c.req.param('id'), parsed.data.targetGameId),
    getDatabase(c).statement(`
      DELETE FROM user_game_favorites
      WHERE game_id = ? AND EXISTS (
        SELECT 1 FROM user_game_favorites target
        WHERE target.user_id = user_game_favorites.user_id AND target.game_id = ?
      )
    `).bind(c.req.param('id'), parsed.data.targetGameId),
    getDatabase(c).statement('UPDATE user_game_favorites SET game_id = ? WHERE game_id = ?')
      .bind(parsed.data.targetGameId, c.req.param('id')),
    getDatabase(c).statement('UPDATE rule_importance_votes SET game_id = ? WHERE game_id = ?')
      .bind(parsed.data.targetGameId, c.req.param('id')),
    getDatabase(c).statement('UPDATE submissions SET game_id = ? WHERE game_id = ?').bind(parsed.data.targetGameId, c.req.param('id')),
    getDatabase(c).statement('UPDATE rules SET game_id = ?, updated_at = ? WHERE game_id = ?').bind(parsed.data.targetGameId, timestamp, c.req.param('id')),
    getDatabase(c).statement('UPDATE games SET merged_into_game_id = ?, updated_at = ? WHERE id = ?').bind(parsed.data.targetGameId, timestamp, c.req.param('id')),
    getDatabase(c).statement('UPDATE games SET updated_at = ? WHERE id = ?').bind(timestamp, parsed.data.targetGameId),
  ]);
  return c.json({ ok: true, targetGameId: parsed.data.targetGameId });
});


export { gamesRoutes };
