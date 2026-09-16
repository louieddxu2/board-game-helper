import { canonicalAttributeAnswer, parseAttributeScale } from '../../src/shared/attributeScale';
import type {
  AttributeActivity,
  AttributeComparisonResult,
  AttributeDefinition,
  AttributeImportCandidate,
  AttributeMatrixValue,
  AttributeQuestion,
  AttributeQuestionPayload,
  AttributeSubject,
  AttributeSubjectComponent,
  AttributesPayload,
} from '../../src/shared/types';
import { createId } from '../utils';
import type { Database, DatabaseStatement } from './database';
import {
  ATTRIBUTE_INITIAL_RD,
  ATTRIBUTE_SCORE_MODEL_VERSION,
  applyComparison,
  applyDirectRating,
  emptyAttributeState,
  type OnlineAttributeState,
} from './attributeScoring';
import {
  chooseAttributeQuestionOpponent,
  type AttributeQuestionOpponentCandidate,
} from './attributeQuestionSelection';

/** Number of random slots used to sample low-confidence game+attribute items. */
export const ATTRIBUTE_QUESTION_SLOT_COUNT = 200;
export const ATTRIBUTE_QUESTION_SEED_SLOT_RETRY_LIMIT = 4;
export const ATTRIBUTE_QUESTION_OPPONENT_CANDIDATE_LIMIT = 4;
export const ATTRIBUTE_QUESTION_PAIR_STAT_LIMIT = 4;
// The voting screen renders five recent records.  Keep the query aligned with
// that UI limit so an opening question does not read seven unused snapshots.
export const ATTRIBUTE_ACTIVITY_FEED_LIMIT = 5;
export const ATTRIBUTE_TABLE_PAGE_SIZE = 50;
/** Local-D1 budget ceiling for a full answer with two ratings and a comparison. */
export const ATTRIBUTE_RESPONSE_MAX_READ_ROWS = 40;
export const ATTRIBUTE_RESPONSE_MAX_WRITE_ROWS = 30;
export const ATTRIBUTE_QUESTION_MAX_RETURNED_ROWS = 17;
export const ATTRIBUTE_RESPONSE_LOCK_PREFIX = 'attribute-vote';
export const ATTRIBUTE_RESPONSE_LOCK_TTL_MS = 15_000;
export const ATTRIBUTE_MERGE_REBUILD_BATCH_SIZE = 20;
export const ATTRIBUTE_MERGE_JOB_LOCK_TTL_MS = 60_000;
const ATTRIBUTE_REBUILD_STATE_ROWS_PER_STATEMENT = 9;
const ATTRIBUTE_REBUILD_STATEMENTS_PER_BATCH = 50;
/** Local-D1 ceiling below the product limit; final 100-question sample maxed at 99. */
export const ATTRIBUTE_QUESTION_MAX_ROWS_READ = 99;

interface AttributeRow {
  scale_type?: string;
  endpoints_json?: string | null;
  id: string;
  key: string;
  name: string;
  short_description: string | null;
  full_description: string | null;
  min_value: number;
  max_value: number;
  sort_order: number;
}

interface SubjectRow {
  id: string;
  slug: string;
  kind: 'game' | 'configuration';
  display_name: string;
  game_id: string | null;
  game_slug: string | null;
  secondary_name: string | null;
  bgg_ids_json: string | null;
}

interface ComponentRow {
  subject_id: string;
  component_order: number;
  game_id: string | null;
  component_type: AttributeSubjectComponent['type'];
  label: string;
  english_name: string | null;
  bgg_id: number | null;
}

interface AttributeScoreStateRow {
  subject_id: string;
  attribute_id: string;
  score: number;
  rating_deviation: number;
  direct_sum: number;
  direct_count: number;
  comparison_count: number;
  decisive_comparison_count: number;
  evidence_count: number;
  model_version?: string;
  random_key?: string;
}

interface SeedCandidateRow {
  subject_id: string;
  attribute_id: string;
  game_id: string | null;
  score: number;
  rating_deviation: number;
  random_key: string;
}

interface PairStatRow {
  comparison_count: number;
}

interface CandidateRow {
  id: string;
  source_name: string;
  values_json: string;
  match_status: AttributeImportCandidate['matchStatus'];
  subject_id: string | null;
  source_row_number: number;
}

interface ActivityFeedRow {
  id: string;
  payload_json: string;
}

/**
 * Keep the BGG voting boundary inline on the hot path.  The equivalent view
 * is useful for administration and migrations, but SQLite may materialize it
 * before applying a point lookup.  These predicates let the score-state
 * indexes remain the driving tables for question selection.
 */
const votableSubjectCondition = (subjectAlias: string, gameAlias: string) => `(
  (
    ${subjectAlias}.kind = 'game'
    AND ${gameAlias}.entity_kind IN ('base', 'expansion')
    AND ${gameAlias}.merged_into_game_id IS NULL
    AND ${gameAlias}.visibility = 'public'
    AND (${gameAlias}.published_rule_count > 0 OR ${gameAlias}.attribute_enabled = 1)
    AND (
      ${gameAlias}.bgg_id IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM game_external_ids external_id
        WHERE external_id.game_id = ${gameAlias}.id AND external_id.source = 'bgg'
      )
      OR EXISTS (
        SELECT 1 FROM attribute_subject_components component
        WHERE component.subject_id = ${subjectAlias}.id
          AND component.component_type = 'base'
          AND component.bgg_id IS NOT NULL
      )
    )
  )
  OR (
    ${subjectAlias}.kind = 'configuration'
    AND EXISTS (
      SELECT 1 FROM attribute_subject_components component
      WHERE component.subject_id = ${subjectAlias}.id
        AND component.component_type = 'base'
        AND component.bgg_id IS NOT NULL
    )
    AND EXISTS (
      SELECT 1 FROM attribute_subject_components component
      WHERE component.subject_id = ${subjectAlias}.id
        AND component.component_type = 'expansion'
        AND component.bgg_id IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM attribute_subject_components component
      WHERE component.subject_id = ${subjectAlias}.id
        AND component.component_type IN ('base', 'expansion')
        AND component.bgg_id IS NULL
    )
  )
)`;

/**
 * Voting secondary labels are derived from the shared game data.  An English
 * primary name uses its first Chinese alias; an official Chinese primary name
 * uses the English name.  Unlike attribute_subject_secondary_names, these
 * correlated lookups do not aggregate every subject in the database for each
 * question.
 */
const gameSecondaryNameExpression = (gameAlias: string) => {
  const firstChineseAlias = `(SELECT alias
    FROM game_aliases
    WHERE game_id = ${gameAlias}.id
      AND alias GLOB '*[一-龥]*'
    ORDER BY alias, id
    LIMIT 1)`;
  return `(CASE
    WHEN ${gameAlias}.display_name NOT GLOB '*[一-龥]*'
      THEN COALESCE(${firstChineseAlias}, NULLIF(${gameAlias}.english_name, ${gameAlias}.display_name))
    ELSE NULLIF(${gameAlias}.english_name, ${gameAlias}.display_name)
  END)`;
};

const subjectSecondaryNameExpression = (subjectAlias: string, gameAlias: string) => {
  const baseName = `(SELECT COALESCE(
      ${gameSecondaryNameExpression('base_game')},
      NULLIF(base_component.english_name, '')
    )
    FROM attribute_subject_components base_component
    LEFT JOIN games base_game ON base_game.id = base_component.game_id
    WHERE base_component.subject_id = ${subjectAlias}.id
      AND base_component.component_type = 'base'
    LIMIT 1)`;
  const expansionName = `(SELECT group_concat(ordered_expansion.english_name, ' + ')
    FROM (
      SELECT component.english_name
      FROM attribute_subject_components component
      WHERE component.subject_id = ${subjectAlias}.id
        AND component.component_type = 'expansion'
        AND NULLIF(TRIM(component.english_name), '') IS NOT NULL
      ORDER BY component.component_order
    ) ordered_expansion)`;
  return `(CASE WHEN ${subjectAlias}.kind = 'configuration' THEN
    CASE
      WHEN ${baseName} IS NULL THEN ${expansionName}
      WHEN ${expansionName} IS NULL THEN ${baseName}
      ELSE ${baseName} || ' + ' || ${expansionName}
    END
    ELSE ${gameSecondaryNameExpression(gameAlias)} END)`;
};

interface AttributeMergeHistoryRow {
  stream_id: string;
  attribute_id: string;
  subject_a_id: string | null;
  subject_b_id: string | null;
  rating_a: number | null;
  rating_b: number | null;
  comparison: AttributeComparisonResult | null;
  created_at: number;
}

interface AttributeMergeRebuildJobRow {
  attribute_id: string | null;
  id: string;
  source_game_id: string;
  target_game_id: string;
  source_subject_id: string;
  target_subject_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  reset_completed: number;
  cursor_created_at: number;
  cursor_stream_id: string;
  cutoff_created_at: number;
  error_message: string | null;
  created_at: number;
  updated_at: number;
}

interface ResponseContextRow {
  endpoints_json?: string | null;
  scale_type?: string;
  attribute_id: string;
  attribute_name: string;
  subject_a_id: string;
  subject_a_name: string;
  subject_a_slug: string;
  subject_a_game_slug: string | null;
  subject_b_id: string;
  subject_b_name: string;
  subject_b_slug: string;
  subject_b_game_slug: string | null;
  actor_name: string;
}

interface ResponseContextAndStateRow extends ResponseContextRow {
  state_a_subject_id: string | null;
  state_a_score: number | null;
  state_a_rating_deviation: number | null;
  state_a_direct_sum: number | null;
  state_a_direct_count: number | null;
  state_a_comparison_count: number | null;
  state_a_decisive_comparison_count: number | null;
  state_a_evidence_count: number | null;
  state_b_subject_id: string | null;
  state_b_score: number | null;
  state_b_rating_deviation: number | null;
  state_b_direct_sum: number | null;
  state_b_direct_count: number | null;
  state_b_comparison_count: number | null;
  state_b_decisive_comparison_count: number | null;
  state_b_evidence_count: number | null;
}

interface SubjectPageOptions {
  cursor?: string;
  limit?: number;
}

interface CandidatePageOptions {
  cursor?: string;
  limit?: number;
}

export interface AttributeTableQueryOptions {
  subjectCursor?: string;
  candidateCursor?: string;
  limit?: number;
  scope?: 'subjects' | 'candidates';
}

export interface AttributeQuestionOptions {
  excludeSubjectAId?: string;
  excludeSubjectBId?: string;
  excludeAttributeId?: string;
  fixedSubjectAId?: string;
  fixedSubjectBId?: string;
  fixedAttributeId?: string;
}

export interface AttributeResponseInput {
  highPole?: 'low' | 'high';
  subjectAId: string;
  subjectBId: string;
  attributeId: string;
  responseId: string;
  questionToken?: string;
  comparison?: AttributeComparisonResult | null;
  ratingA?: number | null;
  ratingB?: number | null;
  sessionId: string;
  actorId: string | null;
  timestamp: number;
}

export interface SavedAttributeResponse {
  updatedValues: AttributeMatrixValue[];
  activities: AttributeActivity[];
}

export interface AttributeMergeLock {
  token: string;
  names: string[];
}

export interface AttributeMergeRebuildJobPlan {
  id: string;
  sourceSubjectId: string | null;
  targetSubjectId: string | null;
  statement: DatabaseStatement | null;
}

const toAttribute = (row: AttributeRow): AttributeDefinition => ({
  ...parseAttributeScale(row.scale_type, row.endpoints_json ? JSON.parse(row.endpoints_json) : undefined),
  id: row.id,
  key: row.key,
  name: row.name,
  shortDescription: row.short_description ?? undefined,
  fullDescription: row.full_description ?? undefined,
  minValue: row.min_value,
  maxValue: row.max_value,
  sortOrder: row.sort_order,
});

const parseBggIds = (value: string | null): number[] => {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed
      .map((id) => typeof id === 'number' ? id : Number(id))
      .filter((id): id is number => Number.isSafeInteger(id) && id > 0))];
  } catch {
    return [];
  }
};

const toSubject = (row: SubjectRow, components: Map<string, AttributeSubjectComponent[]>): AttributeSubject => {
  const bggIds = parseBggIds(row.bgg_ids_json);
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    displayName: row.display_name,
    ...(row.secondary_name ? { secondaryName: row.secondary_name } : {}),
    gameId: row.game_id ?? undefined,
    gameSlug: row.game_slug ?? undefined,
    ...(bggIds.length ? { bggIds } : {}),
    components: components.get(row.id) ?? [],
  };
};

