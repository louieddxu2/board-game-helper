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

export interface EditorAdminPayload {
  users: EditorAccessUser[];
  invitations: EditorInvitation[];
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
