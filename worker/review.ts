import { z } from 'zod';
import { FLOW_STAGES, type FlowStage } from '../src/shared/types';
import { normalizeText, sha256Hex } from './utils';

export const REVIEW_FORMAT = 'wrong-board-game-rules-review';
export const REVIEW_SCHEMA_VERSION = 1;

export const reviewContentSchema = z.object({
  statement: z.string().trim().min(1).max(2000),
  commonMistake: z.string().trim().max(2000).nullable().optional(),
  details: z.string().trim().max(5000).nullable().optional(),
  flowStage: z.enum(FLOW_STAGES),
  playerCountNote: z.string().trim().max(300).nullable().optional(),
  editionNote: z.string().trim().max(300).nullable().optional(),
  sourceLabel: z.string().trim().max(300).nullable().optional(),
  sourceUrl: z.url().max(2000).nullable().optional().or(z.literal('')),
  tagNames: z.array(z.string().trim().min(1).max(40)).max(8),
});

export type ReviewContent = z.infer<typeof reviewContentSchema>;

export interface ReviewExportItem {
  action: 'unchanged' | 'propose' | 'hide';
  target: {
    type: 'rule';
    id: string;
    gameId: string;
    gameName: string;
    gameSlug: string;
  };
  base: { updatedAt: number; contentHash: string };
  current: ReviewContent;
  proposed: ReviewContent;
  reason: string;
}

export interface ReviewFile {
  format: typeof REVIEW_FORMAT;
  schemaVersion: typeof REVIEW_SCHEMA_VERSION;
  name: string;
  exportedAt: number;
  datasetVersion: string;
  scope: Record<string, unknown>;
  instructions: string[];
  items: ReviewExportItem[];
}

export const normalizedReviewContent = (content: ReviewContent): ReviewContent => ({
  statement: content.statement.trim(),
  commonMistake: content.commonMistake?.trim() || null,
  details: content.details?.trim() || null,
  flowStage: content.flowStage as FlowStage,
  playerCountNote: content.playerCountNote?.trim() || null,
  editionNote: content.editionNote?.trim() || null,
  sourceLabel: content.sourceLabel?.trim() || null,
  sourceUrl: content.sourceUrl?.trim() || null,
  tagNames: Array.from(new Map(content.tagNames
    .map((name) => name.trim().replace(/^#/, ''))
    .filter(Boolean)
    .map((name) => [normalizeText(name), name] as const)).values()).slice(0, 8),
});

export const reviewContentHash = async (content: ReviewContent): Promise<string> =>
  sha256Hex(JSON.stringify(normalizedReviewContent(content)));

export const sameReviewContent = (left: ReviewContent, right: ReviewContent): boolean =>
  JSON.stringify(normalizedReviewContent(left)) === JSON.stringify(normalizedReviewContent(right));

export const reviewFileSchema = z.object({
  format: z.literal(REVIEW_FORMAT),
  schemaVersion: z.literal(REVIEW_SCHEMA_VERSION),
  name: z.string().trim().min(1).max(160),
  exportedAt: z.number(),
  datasetVersion: z.string().max(200),
  scope: z.record(z.string(), z.unknown()),
  instructions: z.array(z.string()).max(20),
  items: z.array(z.object({
    action: z.enum(['unchanged', 'propose', 'hide']),
    target: z.object({
      type: z.literal('rule'),
      id: z.string().min(1).max(100),
      gameId: z.string().min(1).max(100),
      gameName: z.string().max(160),
      gameSlug: z.string().max(160),
    }),
    base: z.object({
      updatedAt: z.number().int().nonnegative(),
      contentHash: z.string().length(64),
    }),
    current: reviewContentSchema,
    proposed: reviewContentSchema,
    reason: z.string().max(1000),
  })).max(500),
});
