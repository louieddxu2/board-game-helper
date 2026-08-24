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
export type ContributionReviewStatus = 'not_required' | 'pending' | 'reviewed';

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
  visibility?: 'public' | 'hidden';
  reviewStatus?: ContributionReviewStatus;
  reviewedByNickname?: string;
  reviewedAt?: number;
  pendingRuleCount?: number;
}

export interface AccountDeletionSummary {
  deletableRuleCount: number;
  retainedRuleCount: number;
  isLastAdmin: boolean;
}

export interface GameCatalogPayload {
  generation: number;
  throughVersion: number;
  generatedAt: number;
  games: GameSummary[];
}

export const ATTRIBUTE_COMPARISON_RESULTS = ['A_HIGHER', 'SIMILAR', 'B_HIGHER'] as const;
export type AttributeComparisonResult = (typeof ATTRIBUTE_COMPARISON_RESULTS)[number];

export interface AttributeDefinition {
  id: string;
  key: string;
  name: string;
  shortDescription?: string;
  fullDescription?: string;
  minValue: number;
  maxValue: number;
  sortOrder: number;
}

export interface AttributeSubjectComponent {
  order: number;
  gameId?: string;
  type: 'base' | 'expansion' | 'label';
  label: string;
}

export interface AttributeSubject {
  id: string;
  slug: string;
  kind: 'game' | 'configuration';
  displayName: string;
  gameId?: string;
  gameSlug?: string;
  components?: AttributeSubjectComponent[];
}

export interface AttributeScoreSummary {
  average: number;
  count: number;
  myValue?: number;
}

export interface AttributeProfileEntry extends AttributeScoreSummary {
  attributeId: string;
}

export interface AttributeComparisonSummary {
  result: AttributeComparisonResult;
  count: number;
}

export interface AttributesPayload {
  attributes: AttributeDefinition[];
  subjects: AttributeSubject[];
  values: AttributeMatrixValue[];
}

export interface AttributeMatrixValue {
  subjectId: string;
  attributeId: string;
  average: number;
  count: number;
}

export interface AttributeWorkbenchPayload {
  subjectA: AttributeSubject;
  subjectB: AttributeSubject;
  attributeId: string;
  scores: {
    a: AttributeScoreSummary;
    b: AttributeScoreSummary;
  };
  profile: {
    a: AttributeProfileEntry[];
    b: AttributeProfileEntry[];
  };
  comparisons: AttributeComparisonSummary[];
  myComparison?: AttributeComparisonResult;
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
  unresolved?: boolean;
}

export interface TagSelection {
  id?: string;
  name: string;
  unresolved?: boolean;
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
  reviewStatus?: ContributionReviewStatus;
  reviewedByNickname?: string;
  reviewedAt?: number;
  createdAt?: number;
  updatedAt?: number;
  importanceCount?: number;
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
  externalResources?: GameExternalResource[];
}

export const GAME_EXTERNAL_RESOURCE_CATEGORIES = ['teaching', 'help_card', 'faq'] as const;
export type GameExternalResourceCategory = (typeof GAME_EXTERNAL_RESOURCE_CATEGORIES)[number];

export interface GameExternalResource {
  id: string;
  gameId: string;
  name: string;
  category: GameExternalResourceCategory;
  url: string;
  createdAt: number;
  updatedAt: number;
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
  tagIds?: string[];
  newTagNames?: string[];
}

export interface RuleImportancePayload {
  ruleIds: string[];
}

export interface RuleImportanceMutationPayload {
  important: boolean;
  count: number;
}

export interface PersonalHomeGame {
  id: string;
  slug: string;
  displayName: string;
  latestRule?: {
    id: string;
    statement: string;
    updatedAt: number;
  };
  hasUpdates: boolean;
}

export interface PersonalHomePayload {
  favorites: PersonalHomeGame[];
  recentUpdates: PersonalHomeGame[];
}

export interface FavoriteMutationPayload {
  favorite: boolean;
  favoriteCount: number;
  wasFirst?: boolean;
}

export interface SubmissionInput {
  gameId?: string;
  newGame?: {
    displayName: string;
    englishName?: string;
  };
  sourceLabel?: string;
  sourceUrl?: string;
  idempotencyKey: string;
  rules: SubmissionRuleInput[];
}

export interface ContributionQuota {
  pendingRules: number;
  ruleLimit: number;
  remainingRules: number;
  pendingGames: number;
  gameLimit: number;
  remainingGames: number;
}

export interface ContributionRuleSummary {
  id: string;
  gameId: string;
  gameName: string;
  gameSlug: string;
  statement: string;
  status: RuleCard['status'];
  reviewStatus: ContributionReviewStatus;
  reviewedByNickname?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ContributionGameSummary {
  id: string;
  slug: string;
  displayName: string;
  visibility: 'public' | 'hidden';
  reviewStatus: ContributionReviewStatus;
  reviewedByNickname?: string;
  mergedIntoGameId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ContributionsPayload {
  quota: ContributionQuota;
  rules: ContributionRuleSummary[];
  games: ContributionGameSummary[];
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