const clampPageSize = (limit: number | undefined) => Math.min(ATTRIBUTE_TABLE_PAGE_SIZE, Math.max(1, Math.floor(limit ?? ATTRIBUTE_TABLE_PAGE_SIZE)));

const encodeCursor = (...parts: string[]) => btoa(unescape(encodeURIComponent(parts.join('\u0000'))));
const decodeCursor = (cursor: string | undefined): string[] | undefined => {
  if (!cursor) return undefined;
  try {
    const decoded = decodeURIComponent(escape(atob(cursor)));
    return decoded.split('\u0000');
  } catch {
    return undefined;
  }
};

const queryAttributeDefinitions = async (db: Database): Promise<AttributeDefinition[]> => {
  const result = await db.statement(`
    SELECT a.id, a.key, t.name, t.short_description, t.full_description, a.scale_type, t.endpoints_json,
      a.min_value, a.max_value, a.sort_order
    FROM attributes a
    JOIN attribute_translations t ON t.attribute_id = a.id AND t.locale = 'zh-TW'
    WHERE a.is_active = 1
    ORDER BY a.sort_order, a.id
  `).all<AttributeRow>();
  return (result.results ?? []).map(toAttribute);
};

const querySingleAttribute = async (db: Database, attributeId?: string): Promise<AttributeDefinition | null> => {
  if (attributeId) {
    const result = await db.statement(`
      SELECT a.id, a.key, t.name, t.short_description, t.full_description, a.scale_type, t.endpoints_json,
        a.min_value, a.max_value, a.sort_order
      FROM attributes a
      JOIN attribute_translations t ON t.attribute_id = a.id AND t.locale = 'zh-TW'
      WHERE a.id = ? AND a.is_active = 1
    `).bind(attributeId).first<AttributeRow>();
    return result ? toAttribute(result) : null;
  }

  const pivot = randomKey();
  const [after, before] = await Promise.all([
    db.statement(`
      SELECT a.id, a.key, t.name, t.short_description, t.full_description, a.scale_type, t.endpoints_json,
        a.min_value, a.max_value, a.sort_order
      FROM attributes a
      JOIN attribute_translations t ON t.attribute_id = a.id AND t.locale = 'zh-TW'
      WHERE a.is_active = 1 AND a.random_key >= ?
      ORDER BY a.random_key, a.id
      LIMIT 1
    `).bind(pivot).first<AttributeRow>(),
    db.statement(`
      SELECT a.id, a.key, t.name, t.short_description, t.full_description, a.scale_type, t.endpoints_json,
        a.min_value, a.max_value, a.sort_order
      FROM attributes a
      JOIN attribute_translations t ON t.attribute_id = a.id AND t.locale = 'zh-TW'
      WHERE a.is_active = 1 AND a.random_key < ?
      ORDER BY a.random_key, a.id
      LIMIT 1
    `).bind(pivot).first<AttributeRow>(),
  ]);
  const result = after ?? before;
  return result ? toAttribute(result) : null;
};

const querySubjectRows = async (db: Database, subjectIds?: string[], page?: SubjectPageOptions): Promise<SubjectRow[]> => {
  if (subjectIds && !subjectIds.length) return [];
  const filter = subjectIds?.length ? `AND s.id IN (${subjectIds.map(() => '?').join(',')})` : '';
  const cursorParts = !subjectIds?.length ? decodeCursor(page?.cursor) : undefined;
  const cursorFilter = cursorParts?.length === 2
    ? 'AND (LOWER(s.display_name) > LOWER(?) OR (LOWER(s.display_name) = LOWER(?) AND s.id > ?))'
    : '';
  const pageLimit = !subjectIds?.length && page ? `LIMIT ${clampPageSize(page.limit) + 1}` : '';
  const binds = [
    ...(subjectIds ?? []),
    ...(cursorParts?.length === 2 ? [cursorParts[0], cursorParts[0], cursorParts[1]] : []),
  ];
  const result = await db.statement(`
    SELECT s.id, s.slug, s.kind, s.display_name, s.game_id, g.slug AS game_slug,
      ${subjectSecondaryNameExpression('s', 'g')} AS secondary_name,
      COALESCE((
        SELECT json_group_array(bgg_id)
        FROM (
          SELECT g.bgg_id AS bgg_id
          WHERE s.kind = 'game' AND g.bgg_id IS NOT NULL
          UNION
          SELECT CAST(external_ids.external_id AS INTEGER) AS bgg_id
          FROM game_external_ids external_ids
          WHERE external_ids.game_id = s.game_id
            AND external_ids.source = 'bgg'
          UNION
          SELECT component.bgg_id
          FROM attribute_subject_components component
          WHERE component.subject_id = s.id
            AND component.bgg_id IS NOT NULL
        )
      ), '[]') AS bgg_ids_json
    FROM attribute_subjects s
    LEFT JOIN games g ON g.id = s.game_id
    WHERE ${votableSubjectCondition('s', 'g')}
    ${filter}
    ${cursorFilter}
    ORDER BY s.display_name COLLATE NOCASE, s.id
    ${pageLimit}
  `).bind(...binds).all<SubjectRow>();
  return result.results ?? [];
};

const queryComponents = async (db: Database, subjectIds: string[]): Promise<Map<string, AttributeSubjectComponent[]>> => {
  if (!subjectIds.length) return new Map();
  const result = await db.statement(`
    SELECT subject_id, component_order, game_id, component_type, label, english_name, bgg_id
    FROM attribute_subject_components
    AS c
    WHERE subject_id IN (${subjectIds.map(() => '?').join(',')})
    ORDER BY subject_id, component_order
  `).bind(...subjectIds).all<ComponentRow>();
  const map = new Map<string, AttributeSubjectComponent[]>();
  (result.results ?? []).forEach((row) => {
    const components = map.get(row.subject_id) ?? [];
    components.push({
      order: row.component_order,
      gameId: row.game_id ?? undefined,
      type: row.component_type,
      label: row.label,
      ...(row.english_name ? { englishName: row.english_name } : {}),
      bggId: row.bgg_id ?? undefined,
    });
    map.set(row.subject_id, components);
  });
  return map;
};

const queryAllComponents = async (db: Database): Promise<Map<string, AttributeSubjectComponent[]>> => {
  const result = await db.statement(`
    SELECT subject_id, component_order, game_id, component_type, label, english_name, bgg_id
    FROM attribute_subject_components
    AS c
    ORDER BY subject_id, component_order
  `).all<ComponentRow>();
  const map = new Map<string, AttributeSubjectComponent[]>();
  (result.results ?? []).forEach((row) => {
    const components = map.get(row.subject_id) ?? [];
    components.push({
      order: row.component_order,
      gameId: row.game_id ?? undefined,
      type: row.component_type,
      label: row.label,
      ...(row.english_name ? { englishName: row.english_name } : {}),
      bggId: row.bgg_id ?? undefined,
    });
    map.set(row.subject_id, components);
  });
  return map;
};

export const queryAttributeSubjects = async (db: Database, subjectIds?: string[], page?: SubjectPageOptions): Promise<AttributeSubject[]> => {
  const rows = await querySubjectRows(db, subjectIds, page);
  const components = await queryComponents(db, rows.map((row) => row.id));
  return rows.map((row) => toSubject(row, components));
};

/**
 * Small directory used only to intersect a locally imported BGG collection.
 * It deliberately excludes scores, activities, and components so the voting
 * page never downloads the full attribute table just to resolve BGG IDs.
 */
const queryQuestionSubjects = async (db: Database, subjectIds: string[]): Promise<AttributeSubject[]> => {
  if (!subjectIds.length) return [];
  // A question only needs the two display records.  BGG ID aggregation and
  // component hydration belong to the catalog/table paths; doing that work
  // here makes a two-subject point lookup pay for unrelated component rows.
  const result = await db.statement(`
    SELECT s.id, s.slug, s.kind, s.display_name, s.game_id, g.slug AS game_slug,
      ${subjectSecondaryNameExpression('s', 'g')} AS secondary_name,
      NULL AS bgg_ids_json
    FROM attribute_subjects s
    LEFT JOIN games g ON g.id = s.game_id
    WHERE s.id IN (${subjectIds.map(() => '?').join(',')})
      AND ${votableSubjectCondition('s', 'g')}
    ORDER BY s.id
  `).bind(...subjectIds).all<SubjectRow>();
  const rows = result.results ?? [];
  return rows.map((row) => toSubject(row, new Map()));
};

const toMatrixValue = (row: AttributeScoreStateRow): AttributeMatrixValue => ({
  subjectId: row.subject_id,
  attributeId: row.attribute_id,
  score: Number(Number(row.score).toFixed(2)),
  ratingDeviation: Number(Number(row.rating_deviation ?? ATTRIBUTE_INITIAL_RD).toFixed(3)),
  directAverage: Number(row.direct_count) > 0 ? Number((Number(row.direct_sum) / Number(row.direct_count)).toFixed(2)) : undefined,
  directCount: Number(row.direct_count),
  comparisonCount: Number(row.comparison_count),
  decisiveComparisonCount: Number(row.decisive_comparison_count),
  evidenceCount: Number(row.evidence_count),
  modelVersion: ATTRIBUTE_SCORE_MODEL_VERSION,
});

const queryAttributeValues = async (db: Database, subjectIds?: string[]): Promise<AttributeMatrixValue[]> => {
  if (subjectIds && !subjectIds.length) return [];
  const filter = subjectIds?.length ? `WHERE state.subject_id IN (${subjectIds.map(() => '?').join(',')})` : '';
  const result = await db.statement(`
    SELECT state.subject_id, state.attribute_id, state.score, state.rating_deviation, state.direct_sum, state.direct_count,
      state.comparison_count, state.decisive_comparison_count, state.evidence_count
    FROM attribute_score_states state
    ${filter}
  `).bind(...(subjectIds ?? [])).all<AttributeScoreStateRow>();
  return (result.results ?? []).map(toMatrixValue);
};

const queryAllAttributeValues = async (db: Database): Promise<AttributeMatrixValue[]> => {
  const result = await db.statement(`
    SELECT state.subject_id, state.attribute_id, state.score, state.rating_deviation, state.direct_sum, state.direct_count,
      comparison_count, decisive_comparison_count, evidence_count
    FROM attribute_score_states state
    JOIN attribute_subjects subject ON subject.id = state.subject_id
    LEFT JOIN games game ON game.id = subject.game_id
    WHERE ${votableSubjectCondition('subject', 'game')}
  `).all<AttributeScoreStateRow>();
  return (result.results ?? []).map((row) => ({
    ...toMatrixValue(row),
    // Browser consumers ignore this. The weekly replay uses it to compare a
    // full result without scanning attribute_score_states next time.
    replayState: {
      score: Number(row.score),
      ratingDeviation: Number(row.rating_deviation),
      directSum: Number(row.direct_sum),
      directCount: Number(row.direct_count),
      comparisonCount: Number(row.comparison_count),
      decisiveComparisonCount: Number(row.decisive_comparison_count),
      evidenceCount: Number(row.evidence_count),
      modelVersion: ATTRIBUTE_SCORE_MODEL_VERSION,
    },
  }));
};

const parseCandidateValues = (raw: string): Array<number | null> => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((value) => typeof value === 'number' && Number.isFinite(value) ? value : null);
  } catch {
    return [];
  }
};

const queryUnprocessedCandidates = async (db: Database, options: CandidatePageOptions = {}): Promise<AttributeImportCandidate[]> => {
  const cursorParts = decodeCursor(options.cursor);
  const cursorFilter = cursorParts?.length === 2
    ? 'AND (source_row_number > ? OR (source_row_number = ? AND id > ?))'
    : '';
  const limit = clampPageSize(options.limit);
  const result = await db.statement(`
    SELECT id, source_name, values_json, match_status, subject_id, source_row_number
    FROM attribute_import_candidates
    WHERE match_status IN ('pending', 'ambiguous')
    ${cursorFilter}
    ORDER BY source_row_number, id
    LIMIT ${limit + 1}
  `).bind(...(cursorParts?.length === 2 ? [Number(cursorParts[0]), Number(cursorParts[0]), cursorParts[1]] : [])).all<CandidateRow>();
  return (result.results ?? []).map((row) => ({
    id: row.id,
    displayName: row.source_name,
    values: parseCandidateValues(row.values_json),
    matchStatus: row.match_status,
    subjectId: row.subject_id ?? undefined,
    sourceRowNumber: row.source_row_number,
  }));
};

