import type { RuleCard, SessionUser } from '../shared/types';

export const canUserEditRule = (rule: RuleCard, user: SessionUser | null, isAdmin: boolean) => (
  isAdmin || Boolean(user?.roles.includes('editor') && rule.createdBy && rule.createdBy === user.id)
);
