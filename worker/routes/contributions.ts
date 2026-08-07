import { Hono } from 'hono';
import { requireRole, requireUser, type AppVariables } from '../auth';
import type { RouteEnv } from '../env';
import { getDatabase } from '../data/database';
import { GAME_CONTRIBUTION_LIMIT, RULE_CONTRIBUTION_LIMIT } from '../contributions';
import { setNoCache } from './shared';

const contributionRoutes = new Hono<{ Bindings: RouteEnv; Variables: AppVariables }>();

contributionRoutes.get('/api/account/contributions', requireUser, async (c) => {
  const user = c.get('user')!;
  const [rulesResult, editProposalsResult, gamesResult] = await Promise.all([
    getDatabase(c).statement(`
      SELECT r.id, r.game_id, g.display_name game_name, g.slug game_slug,
        r.statement, r.status, r.review_status, r.created_at, r.updated_at
      FROM rules r
      JOIN games g ON g.id = r.game_id
      WHERE r.created_by = ? AND r.review_status = 'pending' AND r.status = 'published'
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ${RULE_CONTRIBUTION_LIMIT}
    `).bind(user.id).all<{
      id: string; game_id: string; game_name: string; game_slug: string; statement: string;
      status: 'draft' | 'published' | 'hidden'; review_status: 'not_required' | 'pending' | 'reviewed';
      created_at: number; updated_at: number;
    }>(),
    getDatabase(c).statement(`
      SELECT p.target_id id, r.game_id, g.display_name game_name, g.slug game_slug,
        p.proposed_json, r.status, r.updated_at, p.created_at
      FROM review_proposals p
      JOIN rules r ON r.id = p.target_id
      JOIN games g ON g.id = r.game_id
      WHERE p.created_by = ? AND p.operation = 'edit' AND p.status IN ('pending', 'conflict')
        AND NOT EXISTS (
          SELECT 1 FROM user_roles
          WHERE user_id = p.created_by AND role IN ('editor', 'admin') AND revoked_at IS NULL
        )
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT ${RULE_CONTRIBUTION_LIMIT}
    `).bind(user.id).all<{
      id: string; game_id: string; game_name: string; game_slug: string;
      proposed_json: string; status: 'draft' | 'published' | 'hidden'; updated_at: number; created_at: number;
    }>(),
    getDatabase(c).statement(`
      SELECT g.id, g.slug, g.display_name, g.visibility, g.review_status,
        g.merged_into_game_id, g.created_at, g.updated_at
      FROM games g
      WHERE g.created_by = ? AND g.review_status = 'pending'
        AND g.visibility = 'public' AND g.merged_into_game_id IS NULL
      ORDER BY g.created_at DESC, g.id DESC
      LIMIT ${GAME_CONTRIBUTION_LIMIT}
    `).bind(user.id).all<{
      id: string; slug: string; display_name: string; visibility: 'public' | 'hidden';
      review_status: 'not_required' | 'pending' | 'reviewed';
      merged_into_game_id: string | null; created_at: number; updated_at: number;
    }>(),
  ]);
  const pendingRules = rulesResult.results ?? [];
  const pendingEdits = (editProposalsResult.results ?? []).map((row) => {
    let statement = '';
    try {
      const proposed = JSON.parse(row.proposed_json) as { statement?: unknown };
      if (typeof proposed.statement === 'string') statement = proposed.statement;
    } catch { /* keep malformed historical proposals visible without failing the account page */ }
    return {
      id: row.id, gameId: row.game_id, gameName: row.game_name, gameSlug: row.game_slug,
      statement: statement || '待審核修改', status: row.status, reviewStatus: 'pending' as const,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  });
  const pendingGames = gamesResult.results ?? [];
  setNoCache(c);
  return c.json({
    quota: {
      pendingRules: pendingRules.length + pendingEdits.length,
      ruleLimit: RULE_CONTRIBUTION_LIMIT,
      remainingRules: Math.max(0, RULE_CONTRIBUTION_LIMIT - pendingRules.length - pendingEdits.length),
      pendingGames: pendingGames.length,
      gameLimit: GAME_CONTRIBUTION_LIMIT,
      remainingGames: Math.max(0, GAME_CONTRIBUTION_LIMIT - pendingGames.length),
    },
    rules: [...pendingRules.map((row) => ({
      id: row.id, gameId: row.game_id, gameName: row.game_name, gameSlug: row.game_slug,
      statement: row.statement, status: row.status, reviewStatus: row.review_status,
      createdAt: row.created_at, updatedAt: row.updated_at,
    })), ...pendingEdits],
    games: pendingGames.map((row) => ({
      id: row.id, slug: row.slug, displayName: row.display_name, visibility: row.visibility,
      reviewStatus: row.review_status,
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
