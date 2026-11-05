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

  // Views are gated by login, but only anonymous browser-day aggregates reach this query.

  const [popularGameIdsRaw, recentRaw] = await Promise.all([
    getDatabase(c).statement(`
      SELECT views.game_id, SUM(views.view_count) AS view_count
      FROM game_daily_view_counts views
      JOIN games g ON g.id = views.game_id
      WHERE views.view_date >= DATE('now', '-6 days')
        AND g.visibility = 'public' AND g.merged_into_game_id IS NULL
      GROUP BY views.game_id
      ORDER BY view_count DESC, MAX(last_view_at) DESC
      LIMIT 6
    `).all<{ game_id: string }>(),
    getDatabase(c).statement(`
      SELECT r.id FROM rules r
      JOIN games g ON g.id = r.game_id
      WHERE r.status = 'published' AND g.visibility = 'public'
      ORDER BY r.created_at DESC LIMIT 6
    `).all<{ id: string }>(),
  ]);

  const popularGameIdsResult = track('home:popular-games', popularGameIdsRaw);
  const recentResult = track('home:recent-rules', recentRaw);

  // Only games people actually viewed; the section shrinks or hides rather than filling with unviewed games.
  const popularGameIds = (popularGameIdsResult.results ?? []).map((r) => r.game_id);
  const recentRuleIds = (recentResult.results ?? []).map((r) => r.id);

  if (popularGameIds.length === 0) {
    setNoCache(c);
    return c.json({ generatedAt: now(), popularGameIds, recentRuleIds, featuredRuleIds: [], featured: [], debugD1Metrics: d1Logs });
  }

  // 3. 點對點極速解析內容 (WHERE id IN)
  const placeholders = popularGameIds.map(() => '?').join(',');

  const gamesResult = track('home:games-meta', await getDatabase(c).statement(`
    SELECT g.id, g.slug, g.display_name, g.english_name, g.updated_at, g.entity_kind,
      g.published_rule_count
    FROM games g
    WHERE g.id IN (${placeholders}) AND g.merged_into_game_id IS NULL AND g.visibility = 'public'
  `).bind(...popularGameIds).all<GameRow>());

  const gameMap = new Map((gamesResult.results ?? []).map((g) => [g.id, toGame(g)]));

  const featuredRuleIdsResult = track('home:featured-rule-ids', await getDatabase(c).statement(`
    SELECT game_id, rule_id
    FROM game_public_rule_heads
    WHERE game_id IN (${placeholders})
  `).bind(...popularGameIds).all<{ game_id: string; rule_id: string }>());

  const featuredRuleIdByGame = new Map<string, string>();
  (featuredRuleIdsResult.results ?? []).forEach((row) => {
    if (!featuredRuleIdByGame.has(row.game_id)) {
      featuredRuleIdByGame.set(row.game_id, row.rule_id);
    }
  });

  // A game's newest rule is often already in the recent list, so show its next rule instead.
  // Only those games are queried; each walks idx_rules_game_public_updated newest-first and stops at the
  // first rule not listed, reading at most one row more than that game's rules in the recent list.
  const recentRuleIdSet = new Set(recentRuleIds);
  const gamesNeedingAnotherRule = popularGameIds.filter((id) => recentRuleIdSet.has(featuredRuleIdByGame.get(id) ?? ''));
  if (gamesNeedingAnotherRule.length > 0) {
    const excluded = recentRuleIds.map(() => '?').join(',');
    const alternatives = await getDatabase(c).batch(gamesNeedingAnotherRule.map((gameId) => getDatabase(c).statement(`
      SELECT game_id, id FROM rules
      WHERE game_id = ? AND status = 'published' AND id NOT IN (${excluded})
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `).bind(gameId, ...recentRuleIds)));
    gamesNeedingAnotherRule.forEach((gameId, index) => {
      const row = (track(`home:featured-alternative-${index}`, alternatives[index]).results as Array<{ id: string }> | undefined)?.[0];
      if (row) featuredRuleIdByGame.set(gameId, row.id); else featuredRuleIdByGame.delete(gameId);
    });
  }

  const featured = popularGameIds
    .filter((id) => gameMap.has(id) && featuredRuleIdByGame.has(id))
    .map((id) => ({
      gameSlug: gameMap.get(id)!.slug,
      gameName: gameMap.get(id)!.displayName,
      ruleId: featuredRuleIdByGame.get(id)!,
      publishedRuleCount: gameMap.get(id)!.publishedRuleCount,
    }));

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