const queryAllUnprocessedCandidates = async (db: Database): Promise<AttributeImportCandidate[]> => {
  const result = await db.statement(`
    SELECT id, source_name, values_json, match_status, subject_id, source_row_number
    FROM attribute_import_candidates
    WHERE match_status IN ('pending', 'ambiguous')
    ORDER BY source_row_number, id
  `).all<CandidateRow>();
  return (result.results ?? []).map((row) => ({
    id: row.id,
    displayName: row.source_name,
    values: parseCandidateValues(row.values_json),
    matchStatus: row.match_status,
    subjectId: row.subject_id ?? undefined,
    sourceRowNumber: row.source_row_number,
  }));
};

/** Full table source used only by the background snapshot builder. */
export const queryAttributeTableSourcePayload = async (db: Database): Promise<AttributesPayload> => {
  const [attributes, subjectRows, candidates, values] = await Promise.all([
    queryAttributeDefinitions(db),
    querySubjectRows(db),
    queryAllUnprocessedCandidates(db),
    queryAllAttributeValues(db),
  ]);
  const subjects = subjectRows.map((row) => toSubject(row, new Map()));
  const components = await queryAllComponents(db);
  const hydratedSubjects = subjects.map((subject) => ({ ...subject, components: components.get(subject.id) ?? [] }));
  const visibleSubjectIds = new Set(hydratedSubjects.map((subject) => subject.id));
  return {
    attributes,
    subjects: hydratedSubjects,
    values: values.filter((value) => visibleSubjectIds.has(value.subjectId)),
    candidates,
    activities: [],
    scoreModelVersion: ATTRIBUTE_SCORE_MODEL_VERSION,
  };
};

const takePage = <T>(rows: T[], limit: number) => ({
  rows: rows.slice(0, limit),
  hasMore: rows.length > limit,
});

export const queryAttributesPayload = async (db: Database, options: AttributeTableQueryOptions = {}): Promise<AttributesPayload> => {
  const limit = clampPageSize(options.limit);
  const includeSubjects = options.scope !== 'candidates';
  const includeCandidates = options.scope !== 'subjects';
  const [attributes, subjectRows, candidatesRaw] = await Promise.all([
    queryAttributeDefinitions(db),
    includeSubjects ? querySubjectRows(db, undefined, { cursor: options.subjectCursor, limit }) : Promise.resolve([]),
    includeCandidates ? queryUnprocessedCandidates(db, { cursor: options.candidateCursor, limit }) : Promise.resolve([]),
  ]);
  const subjectsPage = takePage(subjectRows, limit);
  const candidatesPage = takePage(candidatesRaw, limit);
  const subjects = subjectsPage.rows.map((row) => toSubject(row, new Map()));
  const components = await queryComponents(db, subjects.map((subject) => subject.id));
  const hydratedSubjects = subjects.map((subject) => ({ ...subject, components: components.get(subject.id) ?? [] }));
  const values = await queryAttributeValues(db, hydratedSubjects.map((subject) => subject.id));
  const lastSubject = subjectsPage.rows.at(-1);
  const lastCandidate = candidatesPage.rows.at(-1);
  return {
    attributes,
    subjects: hydratedSubjects,
    values,
    candidates: candidatesPage.rows,
    activities: [],
    scoreModelVersion: ATTRIBUTE_SCORE_MODEL_VERSION,
    nextSubjectCursor: includeSubjects
      ? subjectsPage.hasMore && lastSubject ? encodeCursor(lastSubject.display_name, lastSubject.id) : null
      : options.subjectCursor ?? null,
    nextCandidateCursor: includeCandidates
      ? candidatesPage.hasMore && lastCandidate ? encodeCursor(String(lastCandidate.sourceRowNumber), lastCandidate.id) : null
      : options.candidateCursor ?? null,
    hasMoreSubjects: includeSubjects ? subjectsPage.hasMore : Boolean(options.subjectCursor),
    hasMoreCandidates: includeCandidates ? candidatesPage.hasMore : Boolean(options.candidateCursor),
  };
};

export const parseAttributeActivityFeedEntry = (raw: string, responseId?: string): AttributeActivity[] => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const activities = parsed.filter((item): item is AttributeActivity => Boolean(item && typeof item === 'object' && 'id' in item && 'kind' in item));
    const comparison = activities.find((item) => item.kind === 'comparison');
    if (!comparison?.subjectA || !comparison.subjectB) return [];
    const ratings = new Map(activities
      .filter((item) => item.kind === 'rating' && item.subject && item.value != null)
      .map((item) => [item.subject!.id, item.value!]));
    return [{
      ...comparison,
      ...(responseId || comparison.responseId ? { responseId: responseId ?? comparison.responseId } : {}),
      ratingA: comparison.ratingA ?? ratings.get(comparison.subjectA.id),
      ratingB: comparison.ratingB ?? ratings.get(comparison.subjectB.id),
    }];
  } catch {
    return [];
  }
};

export const queryRecentActivities = async (db: Database): Promise<AttributeActivity[]> => {
  const result = await db.statement(`
    SELECT response_id AS id, activity_json AS payload_json
    FROM attribute_vote_responses
    JOIN attributes active_attribute
      ON active_attribute.id = attribute_vote_responses.attribute_id
      AND active_attribute.is_active = 1
    ORDER BY created_at DESC, response_id DESC
    LIMIT ${ATTRIBUTE_ACTIVITY_FEED_LIMIT}
  `).all<ActivityFeedRow>();
  const activities = (result.results ?? [])
    .flatMap((row) => parseAttributeActivityFeedEntry(row.payload_json, row.id))
    .slice(0, ATTRIBUTE_ACTIVITY_FEED_LIMIT);
  // activity_json already contains the display snapshot shown to users.  Do
  // not re-hydrate every subject through the derived-name and voting-boundary
  // views on every question request; that turns a 12-row feed into a table
  // scan as the collection grows.
  return activities;
};

/** Keep the public feed intentionally small; this never runs in a vote request. */
export const cleanupAttributeActivityFeed = async (db: Database): Promise<void> => {
  await db.statement(`
    DELETE FROM attribute_activity_feed
    WHERE id NOT IN (
      SELECT id FROM attribute_activity_feed
      ORDER BY created_at DESC, id DESC
      LIMIT 500
    )
  `).run();
};

const randomKey = () => crypto.randomUUID().replaceAll('-', '');
const randomQuestionSlot = () => Math.floor(Math.random() * ATTRIBUTE_QUESTION_SLOT_COUNT) + 1;

const excludedSubjectFilter = (excludeSubjectIds: string[], column = 's.subject_id') => excludeSubjectIds.length
  ? `AND ${column} NOT IN (${excludeSubjectIds.map(() => '?').join(',')})`
  : '';

const querySeedCandidate = async (
  db: Database,
  attributeId?: string,
  excludeSubjectIds: string[] = [],
): Promise<SeedCandidateRow | null> => {
  const attributeFilter = attributeId ? 'AND s.attribute_id = ?' : '';
  const exclusion = excludedSubjectFilter(excludeSubjectIds);
  for (let attempt = 0; attempt < ATTRIBUTE_QUESTION_SEED_SLOT_RETRY_LIMIT; attempt += 1) {
    const row = await db.statement(`
      SELECT s.subject_id, s.attribute_id, candidate_subject.game_id,
        s.score, s.rating_deviation, s.random_key
      FROM attribute_score_states s
      JOIN attribute_subjects candidate_subject ON candidate_subject.id = s.subject_id
      LEFT JOIN games candidate_game ON candidate_game.id = candidate_subject.game_id
      WHERE s.question_slot = ?
        ${attributeFilter}
        ${exclusion}
        AND ${votableSubjectCondition('candidate_subject', 'candidate_game')}
      ORDER BY s.rating_deviation DESC, s.random_key, s.attribute_id, s.subject_id
      LIMIT 1
    `).bind(randomQuestionSlot(), ...(attributeId ? [attributeId] : []), ...excludeSubjectIds).first<SeedCandidateRow>();
    if (row) return row;
  }
  return null;
};

const querySubjectQuestionState = async (
  db: Database,
  subjectId: string,
  attributeId: string,
): Promise<SeedCandidateRow | null> => db.statement(`
  SELECT s.subject_id, s.attribute_id, candidate_subject.game_id,
    s.score, s.rating_deviation, s.random_key
  FROM attribute_score_states s
  JOIN attribute_subjects candidate_subject ON candidate_subject.id = s.subject_id
  WHERE s.subject_id = ? AND s.attribute_id = ?
  LIMIT 1
`).bind(subjectId, attributeId).first<SeedCandidateRow>();

const queryOpponentForAttribute = async (
  db: Database,
  seed: SeedCandidateRow,
  options: AttributeQuestionOptions,
): Promise<string | null> => {
  const excludeSubjectIds = [seed.subject_id];
  const attributeId = seed.attribute_id;
  if (options.excludeAttributeId === attributeId) {
    if (options.excludeSubjectAId === seed.subject_id && options.excludeSubjectBId) excludeSubjectIds.push(options.excludeSubjectBId);
    if (options.excludeSubjectBId === seed.subject_id && options.excludeSubjectAId) excludeSubjectIds.push(options.excludeSubjectAId);
  }
  const uniqueExclusions = [...new Set(excludeSubjectIds)];
  const exclusion = excludedSubjectFilter(uniqueExclusions);
  const gameExclusion = seed.game_id ? 'AND (candidate_subject.game_id IS NULL OR candidate_subject.game_id <> ?)' : '';
  const fixedBinds = [attributeId, ...(seed.game_id ? [seed.game_id] : []), ...uniqueExclusions];
  const pivot = randomKey();
  const selectCandidate = (extraFilter: string, orderBy: string, extraBinds: unknown[]) => db.statement(`
    SELECT s.subject_id, s.attribute_id, candidate_subject.game_id,
      s.score, s.rating_deviation, s.random_key
    FROM attribute_score_states s
    JOIN attribute_subjects candidate_subject ON candidate_subject.id = s.subject_id
    LEFT JOIN games candidate_game ON candidate_game.id = candidate_subject.game_id
    WHERE s.attribute_id = ?
      ${gameExclusion}
      ${exclusion}
      ${extraFilter}
      AND ${votableSubjectCondition('candidate_subject', 'candidate_game')}
    ORDER BY ${orderBy}
    LIMIT 1
  `).bind(...fixedBinds, ...extraBinds).first<SeedCandidateRow>();

  const [nearestBelow, nearestAbove, randomAfter, randomBefore] = await Promise.all([
    selectCandidate('AND s.score < ?', 's.score DESC, s.subject_id DESC', [seed.score]),
    selectCandidate('AND s.score >= ?', 's.score ASC, s.subject_id ASC', [seed.score]),
    selectCandidate('AND s.random_key >= ?', 's.random_key ASC, s.subject_id ASC', [pivot]),
    selectCandidate('AND s.random_key < ?', 's.random_key DESC, s.subject_id DESC', [pivot]),
  ]);

  const candidates = new Map<string, AttributeQuestionOpponentCandidate>();
  const addCandidate = (row: SeedCandidateRow | null, isRandomCandidate: boolean) => {
    if (!row) return;
    const existing = candidates.get(row.subject_id);
    candidates.set(row.subject_id, {
      subjectId: row.subject_id,
      score: Number(row.score),
      ratingDeviation: Number(row.rating_deviation),
      comparisonCount: existing?.comparisonCount ?? 0,
      isRandomCandidate: Boolean(existing?.isRandomCandidate || isRandomCandidate),
    });
  };
  addCandidate(nearestBelow, false);
  addCandidate(nearestAbove, false);
  addCandidate(randomAfter, true);
  addCandidate(randomBefore, true);

  const boundedCandidates = [...candidates.values()].slice(0, ATTRIBUTE_QUESTION_OPPONENT_CANDIDATE_LIMIT);
  await Promise.all(boundedCandidates.map(async (candidate) => {
    const subjectAId = seed.subject_id < candidate.subjectId ? seed.subject_id : candidate.subjectId;
    const subjectBId = seed.subject_id < candidate.subjectId ? candidate.subjectId : seed.subject_id;
    const pair = await db.statement(`
      SELECT comparison_count
      FROM attribute_pair_stats
      WHERE subject_a_id = ? AND subject_b_id = ? AND attribute_id = ?
      LIMIT 1
    `).bind(subjectAId, subjectBId, attributeId).first<PairStatRow>();
    candidate.comparisonCount = Number(pair?.comparison_count ?? 0);
  }));

  const chosen = chooseAttributeQuestionOpponent({
    subjectId: seed.subject_id,
    score: Number(seed.score),
    ratingDeviation: Number(seed.rating_deviation),
  }, boundedCandidates);
  return chosen?.subjectId ?? null;
};

