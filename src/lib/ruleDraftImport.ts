import { z } from 'zod';
import { RULE_CATEGORIES, type RuleCategory } from '../shared/types';

export const RULE_DRAFT_IMPORT_FORMAT = 'wrong-board-game-rules-draft';
export const RULE_DRAFT_IMPORT_SCHEMA_VERSION = 1;

const optionalText = (maximum: number) => z.string().trim().max(maximum).optional();

const ruleSchema = z.object({
  statement: z.string().trim().min(1).max(2000),
  commonMistake: optionalText(2000),
  categories: z.array(z.enum(RULE_CATEGORIES)).max(RULE_CATEGORIES.length).optional(),
  playerCounts: z.array(z.number().int().min(1).max(8)).max(8).optional(),
  editionNotes: z.array(z.string().trim().min(1).max(300)).max(20).optional(),
  sourceLabel: optionalText(300),
  sourceUrl: z.url().max(2000).optional(),
  tagNames: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
}).strict();

const importSchema = z.object({
  format: z.literal(RULE_DRAFT_IMPORT_FORMAT),
  schemaVersion: z.literal(RULE_DRAFT_IMPORT_SCHEMA_VERSION),
  game: z.object({
    id: optionalText(100),
    slug: optionalText(120),
    displayName: z.string().trim().min(1).max(200),
    englishName: optionalText(200),
  }).strict().refine((game) => Boolean(game.id) === Boolean(game.slug), {
    message: '既有遊戲必須同時提供 game.id 與 game.slug',
  }),
  playedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  privateNote: optionalText(2000),
  sourceLabel: optionalText(300),
  sourceUrl: z.url().max(2000).optional(),
  rules: z.array(ruleSchema).min(1).max(20),
}).strict();

export interface RuleDraftImportRule {
  statement: string;
  commonMistake?: string;
  categories?: RuleCategory[];
  playerCounts?: number[];
  editionNotes?: string[];
  sourceLabel?: string;
  sourceUrl?: string;
  tagNames?: string[];
}

export interface RuleDraftImportFile {
  format: typeof RULE_DRAFT_IMPORT_FORMAT;
  schemaVersion: typeof RULE_DRAFT_IMPORT_SCHEMA_VERSION;
  game: { id?: string; slug?: string; displayName: string; englishName?: string };
  sourceLabel?: string;
  sourceUrl?: string;
  rules: RuleDraftImportRule[];
}

export const parseRuleDraftImport = (text: string): RuleDraftImportFile => {
  if (new TextEncoder().encode(text).byteLength > 64 * 1024) throw new Error('匯入檔不可超過 64 KB');
  let json: unknown;
  try { json = JSON.parse(text); }
  catch { throw new Error('檔案不是有效的 JSON'); }
  const parsed = importSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`匯入格式錯誤：${issue.path.join('.') || 'root'} ${issue.message}`);
  }
  const { playedOn: _playedOn, privateNote: _privateNote, ...data } = parsed.data;
  return {
    ...data,
    rules: parsed.data.rules.map((rule) => ({
      ...rule,
      categories: rule.categories ? Array.from(new Set(rule.categories)) : undefined,
      playerCounts: rule.playerCounts ? Array.from(new Set(rule.playerCounts)).sort((a, b) => a - b) : undefined,
      editionNotes: rule.editionNotes ? Array.from(new Set(rule.editionNotes)) : undefined,
      tagNames: rule.tagNames ? Array.from(new Set(rule.tagNames)) : undefined,
      sourceLabel: rule.sourceLabel || parsed.data.sourceLabel,
      sourceUrl: rule.sourceUrl || parsed.data.sourceUrl,
    })),
  };
};
