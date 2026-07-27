export const FLOW_STAGES = [
  'setup',
  'round',
  'action',
  'end_scoring',
  'edition_player_count',
  'always',
  'uncategorized',
] as const;

export type FlowStage = (typeof FLOW_STAGES)[number];
export type UserRole = 'admin' | 'editor';

export interface SessionUser {
  id: string;
  email: string;
  displayName?: string;
  nickname?: string;
  avatarUrl?: string;
  roles: UserRole[];
}

export interface AccountRuleSummary {
  id: string;
  gameName: string;
  gameSlug: string;
  statement: string;
  status: RuleCard['status'];
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

export interface AccountViewedRuleSummary {
  ruleId: string;
  gameName: string;
  gameSlug: string;
  statement: string;
  viewedAt: number;
  viewCount: number;
}

export interface AccountPayload {
  user: SessionUser;
  createdRules: AccountRuleSummary[];
  modifiedRules: AccountRevisionSummary[];
  viewedRules: AccountViewedRuleSummary[];
}

export interface GameSummary {
  id: string;
  slug: string;
  displayName: string;
  englishName?: string;
  aliases?: string[];
  ruleCount: number;
  publishedRuleCount?: number;
  totalRuleCount?: number;
  latestRuleUpdatedAt?: number;
  updatedAt: number;
}

export interface RuleSearchResult {
  ruleId: string;
  gameId: string;
  gameName: string;
  gameSlug: string;
  statement: string;
}

export interface TagSummary {
  id: string;
  slug: string;
  name: string;
  usageCount?: number;
  isPublic?: boolean;
  updatedAt?: number;
  description?: string;
  aliases?: string[];
}

export interface RuleCard {
  id: string;
  gameId: string;
  statement: string;
  commonMistake?: string;
  details?: string;
  flowStage?: FlowStage | null;
  playerCounts?: number[];
  editionNotes?: string[];
  editionNote?: string;
  sourceLabel?: string;
  sourceUrl?: string;
  sourceLinks: Array<{ label?: string; url: string }>;
  status: 'draft' | 'published' | 'hidden';
  createdBy?: string;
  createdAt?: number;
  updatedAt?: number;
  tagIds?: string[];
  tags: TagSummary[];
}

export interface RuleRevision {
  id: string;
  reason: string;
  createdAt: number;
  editorEmail?: string;
  previousStatement: string;
}

export interface GameDetail extends GameSummary {
  aliases: string[];
  rules: RuleCard[];
}

export interface HomePayload {
  generatedAt: number;
  featured: { gameSlug: string; gameName: string; ruleId: string }[];
  featuredRules: Array<RuleCard & { gameName: string; gameSlug: string }>;
  recentRules: Array<RuleCard & { gameName: string; gameSlug: string }>;
  popularGames: GameSummary[];
  popularGameIds?: string[];
  recentRuleIds?: string[];
  featuredRuleIds?: string[];
}

export interface HomeIDPayload {
  generatedAt: number;
  popularGameIds: string[];
  recentRuleIds: string[];
  featuredRuleIds: string[];
}

export interface SubmissionRuleInput {
  statement: string;
  commonMistake?: string;
  details?: string;
  flowStage?: FlowStage;
  playerCounts?: number[];
  editionNotes?: string[];
  editionNote?: string;
  sourceLabel?: string;
  sourceUrl?: string;
  tagNames?: string[];
}

export interface SubmissionInput {
  gameId: string;
  playedOn?: string;
  sourceLabel?: string;
  sourceUrl?: string;
  privateNote?: string;
  idempotencyKey: string;
  rules: SubmissionRuleInput[];
}

export interface ReviewContent {
  statement: string;
  commonMistake?: string | null;
  details?: string | null;
  flowStage?: FlowStage | null;
  playerCounts?: number[] | null;
  editionNotes?: string[] | null;
  editionNote?: string | null;
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  tagNames: string[];
}

export interface ReviewProposal {
  id: string;
  batchId?: string;
  batchName?: string;
  targetId: string;
  gameId: string;
  gameName: string;
  gameSlug: string;
  operation: 'edit' | 'hide';
  baseUpdatedAt: number;
  original: ReviewContent;
  proposed: ReviewContent;
  reason?: string;
  status: 'pending' | 'accepted' | 'rejected' | 'conflict' | 'cancelled';
  version: number;
  claimedBy?: string;
  claimedUntil?: number;
  createdAt: number;
}

export interface ReviewBatch {
  id: string;
  name: string;
  sourceType: 'file' | 'ai' | 'manual';
  status: 'open' | 'completed' | 'cancelled';
  proposalCount: number;
  pendingCount: number;
  acceptedCount: number;
  rejectedCount: number;
  createdAt: number;
  updatedAt: number;
}