export const canonicalizeComparison = (subjectAId: string, subjectBId: string, result: AttributeComparisonResult) => {
  if (subjectAId <= subjectBId) return { subjectAId, subjectBId, result };
  return {
    subjectAId: subjectBId,
    subjectBId: subjectAId,
    result: result === 'A_HIGHER' ? 'B_HIGHER' : result === 'B_HIGHER' ? 'A_HIGHER' : 'SIMILAR',
  } satisfies { subjectAId: string; subjectBId: string; result: AttributeComparisonResult };
};

const isExcludedPair = (subjectAId: string, subjectBId: string, attributeId: string, options: AttributeQuestionOptions) => {
  if (options.excludeAttributeId !== attributeId) return false;
  return (subjectAId === options.excludeSubjectAId && subjectBId === options.excludeSubjectBId)
    || (subjectAId === options.excludeSubjectBId && subjectBId === options.excludeSubjectAId);
};

const queryQuestionWithAttribute = async (
  db: Database,
  attribute: AttributeDefinition,
  options: AttributeQuestionOptions,
): Promise<AttributeQuestion | null> => {
  let subjectAId: string | undefined = options.fixedSubjectAId;
  let subjectBId: string | undefined = options.fixedSubjectBId;
  let subjectAState: SeedCandidateRow | null = null;
  if (!subjectAId && !subjectBId) {
    subjectAState = await querySeedCandidate(db, attribute.id);
    subjectAId = subjectAState?.subject_id;
  }
  if (subjectAId && !subjectBId) {
    subjectAState ??= await querySubjectQuestionState(db, subjectAId, attribute.id);
    subjectBId = subjectAState ? (await queryOpponentForAttribute(db, subjectAState, options)) ?? undefined : undefined;
  }
  if (!subjectAId && subjectBId) {
    const subjectBState = await querySubjectQuestionState(db, subjectBId, attribute.id);
    subjectAId = subjectBState ? (await queryOpponentForAttribute(db, subjectBState, options)) ?? undefined : undefined;
  }
  const selected = subjectAId && subjectBId ? { subjectAId, subjectBId } : null;
  if (!selected || selected.subjectAId === selected.subjectBId || isExcludedPair(selected.subjectAId, selected.subjectBId, attribute.id, options)) return null;
  const subjects = await queryQuestionSubjects(db, [selected.subjectAId, selected.subjectBId]);
  const subjectMap = new Map(subjects.map((subject) => [subject.id, subject]));
  const subjectA = subjectMap.get(selected.subjectAId);
  const subjectB = subjectMap.get(selected.subjectBId);
  if (!subjectA || !subjectB) return null;
  if (subjectA.gameId && subjectB.gameId && subjectA.gameId === subjectB.gameId) return null;
  return { subjectA, subjectB, attribute };
};

export const queryAttributeQuestion = async (
  db: Database,
  _sessionId: string,
  options: AttributeQuestionOptions = {},
): Promise<AttributeQuestion | null> => {
  if (!options.fixedAttributeId && !options.fixedSubjectAId && !options.fixedSubjectBId) {
    const seed = await querySeedCandidate(db);
    if (!seed) return null;
    const attribute = await querySingleAttribute(db, seed.attribute_id);
    if (!attribute) return null;
    const subjectBId = await queryOpponentForAttribute(db, seed, options);
    if (!subjectBId || isExcludedPair(seed.subject_id, subjectBId, seed.attribute_id, options)) return null;
    const subjects = await queryQuestionSubjects(db, [seed.subject_id, subjectBId]);
    const subjectMap = new Map(subjects.map((subject) => [subject.id, subject]));
    const subjectA = subjectMap.get(seed.subject_id);
    const subjectB = subjectMap.get(subjectBId);
    if (!subjectA || !subjectB) return null;
    if (subjectA.gameId && subjectB.gameId && subjectA.gameId === subjectB.gameId) return null;
    return { subjectA, subjectB, attribute };
  }
  const attribute = await querySingleAttribute(db, options.fixedAttributeId);
  if (!attribute) return null;
  return queryQuestionWithAttribute(db, attribute, options);
};

export const queryAttributeQuestionPayload = async (
  db: Database,
  sessionId: string,
  options: AttributeQuestionOptions = {},
): Promise<AttributeQuestionPayload> => {
  const [question, activities] = await Promise.all([
    queryAttributeQuestion(db, sessionId, options),
    queryRecentActivities(db),
  ]);
  return { question, activities, scoreModelVersion: ATTRIBUTE_SCORE_MODEL_VERSION };
};

const toResponseActivitySubject = (id: string, displayName: string, slug: string, gameSlug: string | null) => ({
  id,
  displayName,
  slug,
  ...(gameSlug ? { gameSlug } : {}),
});

const stateToMatrixValue = (subjectId: string, attributeId: string, state: OnlineAttributeState): AttributeMatrixValue => ({
  subjectId,
  attributeId,
  score: Number(state.score.toFixed(2)),
  ratingDeviation: Number(state.ratingDeviation.toFixed(3)),
  directAverage: state.directCount ? Number((state.directSum / state.directCount).toFixed(2)) : undefined,
  directCount: state.directCount,
  comparisonCount: state.comparisonCount,
  decisiveComparisonCount: state.decisiveComparisonCount,
  evidenceCount: state.evidenceCount,
  modelVersion: ATTRIBUTE_SCORE_MODEL_VERSION,
});

const responseContextAndStates = async (db: Database, input: AttributeResponseInput) => {
  const row = await db.statement(`
    SELECT a.id AS attribute_id, t.name AS attribute_name, a.scale_type, t.endpoints_json,
      sa.id AS subject_a_id, sa.display_name AS subject_a_name, sa.slug AS subject_a_slug, ga.slug AS subject_a_game_slug,
      sb.id AS subject_b_id, sb.display_name AS subject_b_name, sb.slug AS subject_b_slug, gb.slug AS subject_b_game_slug,
      CASE WHEN u.show_nickname = 1 AND u.nickname IS NOT NULL THEN u.nickname ELSE '匿名玩家' END AS actor_name,
      ssa.subject_id AS state_a_subject_id, ssa.score AS state_a_score,
      ssa.rating_deviation AS state_a_rating_deviation, ssa.direct_sum AS state_a_direct_sum,
      ssa.direct_count AS state_a_direct_count, ssa.comparison_count AS state_a_comparison_count,
      ssa.decisive_comparison_count AS state_a_decisive_comparison_count,
      ssa.evidence_count AS state_a_evidence_count,
      ssb.subject_id AS state_b_subject_id, ssb.score AS state_b_score,
      ssb.rating_deviation AS state_b_rating_deviation, ssb.direct_sum AS state_b_direct_sum,
      ssb.direct_count AS state_b_direct_count, ssb.comparison_count AS state_b_comparison_count,
      ssb.decisive_comparison_count AS state_b_decisive_comparison_count,
      ssb.evidence_count AS state_b_evidence_count
    FROM attributes a
    JOIN attribute_translations t ON t.attribute_id = a.id AND t.locale = 'zh-TW'
    JOIN attribute_subjects sa ON sa.id = ?
    JOIN attribute_subjects sb ON sb.id = ?
    LEFT JOIN games ga ON ga.id = sa.game_id
    LEFT JOIN games gb ON gb.id = sb.game_id
    LEFT JOIN attribute_score_states ssa ON ssa.subject_id = sa.id AND ssa.attribute_id = a.id
    LEFT JOIN attribute_score_states ssb ON ssb.subject_id = sb.id AND ssb.attribute_id = a.id
    LEFT JOIN users u ON u.id = ?
    WHERE a.id = ? AND a.is_active = 1
      AND ${votableSubjectCondition('sa', 'ga')}
      AND ${votableSubjectCondition('sb', 'gb')}
      AND (sa.game_id IS NULL OR sb.game_id IS NULL OR sa.game_id <> sb.game_id)
  `).bind(input.subjectAId, input.subjectBId, input.actorId, input.attributeId).first<ResponseContextAndStateRow>();
  if (!row) throw new Error('attribute_subject_not_found');

  const stateFor = (side: 'a' | 'b'): OnlineAttributeState | null => {
    const values = side === 'a'
      ? {
          subjectId: row.state_a_subject_id,
          score: row.state_a_score,
          ratingDeviation: row.state_a_rating_deviation,
          directSum: row.state_a_direct_sum,
          directCount: row.state_a_direct_count,
          comparisonCount: row.state_a_comparison_count,
          decisiveComparisonCount: row.state_a_decisive_comparison_count,
          evidenceCount: row.state_a_evidence_count,
        }
      : {
          subjectId: row.state_b_subject_id,
          score: row.state_b_score,
          ratingDeviation: row.state_b_rating_deviation,
          directSum: row.state_b_direct_sum,
          directCount: row.state_b_direct_count,
          comparisonCount: row.state_b_comparison_count,
          decisiveComparisonCount: row.state_b_decisive_comparison_count,
          evidenceCount: row.state_b_evidence_count,
        };
    if (!values.subjectId) return null;
    return {
      score: Number(values.score ?? 5),
      ratingDeviation: Number(values.ratingDeviation ?? ATTRIBUTE_INITIAL_RD),
      directSum: Number(values.directSum ?? 0),
      directCount: Number(values.directCount ?? 0),
      comparisonCount: Number(values.comparisonCount ?? 0),
      decisiveComparisonCount: Number(values.decisiveComparisonCount ?? 0),
      evidenceCount: Number(values.evidenceCount ?? 0),
    };
  };

  return {
    context: row,
    states: new Map([
      [input.subjectAId, stateFor('a')],
      [input.subjectBId, stateFor('b')],
    ].filter((entry): entry is [string, OnlineAttributeState] => entry[1] != null)),
  };
};

interface AttributeWriteLock {
  token: string;
  names: string[];
}

const attributeWriteLockNames = (input: AttributeResponseInput): string[] => {
  const subjectIds = new Set<string>();
  if (input.comparison != null || input.ratingA != null) subjectIds.add(input.subjectAId);
  if (input.comparison != null || input.ratingB != null) subjectIds.add(input.subjectBId);
  return [...subjectIds]
    .map((subjectId) => `${ATTRIBUTE_RESPONSE_LOCK_PREFIX}:${input.attributeId}:${subjectId}`)
    .sort();
};

const batchChangeCount = (result: { meta?: { changes?: number } } | undefined) => result?.meta?.changes ?? 1;

const attributeMergeSubjectIds = async (db: Database, sourceGameId: string, targetGameId: string) => {
  const result = await db.statement(`
    SELECT subject.game_id, subject.id
    FROM attribute_subjects subject
    JOIN games game ON game.id = subject.game_id
    WHERE subject.kind = 'game'
      AND subject.game_id IN (?, ?)
      AND ${votableSubjectCondition('subject', 'game')}
  `).bind(sourceGameId, targetGameId).all<{ game_id: string; id: string }>();
  const byGameId = new Map((result.results ?? []).map((row) => [row.game_id, row.id]));
  return { sourceSubjectId: byGameId.get(sourceGameId) ?? null, targetSubjectId: byGameId.get(targetGameId) ?? null };
};

/**
 * Stop votes touching either canonical game while an editor merge rebuilds the
 * materialized attribute states. This closes the small race between reading
 * the historical answer stream and committing the rebuilt states.
 */
export const acquireAttributeMergeLock = async (
  db: Database,
  sourceGameId: string,
  targetGameId: string,
  timestamp: number,
): Promise<AttributeMergeLock> => {
  const [{ sourceSubjectId, targetSubjectId }, attributes] = await Promise.all([
    attributeMergeSubjectIds(db, sourceGameId, targetGameId),
    db.statement('SELECT id FROM attributes WHERE is_active = 1 ORDER BY id').all<{ id: string }>(),
  ]);
  const subjectIds = [sourceSubjectId, targetSubjectId].filter((id): id is string => Boolean(id));
  const names = [...new Set((attributes.results ?? []).flatMap((attribute) => subjectIds.map((subjectId) => `${ATTRIBUTE_RESPONSE_LOCK_PREFIX}:${attribute.id}:${subjectId}`)))].sort();
  if (!names.length) return { token: '', names: [] };
  const token = createId('attribute-merge-lock');
  const expiresAt = Math.max(Date.now(), timestamp) + ATTRIBUTE_RESPONSE_LOCK_TTL_MS;
  const results = await db.batch([
    db.statement(`
      DELETE FROM attribute_vote_lock
      WHERE lock_name IN (${names.map(() => '?').join(',')}) AND expires_at < ?
    `).bind(...names, Date.now()),
    ...names.map((name) => db.statement(`
      INSERT OR IGNORE INTO attribute_vote_lock (lock_name, token, expires_at)
      VALUES (?, ?, ?)
    `).bind(name, token, expiresAt)),
  ]);
  const acquired = names.filter((_, index) => batchChangeCount(results[index + 1]) === 1);
  if (acquired.length !== names.length) {
    await releaseAttributeMergeLock(db, { token, names: acquired });
    throw new Error('attribute_response_busy');
  }
  return { token, names };
};

