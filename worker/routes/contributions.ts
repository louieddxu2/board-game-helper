import { Hono } from 'hono';
import { requireRole, requireUser, type AppVariables } from '../auth';
import type { RouteEnv } from '../env';
import { getDatabase } from '../data/database';
import { queryContributionQuota } from '../contributions';
import { setNoCache } from './shared';

const contributionRoutes = new Hono<{ Bindings: RouteEnv; Variables: AppVariables }>();

contributionRoutes.get('/api/account/contributions', requireUser, async (c) => {
  const user = c.get('user')!;
  const [quota, rulesResult, gamesResult] = await Promise.all([
    queryContributionQuota(getDatabase(c), user.id),
    getDatabase(c).statement(`
      SELECT r.id, r.game_id, g.display_name game_name, g.slug game_slug,
        r.statement, r.status, r.review_status, r.created_at, r.updated_at,
        CASE WHEN reviewer.show_nickname = 1
          THEN COALESCE(r.reviewed_by_nickname, reviewer.nickname)
        END reviewed_by_nickname
      FROM rules r
      JOIN games g ON g.id = r.game_id
      LEFT JOIN users reviewer ON reviewer.id = r.reviewed_by
      WHERE r.created_by = ?
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT 100
    `).bind(user.id).all<{
      id: string; game_id: string; game_name: string; game_slug: string; statement: string;
      status: 'draft' | 'published' | 'hidden'; review_status: 'not_required' | 'pending' | 'reviewed';
      reviewed_by_nickname: string | null; created_at: number; updated_at: number;
    }>(),
    getDatabase(c).statement(`
      SELECT g.id, g.slug, g.display_name, g.visibility, g.review_status,
        g.merged_into_game_id, g.created_at, g.updated_at,
        CASE WHEN reviewer.show_nickname = 1
          THEN COALESCE(g.reviewed_by_nickname, reviewer.nickname)
        END reviewed_by_nickname
      FROM games g
      LEFT JOIN users reviewer ON reviewer.id = g.reviewed_by
      WHERE g.created_by = ?
      ORDER BY g.created_at DESC, g.id DESC
      LIMIT 50
    `).bind(user.id).all<{
      id: string; slug: string; display_name: string; visibility: 'public' | 'hidden';
      review_status: 'not_required' | 'pending' | 'reviewed'; reviewed_by_nickname: string | null;
      merged_into_game_id: string | null; created_at: number; updated_at: number;
    }>(),
  ]);
  setNoCache(c);
  return c.json({
    quota,
    rules: (rulesResult.results ?? []).map((row) => ({
      id: row.id, gameId: row.game_id, gameName: row.game_name, gameSlug: row.game_slug,
      statement: row.statement, status: row.status, reviewStatus: row.review_status,
      reviewedByNickname: row.reviewed_by_nickname ?? undefined,
      createdAt: row.created_at, updatedAt: row.updated_at,
    })),
    games: (gamesResult.results ?? []).map((row) => ({
      id: row.id, slug: row.slug, displayName: row.display_name, visibility: row.visibility,
      reviewStatus: row.review_status, reviewedByNickname: row.reviewed_by_nickname ?? undefined,
      mergedIntoGameId: row.merged_into_game_id ?? undefined,
      createdAt: row.created_at, updatedAt: row.updated_at,
    })),
  });
});

contributionRoutes.get('/api/editor/contributions', requireRole('editor'), async (c) => {
  const [rulesResult, gamesResult] = await Promise.all([
    getDatabase(c).statement(`
      SELECT game_id, COUNT(*) pending_rule_count
      FROM rules
      WHERE review_status = 'pending' AND status = 'published'
      GROUP BY game_id
    `).all<{ game_id: string; pending_rule_count: number }>(),
    getDatabase(c).statement(`
      SELECT id FROM games
      WHERE review_status = 'pending' AND visibility = 'public' AND merged_into_game_id IS NULL
    `).all<{ id: string }>(),
  ]);
  setNoCache(c);
  return c.json({
    games: (rulesResult.results ?? []).map((row) => ({ gameId: row.game_id, pendingRuleCount: Number(row.pending_rule_count) })),
    pendingGameIds: (gamesResult.results ?? []).map((row) => row.id),
  });
});

export { contributionRoutes };
