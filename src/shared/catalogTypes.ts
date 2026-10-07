import type { GameEntityKind, GameVariantRelationType } from './gameEntity';
import type { ContributionReviewStatus } from './ruleTypes';

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
  entityKind?: GameEntityKind;
  parentGameId?: string;
  parentGameName?: string;
  parentGameSlug?: string;
}

export interface GameVariantSummary {
  id: string;
  displayName: string;
  englishName?: string;
  entityKind: Exclude<GameEntityKind, 'base'>;
  relationType: GameVariantRelationType;
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