export const releaseAttributeMergeLock = async (db: Database, lock: AttributeMergeLock): Promise<void> => {
  if (!lock.names.length) return;
  await db.statement(`
    DELETE FROM attribute_vote_lock
    WHERE lock_name IN (${lock.names.map(() => '?').join(',')}) AND token = ?
  `).bind(...lock.names, lock.token).run();
};

/**
 * Create a resumable rebuild job. The merge request only inserts this row;
 * historical answers are replayed by processAttributeMergeRebuildJobs().
 */
export const prepareAttributeMergeRebuildJob = async (
  db: Database,
  sourceGameId: string,
  targetGameId: string,
  timestamp: number,
): Promise<AttributeMergeRebuildJobPlan> => {
  const [{ sourceSubjectId, targetSubjectId }, activeJob] = await Promise.all([
    attributeMergeSubjectIds(db, sourceGameId, targetGameId),
    db.statement(`
      SELECT id
      FROM attribute_merge_rebuild_jobs
      WHERE status IN ('pending', 'running')
      LIMIT 1
    `).first<{ id: string }>(),
  ]);
  if (activeJob) throw new Error('attribute_merge_busy');
  if (!sourceSubjectId || !targetSubjectId) return { id: '', sourceSubjectId, targetSubjectId, statement: null };
  const id = createId('attribute-merge-rebuild');
  return {
    id,
    sourceSubjectId,
    targetSubjectId,
    statement: db.statement(`
      INSERT INTO attribute_merge_rebuild_jobs
        (id, source_game_id, target_game_id, source_subject_id, target_subject_id,
         status, reset_completed, cursor_created_at, cursor_stream_id,
         cutoff_created_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', 0, -1, '', ?, ?, ?)
    `).bind(id, sourceGameId, targetGameId, sourceSubjectId, targetSubjectId, timestamp, timestamp, timestamp),
  };
};

export const hasActiveAttributeMergeRebuild = async (db: Database): Promise<boolean> => Boolean(await db.statement(`
  SELECT id
  FROM attribute_merge_rebuild_jobs
  WHERE status IN ('pending', 'running')
  LIMIT 1
`).first<{ id: string }>());

interface AttributeMergeBaselineRow {
  subject_id: string;
  attribute_id: string;
  direct_sum: number;
  direct_count: number;
}

/**
 * Direct ratings are commutative, so calculate their per-subject baseline in
 * SQL once. Comparisons are then replayed in memory in chronological order.
 */
const queryAttributeMergeBaselineStates = async (
  db: Database,
  job: AttributeMergeRebuildJobRow,
): Promise<AttributeMergeBaselineRow[]> => {
  const result = await db.statement(`
      WITH values_for_replay(subject_id, attribute_id, value) AS (
        SELECT CASE WHEN subject_a_id = ? THEN ? ELSE subject_a_id END, attribute_id, rating_a FROM attribute_vote_responses WHERE rating_a IS NOT NULL AND attribute_id IS NOT NULL AND (? IS NULL OR attribute_id = ?) AND created_at <= ?
        UNION ALL SELECT CASE WHEN subject_b_id = ? THEN ? ELSE subject_b_id END, attribute_id, rating_b FROM attribute_vote_responses WHERE rating_b IS NOT NULL AND attribute_id IS NOT NULL AND (? IS NULL OR attribute_id = ?) AND created_at <= ?
        UNION ALL SELECT CASE WHEN subject_a_id = ? THEN ? ELSE subject_a_id END, attribute_id, value FROM attribute_vote_events e WHERE kind='rating' AND value IS NOT NULL AND (? IS NULL OR attribute_id = ?) AND created_at <= ? AND NOT EXISTS (SELECT 1 FROM attribute_vote_responses r WHERE r.response_id=e.response_id AND r.attribute_id IS NOT NULL)
      ), averages AS (SELECT subject_id,attribute_id,SUM(value) total,COUNT(*) count FROM values_for_replay GROUP BY subject_id,attribute_id)
      SELECT s.id AS subject_id, a.id AS attribute_id,
        COALESCE(d.total, 0) AS direct_sum, COALESCE(d.count, 0) AS direct_count
      FROM attribute_subjects s
      CROSS JOIN attributes a
      LEFT JOIN games g ON g.id = s.game_id
      LEFT JOIN averages d ON d.subject_id=s.id AND d.attribute_id=a.id
      WHERE a.is_active = 1 AND (? IS NULL OR a.id = ?)
        AND ${votableSubjectCondition('s', 'g')}
    `).bind(job.source_subject_id, job.target_subject_id, job.attribute_id, job.attribute_id, job.cutoff_created_at,
    job.source_subject_id, job.target_subject_id, job.attribute_id, job.attribute_id, job.cutoff_created_at,
    job.source_subject_id, job.target_subject_id, job.attribute_id, job.attribute_id, job.cutoff_created_at,
    job.attribute_id, job.attribute_id).all<AttributeMergeBaselineRow>();
  return result.results ?? [];
};

const queryAttributeMergeHistoryBatch = async (
  db: Database,
  job: AttributeMergeRebuildJobRow,
): Promise<AttributeMergeHistoryRow[]> => {
  const [eventResult, responseResult] = await Promise.all([
    db.statement(`
      SELECT
        'event:' || e.response_id || ':' ||
          CASE WHEN e.kind = 'rating' THEN '1:' ELSE '2:' END ||
          e.event_key || ':' || e.id AS stream_id,
        e.attribute_id,
        e.subject_a_id,
        e.subject_b_id,
        NULL AS rating_a,
        NULL AS rating_b,
        CASE WHEN e.kind = 'comparison' THEN e.result ELSE NULL END AS comparison,
        e.created_at
      FROM attribute_vote_events e
      JOIN attributes active_attribute
        ON active_attribute.id = e.attribute_id AND active_attribute.is_active = 1
      WHERE e.kind = 'comparison' AND (? IS NULL OR e.attribute_id = ?) AND e.created_at <= ?
        AND (e.created_at > ? OR (e.created_at = ? AND
          ('event:' || e.response_id || ':' ||
            CASE WHEN e.kind = 'rating' THEN '1:' ELSE '2:' END ||
            e.event_key || ':' || e.id) > ?))
        AND NOT EXISTS (
          SELECT 1
          FROM attribute_vote_responses r
          WHERE r.response_id = e.response_id AND r.attribute_id IS NOT NULL
        )
      ORDER BY e.created_at, stream_id
      LIMIT ${ATTRIBUTE_MERGE_REBUILD_BATCH_SIZE}
    `).bind(
      job.attribute_id, job.attribute_id, job.cutoff_created_at,
      job.cursor_created_at,
      job.cursor_created_at,
      job.cursor_stream_id,
    ).all<AttributeMergeHistoryRow>(),
    db.statement(`
      SELECT
        'response:' || r.response_id AS stream_id,
        r.attribute_id,
        r.subject_a_id,
        r.subject_b_id,
        NULL AS rating_a,
        NULL AS rating_b,
        r.comparison,
        r.created_at
      FROM attribute_vote_responses r
      JOIN attributes active_attribute
        ON active_attribute.id = r.attribute_id AND active_attribute.is_active = 1
      WHERE (? IS NULL OR r.attribute_id = ?) AND r.attribute_id IS NOT NULL AND r.comparison IS NOT NULL AND r.created_at <= ?
        AND (r.created_at > ? OR (r.created_at = ? AND
          ('response:' || r.response_id) > ?))
      ORDER BY r.created_at, stream_id
      LIMIT ${ATTRIBUTE_MERGE_REBUILD_BATCH_SIZE}
    `).bind(
      job.attribute_id, job.attribute_id, job.cutoff_created_at,
      job.cursor_created_at,
      job.cursor_created_at,
      job.cursor_stream_id,
    ).all<AttributeMergeHistoryRow>(),
  ]);
  return [...(eventResult.results ?? []), ...(responseResult.results ?? [])]
    .sort((left, right) => left.created_at - right.created_at || left.stream_id.localeCompare(right.stream_id))
    .slice(0, ATTRIBUTE_MERGE_REBUILD_BATCH_SIZE);
};

const mergeStateKey = (subjectId: string, attributeId: string) => `${subjectId}\u0000${attributeId}`;

const stateFromBaseline = (row: AttributeMergeBaselineRow): OnlineAttributeState => {
  const directCount = Number(row.direct_count);
  const directSum = Number(row.direct_sum);
  return {
    score: directCount ? directSum / directCount : 5,
    ratingDeviation: directCount ? 1.5 / Math.sqrt(directCount) : ATTRIBUTE_INITIAL_RD,
    directSum,
    directCount,
    comparisonCount: 0,
    decisiveComparisonCount: 0,
    evidenceCount: directCount,
  };
};

const chunk = <T>(values: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
};

const rebuildStateStatement = (
  db: Database,
  rows: Array<{ subjectId: string; attributeId: string; state: OnlineAttributeState }>,
  timestamp: number,
) => db.statement(`
  INSERT INTO attribute_score_states
    (subject_id, attribute_id, score, rating_deviation, direct_sum, direct_count,
     comparison_count, decisive_comparison_count, evidence_count, model_version,
     updated_at, random_key, question_slot)
  VALUES ${rows.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, lower(hex(randomblob(16))), (abs(random()) % ' + ATTRIBUTE_QUESTION_SLOT_COUNT + ') + 1)').join(', ')}
  ON CONFLICT(subject_id, attribute_id) DO UPDATE SET
    score = excluded.score,
    rating_deviation = excluded.rating_deviation,
    direct_sum = excluded.direct_sum,
    direct_count = excluded.direct_count,
    comparison_count = excluded.comparison_count,
    decisive_comparison_count = excluded.decisive_comparison_count,
    evidence_count = excluded.evidence_count,
    model_version = excluded.model_version,
    updated_at = excluded.updated_at
`).bind(...rows.flatMap(({ subjectId, attributeId, state }) => [
  subjectId, attributeId, state.score, state.ratingDeviation, state.directSum,
  state.directCount, state.comparisonCount, state.decisiveComparisonCount,
  state.evidenceCount, ATTRIBUTE_SCORE_MODEL_VERSION, timestamp,
]));

const stateMatches = (stored: AttributeScoreStateRow | undefined, next: OnlineAttributeState): boolean => {
  if (!stored || stored.model_version !== ATTRIBUTE_SCORE_MODEL_VERSION) return false;
  // Older public snapshots round display values. That rounding must not make
  // a no-op replay rewrite every state; new snapshots retain replayState too.
  const nearlyEqual = (left: number, right: number, tolerance: number) => Math.abs(left - right) <= tolerance;
  return nearlyEqual(Number(stored.score), next.score, 0.0051)
    && nearlyEqual(Number(stored.rating_deviation), next.ratingDeviation, 0.00051)
    && nearlyEqual(Number(stored.direct_sum), next.directSum, Math.max(1e-12, Number(stored.direct_count) * 0.0051))
    && Number(stored.direct_count) === next.directCount
    && Number(stored.comparison_count) === next.comparisonCount
    && Number(stored.decisive_comparison_count) === next.decisiveComparisonCount
    && Number(stored.evidence_count) === next.evidenceCount;
};

const queryStoredRebuildStates = async (
  db: Database,
  attributeId: string | null,
): Promise<AttributeScoreStateRow[]> => {
  const result = await db.statement(`
    SELECT subject_id, attribute_id, score, rating_deviation, direct_sum, direct_count,
      comparison_count, decisive_comparison_count, evidence_count, model_version
    FROM attribute_score_states
    WHERE (? IS NULL OR attribute_id = ?)
  `).bind(attributeId, attributeId).all<AttributeScoreStateRow>();
  return result.results ?? [];
};

interface StoredPairStatRow {
  subject_a_id: string;
  subject_b_id: string;
  attribute_id: string;
  comparison_count: number;
}

const pairStatKey = (subjectAId: string, subjectBId: string, attributeId: string) =>
  `${subjectAId}\u0000${subjectBId}\u0000${attributeId}`;

const queryStoredRebuildPairStats = async (
  db: Database,
  attributeId: string | null,
): Promise<StoredPairStatRow[]> => {
  const result = await db.statement(`
    SELECT subject_a_id, subject_b_id, attribute_id, comparison_count
    FROM attribute_pair_stats
    WHERE (? IS NULL OR attribute_id = ?)
  `).bind(attributeId, attributeId).all<StoredPairStatRow>();
  return result.results ?? [];
};

