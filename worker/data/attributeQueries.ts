import type {
  AttributeDefinition,
  AttributeImportCandidate,
  AttributeMatrixValue,
  AttributeSubject,
  AttributeSubjectComponent,
  AttributesPayload
} from '../../src/shared/types';
import type { AttributeRow, AttributeScoreStateRow, AttributeTableQueryOptions, CandidatePageOptions, CandidateRow, ComponentRow, SubjectPageOptions, SubjectRow } from './attributeQueryShared';
import { D1_SAFE_BOUND_PARAMETER_COUNT, chunk, clampPageSize, decodeCursor, encodeCursor, subjectSecondaryNameExpression, toAttribute, toComponent, toSubject, votableSubjectCondition } from './attributeQueryShared';
import {
  ATTRIBUTE_INITIAL_RD,
  ATTRIBUTE_SCORE_MODEL_VERSION
} from './attributeScoring';
import type { Database } from './database';

export const queryAttributeDefinitions = async (db: Database, attributeIds?: string[]): Promise<AttributeDefinition[]> => {
  if (attributeIds && !attributeIds.length) return [];
  const filter = attributeIds?.length ? `AND a.id IN (${attributeIds.map(() => '?').join(',')})` : '';
  const result = await db.statement(`
    SELECT a.id, a.key, t.name, t.short_description, t.full_description, a.scale_type, t.endpoints_json,
      a.min_value, a.max_value, a.sort_order
    FROM attributes a
    JOIN attribute_translations t ON t.attribute_id = a.id AND t.locale = 'zh-TW'
    WHERE a.is_active = 1
      ${filter}
    ORDER BY a.sort_order, a.id
  `).bind(...(attributeIds ?? [])).all<AttributeRow>();
  return (result.results ?? []).map(toAttribute);
};

export const queryAttributeDefinitionsById = (db: Database, attributeIds: string[]) =>
  queryAttributeDefinitions(db, attributeIds);

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
      (
        SELECT json_group_array(alias) FROM (
          SELECT alias FROM game_aliases WHERE game_id = s.game_id
          UNION
          SELECT game_aliases.alias
          FROM attribute_subject_components component
          JOIN game_aliases ON game_aliases.game_id = component.game_id
          WHERE component.subject_id = s.id AND component.game_id IS NOT s.game_id
          ORDER BY alias
        )
      ) AS aliases_json,
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
  const resultChunks = await Promise.all(chunk(subjectIds, D1_SAFE_BOUND_PARAMETER_COUNT).map((ids) => db.statement(`
    SELECT subject_id, component_order, game_id, component_type, label, english_name, bgg_id
    FROM attribute_subject_components
    AS c
    WHERE subject_id IN (${ids.map(() => '?').join(',')})
    ORDER BY subject_id, component_order
  `).bind(...ids).all<ComponentRow>()));
  const map = new Map<string, AttributeSubjectComponent[]>();
  for (const result of resultChunks) for (const row of result.results ?? []) {
    const components = map.get(row.subject_id) ?? [];
    components.push(toComponent(row));
    map.set(row.subject_id, components);
  }
  return map;
};

export const queryAttributeSubjects = async (db: Database, subjectIds?: string[], page?: SubjectPageOptions): Promise<AttributeSubject[]> => {
  const rows = await querySubjectRows(db, subjectIds, page);
  const components = await queryComponents(db, rows.map((row) => row.id));
  return rows.map((row) => toSubject(row, components));
};

export const queryAttributeSubjectBundles = async (
  db: Database,
  subjectIds: string[],
): Promise<Array<{ subject: AttributeSubject; values: AttributeMatrixValue[] }>> => {
  if (!subjectIds.length) return [];
  const [subjects, values] = await Promise.all([
    queryAttributeSubjects(db, subjectIds),
    queryAttributeValues(db, subjectIds),
  ]);
  const valuesBySubject = new Map<string, AttributeMatrixValue[]>();
  values.forEach((value) => {
    const current = valuesBySubject.get(value.subjectId) ?? [];
    current.push(value);
    valuesBySubject.set(value.subjectId, current);
  });
  return subjects.map((subject) => ({
    subject,
    values: valuesBySubject.get(subject.id) ?? [],
  }));
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

export const queryAttributeValues = async (db: Database, subjectIds?: string[]): Promise<AttributeMatrixValue[]> => {
  if (subjectIds && !subjectIds.length) return [];
  const filter = subjectIds?.length ? `WHERE state.subject_id IN (${subjectIds.map(() => '?').join(',')})` : '';
  const result = await db.statement(`
    SELECT state.subject_id, state.attribute_id, state.score, state.rating_deviation, state.direct_sum, state.direct_count,
      state.comparison_count, state.decisive_comparison_count, state.evidence_count
    FROM attribute_score_states state
    ${filter}
    ORDER BY state.subject_id, state.attribute_id
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

export const queryAllUnprocessedCandidates = async (db: Database): Promise<AttributeImportCandidate[]> => {
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

export const queryAttributeCandidatesById = async (
  db: Database,
  candidateIds: string[],
): Promise<AttributeImportCandidate[]> => {
  if (!candidateIds.length) return [];
  const result = await db.statement(`
    SELECT id, source_name, values_json, match_status, subject_id, source_row_number
    FROM attribute_import_candidates
    WHERE id IN (${candidateIds.map(() => '?').join(',')})
      AND match_status IN ('pending', 'ambiguous')
    ORDER BY source_row_number, id
  `).bind(...candidateIds).all<CandidateRow>();
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
