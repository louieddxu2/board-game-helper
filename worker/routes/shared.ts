import { Hono } from 'hono';
import { z } from 'zod';
import { FLOW_STAGES, type FlowStage, type GameDetail, type GameSummary, type HomePayload, type HomeIDPayload, type ReviewBatch, type ReviewContent as SharedReviewContent, type ReviewProposal, type RuleCard, type TagSummary, type UserRole } from '../../src/shared/types';
import { requireRole, type AppContext, type AppVariables } from '../auth';
import type { D1Database, D1PreparedStatement, D1Result } from '../env';
import { assertMutationOrigin, cleanOptional, createId, normalizeEmail, normalizeText, now, sha256Hex, slugify, trustedOrigins } from '../utils';
import { normalizedReviewContent, REVIEW_FORMAT, REVIEW_SCHEMA_VERSION, reviewContentHash, reviewContentSchema, reviewFileSchema, sameReviewContent, type ReviewContent, type ReviewFile } from '../review';
import { parseReviewCsv, serializeReviewCsv } from '../review-csv';

export const setNoCache = (c: AppContext) => {
  c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
  c.header('Pragma', 'no-cache');
  c.header('Expires', '0');
};

export const ruleSelect = `
  SELECT r.id, r.game_id, r.statement, r.common_mistake, r.details,
    r.flow_stage, r.player_count_note, r.edition_note, r.status,
    r.created_by, r.created_at, r.updated_at,
    r.tag_ids_json,
    s.source_label, s.source_url,
    (SELECT COALESCE(json_group_array(json_object('label', ss.label, 'url', ss.url)), '[]')
      FROM submission_sources ss WHERE ss.submission_id = s.id ORDER BY ss.position) AS sources_json
  FROM rules r JOIN submissions s ON s.id = r.submission_id
`;

export const gameRuleSelect = `
  SELECT r.id, r.game_id, r.statement, r.common_mistake, r.details,
    r.flow_stage, r.player_count_note, r.edition_note, r.status,
    r.created_by, r.created_at, r.updated_at, r.tag_ids_json
  FROM rules r
`;

export const homeRuleSelect = ruleSelect.replace(
  'FROM rules r',
  ', g.display_name, g.slug FROM rules r',
);

export interface RuleRow {
  id: string;
  game_id: string;
  statement: string;
  common_mistake: string | null;
  details: string | null;
  flow_stage: FlowStage;
  player_count_note: string | null;
  edition_note: string | null;
  status: 'draft' | 'published' | 'hidden';
  source_label?: string | null;
  source_url?: string | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
  tag_ids_json: string | null;
  sources_json?: string | null;
}

export const parseRuleTagIds = (row: Pick<RuleRow, 'tag_ids_json'>): string[] => {
  try {
    const value = JSON.parse(row.tag_ids_json ?? '[]');
    return Array.isArray(value) ? value.filter((tagId): tagId is string => typeof tagId === 'string') : [];
  } catch {
    return [];
  }
};

export const resolveRuleTags = async (db: D1Database, rows: RuleRow[]): Promise<Map<string, TagSummary>> => {
  const tagIds = Array.from(new Set(rows.flatMap(parseRuleTagIds)));
  if (!tagIds.length) return new Map();
  const placeholders = tagIds.map(() => '?').join(',');
  const result = await db.prepare(`
    SELECT t.id, t.slug, t.name, t.is_public
    FROM tags t
    WHERE t.id IN (${placeholders})
  `).bind(...tagIds).all<{ id: string; slug: string; name: string; is_public: number | null }>();
  return new Map((result.results ?? []).map((tag) => [tag.id, {
    id: tag.id,
    slug: tag.slug,
    name: tag.name,
    isPublic: Boolean(tag.is_public),
  }]));
};

export const toRule = (row: RuleRow, tagMap = new Map<string, TagSummary>()): RuleCard => {
  const tagIds = parseRuleTagIds(row);
  return ({
    id: row.id,
    gameId: row.game_id,
    statement: row.statement,
    commonMistake: row.common_mistake ?? undefined,
    details: row.details ?? undefined,
    flowStage: row.flow_stage && row.flow_stage !== 'uncategorized' ? row.flow_stage : undefined,
    playerCountNote: row.player_count_note ?? undefined,
    editionNote: row.edition_note ?? undefined,
    sourceLabel: row.source_label ?? undefined,
    sourceUrl: row.source_url ?? undefined,
    sourceLinks: (() => {
      try {
        const links = JSON.parse(row.sources_json ?? '[]') as RuleCard['sourceLinks'];
        return links.length ? links : (row.source_url ? [{ label: row.source_label ?? undefined, url: row.source_url }] : []);
      } catch { return row.source_url ? [{ label: row.source_label ?? undefined, url: row.source_url }] : []; }
    })(),
    status: row.status,
    createdBy: row.created_by ?? undefined,
    updatedAt: row.updated_at,
    tagIds,
    tags: tagIds.map((tagId) => tagMap.get(tagId)).filter((tag): tag is TagSummary => Boolean(tag)),
  });
};