const attributeMergeJobLock = async (db: Database, jobId: string) => {
  const token = createId('attribute-merge-job-lock');
  const lockName = `${ATTRIBUTE_RESPONSE_LOCK_PREFIX}:rebuild:${jobId}`;
  await db.statement('DELETE FROM attribute_vote_lock WHERE lock_name = ? AND expires_at < ?')
    .bind(lockName, Date.now()).run();
  const result = await db.statement(`
    INSERT OR IGNORE INTO attribute_vote_lock (lock_name, token, expires_at)
    VALUES (?, ?, ?)
  `).bind(lockName, token, Date.now() + ATTRIBUTE_MERGE_JOB_LOCK_TTL_MS).run();
  if (batchChangeCount(result) !== 1) return null;
  return { token, lockName };
};

const releaseAttributeMergeJobLock = async (db: Database, lock: { token: string; lockName: string }) => {
  await db.statement('DELETE FROM attribute_vote_lock WHERE lock_name = ? AND token = ?')
    .bind(lock.lockName, lock.token).run();
};

const processAttributeMergeRebuild = async (
  db: Database,
  timestamp: number,
  suppliedJob?: AttributeMergeRebuildJobRow,
): Promise<boolean> => {
  const job = suppliedJob ?? await db.statement(`
    SELECT id, source_game_id, target_game_id, source_subject_id, target_subject_id,
      attribute_id, status, reset_completed, cursor_created_at, cursor_stream_id,
      cutoff_created_at, error_message, created_at, updated_at
    FROM attribute_merge_rebuild_jobs
    WHERE status IN ('pending', 'running')
    ORDER BY created_at, id
    LIMIT 1
  `).first<AttributeMergeRebuildJobRow>();
  if (!job) return false;
  const lock = await attributeMergeJobLock(db, job.id);
  if (!lock) return false;
  let rebuildModeActive = false;
  try {
    const states = new Map((await queryAttributeMergeBaselineStates(db, job)).map((row) => [
      mergeStateKey(row.subject_id, row.attribute_id), stateFromBaseline(row),
    ]));
    const pairCounts = new Map<string, { subjectAId: string; subjectBId: string; attributeId: string; count: number }>();
    const getState = (subjectId: string, attributeId: string) => {
      const key = mergeStateKey(subjectId, attributeId);
      const state = states.get(key) ?? emptyAttributeState();
      states.set(key, state);
      return { key, state };
    };
    let replayCursor: AttributeMergeRebuildJobRow = { ...job, cursor_created_at: -1, cursor_stream_id: '' };
    let last: AttributeMergeHistoryRow | undefined;
    for (;;) {
      const rows = await queryAttributeMergeHistoryBatch(db, replayCursor);
      if (!rows.length) break;
      rows.forEach((row) => {
        const subjectAId = row.subject_a_id === job.source_subject_id ? job.target_subject_id : row.subject_a_id;
        const subjectBId = row.subject_b_id === job.source_subject_id ? job.target_subject_id : row.subject_b_id;
        if (!subjectAId || !subjectBId || subjectAId === subjectBId || !row.comparison) return;
        const a = getState(subjectAId, row.attribute_id);
        const b = getState(subjectBId, row.attribute_id);
        const updated = applyComparison(a.state, b.state, row.comparison);
        states.set(a.key, updated.a.next);
        states.set(b.key, updated.b.next);
        const [firstSubjectId, secondSubjectId] = subjectAId < subjectBId
          ? [subjectAId, subjectBId] : [subjectBId, subjectAId];
        const key = `${firstSubjectId}\u0000${secondSubjectId}\u0000${row.attribute_id}`;
        const pair = pairCounts.get(key);
        if (pair) pair.count += 1;
        else pairCounts.set(key, { subjectAId: firstSubjectId, subjectBId: secondSubjectId, attributeId: row.attribute_id, count: 1 });
      });
      last = rows.at(-1)!;
      replayCursor = { ...replayCursor, cursor_created_at: last.created_at, cursor_stream_id: last.stream_id };
    }

    // No comparison has written to D1 yet. Compare the complete in-memory
    // result with materialized rows, then write only the differences.
    const stateRows = [...states.entries()].map(([key, state]) => {
      const separator = key.indexOf('\u0000');
      return { subjectId: key.slice(0, separator), attributeId: key.slice(separator + 1), state };
    });
    const storedStates = new Map((await queryStoredRebuildStates(db, job.attribute_id)).map((row) => [
      mergeStateKey(row.subject_id, row.attribute_id), row,
    ]));
    const changedStateRows = stateRows.filter(({ subjectId, attributeId, state }) =>
      !stateMatches(storedStates.get(mergeStateKey(subjectId, attributeId)), state));

    const storedPairStats = new Map((await queryStoredRebuildPairStats(db, job.attribute_id)).map((row) => [
      pairStatKey(row.subject_a_id, row.subject_b_id, row.attribute_id), row,
    ]));
    const changedPairs = [...pairCounts.values()].filter((pair) =>
      Number(storedPairStats.get(pairStatKey(pair.subjectAId, pair.subjectBId, pair.attributeId))?.comparison_count) !== pair.count);
    const stalePairs = [...storedPairStats.values()].filter((pair) => !pairCounts.has(
      pairStatKey(pair.subject_a_id, pair.subject_b_id, pair.attribute_id)));

    if (changedStateRows.length) {
      // A state change would otherwise write a catalog delta through its
      // trigger. The workflow rebuilds the complete snapshot afterwards.
      await db.statement('INSERT OR IGNORE INTO attribute_catalog_rebuild_mode (id) VALUES (1)').run();
      rebuildModeActive = true;
    }
    for (const statementBatch of chunk(
      chunk(changedStateRows, ATTRIBUTE_REBUILD_STATE_ROWS_PER_STATEMENT).map((rows) => rebuildStateStatement(db, rows, timestamp)),
      ATTRIBUTE_REBUILD_STATEMENTS_PER_BATCH,
    )) await db.batch(statementBatch);

    const pairStatements = changedPairs.map((pair) => db.statement(`
      INSERT INTO attribute_pair_stats
        (subject_a_id, subject_b_id, attribute_id, comparison_count, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(subject_a_id, subject_b_id, attribute_id) DO UPDATE SET
        comparison_count = excluded.comparison_count,
      updated_at = excluded.updated_at
    `).bind(pair.subjectAId, pair.subjectBId, pair.attributeId, pair.count, timestamp));
    for (const statementBatch of chunk(pairStatements, ATTRIBUTE_REBUILD_STATEMENTS_PER_BATCH)) await db.batch(statementBatch);
    for (const statementBatch of chunk(stalePairs.map((pair) => db.statement(`
      DELETE FROM attribute_pair_stats
      WHERE subject_a_id = ? AND subject_b_id = ? AND attribute_id = ?
    `).bind(pair.subject_a_id, pair.subject_b_id, pair.attribute_id)), ATTRIBUTE_REBUILD_STATEMENTS_PER_BATCH)) {
      await db.batch(statementBatch);
    }
    await db.batch([
      ...(suppliedJob ? [] : [db.statement(`
      UPDATE attribute_merge_rebuild_jobs
      SET status = 'completed', reset_completed = 1, cursor_created_at = ?, cursor_stream_id = ?, error_message = NULL, updated_at = ?
      WHERE id = ? AND status IN ('pending', 'running')
    `).bind(last?.created_at ?? -1, last?.stream_id ?? '', timestamp, job.id)]),
      ...(rebuildModeActive ? [db.statement('DELETE FROM attribute_catalog_rebuild_mode WHERE id = 1')] : []),
    ]);
    rebuildModeActive = false;
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'attribute_merge_rebuild_failed';
    if (rebuildModeActive) await db.statement('DELETE FROM attribute_catalog_rebuild_mode WHERE id = 1').run();
    if (!suppliedJob) await db.statement(`
      UPDATE attribute_merge_rebuild_jobs
      SET status = 'failed', error_message = ?, updated_at = ?
      WHERE id = ? AND status IN ('pending', 'running')
    `).bind(message, timestamp, job.id).run();
    throw error;
  } finally {
    await releaseAttributeMergeJobLock(db, lock);
  }
};

export const processAttributeMergeRebuildJobs = async (
  db: Database,
  timestamp = Date.now(),
  _maxBatches?: number,
): Promise<boolean> => processAttributeMergeRebuild(db, timestamp);

interface FullReplaySnapshotRow {
  active_generation: number;
  through_version: number;
  attributes_json: string;
}

interface FullReplaySnapshotChunkRow { entries_json: string; }
interface FullReplayCatalogEntryRow { entry_key: string; catalog_version: number; entry_json: string | null; deleted: number; }
interface FullReplayPairSnapshotRow { active_generation: number; chunk_count: number; }
interface FullReplayPairSnapshotChunkRow { pairs_json: string; }
interface FullReplayHistoryRow {
  stream_id: string;
  kind: 'rating' | 'comparison';
  attribute_id: string;
  subject_a_id: string;
  subject_b_id: string | null;
  value: number | null;
  comparison: AttributeComparisonResult | null;
  created_at: number;
}

interface FullReplayResponseRow {
  response_id: string;
  attribute_id: string;
  subject_a_id: string;
  subject_b_id: string | null;
  rating_a: number | null;
  rating_b: number | null;
  comparison: AttributeComparisonResult | null;
  created_at: number;
}

interface FullReplayEventRow {
  id: string;
  response_id: string;
  event_key: string;
  kind: 'rating' | 'comparison';
  attribute_id: string;
  subject_a_id: string;
  subject_b_id: string | null;
  value: number | null;
  result: AttributeComparisonResult | null;
  created_at: number;
}

export interface AttributeReplayResult {
  changed: boolean;
  catalogPayload: AttributesPayload;
  catalogThroughVersion: number;
}

const parseFullReplayJson = (value: string): unknown => {
  try { return JSON.parse(value); } catch { throw new Error('invalid_attribute_replay_snapshot'); }
};

/**
 * The public catalog snapshot already contains every active score state.
 * Reconstruct from its few chunks plus post-snapshot entries, rather than
 * reading attribute_score_states once per weekly replay.
 */
