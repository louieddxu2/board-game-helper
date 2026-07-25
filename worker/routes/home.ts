import { Hono } from 'hono';
import { type AppVariables } from '../auth';
import type { Env } from '../env';
import { now } from '../utils';
import { setNoCache, toGame, GameRow } from './shared';

const homeRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

homeRoutes.get('/api/home', async (c) => {
  const d1Logs: Array<{ name: string; rowsRead: number }> = [];
  const track = <T extends { meta?: { rows_read?: number } }>(name: string, res: T): T => {
    d1Logs.push({ name, rowsRead: res.meta?.rows_read ?? 0 });
    return res;
  };

  const windowResult = track('home:window-start', await c.env.DB.prepare(`
    WITH recent_games AS (
      SELECT game_id, MIN(view_date) as min_date, MAX(created_at) as last_seen
      FROM daily_views
      WHERE view_date >= DATE('now', '-30 days')
      GROUP BY game_id
      ORDER BY last_seen DESC
      LIMIT 8
    )
    SELECT MIN(min_date) as window_start FROM recent_games;
  `).all<{ window_start: string | null }>());

  const windowRow = windowResult.results?.[0];
  let startDateStr = '';
  if (windowRow && windowRow.window_start) {
    startDateStr = new Date(new Date(windowRow.window_start).getTime() - 7 * 86400000).toISOString().slice(0, 10);
  }
  const viewDateCondition = startDateStr ? `view_date >= '${startDateStr}'` : `view_date >= DATE('now', '-7 days')`;

  // 2. 統計階段
  const [popularGameIdsRaw, recentRaw] = await Promise.all([
    c.env.DB.prepare(`
      WITH scoped_views AS (
        SELECT game_id, user_id, created_at
        FROM daily_views
        WHERE ${viewDateCondition}
        ORDER BY view_date DESC, created_at DESC
        LIMIT 200
      )
      SELECT game_id, COUNT(DISTINCT user_id) AS view_count
      FROM scoped_views
      GROUP BY game_id
      ORDER BY view_count DESC, MAX(created_at) DESC
      LIMIT 8
    `).all<{ game_id: string }>(),
    c.env.DB.prepare(`
      SELECT id FROM rules
      WHERE status = 'published'
      ORDER BY created_at DESC LIMIT 8
    `).all<{ id: string }>(),
  ]);

  const popularGameIdsResult = track('home:popular-games', await popularGameIdsRaw);
  const recentResult = track('home:recent-rules', await recentRaw);

  let popularGameIds = (popularGameIdsResult.results ?? []).map((r) => r.game_id);

  if (popularGameIds.length < 8) {
    const fallbackGameIdsResult = track('home:fallback-games', await c.env.DB.prepare(`
      SELECT g.id FROM games g
      JOIN rules r ON r.game_id = g.id AND r.status = 'published'
      WHERE g.merged_into_game_id IS NULL
      GROUP BY g.id
      ORDER BY MAX(g.updated_at) DESC LIMIT 8
    `).all<{ id: string }>());
    const extraIds = (fallbackGameIdsResult.results ?? []).map((g) => g.id);
    popularGameIds = Array.from(new Set([...popularGameIds, ...extraIds])).slice(0, 8);
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
      ORDER BY view_date DESC, created_at DESC
      LIMIT 200
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
        ORDER BY created_at DESC
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
  const featuredFiltered = featured.filter((f) => f.ruleId && f.gameSlug);
  const featuredRuleIds = featuredFiltered.map((f) => f.ruleId);

  setNoCache(c);
  return c.json({
    generatedAt: now(),
    popularGameIds,
    recentRuleIds,
    featuredRuleIds,
    featured: featuredFiltered,
    debugD1Metrics: d1Logs,
  });
});

export { homeRoutes };
