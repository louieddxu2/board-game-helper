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
import type { Database } from './database';
import {
  ATTRIBUTE_INITIAL_RD,
  ATTRIBUTE_SCORE_MODEL_VERSION,
  applyComparison,
  applyDirectRating,
  emptyAttributeState,
  type OnlineAttributeState,
} from './attributeScoring';

/** Number of random slots used to sample low-confidence game+attribute items. */
export const ATTRIBUTE_QUESTION_SLOT_COUNT = 200;
export const ATTRIBUTE_QUESTION_SEED_SLOT_RETRY_LIMIT = 4;
export const ATTRIBUTE_EXTREME_EXAMPLE_LIMIT = 3;
export const ATTRIBUTE_ACTIVITY_FEED_LIMIT = 12;
export const ATTRIBUTE_TABLE_PAGE_SIZE = 50;
/** Measured local-D1 maximum for a full answer with two ratings and a comparison. */
export const ATTRIBUTE_RESPONSE_MAX_READ_ROWS = 29;
/** Measured local-D1 maximum, including indexes, triggers, locks, and catalog deltas. */
export const ATTRIBUTE_RESPONSE_MAX_WRITE_ROWS = 25;
export const ATTRIBUTE_QUESTION_MAX_RETURNED_ROWS = 24;
export const ATTRIBUTE_RESPONSE_LOCK_PREFIX = 'attribute-vote';
export const ATTRIBUTE_RESPONSE_LOCK_TTL_MS = 15_000;
/** Includes up to two excluded subject rows skipped by the random opponent lookup. */
export const ATTRIBUTE_QUESTION_MAX_ROWS_READ = 26;

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
  game_english_name: string | null;
}

interface ComponentRow {
  subject_id: string;
  component_order: number;
  game_id: string | null;
  component_type: AttributeSubjectComponent['type'];
  label: string;
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
  rating_deviation: number;
  random_key: string;
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

interface AttributeExtremeExampleRow {
  subject_id: string;
  subject_slug: string;
  subject_kind: AttributeSubject['kind'];
  display_name: string;
  game_id: string | null;
  game_slug: string | null;
  game_english_name: string | null;
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

const toSubject = (row: SubjectRow, components: Map<string, AttributeSubjectComponent[]>): AttributeSubject => ({
  id: row.id,
  slug: row.slug,
  kind: row.kind,
  displayName: row.display_name,
  ...(row.game_english_name ? { secondaryName: row.game_english_name } : {}),
  gameId: row.game_id ?? undefined,
  gameSlug: row.game_slug ?? undefined,
  components: components.get(row.id) ?? [],
});

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
      g.english_name AS game_english_name
    FROM attribute_subjects s
    LEFT JOIN games g ON g.id = s.game_id
    WHERE (
      s.kind = 'configuration'
      OR (g.merged_into_game_id IS NULL AND g.visibility = 'public' AND g.published_rule_count > 0)
    )
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
  const result = await db.statement(`
    WITH eligible AS (
      SELECT s.subject_id, s.score, candidate_subject.slug AS subject_slug,
        candidate_subject.kind AS subject_kind, candidate_subject.display_name,
        candidate_subject.game_id, candidate_game.slug AS game_slug,
        candidate_game.english_name AS game_english_name
      FROM attribute_score_states s
      JOIN attribute_subjects candidate_subject ON candidate_subject.id = s.subject_id
      LEFT JOIN games candidate_game ON candidate_game.id = candidate_subject.game_id
      WHERE s.attribute_id = ?
        AND s.evidence_count > 0
        AND (
          candidate_subject.kind = 'configuration'
          OR (candidate_game.merged_into_game_id IS NULL
            AND candidate_game.visibility = 'public'
            AND candidate_game.published_rule_count > 0)
        )
    ),
    lowest AS (
      SELECT * FROM eligible
      ORDER BY score ASC, subject_id
      LIMIT ?
    ),
    highest AS (
      SELECT * FROM eligible
      WHERE subject_id NOT IN (SELECT subject_id FROM lowest)
      ORDER BY score DESC, subject_id
      LIMIT ?
    )
    SELECT subject_id, subject_slug, subject_kind, display_name, game_id, game_slug, game_english_name, score, 'lowest' AS direction
    FROM lowest
    UNION ALL
    SELECT subject_id, subject_slug, subject_kind, display_name, game_id, game_slug, game_english_name, score, 'highest' AS direction
    FROM highest
  `).bind(attributeId, ATTRIBUTE_EXTREME_EXAMPLE_LIMIT, ATTRIBUTE_EXTREME_EXAMPLE_LIMIT).all<AttributeExtremeExampleRow>();

