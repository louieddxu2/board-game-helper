import type {
  AttributeActivity,
  AttributeComparisonResult,
  AttributeDefinition,
  AttributeExtremeExamples,
  AttributeImportCandidate,
  AttributeMatrixValue,
  AttributeQuestion,
  AttributeQuestionPayload,
  AttributeSubject,
  AttributeSubjectComponent,
  AttributeScoreExample,
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
export const ATTRIBUTE_EXTREME_EXAMPLE_LIMIT = 2;
export const ATTRIBUTE_QUESTION_OPPONENT_CANDIDATE_LIMIT = 4;
export const ATTRIBUTE_QUESTION_PAIR_STAT_LIMIT = 4;
// The voting screen renders five recent records.  Keep the query aligned with
// that UI limit so an opening question does not read seven unused snapshots.
export const ATTRIBUTE_ACTIVITY_FEED_LIMIT = 5;
export const ATTRIBUTE_TABLE_PAGE_SIZE = 50;
/** Local-D1 budget ceiling for a full answer with two ratings and a comparison. */
export const ATTRIBUTE_RESPONSE_MAX_READ_ROWS = 40;
export const ATTRIBUTE_RESPONSE_MAX_WRITE_ROWS = 30;
export const ATTRIBUTE_QUESTION_MAX_RETURNED_ROWS = 21;
export const ATTRIBUTE_RESPONSE_LOCK_PREFIX = 'attribute-vote';
export const ATTRIBUTE_RESPONSE_LOCK_TTL_MS = 15_000;
export const ATTRIBUTE_MERGE_REBUILD_BATCH_SIZE = 20;
export const ATTRIBUTE_MERGE_REBUILD_MAX_BATCHES_PER_RUN = 8;
export const ATTRIBUTE_MERGE_JOB_LOCK_TTL_MS = 60_000;
/** Local-D1 ceiling below the product limit; final 100-question sample maxed at 99. */
export const ATTRIBUTE_QUESTION_MAX_ROWS_READ = 99;

interface AttributeRow {
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
 * Configuration English names are derived from only that subject's
 * components.  Unlike attribute_subject_secondary_names, these correlated
 * lookups do not aggregate every subject in the database for each question.
 */
const subjectSecondaryNameExpression = (subjectAlias: string, gameAlias: string) => {
  const baseName = `(SELECT COALESCE(base_game.english_name, base_component.english_name)
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
    ELSE ${gameAlias}.english_name END)`;
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

interface AttributeExtremeExampleRow {
  subject_id: string;
  subject_slug: string;
  subject_kind: AttributeSubject['kind'];
  display_name: string;
  game_id: string | null;
  game_slug: string | null;
  secondary_name: string | null;
  score: number;
  direction: 'lowest' | 'highest';
}

interface ResponseContextRow {
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
  includeExtremeExamples?: boolean;
}

export interface AttributeResponseInput {
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
    SELECT a.id, a.key, t.name, t.short_description, t.full_description,
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
      SELECT a.id, a.key, t.name, t.short_description, t.full_description,
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
      SELECT a.id, a.key, t.name, t.short_description, t.full_description,
        a.min_value, a.max_value, a.sort_order
      FROM attributes a
      JOIN attribute_translations t ON t.attribute_id = a.id AND t.locale = 'zh-TW'
      WHERE a.is_active = 1 AND a.random_key >= ?
      ORDER BY a.random_key, a.id
      LIMIT 1
    `).bind(pivot).first<AttributeRow>(),
    db.statement(`
      SELECT a.id, a.key, t.name, t.short_description, t.full_description,
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

const queryAttributeExtremeExamples = async (
  db: Database,
  attributeId: string,
): Promise<AttributeExtremeExamples> => {
  const querySlice = async (direction: 'lowest' | 'highest') => {
    const scoreFilter = direction === 'lowest'
      ? 's.score >= 0 AND s.score <= 2'
      : 's.score >= 8 AND s.score <= 10';
    const order = direction === 'lowest' ? 'ASC' : 'DESC';
    const result = await db.statement(`
      SELECT s.subject_id, s.score, candidate_subject.slug AS subject_slug,
        candidate_subject.kind AS subject_kind, candidate_subject.display_name,
        candidate_subject.game_id, candidate_game.slug AS game_slug,
        ${subjectSecondaryNameExpression('candidate_subject', 'candidate_game')} AS secondary_name
      FROM attribute_score_states s
      JOIN attribute_subjects candidate_subject ON candidate_subject.id = s.subject_id
      LEFT JOIN games candidate_game ON candidate_game.id = candidate_subject.game_id
      WHERE s.attribute_id = ?
        AND s.evidence_count > 0
        AND ${scoreFilter}
        AND ${votableSubjectCondition('candidate_subject', 'candidate_game')}
      ORDER BY s.score ${order}, s.random_key ${order}, s.subject_id ${order}
      LIMIT ${ATTRIBUTE_EXTREME_EXAMPLE_LIMIT}
    `).bind(attributeId).all<Omit<AttributeExtremeExampleRow, 'direction'>>();
    // The score-first example indexes keep the scan inside the requested
    // extreme band while the stable random key preserves variety between
    // games without a random-key wraparound query.
    return (result.results ?? [])
      .map((row) => ({ ...row, direction } satisfies AttributeExtremeExampleRow));
  };

  const [lowest, highest] = await Promise.all([querySlice('lowest'), querySlice('highest')]);
  const rows = [...lowest, ...highest];

  const extremeExamples: AttributeExtremeExamples = { lowest: [], highest: [] };
  rows.forEach((row) => {
    const example: AttributeScoreExample = {
      score: Number(Number(row.score).toFixed(2)),
      subject: {
        id: row.subject_id,
        slug: row.subject_slug,
        kind: row.subject_kind,
        displayName: row.display_name,
        ...(row.secondary_name ? { secondaryName: row.secondary_name } : {}),
        ...(row.game_id ? { gameId: row.game_id } : {}),
        ...(row.game_slug ? { gameSlug: row.game_slug } : {}),
      },
    };
    extremeExamples[row.direction].push(example);
  });
  return extremeExamples;
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
  const filter = subjectIds?.length ? `WHERE subject_id IN (${subjectIds.map(() => '?').join(',')})` : '';
  const result = await db.statement(`
    SELECT subject_id, attribute_id, score, rating_deviation, direct_sum, direct_count,
      comparison_count, decisive_comparison_count, evidence_count
    FROM attribute_score_states
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
  return (result.results ?? []).map(toMatrixValue);
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
  const extremeExamples = options.includeExtremeExamples !== false && question
    ? await queryAttributeExtremeExamples(db, question.attribute.id)
    : { lowest: [], highest: [] } satisfies AttributeExtremeExamples;
  return { question, activities, extremeExamples, scoreModelVersion: ATTRIBUTE_SCORE_MODEL_VERSION };
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
    SELECT a.id AS attribute_id, t.name AS attribute_name,
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

const initializeAttributeMergeRebuild = async (
  db: Database,
  job: AttributeMergeRebuildJobRow,
  timestamp: number,
) => {
  await db.batch([
    db.statement('DELETE FROM attribute_pair_stats'),
    db.statement('DELETE FROM attribute_score_states'),
    db.statement(`
      INSERT OR IGNORE INTO attribute_score_states
        (subject_id, attribute_id, score, direct_sum, direct_count, comparison_count,
         decisive_comparison_count, evidence_count, model_version, updated_at,
         rating_deviation, random_key, question_slot)
      SELECT s.id, a.id, 5, 0, 0, 0, 0, 0, ?, ?, 3,
        lower(hex(randomblob(16))), (abs(random()) % ${ATTRIBUTE_QUESTION_SLOT_COUNT}) + 1
      FROM attribute_subjects s
      CROSS JOIN attributes a
      LEFT JOIN games g ON g.id = s.game_id
      WHERE a.is_active = 1
        AND ${votableSubjectCondition('s', 'g')}
    `).bind(ATTRIBUTE_SCORE_MODEL_VERSION, timestamp),
    db.statement(`
      UPDATE attribute_merge_rebuild_jobs
      SET status = 'running', reset_completed = 1, updated_at = ?
      WHERE id = ? AND status = 'pending'
    `).bind(timestamp, job.id),
  ]);
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
        CASE WHEN e.kind = 'rating' THEN e.value ELSE NULL END AS rating_a,
        NULL AS rating_b,
        CASE WHEN e.kind = 'comparison' THEN e.result ELSE NULL END AS comparison,
        e.created_at
      FROM attribute_vote_events e
      WHERE e.created_at <= ?
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
      job.cutoff_created_at,
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
        r.rating_a,
        r.rating_b,
        r.comparison,
        r.created_at
      FROM attribute_vote_responses r
      WHERE r.attribute_id IS NOT NULL AND r.created_at <= ?
        AND (r.created_at > ? OR (r.created_at = ? AND
          ('response:' || r.response_id) > ?))
      ORDER BY r.created_at, stream_id
      LIMIT ${ATTRIBUTE_MERGE_REBUILD_BATCH_SIZE}
    `).bind(
      job.cutoff_created_at,
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

const stateFromAttributeRow = (row: AttributeScoreStateRow): OnlineAttributeState => ({
  score: Number(row.score),
  ratingDeviation: Number(row.rating_deviation ?? ATTRIBUTE_INITIAL_RD),
  directSum: Number(row.direct_sum),
  directCount: Number(row.direct_count),
  comparisonCount: Number(row.comparison_count),
  decisiveComparisonCount: Number(row.decisive_comparison_count),
  evidenceCount: Number(row.evidence_count),
});

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

const processAttributeMergeRebuildBatch = async (db: Database, timestamp: number): Promise<boolean> => {
  const job = await db.statement(`
    SELECT id, source_game_id, target_game_id, source_subject_id, target_subject_id,
      status, reset_completed, cursor_created_at, cursor_stream_id,
      cutoff_created_at, error_message, created_at, updated_at
    FROM attribute_merge_rebuild_jobs
    WHERE status IN ('pending', 'running')
    ORDER BY created_at, id
    LIMIT 1
  `).first<AttributeMergeRebuildJobRow>();
  if (!job) return false;
  const lock = await attributeMergeJobLock(db, job.id);
  if (!lock) return false;
  try {
    if (!job.reset_completed) await initializeAttributeMergeRebuild(db, job, timestamp);
    const rows = await queryAttributeMergeHistoryBatch(db, job);
    if (!rows.length) {
      await db.statement(`
        UPDATE attribute_merge_rebuild_jobs
        SET status = 'completed', updated_at = ?
        WHERE id = ? AND status = 'running'
      `).bind(timestamp, job.id).run();
      return true;
    }

    const mappedRows = rows.map((row) => ({
      ...row,
      subject_a_id: row.subject_a_id === job.source_subject_id ? job.target_subject_id : row.subject_a_id,
      subject_b_id: row.subject_b_id === job.source_subject_id ? job.target_subject_id : row.subject_b_id,
    }));
    const stateKeys = [...new Set(mappedRows.flatMap((row) => [
      row.subject_a_id && mergeStateKey(row.subject_a_id, row.attribute_id),
      row.subject_b_id && mergeStateKey(row.subject_b_id, row.attribute_id),
    ].filter((key): key is string => Boolean(key))))];
    const stateResult = stateKeys.length
      ? await db.statement(`
          SELECT subject_id, attribute_id, score, rating_deviation, direct_sum, direct_count,
            comparison_count, decisive_comparison_count, evidence_count
          FROM attribute_score_states
          WHERE ${stateKeys.map(() => '(subject_id = ? AND attribute_id = ?)').join(' OR ')}
        `).bind(...stateKeys.flatMap((key) => {
          const separator = key.indexOf('\u0000');
          return [key.slice(0, separator), key.slice(separator + 1)];
        })).all<AttributeScoreStateRow>()
      : { results: [] };
    const states = new Map((stateResult.results ?? []).map((row) => [mergeStateKey(row.subject_id, row.attribute_id), stateFromAttributeRow(row)]));
    const touched = new Set<string>();
    const pairCounts = new Map<string, { subjectAId: string; subjectBId: string; attributeId: string; count: number }>();
    const getState = (subjectId: string, attributeId: string) => {
      const key = mergeStateKey(subjectId, attributeId);
      const state = states.get(key) ?? emptyAttributeState();
      states.set(key, state);
      return { key, state };
    };
    mappedRows.forEach((row) => {
      if (row.subject_a_id && row.rating_a != null) {
        const a = getState(row.subject_a_id, row.attribute_id);
        states.set(a.key, applyDirectRating(a.state, Number(row.rating_a)).next);
        touched.add(a.key);
      }
      if (row.subject_b_id && row.rating_b != null) {
        const b = getState(row.subject_b_id, row.attribute_id);
        states.set(b.key, applyDirectRating(b.state, Number(row.rating_b)).next);
        touched.add(b.key);
      }
      if (row.subject_a_id && row.subject_b_id && row.subject_a_id !== row.subject_b_id && row.comparison) {
        const a = getState(row.subject_a_id, row.attribute_id);
        const b = getState(row.subject_b_id, row.attribute_id);
        const updated = applyComparison(a.state, b.state, row.comparison);
        states.set(a.key, updated.a.next);
        states.set(b.key, updated.b.next);
        touched.add(a.key);
        touched.add(b.key);
        const [subjectAId, subjectBId] = row.subject_a_id < row.subject_b_id
          ? [row.subject_a_id, row.subject_b_id]
          : [row.subject_b_id, row.subject_a_id];
        const key = `${subjectAId}\u0000${subjectBId}\u0000${row.attribute_id}`;
        const existing = pairCounts.get(key);
        if (existing) existing.count += 1;
        else pairCounts.set(key, { subjectAId, subjectBId, attributeId: row.attribute_id, count: 1 });
      }
    });

    const statements: DatabaseStatement[] = [];
    touched.forEach((key) => {
      const separator = key.indexOf('\u0000');
      const subjectId = key.slice(0, separator);
      const attributeId = key.slice(separator + 1);
      const state = states.get(key)!;
      statements.push(db.statement(`
        INSERT INTO attribute_score_states
          (subject_id, attribute_id, score, rating_deviation, direct_sum, direct_count,
           comparison_count, decisive_comparison_count, evidence_count, model_version,
           updated_at, random_key, question_slot)
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
      `).bind(subjectId, attributeId, state.score, state.ratingDeviation, state.directSum, state.directCount, state.comparisonCount, state.decisiveComparisonCount, state.evidenceCount, ATTRIBUTE_SCORE_MODEL_VERSION, timestamp, randomQuestionSlot()));
    });
    pairCounts.forEach((pair) => statements.push(db.statement(`
      INSERT INTO attribute_pair_stats
        (subject_a_id, subject_b_id, attribute_id, comparison_count, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(subject_a_id, subject_b_id, attribute_id) DO UPDATE SET
        comparison_count = attribute_pair_stats.comparison_count + excluded.comparison_count,
        updated_at = excluded.updated_at
    `).bind(pair.subjectAId, pair.subjectBId, pair.attributeId, pair.count, timestamp)));
    const last = rows.at(-1)!;
    statements.push(db.statement(`
      UPDATE attribute_merge_rebuild_jobs
      SET cursor_created_at = ?, cursor_stream_id = ?, status = ?, updated_at = ?
      WHERE id = ? AND status = 'running'
    `).bind(last.created_at, last.stream_id, rows.length < ATTRIBUTE_MERGE_REBUILD_BATCH_SIZE ? 'completed' : 'running', timestamp, job.id));
    await db.batch(statements);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'attribute_merge_rebuild_failed';
    await db.statement(`
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
  maxBatches = ATTRIBUTE_MERGE_REBUILD_MAX_BATCHES_PER_RUN,
): Promise<void> => {
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const processed = await processAttributeMergeRebuildBatch(db, timestamp);
    if (!processed) break;
  }
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
  const addActivity = (kind: 'rating' | 'comparison', subjectAId: string, subjectBId: string | null, value: number | null, result: AttributeComparisonResult | null) => {
    const id = createId('attribute-vote');
    if (kind === 'rating') {
      const subject = subjectAId === context.subject_a_id
        ? toResponseActivitySubject(context.subject_a_id, context.subject_a_name, context.subject_a_slug, context.subject_a_game_slug)
        : toResponseActivitySubject(context.subject_b_id, context.subject_b_name, context.subject_b_slug, context.subject_b_game_slug);
      activities.push({ id, kind, actorName: context.actor_name, attributeId: input.attributeId, attributeName: context.attribute_name, subject, value: value ?? undefined, createdAt: input.timestamp });
    } else {
      const subjectA = subjectAId === context.subject_a_id
        ? toResponseActivitySubject(context.subject_a_id, context.subject_a_name, context.subject_a_slug, context.subject_a_game_slug)
        : toResponseActivitySubject(context.subject_b_id, context.subject_b_name, context.subject_b_slug, context.subject_b_game_slug);
      const subjectB = subjectBId === context.subject_b_id
        ? toResponseActivitySubject(context.subject_b_id, context.subject_b_name, context.subject_b_slug, context.subject_b_game_slug)
        : toResponseActivitySubject(context.subject_a_id, context.subject_a_name, context.subject_a_slug, context.subject_a_game_slug);
      activities.push({ id, kind, actorName: context.actor_name, attributeId: input.attributeId, attributeName: context.attribute_name, subjectA, subjectB, result: result ?? undefined, createdAt: input.timestamp });
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
       comparison, activity_json, actor_id, session_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
