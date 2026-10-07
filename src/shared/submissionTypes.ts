import type { RuleCard } from './contentTypes';
import type { ContributionReviewStatus, FlowStage, RuleCategory } from './ruleTypes';

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