  const extremeExamples: AttributeExtremeExamples = { lowest: [], highest: [] };
  (result.results ?? []).forEach((row) => {
    const example: AttributeScoreExample = {
      score: Number(Number(row.score).toFixed(2)),
      subject: {
        id: row.subject_id,
        slug: row.subject_slug,
        kind: row.subject_kind,
        displayName: row.display_name,
        ...(row.game_english_name ? { secondaryName: row.game_english_name } : {}),
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
    SELECT subject_id, component_order, game_id, component_type, label
    FROM attribute_subject_components
    WHERE subject_id IN (${subjectIds.map(() => '?').join(',')})
    ORDER BY subject_id, component_order
  `).bind(...subjectIds).all<ComponentRow>();
  const map = new Map<string, AttributeSubjectComponent[]>();
  (result.results ?? []).forEach((row) => {
    const components = map.get(row.subject_id) ?? [];
    components.push({ order: row.component_order, gameId: row.game_id ?? undefined, type: row.component_type, label: row.label });
    map.set(row.subject_id, components);
  });
  return map;
};

const queryAllComponents = async (db: Database): Promise<Map<string, AttributeSubjectComponent[]>> => {
  const result = await db.statement(`
    SELECT subject_id, component_order, game_id, component_type, label
    FROM attribute_subject_components
    ORDER BY subject_id, component_order
  `).all<ComponentRow>();
  const map = new Map<string, AttributeSubjectComponent[]>();
  (result.results ?? []).forEach((row) => {
    const components = map.get(row.subject_id) ?? [];
    components.push({ order: row.component_order, gameId: row.game_id ?? undefined, type: row.component_type, label: row.label });
    map.set(row.subject_id, components);
  });
  return map;
};

export const queryAttributeSubjects = async (db: Database, subjectIds?: string[], page?: SubjectPageOptions): Promise<AttributeSubject[]> => {
  const rows = await querySubjectRows(db, subjectIds, page);
  const components = await queryComponents(db, rows.map((row) => row.id));
  return rows.map((row) => toSubject(row, components));
};

const queryQuestionSubjects = async (db: Database, subjectIds: string[]): Promise<AttributeSubject[]> => {
  if (!subjectIds.length) return [];
  const rows = await querySubjectRows(db, subjectIds);
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
    SELECT subject_id, attribute_id, score, rating_deviation, direct_sum, direct_count,
      comparison_count, decisive_comparison_count, evidence_count
    FROM attribute_score_states
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

export const parseAttributeActivityFeedEntry = (raw: string): AttributeActivity[] => {
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
  return (result.results ?? []).flatMap((row) => parseAttributeActivityFeedEntry(row.payload_json)).slice(0, ATTRIBUTE_ACTIVITY_FEED_LIMIT);
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
        s.rating_deviation, s.random_key
      FROM attribute_score_states s
      JOIN attribute_subjects candidate_subject ON candidate_subject.id = s.subject_id
      LEFT JOIN games candidate_game ON candidate_game.id = candidate_subject.game_id
      WHERE s.question_slot = ?
        ${attributeFilter}
        ${exclusion}
        AND (
          candidate_subject.kind = 'configuration'
          OR (candidate_game.merged_into_game_id IS NULL
            AND candidate_game.visibility = 'public'
            AND candidate_game.published_rule_count > 0)
        )
      ORDER BY s.rating_deviation DESC, s.random_key, s.attribute_id, s.subject_id
      LIMIT 1
    `).bind(randomQuestionSlot(), ...(attributeId ? [attributeId] : []), ...excludeSubjectIds).first<SeedCandidateRow>();
    if (row) return row;
  }
  return null;
};

const queryRandomSubjectForAttribute = async (
  db: Database,
  attributeId: string,
  fixedSubjectId: string,
  options: AttributeQuestionOptions,
  fixedGameId: string | null = null,
): Promise<string | null> => {
  const excludeSubjectIds = [fixedSubjectId];
  if (options.excludeAttributeId === attributeId) {
    if (options.excludeSubjectAId === fixedSubjectId && options.excludeSubjectBId) excludeSubjectIds.push(options.excludeSubjectBId);
    if (options.excludeSubjectBId === fixedSubjectId && options.excludeSubjectAId) excludeSubjectIds.push(options.excludeSubjectAId);
  }
  const exclusion = excludedSubjectFilter([...new Set(excludeSubjectIds)]);
  const gameExclusion = fixedGameId ? 'AND (candidate_subject.game_id IS NULL OR candidate_subject.game_id <> ?)' : '';
  const pivot = randomKey();
  const [after, before] = await Promise.all([
    db.statement(`
      SELECT s.subject_id
      FROM attribute_score_states s
      JOIN attribute_subjects candidate_subject ON candidate_subject.id = s.subject_id
      LEFT JOIN games candidate_game ON candidate_game.id = candidate_subject.game_id
      WHERE s.attribute_id = ? AND s.random_key >= ?
        ${gameExclusion}
        ${exclusion}
        AND (
          candidate_subject.kind = 'configuration'
          OR (candidate_game.merged_into_game_id IS NULL
            AND candidate_game.visibility = 'public'
            AND candidate_game.published_rule_count > 0)
        )
      ORDER BY s.random_key, s.subject_id
      LIMIT 1
    `).bind(attributeId, pivot, ...(fixedGameId ? [fixedGameId] : []), ...[...new Set(excludeSubjectIds)]).first<{ subject_id: string }>(),
    db.statement(`
      SELECT s.subject_id
      FROM attribute_score_states s
      JOIN attribute_subjects candidate_subject ON candidate_subject.id = s.subject_id
      LEFT JOIN games candidate_game ON candidate_game.id = candidate_subject.game_id
      WHERE s.attribute_id = ? AND s.random_key < ?
        ${gameExclusion}
        ${exclusion}
        AND (
          candidate_subject.kind = 'configuration'
          OR (candidate_game.merged_into_game_id IS NULL
            AND candidate_game.visibility = 'public'
            AND candidate_game.published_rule_count > 0)
        )
      ORDER BY s.random_key DESC, s.subject_id DESC
      LIMIT 1
    `).bind(attributeId, pivot, ...(fixedGameId ? [fixedGameId] : []), ...[...new Set(excludeSubjectIds)]).first<{ subject_id: string }>(),
  ]);
  return after?.subject_id ?? before?.subject_id ?? null;
};

const querySubjectGameId = async (db: Database, subjectId: string): Promise<string | null> => {
  const row = await db.statement('SELECT game_id FROM attribute_subjects WHERE id = ? LIMIT 1')
    .bind(subjectId)
    .first<{ game_id: string | null }>();
  return row?.game_id ?? null;
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
  let subjectAGameId: string | null = null;
  if (!subjectAId && !subjectBId) {
    const seed = await querySeedCandidate(db, attribute.id);
    subjectAId = seed?.subject_id;
    subjectAGameId = seed?.game_id ?? null;
  }
  if (subjectAId && !subjectBId) {
    if (options.fixedSubjectAId) subjectAGameId = await querySubjectGameId(db, subjectAId);
    subjectBId = (await queryRandomSubjectForAttribute(db, attribute.id, subjectAId, options, subjectAGameId)) ?? undefined;
  }
  if (!subjectAId && subjectBId) {
    const fixedGameId = await querySubjectGameId(db, subjectBId);
    subjectAId = (await queryRandomSubjectForAttribute(db, attribute.id, subjectBId, options, fixedGameId)) ?? undefined;
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
    const subjectBId = await queryRandomSubjectForAttribute(db, seed.attribute_id, seed.subject_id, options, seed.game_id);
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
  const extremeExamples = question
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

const responseContext = async (db: Database, input: AttributeResponseInput) => {
  const row = await db.statement(`
    SELECT a.id AS attribute_id, t.name AS attribute_name,
      sa.id AS subject_a_id, sa.display_name AS subject_a_name, sa.slug AS subject_a_slug, ga.slug AS subject_a_game_slug,
      sb.id AS subject_b_id, sb.display_name AS subject_b_name, sb.slug AS subject_b_slug, gb.slug AS subject_b_game_slug,
      CASE WHEN u.show_nickname = 1 AND u.nickname IS NOT NULL THEN u.nickname ELSE '匿名玩家' END AS actor_name
    FROM attributes a
    JOIN attribute_translations t ON t.attribute_id = a.id AND t.locale = 'zh-TW'
    JOIN attribute_subjects sa ON sa.id = ?
    JOIN attribute_subjects sb ON sb.id = ?
    LEFT JOIN games ga ON ga.id = sa.game_id
    LEFT JOIN games gb ON gb.id = sb.game_id
    LEFT JOIN users u ON u.id = ?
    WHERE a.id = ? AND a.is_active = 1
      AND (sa.kind = 'configuration' OR (ga.merged_into_game_id IS NULL AND ga.visibility = 'public' AND ga.published_rule_count > 0))
      AND (sb.kind = 'configuration' OR (gb.merged_into_game_id IS NULL AND gb.visibility = 'public' AND gb.published_rule_count > 0))
      AND (sa.game_id IS NULL OR sb.game_id IS NULL OR sa.game_id <> sb.game_id)
  `).bind(input.subjectAId, input.subjectBId, input.actorId, input.attributeId).first<ResponseContextRow>();
  if (!row) throw new Error('attribute_subject_not_found');
  return row;
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

const releaseAttributeWriteLock = async (db: Database, lock: AttributeWriteLock): Promise<void> => {
  if (!lock.names.length) return;
  await db.statement(`
    DELETE FROM attribute_vote_lock
    WHERE lock_name IN (${lock.names.map(() => '?').join(',')}) AND token = ?
  `).bind(...lock.names, lock.token).run();
};

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

const saveAttributeResponseLocked = async (db: Database, input: AttributeResponseInput): Promise<SavedAttributeResponse> => {
  const context = await responseContext(db, input);
  const stateResult = await db.statement(`
    SELECT subject_id, attribute_id, score, rating_deviation, direct_sum, direct_count,
      comparison_count, decisive_comparison_count, evidence_count
    FROM attribute_score_states
    WHERE (subject_id = ? AND attribute_id = ?)
       OR (subject_id = ? AND attribute_id = ?)
  `).bind(input.subjectAId, input.attributeId, input.subjectBId, input.attributeId).all<AttributeScoreStateRow>();
  const stateMap = new Map((stateResult.results ?? []).map((row) => [row.subject_id, {
    score: Number(row.score),
    ratingDeviation: Number(row.rating_deviation ?? ATTRIBUTE_INITIAL_RD),
    directSum: Number(row.direct_sum),
    directCount: Number(row.direct_count),
    comparisonCount: Number(row.comparison_count),
    decisiveComparisonCount: Number(row.decisive_comparison_count),
    evidenceCount: Number(row.evidence_count),
  } satisfies OnlineAttributeState]));
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
  await db.batch(statements);

  const updatedValues: AttributeMatrixValue[] = [];
  if (touchedSubjects.has(input.subjectAId)) updatedValues.push(stateToMatrixValue(input.subjectAId, input.attributeId, stateA));
  if (touchedSubjects.has(input.subjectBId)) updatedValues.push(stateToMatrixValue(input.subjectBId, input.attributeId, stateB));
  return { updatedValues, activities };
};

export const saveAttributeResponse = async (db: Database, input: AttributeResponseInput): Promise<SavedAttributeResponse> => {
  if (input.subjectAId === input.subjectBId) throw new Error('attribute_subjects_must_differ');
  if (input.comparison == null && input.ratingA == null && input.ratingB == null) throw new Error('attribute_response_empty');

  const existingResponse = await db.statement('SELECT response_id FROM attribute_vote_responses WHERE response_id = ? LIMIT 1')
    .bind(input.responseId)
    .first<{ response_id: string }>();
  if (existingResponse) return { updatedValues: [], activities: [] };

  const lock = await acquireAttributeWriteLock(db, input);
  try {
    const lockedExistingResponse = await db.statement('SELECT response_id FROM attribute_vote_responses WHERE response_id = ? LIMIT 1')
      .bind(input.responseId)
      .first<{ response_id: string }>();
    if (lockedExistingResponse) return { updatedValues: [], activities: [] };
    return await saveAttributeResponseLocked(db, input);
  } finally {
    await releaseAttributeWriteLock(db, lock);
  }
};
