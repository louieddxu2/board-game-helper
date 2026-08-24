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
import type { Database } from './database';
import {
  ATTRIBUTE_INITIAL_RD,
  ATTRIBUTE_SCORE_MODEL_VERSION,
  applyComparison,
  applyDirectRating,
  emptyAttributeState,
  type OnlineAttributeState,
} from './attributeScoring';

/** Number of random slots used to sample low-confidence subjects. */
export const ATTRIBUTE_QUESTION_SLOT_COUNT = 200;
export const ATTRIBUTE_QUESTION_SLOT_PROBE_LIMIT = 16;
export const ATTRIBUTE_QUESTION_SELECTED_LIMIT = 2;
export const ATTRIBUTE_QUESTION_PAIR_PROBE_LIMIT = 4;
export const ATTRIBUTE_ACTIVITY_FEED_LIMIT = 12;
export const ATTRIBUTE_TABLE_PAGE_SIZE = 50;
export const ATTRIBUTE_RESPONSE_MAX_READ_ROWS = 4;
export const ATTRIBUTE_RESPONSE_MAX_WRITE_ROWS = 7;
export const ATTRIBUTE_QUESTION_MAX_RETURNED_ROWS = 37;
/** Includes up to four excluded subject rows skipped by slot lookups. */
export const ATTRIBUTE_QUESTION_MAX_ROWS_READ = 41;

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

interface CandidateStateRow {
  subject_id: string;
  score: number;
  rating_deviation: number;
  random_key: string;
}

interface PairCandidateRow {
  subject_a_id: string;
  subject_b_id: string;
  distance: number;
}

interface AttributePairStatsRow {
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
    SELECT s.id, s.slug, s.kind, s.display_name, s.game_id, g.slug AS game_slug
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

const parseActivities = (raw: string): AttributeActivity[] => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is AttributeActivity => Boolean(item && typeof item === 'object' && 'id' in item && 'kind' in item));
  } catch {
    return [];
  }
};

