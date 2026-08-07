import type { ContributionQuota, ContributionReviewStatus, SessionUser } from '../src/shared/types';
import type { Database } from './data/database';

export const RULE_CONTRIBUTION_LIMIT = 6;
export const GAME_CONTRIBUTION_LIMIT = 1;

export const isTrustedEditor = (user: Pick<SessionUser, 'roles'>) =>
  user.roles.includes('admin') || user.roles.includes('editor');

export const initialReviewStatus = (user: Pick<SessionUser, 'roles'>): ContributionReviewStatus =>
  isTrustedEditor(user) ? 'not_required' : 'pending';

export const canEditContributionRule = (
  rule: { created_by: string | null; pending_review_by?: string | null; review_status: ContributionReviewStatus; status?: string },
  user: Pick<SessionUser, 'id' | 'roles'>,
) => {
  if (user.roles.includes('admin')) return true;
  if (user.roles.includes('editor')) {
    return rule.created_by === user.id || rule.review_status !== 'not_required';
  }
  return rule.created_by === user.id && rule.review_status === 'pending' && rule.status !== 'hidden';
};

export const canRestoreHiddenContributionRule = (
  rule: { created_by: string | null; hidden_by?: string | null; review_status: ContributionReviewStatus; status?: string },
  user: Pick<SessionUser, 'id' | 'roles'>,
) => {
  if (user.roles.includes('admin')) return true;
  if (user.roles.includes('editor')) {
    return rule.created_by === user.id || rule.review_status !== 'not_required';
  }
  return rule.status === 'hidden' && rule.created_by === user.id && rule.hidden_by === user.id;
};

export const canEditContributionGame = (
  game: { created_by: string | null; review_status: ContributionReviewStatus; visibility?: string },
  user: Pick<SessionUser, 'id' | 'roles'>,
) => {
  if (user.roles.includes('admin')) return true;
  if (user.roles.includes('editor')) {
    return game.created_by === user.id || game.review_status !== 'not_required';
  }
  return game.created_by === user.id && game.review_status === 'pending' && game.visibility !== 'hidden';
};

export const queryContributionQuota = async (db: Database, userId: string): Promise<ContributionQuota> => {
  const [ruleCount, gameCount] = await Promise.all([
    db.statement(`
      SELECT COUNT(*) count FROM rules
      WHERE review_status = 'pending' AND status = 'published'
        AND (created_by = ? OR pending_review_by = ?)
    `).bind(userId, userId).first<{ count: number }>(),
    db.statement(`
      SELECT COUNT(*) count FROM games
      WHERE created_by = ? AND review_status = 'pending' AND visibility = 'public'
        AND merged_into_game_id IS NULL
    `).bind(userId).first<{ count: number }>(),
  ]);
  const pendingRules = Number(ruleCount?.count ?? 0);
  const pendingGames = Number(gameCount?.count ?? 0);
  return {
    pendingRules,
    ruleLimit: RULE_CONTRIBUTION_LIMIT,
    remainingRules: Math.max(0, RULE_CONTRIBUTION_LIMIT - pendingRules),
    pendingGames,
    gameLimit: GAME_CONTRIBUTION_LIMIT,
    remainingGames: Math.max(0, GAME_CONTRIBUTION_LIMIT - pendingGames),
  };
};

export const contributionErrorCode = (error: unknown) => {
  const message = String(error).toLowerCase();
  if (message.includes('pending_rule_limit')) return 'PENDING_RULE_LIMIT_REACHED';
  if (message.includes('pending_game_limit')) return 'PENDING_GAME_LIMIT_REACHED';
  return undefined;
};
