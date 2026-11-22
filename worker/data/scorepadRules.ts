import type { ContributionReviewStatus, FlowStage, GameExternalResourceCategory, RuleCategory } from '../../src/shared/types';
import { cleanDetectionKeywords, cleanRuleCategories, toRule, type RuleRow } from '../routes/shared';
import type { Database } from './database';

// A game's rule count and its rules for the score pad Worker, reached only through the ScorepadApi
// Service Binding entrypoint. Each method issues one D1 query and writes nothing.

/** Everything the site shows of a published rule except who wrote, edited or reviewed it. */
export interface ScorepadRule {
  id: string;
  statement: string;
  commonMistake?: string;
  details?: string;
  flowStage?: FlowStage;
  categories: RuleCategory[];
  playerCounts: number[];
  editionNotes: string[];
  sourceLinks: Array<{ label?: string; url: string }>;
  /** 'pending' marks a rule an editor has not reviewed yet. */
  reviewStatus: ContributionReviewStatus;
  importanceCount: number;
  tagIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ScorepadExternalResource {
  id: string;
  name: string;
  category: GameExternalResourceCategory;
  url: string;
}

export interface ScorepadGameRules {
  gameId: string;
  slug: string;
  displayName: string;
  englishName: string | null;
  /** Equal to getRuleSummaryByBgg's ruleVersion for this game when the rules were read. */
  ruleVersion: string;
  rules: ScorepadRule[];
  /** Every tag the rules name, as the site's game page loads them for its filter. */
  tags: ScorepadTag[];
  externalResources: ScorepadExternalResource[];
}

/** What a score pad shows when a game opens, before anyone asks for the rules themselves. */
export interface ScorepadRuleSummary {
  /** The base game whose rules a BGG id leads to; pass it to getGameRules. */
  ruleGameId: string;
  /** Published rules, reviewed or not. */
  publishedRuleCount: number;
  ruleVersion: string;
}

export interface ScorepadTag {
  id: string;
  name: string;
  categoryHints: RuleCategory[];
  detectionKeywords: string[];
}

/** Changes with every published rule's time or count; reviews and resources do not (see docs/scorepad-integration.md). */
export const ruleVersionOf = (latestRuleUpdatedAt: number | null, publishedRuleCount: number | null) =>
  `${Number(latestRuleUpdatedAt ?? 0)}:${Number(publishedRuleCount ?? 0)}`;

const GAME_ID = /^[A-Za-z0-9_-]{1,100}$/;
const BGG_ID = /^[1-9]\d{0,9}$/;

const LISTED = (alias: string) => `${alias}.visibility = 'public' AND ${alias}.merged_into_game_id IS NULL`;
const IS_BASE = (alias: string) => `COALESCE(${alias}.entity_kind, 'base') = 'base'`;

/**
 * The rule count and version of the game a BGG id leads to, as the site shows it: a base game's own
 * rules, or for an expansion or version its base game's. Null when no listed game, or no listed
 * base game, has the id. Both BGG id sources are searched; should a data error give the id to two
 * games, the earlier branch below answers.
 */
export const getScorepadRuleSummaryByBgg = async (db: Database, bggId: unknown): Promise<ScorepadRuleSummary | null> => {
  if (typeof bggId !== 'string' || !BGG_ID.test(bggId)) throw new TypeError('scorepad_bgg_id_must_be_a_positive_integer_string');
  // Branches run in order and stop at the first row, so the common case reads one games row:
  // 1. a base game carrying the id itself, 2. a base game holding it as an edition id,
  // 3. an expansion or version carrying it, through its relation to a listed base game.
  const row = await db.statement(`
    SELECT rule_game_id, published_rule_count, latest_rule_updated_at FROM (
      SELECT g.id AS rule_game_id, g.published_rule_count, g.latest_rule_updated_at
      FROM games g INDEXED BY idx_games_bgg_id
      WHERE g.bgg_id = CAST(?1 AS INTEGER) AND ${LISTED('g')} AND ${IS_BASE('g')}
      UNION ALL
      SELECT g.id, g.published_rule_count, g.latest_rule_updated_at
      FROM game_external_ids external INDEXED BY sqlite_autoindex_game_external_ids_2
      CROSS JOIN games g INDEXED BY sqlite_autoindex_games_1 ON g.id = external.game_id
      WHERE external.source = 'bgg' AND external.external_id = ?1 AND ${LISTED('g')} AND ${IS_BASE('g')}
      UNION ALL
      SELECT base.id, base.published_rule_count, base.latest_rule_updated_at
      FROM (
        SELECT id AS game_id FROM games INDEXED BY idx_games_bgg_id WHERE bgg_id = CAST(?1 AS INTEGER)
        UNION ALL
        SELECT game_id FROM game_external_ids INDEXED BY sqlite_autoindex_game_external_ids_2
        WHERE source = 'bgg' AND external_id = ?1
      ) matched
      CROSS JOIN games variant INDEXED BY sqlite_autoindex_games_1 ON variant.id = matched.game_id
      CROSS JOIN game_entity_relations relation INDEXED BY idx_game_entity_relations_source_type_target
        ON relation.source_game_id = variant.id AND relation.relation_type IN ('expansion_of', 'version_of', 'variant_of')
      CROSS JOIN games base INDEXED BY sqlite_autoindex_games_1 ON base.id = relation.target_game_id
      WHERE ${LISTED('variant')} AND NOT ${IS_BASE('variant')} AND base.entity_kind = 'base' AND ${LISTED('base')}
    )
    LIMIT 1
  `).bind(bggId).first<{ rule_game_id: string; published_rule_count: number | null; latest_rule_updated_at: number | null }>();
  return row ? {
    ruleGameId: row.rule_game_id,
    publishedRuleCount: Number(row.published_rule_count ?? 0),
    ruleVersion: ruleVersionOf(row.latest_rule_updated_at, row.published_rule_count),
  } : null;
};

const parseList = <T>(json: string | null, clean: (values: unknown) => T[]): T[] => {
  try { return clean(JSON.parse(json ?? '[]')); } catch { return []; }
};

const RULE_COLUMNS = ['id', 'game_id', 'statement', 'common_mistake', 'details', 'flow_stage', 'categories_json',
  'player_counts_json', 'edition_notes_json', 'edition_note', 'status', 'importance_count', 'tag_ids_json',
  'review_status', 'source_label', 'source_url', 'created_at', 'updated_at'] as const;

/**
 * A listed base game's published rules, reviewed or not, in the site's order, with the tags they
 * name and the game's external resources. Expansions and versions have no rules of their own: pass
 * getRuleSummaryByBgg's ruleGameId. Returns null for any id that is not a public, unmerged base game.
 */
export const getScorepadGameRules = async (db: Database, gameId: unknown): Promise<ScorepadGameRules | null> => {
  if (typeof gameId !== 'string' || !GAME_ID.test(gameId)) throw new TypeError('scorepad_game_id_must_be_a_game_id');
  // The game row gates every subquery; each walks only this game's rows in a game_id index, and tags by primary key.
  const row = await db.statement(`
    SELECT g.id, g.slug, g.display_name, g.english_name, g.published_rule_count, g.latest_rule_updated_at,
      COALESCE((
        SELECT json_group_array(json_object(${RULE_COLUMNS.map((column) => `'${column}', r.${column}`).join(', ')}))
        FROM (
          SELECT * FROM rules INDEXED BY idx_rules_game_status
          WHERE game_id = g.id AND status = 'published'
          ORDER BY CASE flow_stage
            WHEN 'setup' THEN 1 WHEN 'round' THEN 2 WHEN 'action' THEN 3
            WHEN 'always' THEN 4 WHEN 'end_scoring' THEN 5
            WHEN 'edition_player_count' THEN 6 ELSE 7 END,
            created_at DESC
        ) r
      ), '[]') AS rules_json,
      COALESCE((
        SELECT json_group_array(json_object('id', resource.id, 'name', resource.name,
          'category', resource.category, 'url', resource.url))
        FROM (
          SELECT id, name, category, url FROM game_external_resources INDEXED BY idx_game_external_resources_game
          WHERE game_id = g.id
          ORDER BY CASE category WHEN 'teaching' THEN 1 WHEN 'help_card' THEN 2 ELSE 3 END, name, id
        ) resource
      ), '[]') AS resources_json,
      COALESCE((
        SELECT json_group_array(json_object('id', t.id, 'name', t.name,
          'category_hints_json', t.category_hints_json, 'detection_keywords_json', t.detection_keywords_json))
        FROM tags t INDEXED BY sqlite_autoindex_tags_1
        WHERE t.id IN (
          SELECT tag.value
          FROM rules tagged INDEXED BY idx_rules_game_status, json_each(tagged.tag_ids_json) tag
          WHERE tagged.game_id = g.id AND tagged.status = 'published'
        )
      ), '[]') AS tags_json
    FROM games g INDEXED BY sqlite_autoindex_games_1
    WHERE g.id = ? AND g.visibility = 'public' AND g.merged_into_game_id IS NULL
      AND COALESCE(g.entity_kind, 'base') = 'base'
  `).bind(gameId).first<{
    id: string; slug: string; display_name: string; english_name: string | null;
    published_rule_count: number | null; latest_rule_updated_at: number | null;
    rules_json: string; resources_json: string; tags_json: string;
  }>();
  if (!row) return null;
  const rules = (JSON.parse(row.rules_json) as RuleRow[]).map((ruleRow): ScorepadRule => {
    const rule = toRule(ruleRow);
    return {
      id: rule.id,
      statement: rule.statement,
      commonMistake: rule.commonMistake,
      details: rule.details,
      flowStage: rule.flowStage ?? undefined,
      categories: rule.categories ?? [],
      playerCounts: rule.playerCounts ?? [],
      editionNotes: rule.editionNotes ?? [],
      sourceLinks: rule.sourceLinks,
      reviewStatus: rule.reviewStatus ?? 'not_required',
      importanceCount: rule.importanceCount ?? 0,
      tagIds: rule.tagIds ?? [],
      createdAt: rule.createdAt ?? 0,
      updatedAt: rule.updatedAt ?? 0,
    };
  });
  return {
    gameId: row.id,
    slug: row.slug,
    displayName: row.display_name,
    englishName: row.english_name ?? null,
    ruleVersion: ruleVersionOf(row.latest_rule_updated_at, row.published_rule_count),
    rules,
    tags: (JSON.parse(row.tags_json) as Array<{ id: string; name: string; category_hints_json: string | null; detection_keywords_json: string | null }>)
      .map((tag) => ({
        id: tag.id,
        name: tag.name,
        categoryHints: parseList(tag.category_hints_json, cleanRuleCategories),
        detectionKeywords: parseList(tag.detection_keywords_json, cleanDetectionKeywords),
      })),
    externalResources: JSON.parse(row.resources_json) as ScorepadExternalResource[],
  };
};