const queryFullReplayMaterializedStates = async (db: Database) => {
  const snapshot = await db.statement(`
    SELECT active_generation, through_version, attributes_json
    FROM attribute_catalog_snapshot_state WHERE id = 1
  `).first<FullReplaySnapshotRow>();
  if (!snapshot) throw new Error('attribute_catalog_unavailable');
  const [chunksResult, changesResult] = await Promise.all([
    db.statement(`SELECT entries_json FROM attribute_catalog_snapshot_chunks
      WHERE generation = ? ORDER BY chunk_number`).bind(snapshot.active_generation).all<FullReplaySnapshotChunkRow>(),
    db.statement(`SELECT entry_key, catalog_version, entry_json, deleted FROM attribute_catalog_entries
      WHERE catalog_version > ? ORDER BY catalog_version, entry_key`).bind(snapshot.through_version).all<FullReplayCatalogEntryRow>(),
  ]);
  const subjectIds = new Set<string>();
  const attributes = new Map<string, AttributeDefinition>();
  const subjects = new Map<string, AttributeSubject>();
  const candidates = new Map<string, AttributeImportCandidate>();
  const stored = new Map<string, AttributeScoreStateRow>();
  const addValue = (value: Record<string, unknown>) => {
    if (typeof value.subjectId !== 'string' || typeof value.attributeId !== 'string'
      || typeof value.score !== 'number' || typeof value.ratingDeviation !== 'number'
      || typeof value.directCount !== 'number' || typeof value.comparisonCount !== 'number'
      || typeof value.decisiveComparisonCount !== 'number' || typeof value.modelVersion !== 'string') return;
    const replayState = value.replayState as Record<string, unknown> | undefined;
    const exact = replayState && typeof replayState.score === 'number' && typeof replayState.ratingDeviation === 'number'
      && typeof replayState.directSum === 'number' ? replayState : undefined;
    stored.set(mergeStateKey(value.subjectId, value.attributeId), {
      subject_id: value.subjectId, attribute_id: value.attributeId, score: typeof exact?.score === 'number' ? exact.score : value.score,
      rating_deviation: typeof exact?.ratingDeviation === 'number' ? exact.ratingDeviation : value.ratingDeviation,
      direct_sum: typeof exact?.directSum === 'number' ? exact.directSum : (typeof value.directAverage === 'number' ? value.directAverage * value.directCount : 0),
      direct_count: typeof exact?.directCount === 'number' ? exact.directCount : value.directCount,
      comparison_count: typeof exact?.comparisonCount === 'number' ? exact.comparisonCount : value.comparisonCount,
      decisive_comparison_count: typeof exact?.decisiveComparisonCount === 'number' ? exact.decisiveComparisonCount : value.decisiveComparisonCount,
      evidence_count: typeof exact?.evidenceCount === 'number' ? exact.evidenceCount : (typeof value.evidenceCount === 'number' ? value.evidenceCount : value.directCount + value.comparisonCount),
      model_version: typeof exact?.modelVersion === 'string' ? exact.modelVersion : value.modelVersion,
    });
  };
  const removeSubject = (subjectId: string) => {
    subjectIds.delete(subjectId); subjects.delete(subjectId);
    for (const key of stored.keys()) if (key.startsWith(`${subjectId}\u0000`)) stored.delete(key);
  };
  const removeAttribute = (attributeId: string) => {
    attributes.delete(attributeId);
    for (const [key, value] of stored) if (value.attribute_id === attributeId) stored.delete(key);
  };
  const applyEntry = (entryKey: string, entryJson: string | null, deleted: boolean) => {
    const [kind, ...parts] = entryKey.split(':');
    if (deleted || !entryJson) {
      if (kind === 'subject') removeSubject(parts.join(':'));
      else if (kind === 'attribute') removeAttribute(parts.join(':'));
      else if (kind === 'value') stored.delete(mergeStateKey(parts[0], parts.slice(1).join(':')));
      else if (kind === 'candidate') candidates.delete(parts.join(':'));
      return;
    }
    const entry = parseFullReplayJson(entryJson) as Record<string, unknown>;
    if (entry.kind === 'subject') {
      const subject = entry.subject as Record<string, unknown> | undefined;
      if (typeof subject?.id === 'string') { subjectIds.add(subject.id); subjects.set(subject.id, subject as unknown as AttributeSubject); }
    } else if (entry.kind === 'attribute') {
      const attribute = entry.attribute as Record<string, unknown> | undefined;
      if (typeof attribute?.id === 'string') attributes.set(attribute.id, attribute as unknown as AttributeDefinition);
    } else if (entry.kind === 'value') addValue(entry);
    else if (entry.kind === 'candidate' && typeof entry.id === 'string') candidates.set(entry.id, entry as unknown as AttributeImportCandidate);
  };
  const snapshotAttributes = parseFullReplayJson(snapshot.attributes_json);
  if (!Array.isArray(snapshotAttributes)) throw new Error('invalid_attribute_replay_snapshot');
  for (const attribute of snapshotAttributes as Array<Record<string, unknown>>) if (typeof attribute.id === 'string') attributes.set(attribute.id, attribute as unknown as AttributeDefinition);
  for (const row of chunksResult.results ?? []) {
    const entries = parseFullReplayJson(row.entries_json);
    if (!Array.isArray(entries)) throw new Error('invalid_attribute_replay_snapshot');
    for (const entry of entries as Array<Record<string, unknown>>) {
      if (entry.kind === 'subject') {
        const subject = entry.subject as Record<string, unknown> | undefined;
        if (typeof subject?.id !== 'string') continue;
        subjectIds.add(subject.id); subjects.set(subject.id, subject as unknown as AttributeSubject);
        if (Array.isArray(entry.values)) for (const value of entry.values as Array<Record<string, unknown>>) addValue(value);
      } else if (entry.kind === 'candidate' && typeof entry.candidate === 'object' && entry.candidate) {
        const candidate = entry.candidate as AttributeImportCandidate;
        if (typeof candidate.id === 'string') candidates.set(candidate.id, candidate);
      }
    }
  }
  for (const entry of changesResult.results ?? []) applyEntry(entry.entry_key, entry.entry_json, Boolean(entry.deleted));
  return {
    subjectIds, attributes, subjects, candidates, stored,
    throughVersion: Number((changesResult.results ?? []).at(-1)?.catalog_version ?? snapshot.through_version),
  };
};

const queryFullReplayHistory = async (db: Database, cutoff: number): Promise<FullReplayHistoryRow[]> => {
  // Each source table is read once.  Splitting one response into its ratings
  // and comparison in memory prevents three scans of the response history.
  const [responses, events] = await Promise.all([
    db.statement(`SELECT r.response_id, r.attribute_id, r.subject_a_id, r.subject_b_id,
      r.rating_a, r.rating_b, r.comparison, r.created_at
      FROM attribute_vote_responses r JOIN attributes a ON a.id = r.attribute_id AND a.is_active = 1
      WHERE r.attribute_id IS NOT NULL AND r.created_at <= ?`).bind(cutoff).all<FullReplayResponseRow>(),
    db.statement(`SELECT e.id, e.response_id, e.event_key, e.kind, e.attribute_id,
      e.subject_a_id, e.subject_b_id, e.value, e.result, e.created_at
      FROM attribute_vote_events e JOIN attributes a ON a.id = e.attribute_id AND a.is_active = 1
      WHERE e.created_at <= ? AND e.kind IN ('rating', 'comparison')`).bind(cutoff).all<FullReplayEventRow>(),
  ]);
  const responseIds = new Set((responses.results ?? []).map((row) => row.response_id));
  const history: FullReplayHistoryRow[] = [];
  for (const row of responses.results ?? []) {
    if (row.rating_a != null) history.push({ stream_id: `response:${row.response_id}:rating-a`, kind: 'rating', attribute_id: row.attribute_id, subject_a_id: row.subject_a_id, subject_b_id: null, value: row.rating_a, comparison: null, created_at: row.created_at });
    if (row.rating_b != null && row.subject_b_id) history.push({ stream_id: `response:${row.response_id}:rating-b`, kind: 'rating', attribute_id: row.attribute_id, subject_a_id: row.subject_b_id, subject_b_id: null, value: row.rating_b, comparison: null, created_at: row.created_at });
    if (row.comparison && row.subject_b_id) history.push({ stream_id: `response:${row.response_id}:comparison`, kind: 'comparison', attribute_id: row.attribute_id, subject_a_id: row.subject_a_id, subject_b_id: row.subject_b_id, value: null, comparison: row.comparison, created_at: row.created_at });
  }
  for (const row of events.results ?? []) {
    if (responseIds.has(row.response_id)) continue;
    if (row.kind === 'rating' && row.value != null) history.push({ stream_id: `event:${row.response_id}:rating:${row.event_key}:${row.id}`, kind: 'rating', attribute_id: row.attribute_id, subject_a_id: row.subject_a_id, subject_b_id: null, value: row.value, comparison: null, created_at: row.created_at });
    if (row.kind === 'comparison' && row.result && row.subject_b_id) history.push({ stream_id: `event:${row.response_id}:comparison:${row.event_key}:${row.id}`, kind: 'comparison', attribute_id: row.attribute_id, subject_a_id: row.subject_a_id, subject_b_id: row.subject_b_id, value: null, comparison: row.result, created_at: row.created_at });
  }
  return history.sort((left, right) => left.created_at - right.created_at || left.stream_id.localeCompare(right.stream_id));
};

const queryFullReplayPairBaseline = async (db: Database) => {
  const state = await db.statement('SELECT active_generation, chunk_count FROM attribute_replay_snapshot_state WHERE id = 1')
    .first<FullReplayPairSnapshotRow>();
  if (!state) throw new Error('attribute_replay_baseline_unavailable');
  const chunks = await db.statement('SELECT pairs_json FROM attribute_replay_snapshot_chunks WHERE generation = ? ORDER BY chunk_number')
    .bind(state.active_generation).all<FullReplayPairSnapshotChunkRow>();
  if ((chunks.results ?? []).length !== Number(state.chunk_count)) throw new Error('incomplete_attribute_replay_baseline');
  const pairs = new Map<string, StoredPairStatRow>();
  for (const chunk of chunks.results ?? []) {
    const rows = parseFullReplayJson(chunk.pairs_json);
    if (!Array.isArray(rows)) throw new Error('invalid_attribute_replay_baseline');
    for (const row of rows) {
      if (!Array.isArray(row) || row.length !== 4 || row.some((value, index) => index < 3 ? typeof value !== 'string' : typeof value !== 'number')) continue;
      const [subjectAId, subjectBId, attributeId, comparisonCount] = row as [string, string, string, number];
      pairs.set(pairStatKey(subjectAId, subjectBId, attributeId), { subject_a_id: subjectAId, subject_b_id: subjectBId, attribute_id: attributeId, comparison_count: comparisonCount });
    }
  }
  return pairs;
};

const writeFullReplayPairBaseline = async (db: Database, pairs: Array<{ subjectAId: string; subjectBId: string; attributeId: string; count: number }>, generation: number) => {
  const rows = pairs.map((pair) => [pair.subjectAId, pair.subjectBId, pair.attributeId, pair.count]);
  await db.batch([
    db.statement('DELETE FROM attribute_replay_snapshot_chunks WHERE generation = ?').bind(generation),
    db.statement('INSERT INTO attribute_replay_snapshot_chunks (generation, chunk_number, pairs_json) VALUES (?, 0, ?)').bind(generation, JSON.stringify(rows)),
    db.statement(`INSERT INTO attribute_replay_snapshot_state (id, active_generation, chunk_count, generated_at) VALUES (1, ?, 1, ?)
      ON CONFLICT(id) DO UPDATE SET active_generation = excluded.active_generation, chunk_count = excluded.chunk_count, generated_at = excluded.generated_at`).bind(generation, generation),
    db.statement('DELETE FROM attribute_replay_snapshot_chunks WHERE generation <> ?').bind(generation),
  ]);
};

