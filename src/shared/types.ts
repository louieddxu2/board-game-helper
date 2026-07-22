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
  avatarUrl?: string;
  roles: UserRole[];
}

export interface GameSummary {
  id: string;
  slug: string;
  displayName: string;
  englishName?: string;
  ruleCount: number;
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
}

export interface RuleCard {
  id: string;
  gameId: string;
  statement: string;
  commonMistake?: string;
  details?: string;
  flowStage: FlowStage;
  playerCountNote?: string;
  editionNote?: string;
  sourceLabel?: string;
  sourceUrl?: string;
  sourceLinks: Array<{ label?: string; url: string }>;
  status: 'draft' | 'published' | 'hidden';
  isFeatured: boolean;
  tags: TagSummary[];
  createdAt: number;
  updatedAt: number;
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
  featuredRules: Array<RuleCard & { gameName: string; gameSlug: string }>;
  recentRules: Array<RuleCard & { gameName: string; gameSlug: string }>;
  popularGames: GameSummary[];
}

export interface SubmissionRuleInput {
  statement: string;
  commonMistake?: string;
  details?: string;
  flowStage?: FlowStage;
  playerCountNote?: string;
  editionNote?: string;
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
