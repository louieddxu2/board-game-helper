import { Hono } from 'hono';
import { z } from 'zod';
import { FLOW_STAGES, type FlowStage, type GameDetail, type GameSummary, type HomePayload, type HomeIDPayload, type ReviewBatch, type ReviewContent as SharedReviewContent, type ReviewProposal, type RuleCard, type UserRole } from '../../src/shared/types';
import { requireRole, type AppContext, type AppVariables, exchangeGoogleCredential, signInAsLocalAdmin, signInWithGoogle, signOut } from '../auth';
import type { RouteEnv } from '../env';
import type { D1Result } from '../data/database';
import { getDatabase } from '../data/database';
import { assertMutationOrigin, cleanOptional, createId, normalizeEmail, normalizeText, now, sha256Hex, slugify, trustedOrigins } from '../utils';
import { normalizedReviewContent, REVIEW_FORMAT, REVIEW_SCHEMA_VERSION, reviewContentHash, reviewContentSchema, reviewFileSchema, sameReviewContent, type ReviewContent, type ReviewFile } from '../review';
import { parseReviewCsv, serializeReviewCsv } from '../review-csv';
import { setNoCache, ruleSelect, homeRuleSelect, toRule, cleanTagNames, tagWriteStatements, toGame, reviewContentFromRow, reviewRuleSelect , RuleRow, GameRow, ReviewRuleRow } from './shared';

const homeRoutes = new Hono<{ Bindings: RouteEnv; Variables: AppVariables }>();

homeRoutes.get('/api/home', async (c) => {
  const d1Logs: Array<{ name: string; rowsRead: number; meta: unknown }> = [];
  const track = <T extends D1Result<unknown>>(name: string, res: T): T => {
    const rowsRead = Number(res.meta?.rows_read ?? (res.meta as any)?.rowsRead ?? 0);
    d1Logs.push({ name, rowsRead, meta: res.meta });
    return res;
  };

  const windowResult = track('home:window-start', await getDatabase(c).statement(`
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
    getDatabase(c).statement(`
      WITH scoped_views AS (
        SELECT game_id, user_id, created_at
        FROM daily_views
        WHERE ${viewDateCondition}
        ORDER BY view_date DESC, created_at DESC
        LIMIT 100
      )
      SELECT game_id, COUNT(DISTINCT user_id) AS view_count
      FROM scoped_views
      GROUP BY game_id
      ORDER BY view_count DESC, MAX(created_at) DESC
      LIMIT 6
    `).all<{ game_id: string }>(),
    getDatabase(c).statement(`
      SELECT id FROM rules
      WHERE status = 'published'
      ORDER BY created_at DESC LIMIT 6
    `).all<{ id: string }>(),
  ]);

  const popularGameIdsResult = track('home:popular-games', popularGameIdsRaw);
  const recentResult = track('home:recent-rules', recentRaw);

  let popularGameIds = (popularGameIdsResult.results ?? []).map((r) => r.game_id);

  if (popularGameIds.length < 6) {
    const fallbackGameIdsResult = track('home:fallback-games', await getDatabase(c).statement(`
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

  const gamesResult = track('home:games-meta', await getDatabase(c).statement(`
    SELECT g.id, g.slug, g.display_name, g.english_name, g.updated_at,
      0 AS rule_count
    FROM games g
    WHERE g.id IN (${placeholders}) AND g.merged_into_game_id IS NULL
  `).bind(...popularGameIds).all<GameRow>());

  const gameMap = new Map((gamesResult.results ?? []).map((g) => [g.id, toGame(g)]));

  const featuredRuleIdsResult = track('home:featured-rule-ids', await getDatabase(c).statement(`
    WITH scoped_views AS (
      SELECT game_id, rule_id, user_id, created_at
      FROM daily_views
      WHERE game_id IN (${placeholders}) AND rule_id != '' AND ${viewDateCondition}
      ORDER BY view_date DESC, created_at DESC
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
      const fallback = track('home:fallback-rule-id', await getDatabase(c).statement(`
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


export { homeRoutes };
