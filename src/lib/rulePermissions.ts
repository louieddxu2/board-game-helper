import type { RuleCard, SessionUser } from '../shared/types';

export const canUserEditRule = (rule: RuleCard, user: SessionUser | null, isAdmin: boolean) => (
  isAdmin || Boolean(user && (
    (user.roles.includes('editor') && (rule.createdBy === user.id || (rule.reviewStatus ?? 'not_required') !== 'not_required'))
    || (!user.roles.includes('editor') && rule.status !== 'hidden'
      && ((rule.reviewStatus ?? 'not_required') !== 'pending' || rule.createdBy === user.id))
  ))
);

export const canUserReviewRule = (rule: RuleCard, user: SessionUser | null) => Boolean(
  user?.roles.some((role) => role === 'admin' || role === 'editor') && rule.reviewStatus === 'pending',
);
