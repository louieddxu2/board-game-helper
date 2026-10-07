import type { GameSummary, GameVariantSummary } from './catalogTypes';
import type { ContributionReviewStatus, FlowStage, RuleCategory } from './ruleTypes';

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
  variants?: GameVariantSummary[];
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
