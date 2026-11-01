import type { RuleCard } from './contentTypes';
import type { UserRole } from './ruleTypes';

export interface SessionUser {
  id: string;
  maskedEmail?: string;
  displayName?: string;
  nickname?: string;
  showNickname?: boolean;
  avatarUrl?: string;
  roles: UserRole[];
}

export interface EditorAccessUser {
  id: string;
  maskedEmail: string;
  displayName?: string;
  role: UserRole;
  grantedAt: number;
  revokedAt?: number;
}

export interface EditorInvitation {
  id: string;
  maskedEmail: string;
  note?: string;
  role: UserRole;
  invitedAt: number;
}

// A signed-in account without an active role, shown so an admin can grant access directly.
export interface EditorCandidate {
  id: string;
  maskedEmail: string;
  nickname?: string;
  displayName?: string;
  ruleCount: number;
  pendingRuleCount: number;
  lastLoginAt?: number;
}

export interface EditorAdminPayload {
  users: EditorAccessUser[];
  invitations: EditorInvitation[];
  candidates: EditorCandidate[];
}

export interface AccountRuleSummary {
  id: string;
  gameName: string;
  gameSlug: string;
  statement: string;
  status: RuleCard['status'];
  canRestore?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface AccountRevisionSummary {
  id: string;
  ruleId: string;
  gameName: string;
  gameSlug: string;
  currentStatement: string;
  previousStatement?: string;
  editedByName?: string;
  reason: string;
  editedAt: number;
}

export interface AccountPayload {
  user: SessionUser;
}

export interface AccountCreatedRulesPayload {
  rules: AccountRuleSummary[];
}

export interface AccountModifiedRulesPayload {
  revisions: AccountRevisionSummary[];
}