export const queryRecentActivities = async (db: Database): Promise<AttributeActivity[]> => {
  const result = await db.statement(`
    SELECT id, payload_json
    FROM attribute_activity_feed
    ORDER BY created_at DESC, id DESC
    LIMIT ${ATTRIBUTE_ACTIVITY_FEED_LIMIT}
  `).all<ActivityFeedRow>();
  return (result.results ?? []).flatMap((row) => parseActivities(row.payload_json)).slice(0, ATTRIBUTE_ACTIVITY_FEED_LIMIT);
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

const randomQuestionSlots = (limit: number) => {
  const slots = new Set<number>();
  while (slots.size < Math.min(limit, ATTRIBUTE_QUESTION_SLOT_COUNT)) slots.add(randomQuestionSlot());
  return [...slots];
};

const excludedSubjectFilter = (excludeSubjectIds: string[]) => excludeSubjectIds.length
  ? `AND subject_id NOT IN (${excludeSubjectIds.map(() => '?').join(',')})`
  : '';

const queryCandidateIdsBySlots = async (
  db: Database,
  attributeId: string,
  excludeSubjectIds: string[] = [],
): Promise<string[]> => {
  const exclusion = excludedSubjectFilter(excludeSubjectIds);
  const rows = await Promise.all(randomQuestionSlots(ATTRIBUTE_QUESTION_SLOT_PROBE_LIMIT).map((slot) => db.statement(`
    SELECT subject_id
    FROM attribute_score_states
    WHERE attribute_id = ? AND question_slot = ? ${exclusion}
    ORDER BY rating_deviation DESC, random_key, subject_id
    LIMIT 1
  `).bind(attributeId, slot, ...excludeSubjectIds).first<{ subject_id: string }>()));
  return rows.filter((row): row is { subject_id: string } => Boolean(row))
    .map((row) => row.subject_id)
    .slice(0, ATTRIBUTE_QUESTION_SELECTED_LIMIT);
};

const queryCandidateStatesBySlots = async (
  db: Database,
  attributeId: string,
  excludeSubjectIds: string[] = [],
): Promise<CandidateStateRow[]> => {
  const exclusion = excludedSubjectFilter(excludeSubjectIds);
  const rows = await Promise.all(randomQuestionSlots(ATTRIBUTE_QUESTION_SLOT_PROBE_LIMIT).map((slot) => db.statement(`
    SELECT subject_id, score, rating_deviation, random_key
    FROM attribute_score_states
    WHERE attribute_id = ? AND question_slot = ? ${exclusion}
    ORDER BY rating_deviation DESC, random_key, subject_id
    LIMIT 1
  `).bind(attributeId, slot, ...excludeSubjectIds).first<CandidateStateRow>()));
  return rows.filter((row): row is CandidateStateRow => Boolean(row));
};

const queryFixedCandidateState = async (db: Database, attributeId: string, subjectId: string): Promise<CandidateStateRow | null> => {
  const result = await db.statement(`
    SELECT subject_id, score, rating_deviation, random_key
    FROM attribute_score_states
    WHERE attribute_id = ? AND subject_id = ?
    LIMIT 1
  `).bind(attributeId, subjectId).first<CandidateStateRow>();
  return result ?? null;
};

export const canonicalizeComparison = (subjectAId: string, subjectBId: string, result: AttributeComparisonResult) => {
  if (subjectAId <= subjectBId) return { subjectAId, subjectBId, result };
  return {
    subjectAId: subjectBId,
    subjectBId: subjectAId,
    result: result === 'A_HIGHER' ? 'B_HIGHER' : result === 'B_HIGHER' ? 'A_HIGHER' : 'SIMILAR',
  } satisfies { subjectAId: string; subjectBId: string; result: AttributeComparisonResult };
};

const queryPairComparisonCount = async (db: Database, subjectAId: string, subjectBId: string, attributeId: string) => {
  const canonical = subjectAId <= subjectBId ? [subjectAId, subjectBId] : [subjectBId, subjectAId];
  const result = await db.statement(`
    SELECT comparison_count
    FROM attribute_pair_stats
    WHERE subject_a_id = ? AND subject_b_id = ? AND attribute_id = ?
  `).bind(canonical[0], canonical[1], attributeId).first<AttributePairStatsRow>();
  return Number(result?.comparison_count ?? 0);
};

const queryClosePairCandidates = async (
  db: Database,
  attributeId: string,
  options: AttributeQuestionOptions,
): Promise<PairCandidateRow[]> => {
  const limit = ATTRIBUTE_QUESTION_PAIR_PROBE_LIMIT;
  if (options.fixedSubjectAId || options.fixedSubjectBId) {
    const fixedSubjectId = options.fixedSubjectAId ?? options.fixedSubjectBId;
    const fixed = fixedSubjectId ? await queryFixedCandidateState(db, attributeId, fixedSubjectId) : null;
    if (!fixed || !fixedSubjectId) return [];
    const candidates = await queryCandidateStatesBySlots(db, attributeId, [fixedSubjectId]);
    return candidates
      .map((candidate) => options.fixedSubjectAId
        ? { subject_a_id: fixedSubjectId, subject_b_id: candidate.subject_id, distance: Math.abs(fixed.score - candidate.score) }
        : { subject_a_id: candidate.subject_id, subject_b_id: fixedSubjectId, distance: Math.abs(fixed.score - candidate.score) })
      .sort((left, right) => left.distance - right.distance)
      .slice(0, limit);
  }

  const candidates = await queryCandidateStatesBySlots(db, attributeId);
  const pairs: PairCandidateRow[] = [];
  for (let index = 0; index < candidates.length; index += 1) {
    for (let next = index + 1; next < candidates.length; next += 1) {
      pairs.push({
        subject_a_id: candidates[index].subject_id,
        subject_b_id: candidates[next].subject_id,
        distance: Math.abs(candidates[index].score - candidates[next].score),
      });
    }
  }
  return pairs.sort((left, right) => left.distance - right.distance).slice(0, limit);
};

const isExcludedPair = (subjectAId: string, subjectBId: string, attributeId: string, options: AttributeQuestionOptions) => {
  if (options.excludeAttributeId !== attributeId) return false;
  return (subjectAId === options.excludeSubjectAId && subjectBId === options.excludeSubjectBId)
    || (subjectAId === options.excludeSubjectBId && subjectBId === options.excludeSubjectAId);
};

const chooseClosePair = async (db: Database, attributeId: string, options: AttributeQuestionOptions) => {
  const candidates = (await queryClosePairCandidates(db, attributeId, options))
    .filter((pair) => !isExcludedPair(pair.subject_a_id, pair.subject_b_id, attributeId, options));
  if (!candidates.length) return null;
  const withCounts = await Promise.all(candidates.slice(0, ATTRIBUTE_QUESTION_PAIR_PROBE_LIMIT).map(async (pair) => ({
    pair,
    count: await queryPairComparisonCount(db, pair.subject_a_id, pair.subject_b_id, attributeId),
  })));
  withCounts.sort((left, right) => left.count - right.count || left.pair.distance - right.pair.distance);
  const selected = withCounts[0]?.pair;
  return selected ? { subjectAId: selected.subject_a_id, subjectBId: selected.subject_b_id } : null;
};

const queryQuestionWithAttribute = async (
  db: Database,
  attribute: AttributeDefinition,
  options: AttributeQuestionOptions,
): Promise<AttributeQuestion | null> => {
  const fixedBoth = Boolean(options.fixedSubjectAId && options.fixedSubjectBId);
  const mode: 'low' | 'close' | 'random' = Math.random() < 0.4 ? 'low' : Math.random() < 0.6666667 ? 'close' : 'random';
  let selected: { subjectAId: string; subjectBId: string } | null = null;
  if (fixedBoth) {
    selected = { subjectAId: options.fixedSubjectAId!, subjectBId: options.fixedSubjectBId! };
  } else if (mode === 'close') {
    selected = await chooseClosePair(db, attribute.id, options);
  } else {
    const excludeSubjectIds = [
      options.fixedSubjectAId,
      options.fixedSubjectBId,
      options.excludeSubjectAId,
      options.excludeSubjectBId,
    ].filter((id): id is string => Boolean(id));
    const subjectIds = await queryCandidateIdsBySlots(db, attribute.id, [...new Set(excludeSubjectIds)]);
    if (options.fixedSubjectAId && subjectIds[0]) selected = { subjectAId: options.fixedSubjectAId, subjectBId: subjectIds[0] };
    else if (options.fixedSubjectBId && subjectIds[0]) selected = { subjectAId: subjectIds[0], subjectBId: options.fixedSubjectBId };
    else if (subjectIds.length >= 2) selected = { subjectAId: subjectIds[0], subjectBId: subjectIds[1] };
  }
  if (!selected || selected.subjectAId === selected.subjectBId || isExcludedPair(selected.subjectAId, selected.subjectBId, attribute.id, options)) return null;
  const subjects = await queryQuestionSubjects(db, [selected.subjectAId, selected.subjectBId]);
  const subjectMap = new Map(subjects.map((subject) => [subject.id, subject]));
  const subjectA = subjectMap.get(selected.subjectAId);
  const subjectB = subjectMap.get(selected.subjectBId);
  return subjectA && subjectB ? { subjectA, subjectB, attribute } : null;
};

export const queryAttributeQuestion = async (
  db: Database,
  _sessionId: string,
  options: AttributeQuestionOptions = {},
): Promise<AttributeQuestion | null> => {
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
  `).bind(input.subjectAId, input.subjectBId, input.actorId, input.attributeId).first<ResponseContextRow>();
  if (!row) throw new Error('attribute_subject_not_found');
  return row;
};

export const saveAttributeResponse = async (db: Database, input: AttributeResponseInput): Promise<SavedAttributeResponse> => {
  if (input.subjectAId === input.subjectBId) throw new Error('attribute_subjects_must_differ');
  if (input.comparison == null && input.ratingA == null && input.ratingB == null) throw new Error('attribute_response_empty');

  const existingResponse = await db.statement('SELECT id FROM attribute_vote_events WHERE response_id = ? LIMIT 1')
    .bind(input.responseId)
    .first<{ id: string }>();
  if (existingResponse) return { updatedValues: [], activities: [] };

  const context = await responseContext(db, input);
  const stateResult = await db.statement(`
    SELECT subject_id, attribute_id, score, rating_deviation, direct_sum, direct_count,
      comparison_count, decisive_comparison_count, evidence_count
    FROM attribute_score_states
    WHERE attribute_id = ? AND subject_id IN (?, ?)
  `).bind(input.attributeId, input.subjectAId, input.subjectBId).all<AttributeScoreStateRow>();
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
  const addEvent = (eventKey: string, kind: 'rating' | 'comparison', subjectAId: string, subjectBId: string | null, value: number | null, result: AttributeComparisonResult | null) => {
    const id = createId('attribute-vote');
    statements.push(db.statement(`
      INSERT INTO attribute_vote_events
        (id, response_id, event_key, kind, attribute_id, subject_a_id, subject_b_id, value, result, actor_id, session_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, input.responseId, eventKey, kind, input.attributeId, subjectAId, subjectBId, value, result, input.actorId, input.sessionId, input.timestamp, input.timestamp));
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

  if (input.ratingA != null) addEvent(`rating:${input.subjectAId}`, 'rating', input.subjectAId, null, input.ratingA, null);
  if (input.ratingB != null) addEvent(`rating:${input.subjectBId}`, 'rating', input.subjectBId, null, input.ratingB, null);
  if (canonical) addEvent(`comparison:${canonical.subjectAId}:${canonical.subjectBId}`, 'comparison', canonical.subjectAId, canonical.subjectBId, null, canonical.result);

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

  if (canonical) {
    statements.push(db.statement(`
      INSERT INTO attribute_pair_stats
        (subject_a_id, subject_b_id, attribute_id, comparison_count, updated_at)
      VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(subject_a_id, subject_b_id, attribute_id) DO UPDATE SET
        comparison_count = attribute_pair_stats.comparison_count + 1,
        updated_at = excluded.updated_at
    `).bind(canonical.subjectAId, canonical.subjectBId, input.attributeId, input.timestamp));
  }

  statements.push(db.statement(`
    INSERT INTO attribute_activity_feed (id, response_id, payload_json, created_at)
    VALUES (?, ?, ?, ?)
  `).bind(createId('attribute-feed'), input.responseId, JSON.stringify(activities), input.timestamp));
  await db.batch(statements);

  const updatedValues: AttributeMatrixValue[] = [];
  if (touchedSubjects.has(input.subjectAId)) updatedValues.push(stateToMatrixValue(input.subjectAId, input.attributeId, stateA));
  if (touchedSubjects.has(input.subjectBId)) updatedValues.push(stateToMatrixValue(input.subjectBId, input.attributeId, stateB));
  return { updatedValues, activities };
};
