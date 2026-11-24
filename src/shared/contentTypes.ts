import type { GameSummary, GameVariantSummary } from './catalogTypes';
import type { ContributionReviewStatus, FlowStage, RuleCategory } from './ruleTypes';

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
  /** Admins only, like other account information. */
  editorEmail?: string;
  editorNickname?: string;
  previousStatement: string;
}

/** Who submitted a rule, shown to admins even when the account keeps its nickname private. */
export interface RuleContributor {
  id: string;
  maskedEmail: string;
  nickname?: string;
  deleted: boolean;
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
  /** The editor who added it; only they or an admin may delete it. */
  createdBy?: string;
  createdAt: number;
  updatedAt: number;
}

export interface HomePayload {
  generatedAt: number;
  /** moreRuleIds: the game's next newest rules, for the phone's rule window. */
  featured: { gameSlug: string; gameName: string; gameEnglishName?: string; ruleId: string; moreRuleIds?: string[]; publishedRuleCount?: number }[];
  featuredRules: Array<RuleCard & { gameName: string; gameSlug: string }>;
  recentRules: Array<RuleCard & { gameName: string; gameSlug: string }>;
  popularGames: GameSummary[];
  popularGameIds?: string[];
  /** One per game, aligned with recentRuleIds: the game's newest rule and that Taiwan day's count. */
  recentRuleIds?: string[];
  recentGames?: HomeRecentGame[];
  featuredRuleIds?: string[];
}

export interface HomeRecentGame {
  ruleId: string;
  /** YYYY-MM-DD in Taiwan time. */
  addedOn: string;
  addedCount: number;
}

export interface HomeIDPayload {
  generatedAt: number;
  popularGameIds: string[];
  recentRuleIds: string[];
  featuredRuleIds: string[];
}