/** Recalculate every active game+attribute from every raw vote, without scanning materialized score rows. */
export const replayAllAttributeScores = async (db: Database, timestamp = Date.now()): Promise<AttributeReplayResult> => {
  if (await hasActiveAttributeMergeRebuild(db)) throw new Error('attribute_merge_rebuild_active');
  const [{ subjectIds, attributes, subjects, candidates, stored, throughVersion }, history, storedPairs] = await Promise.all([
    queryFullReplayMaterializedStates(db), queryFullReplayHistory(db, timestamp), queryFullReplayPairBaseline(db),
  ]);
  const states = new Map<string, OnlineAttributeState>();
  const directRatings = new Map<string, { total: number; count: number }>();
  for (const row of history) {
    if (row.kind !== 'rating' || row.value == null || !subjectIds.has(row.subject_a_id) || !attributes.has(row.attribute_id)) continue;
    const key = mergeStateKey(row.subject_a_id, row.attribute_id);
    const direct = directRatings.get(key) ?? { total: 0, count: 0 };
    direct.total += Number(row.value); direct.count += 1;
    directRatings.set(key, direct);
  }
  for (const subjectId of subjectIds) for (const attributeId of attributes.keys()) {
    const direct = directRatings.get(mergeStateKey(subjectId, attributeId));
    states.set(mergeStateKey(subjectId, attributeId), stateFromBaseline({
      subject_id: subjectId, attribute_id: attributeId, direct_sum: direct?.total ?? 0, direct_count: direct?.count ?? 0,
    }));
  }
  const pairCounts = new Map<string, { subjectAId: string; subjectBId: string; attributeId: string; count: number }>();
  for (const row of history) {
    if (row.kind !== 'comparison' || !row.comparison || !row.subject_b_id || !subjectIds.has(row.subject_a_id) || !subjectIds.has(row.subject_b_id) || !attributes.has(row.attribute_id) || row.subject_a_id === row.subject_b_id) continue;
    const keyA = mergeStateKey(row.subject_a_id, row.attribute_id);
    const keyB = mergeStateKey(row.subject_b_id, row.attribute_id);
    const updated = applyComparison(states.get(keyA) ?? emptyAttributeState(), states.get(keyB) ?? emptyAttributeState(), row.comparison);
    states.set(keyA, updated.a.next); states.set(keyB, updated.b.next);
    const [subjectAId, subjectBId] = row.subject_a_id < row.subject_b_id ? [row.subject_a_id, row.subject_b_id] : [row.subject_b_id, row.subject_a_id];
    const key = pairStatKey(subjectAId, subjectBId, row.attribute_id);
    const pair = pairCounts.get(key);
    if (pair) pair.count += 1;
    else pairCounts.set(key, { subjectAId, subjectBId, attributeId: row.attribute_id, count: 1 });
  }
  const changedStates = [...states.entries()].map(([key, state]) => {
    const separator = key.indexOf('\u0000');
    return { subjectId: key.slice(0, separator), attributeId: key.slice(separator + 1), state };
  }).filter(({ subjectId, attributeId, state }) => !stateMatches(stored.get(mergeStateKey(subjectId, attributeId)), state));
  const changedPairs = [...pairCounts.values()].filter((pair) => Number(storedPairs.get(pairStatKey(pair.subjectAId, pair.subjectBId, pair.attributeId))?.comparison_count) !== pair.count);
  const stalePairs = [...storedPairs.values()].filter((pair) => !pairCounts.has(pairStatKey(pair.subject_a_id, pair.subject_b_id, pair.attribute_id)));
  const changed = changedStates.length > 0 || changedPairs.length > 0 || stalePairs.length > 0;
  let rebuildMode = false;
  try {
    if (changedStates.length) { await db.statement('INSERT OR IGNORE INTO attribute_catalog_rebuild_mode (id) VALUES (1)').run(); rebuildMode = true; }
    for (const statementBatch of chunk(chunk(changedStates, ATTRIBUTE_REBUILD_STATE_ROWS_PER_STATEMENT).map((rows) => rebuildStateStatement(db, rows, timestamp)), ATTRIBUTE_REBUILD_STATEMENTS_PER_BATCH)) await db.batch(statementBatch);
    const pairStatements = changedPairs.map((pair) => db.statement(`INSERT INTO attribute_pair_stats (subject_a_id, subject_b_id, attribute_id, comparison_count, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(subject_a_id, subject_b_id, attribute_id) DO UPDATE SET comparison_count = excluded.comparison_count, updated_at = excluded.updated_at`).bind(pair.subjectAId, pair.subjectBId, pair.attributeId, pair.count, timestamp));
    for (const statementBatch of chunk(pairStatements, ATTRIBUTE_REBUILD_STATEMENTS_PER_BATCH)) await db.batch(statementBatch);
    for (const statementBatch of chunk(stalePairs.map((pair) => db.statement('DELETE FROM attribute_pair_stats WHERE subject_a_id = ? AND subject_b_id = ? AND attribute_id = ?').bind(pair.subject_a_id, pair.subject_b_id, pair.attribute_id)), ATTRIBUTE_REBUILD_STATEMENTS_PER_BATCH)) await db.batch(statementBatch);
    if (changedPairs.length || stalePairs.length) await writeFullReplayPairBaseline(db, [...pairCounts.values()], timestamp);
  } finally {
    if (rebuildMode) await db.statement('DELETE FROM attribute_catalog_rebuild_mode WHERE id = 1').run();
  }
  const values: AttributeMatrixValue[] = [...states.entries()].map(([key, state]) => {
    const separator = key.indexOf('\u0000');
    const subjectId = key.slice(0, separator);
    const attributeId = key.slice(separator + 1);
    return {
      subjectId, attributeId,
      score: Number(state.score.toFixed(2)), ratingDeviation: Number(state.ratingDeviation.toFixed(3)),
      ...(state.directCount ? { directAverage: Number((state.directSum / state.directCount).toFixed(2)) } : {}),
      directCount: state.directCount, comparisonCount: state.comparisonCount,
      decisiveComparisonCount: state.decisiveComparisonCount, evidenceCount: state.evidenceCount,
      modelVersion: ATTRIBUTE_SCORE_MODEL_VERSION,
      replayState: {
        score: state.score, ratingDeviation: state.ratingDeviation, directSum: state.directSum,
        directCount: state.directCount, comparisonCount: state.comparisonCount,
        decisiveComparisonCount: state.decisiveComparisonCount, evidenceCount: state.evidenceCount,
        modelVersion: ATTRIBUTE_SCORE_MODEL_VERSION,
      },
    } as AttributeMatrixValue;
  });
  return {
    changed,
    catalogThroughVersion: throughVersion,
    catalogPayload: {
      attributes: [...attributes.values()].sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)),
      subjects: [...subjects.values()].sort((left, right) => left.displayName.localeCompare(right.displayName, 'zh-Hant') || left.id.localeCompare(right.id)),
      values, candidates: [...candidates.values()].sort((left, right) => left.sourceRowNumber - right.sourceRowNumber || left.id.localeCompare(right.id)),
      activities: [], scoreModelVersion: ATTRIBUTE_SCORE_MODEL_VERSION,
    },
  };
};

const releaseAttributeWriteLock = async (db: Database, lock: AttributeWriteLock): Promise<void> => {
  if (!lock.names.length) return;
  await db.statement(`
    DELETE FROM attribute_vote_lock
    WHERE lock_name IN (${lock.names.map(() => '?').join(',')}) AND token = ?
  `).bind(...lock.names, lock.token).run();
};

const releaseAttributeWriteLockStatement = (db: Database, lock: AttributeWriteLock): DatabaseStatement => db.statement(`
  DELETE FROM attribute_vote_lock
  WHERE lock_name IN (${lock.names.map(() => '?').join(',')}) AND token = ?
`).bind(...lock.names, lock.token);

const acquireAttributeWriteLock = async (db: Database, input: AttributeResponseInput): Promise<AttributeWriteLock> => {
  const token = createId('attribute-lock');
  const names = attributeWriteLockNames(input);
  const expiresAt = Math.max(Date.now(), input.timestamp) + ATTRIBUTE_RESPONSE_LOCK_TTL_MS;
  const results = await db.batch([
    db.statement(`
      DELETE FROM attribute_vote_lock
      WHERE lock_name IN (${names.map(() => '?').join(',')}) AND expires_at < ?
    `).bind(...names, Date.now()),
    ...names.map((name) => db.statement(`
      INSERT OR IGNORE INTO attribute_vote_lock (lock_name, token, expires_at)
      VALUES (?, ?, ?)
    `).bind(name, token, expiresAt)),
  ]);
  const acquired = names.filter((_, index) => batchChangeCount(results[index + 1]) === 1);
  if (acquired.length !== names.length) {
    await releaseAttributeWriteLock(db, { token, names: acquired });
    throw new Error('attribute_response_busy');
  }
  return { token, names };
};

const saveAttributeResponseLocked = async (
  db: Database,
  input: AttributeResponseInput,
  lock: AttributeWriteLock,
): Promise<SavedAttributeResponse> => {
  const { context, states: stateMap } = await responseContextAndStates(db, input);
  if (input.highPole === 'low' && context.scale_type !== 'bipolar') throw new Error('attribute_question_invalid');
  input = canonicalAttributeAnswer(input);
  let stateA = stateMap.get(input.subjectAId) ?? emptyAttributeState();
  let stateB = stateMap.get(input.subjectBId) ?? emptyAttributeState();
  const touchedSubjects = new Set<string>();

  if (input.ratingA != null) {
    stateA = applyDirectRating(stateA, input.ratingA).next;
    touchedSubjects.add(input.subjectAId);
  }
  if (input.ratingB != null) {
    stateB = applyDirectRating(stateB, input.ratingB).next;
    touchedSubjects.add(input.subjectBId);
  }

  const canonical = input.comparison == null ? undefined : canonicalizeComparison(input.subjectAId, input.subjectBId, input.comparison);
  if (input.comparison != null) {
    const updated = applyComparison(stateA, stateB, input.comparison);
    stateA = updated.a.next;
    stateB = updated.b.next;
    touchedSubjects.add(input.subjectAId);
    touchedSubjects.add(input.subjectBId);
  }

  const statements = [];
  const activities: AttributeActivity[] = [];
  const activityEndpoints = parseAttributeScale(context.scale_type, context.endpoints_json ? JSON.parse(context.endpoints_json) : undefined).endpoints;
  const attributePoles = activityEndpoints ? { low: activityEndpoints.low.label, high: activityEndpoints.high.label } : undefined;
  const addActivity = (kind: 'rating' | 'comparison', subjectAId: string, subjectBId: string | null, value: number | null, result: AttributeComparisonResult | null) => {
    const id = createId('attribute-vote');
    if (kind === 'rating') {
      const subject = subjectAId === context.subject_a_id
        ? toResponseActivitySubject(context.subject_a_id, context.subject_a_name, context.subject_a_slug, context.subject_a_game_slug)
        : toResponseActivitySubject(context.subject_b_id, context.subject_b_name, context.subject_b_slug, context.subject_b_game_slug);
      activities.push({ id, kind, actorName: context.actor_name, attributeId: input.attributeId, attributeName: context.attribute_name, attributePoles, subject, value: value ?? undefined, createdAt: input.timestamp });
    } else {
      const subjectA = subjectAId === context.subject_a_id
        ? toResponseActivitySubject(context.subject_a_id, context.subject_a_name, context.subject_a_slug, context.subject_a_game_slug)
        : toResponseActivitySubject(context.subject_b_id, context.subject_b_name, context.subject_b_slug, context.subject_b_game_slug);
      const subjectB = subjectBId === context.subject_b_id
        ? toResponseActivitySubject(context.subject_b_id, context.subject_b_name, context.subject_b_slug, context.subject_b_game_slug)
        : toResponseActivitySubject(context.subject_a_id, context.subject_a_name, context.subject_a_slug, context.subject_a_game_slug);
      activities.push({ id, kind, actorName: context.actor_name, attributeId: input.attributeId, attributeName: context.attribute_name, attributePoles, subjectA, subjectB, result: result ?? undefined, createdAt: input.timestamp });
    }
  };

  if (input.ratingA != null) addActivity('rating', input.subjectAId, null, input.ratingA, null);
  if (input.ratingB != null) addActivity('rating', input.subjectBId, null, input.ratingB, null);
  if (canonical) addActivity('comparison', canonical.subjectAId, canonical.subjectBId, null, canonical.result);

  const addStateUpsert = (subjectId: string, state: OnlineAttributeState) => {
    statements.push(db.statement(`
      INSERT INTO attribute_score_states
        (subject_id, attribute_id, score, rating_deviation, direct_sum, direct_count,
         comparison_count, decisive_comparison_count, evidence_count, model_version, updated_at, random_key, question_slot)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, lower(hex(randomblob(16))), ?)
      ON CONFLICT(subject_id, attribute_id) DO UPDATE SET
        score = excluded.score,
        rating_deviation = excluded.rating_deviation,
        direct_sum = excluded.direct_sum,
        direct_count = excluded.direct_count,
        comparison_count = excluded.comparison_count,
        decisive_comparison_count = excluded.decisive_comparison_count,
        evidence_count = excluded.evidence_count,
        model_version = excluded.model_version,
        updated_at = excluded.updated_at
    `).bind(subjectId, input.attributeId, state.score, state.ratingDeviation, state.directSum, state.directCount, state.comparisonCount, state.decisiveComparisonCount, state.evidenceCount, ATTRIBUTE_SCORE_MODEL_VERSION, input.timestamp, randomQuestionSlot()));
  };
  if (touchedSubjects.has(input.subjectAId)) addStateUpsert(input.subjectAId, stateA);
  if (touchedSubjects.has(input.subjectBId)) addStateUpsert(input.subjectBId, stateB);

  statements.push(db.statement(`
    INSERT INTO attribute_vote_responses
      (response_id, attribute_id, subject_a_id, subject_b_id, rating_a, rating_b,
       comparison, activity_json, actor_id, session_id, created_at, updated_at, question_high_pole)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    input.responseId,
    input.attributeId,
    input.subjectAId,
    input.subjectBId,
    input.ratingA ?? null,
    input.ratingB ?? null,
    input.comparison ?? null,
    JSON.stringify(activities),
    input.actorId,
    input.sessionId,
    input.timestamp,
    input.timestamp,
    input.highPole ?? 'high',
  ));
  statements.push(releaseAttributeWriteLockStatement(db, lock));
  await db.batch(statements);

  const updatedValues: AttributeMatrixValue[] = [];
  if (touchedSubjects.has(input.subjectAId)) updatedValues.push(stateToMatrixValue(input.subjectAId, input.attributeId, stateA));
  if (touchedSubjects.has(input.subjectBId)) updatedValues.push(stateToMatrixValue(input.subjectBId, input.attributeId, stateB));
  return { updatedValues, activities };
};

export const saveAttributeResponse = async (db: Database, input: AttributeResponseInput): Promise<SavedAttributeResponse> => {
  if (input.subjectAId === input.subjectBId) throw new Error('attribute_subjects_must_differ');
  if (input.comparison == null && input.ratingA == null && input.ratingB == null) throw new Error('attribute_response_empty');
  if (await hasActiveAttributeMergeRebuild(db)) throw new Error('attribute_response_busy');

  const lock = await acquireAttributeWriteLock(db, input);
  let lockReleasedInCommit = false;
  try {
    const lockedExistingResponse = await db.statement('SELECT response_id FROM attribute_vote_responses WHERE response_id = ? LIMIT 1')
      .bind(input.responseId)
      .first<{ response_id: string }>();
    if (lockedExistingResponse) return { updatedValues: [], activities: [] };
    const result = await saveAttributeResponseLocked(db, input, lock);
    lockReleasedInCommit = true;
    return result;
  } finally {
    if (!lockReleasedInCommit) await releaseAttributeWriteLock(db, lock);
  }
};



