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

export const RULE_CATEGORIES = [
  'teaching_setup_opening',
  'action_effect_detail',
  'flow_endgame_scoring',
] as const;

export type RuleCategory = (typeof RULE_CATEGORIES)[number];

export const RULE_CATEGORY_LABELS: Record<RuleCategory, string> = {
  teaching_setup_opening: '教學、設置、開局',
  action_effect_detail: '行動、效果、細節',
  flow_endgame_scoring: '流程、終局、計分',
};
export type UserRole = 'admin' | 'editor';

export interface SessionUser {
  id: string;
  email: string;
  displayName?: string;
  nickname?: string;
  showNickname?: boolean;
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

export interface AccountPayload {
  user: SessionUser;
  createdRules: AccountRuleSummary[];
  modifiedRules: AccountRevisionSummary[];
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
  renameOwnerId?: string;
  renameLocked?: boolean;
}

export interface GameCatalogPayload {
  generation: number;
  throughVersion: number;
  generatedAt: number;
  games: GameSummary[];
}

export interface GameCatalogChange {
  gameId: string;
  catalogVersion: number;
  deleted: boolean;
  game?: GameSummary;
}

export interface GameCatalogChangesPayload {
  changes: GameCatalogChange[];
  throughVersion: number;
  hasMore: boolean;
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
  categoryHints?: RuleCategory[];
  detectionKeywords?: string[];
}

export interface PublicTagCatalogChange {
  tagId: string;
  catalogVersion: number;
  deleted: boolean;
  tag?: TagSummary;
}

export interface PublicTagCatalogPayload {
  tags: TagSummary[];
  throughVersion: number;
}

export interface PublicTagCatalogChangesPayload {
  changes: PublicTagCatalogChange[];
  throughVersion: number;
  hasMore: boolean;
}

export interface RuleCard {
  id: string;
  gameId: string;
  statement: string;
  commonMistake?: string;
  details?: string;
  flowStage?: FlowStage | null;
  categories?: RuleCategory[];
  playerCounts?: number[];
  editionNotes?: string[];
  editionNote?: string;
  sourceLabel?: string;
  sourceUrl?: string;
  sourceLinks: Array<{ label?: string; url: string }>;
  status: 'draft' | 'published' | 'hidden';
  createdBy?: string;
  createdByNickname?: string;
  editedByNicknames?: string[];
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
  categories?: RuleCategory[];
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
  categories?: RuleCategory[];
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