export const cleanTagNames = (names: string[] | undefined): string[] => Array.from(new Map((names ?? [])
  .map((name) => name.trim().replace(/^#/, '').slice(0, 40))
  .filter(Boolean)
  .map((name) => [normalizeText(name), name] as const)).values()).slice(0, 8);

export const tagWriteStatements = async (c: AppContext, ruleId: string, names: string[], userId: string, timestamp: number, replace = true) => {
  const statements: D1PreparedStatement[] = replace
    ? [c.env.DB.prepare('DELETE FROM rule_tags WHERE rule_id = ?').bind(ruleId)]
    : [];
  const tagIds: string[] = [];
  const userRoles = c.get('user')?.roles ?? [];
  const canCreate = userRoles.includes('admin') || userRoles.includes('editor');
  for (const name of cleanTagNames(names)) {
    const normalized = normalizeText(name);
    if (!normalized) continue;
    const existing = await c.env.DB.prepare(`
      SELECT t.id FROM tags t LEFT JOIN tag_aliases ta ON ta.tag_id = t.id
      WHERE (t.normalized_name = ? OR ta.normalized_alias = ?) LIMIT 1
    `).bind(normalized, normalized).first<{ id: string }>();
    const suffix = (await sha256Hex(normalized)).slice(0, 20);
    const tagId = existing?.id ?? `tag_${suffix}`;
    if (!existing && !canCreate) throw new Error('unknown_tag');
    if (!tagIds.includes(tagId)) tagIds.push(tagId);
    if (!existing) {
      statements.push(c.env.DB.prepare(`
        INSERT OR IGNORE INTO tags (id, slug, name, normalized_name, created_by, created_at, updated_at, is_public)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
      `).bind(tagId, slugify(name), name, normalized, userId, timestamp, timestamp));
      statements.push(c.env.DB.prepare(`
        INSERT OR IGNORE INTO tag_aliases (id, tag_id, alias, normalized_alias, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(`ta_${suffix}`, tagId, name, normalized, timestamp));
    }
    statements.push(c.env.DB.prepare(`
      INSERT OR IGNORE INTO rule_tags (rule_id, tag_id, created_by, created_at) VALUES (?, ?, ?, ?)
    `).bind(ruleId, tagId, userId, timestamp));
  }
  statements.push(c.env.DB.prepare('UPDATE rules SET tag_ids_json = ? WHERE id = ?')
    .bind(JSON.stringify(tagIds), ruleId));
  return statements;
};

export interface GameRow {
  id: string;
  slug: string;
  display_name: string;
  english_name: string | null;
  aliases_str?: string | null;
  rule_count: number;
  updated_at: number;
}

export const toGame = (row: GameRow): GameSummary => ({
  id: row.id,
  slug: row.slug,
  displayName: row.display_name,
  englishName: row.english_name ?? undefined,
  aliases: row.aliases_str ? row.aliases_str.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
  ruleCount: row.rule_count,
  updatedAt: row.updated_at,
});

export interface ReviewRuleRow {
  id: string;
  submission_id: string;
  game_id: string;
  game_name: string;
  game_slug: string;
  statement: string;
  common_mistake: string | null;
  details: string | null;
  flow_stage: FlowStage;
  player_count_note: string | null;
  edition_note: string | null;
  source_label: string | null;
  source_url: string | null;
  updated_at: number;
  tags_json: string | null;
}

export const reviewContentFromRow = (row: ReviewRuleRow): ReviewContent => normalizedReviewContent({
  statement: row.statement,
  commonMistake: row.common_mistake,
  details: row.details,
  flowStage: row.flow_stage,
  playerCountNote: row.player_count_note,
  editionNote: row.edition_note,
  sourceLabel: row.source_label,
  sourceUrl: row.source_url,
  tagNames: (() => {
    try {
      return (JSON.parse(row.tags_json ?? '[]') as Array<{ name: string }>).map((tag) => tag.name);
    } catch { return []; }
  })(),
});

export const reviewRuleSelect = `
  SELECT r.id, r.submission_id, r.game_id, g.display_name game_name, g.slug game_slug,
    r.statement, r.common_mistake, r.details, r.flow_stage, r.player_count_note,
    r.edition_note, r.updated_at, s.source_label, s.source_url,
    (SELECT COALESCE(json_group_array(json_object('name', t.name)), '[]')
      FROM rule_tags rt JOIN tags t ON t.id = rt.tag_id
      WHERE rt.rule_id = r.id) AS tags_json
  FROM rules r
  JOIN games g ON g.id = r.game_id
  JOIN submissions s ON s.id = r.submission_id
`;


export interface LoggedQueryContext {
  reqPath: string;
  totalRowsRead: number;
  queries: Array<{ name: string; rowsRead: number }>;
}

export const logD1Query = <T extends D1Result<unknown>>(c: AppContext, queryName: string, result: T): T => {
  const meta = result?.meta as Record<string, unknown> | undefined;
  const rowsRead = Number(meta?.rows_read ?? meta?.rowsRead ?? meta?.rows_served ?? 0);
  console.log("[D1_METRICS] [" + c.req.path + "] " + queryName + ": " + rowsRead + " rows_read");
  
  let ctx = c.get('d1Metrics');
  if (!ctx) {
    ctx = { reqPath: c.req.path, totalRowsRead: 0, queries: [] };
    c.set('d1Metrics', ctx);
  }
  ctx.totalRowsRead += rowsRead;
  ctx.queries.push({ name: queryName, rowsRead });
  c.header('X-D1-Rows-Read', String(ctx.totalRowsRead));
  
  return result;
};
