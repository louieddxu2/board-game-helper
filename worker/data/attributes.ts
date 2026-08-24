import type {
  AttributeActivity,
  AttributeComparisonResult,
  AttributeDefinition,
  AttributeImportCandidate,
  AttributeMatrixValue,
  AttributeQuestion,
  AttributeSubject,
  AttributeSubjectComponent,
  AttributesPayload,
} from '../../src/shared/types';
import { createId } from '../utils';
import type { Database } from './database';
import {
  ATTRIBUTE_INITIAL_SCORE,
  ATTRIBUTE_SCORE_MODEL_VERSION,
  applyComparison,
  applyDirectRating,
  emptyAttributeState,
  kFactorForEvidenceCount,
  type OnlineAttributeState,
} from './attributeScoring';

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
  direct_sum: number;
  direct_count: number;
  comparison_count: number;
  decisive_comparison_count: number;
  evidence_count: number;
}

interface AttributePairStatsRow {
  subject_a_id: string;
  subject_b_id: string;
  attribute_id: string;
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

interface ActivityRow {
  id: string;
  kind: 'rating' | 'comparison';
  actor_name: string;
  attribute_id: string;
  attribute_name: string;
  subject_id: string | null;
  subject_name: string | null;
  subject_slug: string | null;
  subject_game_slug: string | null;
  subject_a_id: string | null;
  subject_a_name: string | null;
  subject_a_slug: string | null;
  subject_a_game_slug: string | null;
  subject_b_id: string | null;
  subject_b_name: string | null;
  subject_b_slug: string | null;
  subject_b_game_slug: string | null;
  value: number | null;
  result: AttributeComparisonResult | null;
  created_at: number;
}

interface SessionRatingRow {
  subject_id: string;
  attribute_id: string;
}

interface SessionComparisonRow {
  subject_a_id: string;
  subject_b_id: string;
  attribute_id: string;
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

const querySubjectRows = async (db: Database, subjectIds?: string[]): Promise<SubjectRow[]> => {
  const filter = subjectIds?.length ? `AND s.id IN (${subjectIds.map(() => '?').join(',')})` : '';
  const result = await db.statement(`
    SELECT s.id, s.slug, s.kind, s.display_name, s.game_id, g.slug AS game_slug
    FROM attribute_subjects s
    LEFT JOIN games g ON g.id = s.game_id
    WHERE (
      s.kind = 'configuration'
      OR (
        g.merged_into_game_id IS NULL
        AND g.visibility = 'public'
        AND g.published_rule_count > 0
      )
    )
    ${filter}
    ORDER BY s.display_name COLLATE NOCASE, s.id
  `).bind(...(subjectIds ?? [])).all<SubjectRow>();
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
    components.push({
      order: row.component_order,
      gameId: row.game_id ?? undefined,
      type: row.component_type,
      label: row.label,
    });
    map.set(row.subject_id, components);
  });
  return map;
};

export const queryAttributeSubjects = async (db: Database, subjectIds?: string[]): Promise<AttributeSubject[]> => {
  const rows = await querySubjectRows(db, subjectIds);
  const components = await queryComponents(db, rows.map((row) => row.id));
  return rows.map((row) => toSubject(row, components));
};

const queryAttributeValues = async (db: Database): Promise<AttributeMatrixValue[]> => {
  const result = await db.statement(`
    SELECT subject_id, attribute_id, score, direct_sum, direct_count,
      comparison_count, decisive_comparison_count, evidence_count
    FROM attribute_score_states
  `).all<AttributeScoreStateRow>();
  return (result.results ?? []).map((row) => ({
    subjectId: row.subject_id,
    attributeId: row.attribute_id,
    score: Number(Number(row.score).toFixed(2)),
    directAverage: Number(row.direct_count) > 0
      ? Number((Number(row.direct_sum) / Number(row.direct_count)).toFixed(2))
      : undefined,
    directCount: Number(row.direct_count),
    comparisonCount: Number(row.comparison_count),
    decisiveComparisonCount: Number(row.decisive_comparison_count),
    evidenceCount: Number(row.evidence_count),
    kFactor: kFactorForEvidenceCount(Number(row.evidence_count)),
    modelVersion: ATTRIBUTE_SCORE_MODEL_VERSION,
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

const queryUnprocessedCandidates = async (db: Database): Promise<AttributeImportCandidate[]> => {
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

const toActivity = (row: ActivityRow): AttributeActivity => ({
  id: row.id,
  kind: row.kind,
  actorName: row.actor_name,
  attributeId: row.attribute_id,
  attributeName: row.attribute_name,
  subject: row.subject_id && row.subject_name && row.subject_slug
    ? { id: row.subject_id, displayName: row.subject_name, slug: row.subject_slug, gameSlug: row.subject_game_slug ?? undefined }
    : undefined,
  subjectA: row.subject_a_id && row.subject_a_name && row.subject_a_slug
    ? { id: row.subject_a_id, displayName: row.subject_a_name, slug: row.subject_a_slug, gameSlug: row.subject_a_game_slug ?? undefined }
    : undefined,
  subjectB: row.subject_b_id && row.subject_b_name && row.subject_b_slug
    ? { id: row.subject_b_id, displayName: row.subject_b_name, slug: row.subject_b_slug, gameSlug: row.subject_b_game_slug ?? undefined }
    : undefined,
  value: row.value ?? undefined,
  result: row.result ?? undefined,
  createdAt: row.created_at,
});

const queryRecentActivities = async (db: Database): Promise<AttributeActivity[]> => {
  const result = await db.statement(`
    SELECT v.id, v.kind,
      CASE WHEN u.show_nickname = 1 AND u.nickname IS NOT NULL THEN u.nickname ELSE '匿名玩家' END AS actor_name,
      v.attribute_id, t.name AS attribute_name,
      CASE WHEN v.kind = 'rating' THEN v.subject_a_id END AS subject_id,
      CASE WHEN v.kind = 'rating' THEN sa.display_name END AS subject_name,
      CASE WHEN v.kind = 'rating' THEN sa.slug END AS subject_slug,
      CASE WHEN v.kind = 'rating' THEN ga.slug END AS subject_game_slug,
      CASE WHEN v.kind = 'comparison' THEN v.subject_a_id END AS subject_a_id,
      CASE WHEN v.kind = 'comparison' THEN sa.display_name END AS subject_a_name,
      CASE WHEN v.kind = 'comparison' THEN sa.slug END AS subject_a_slug,
      CASE WHEN v.kind = 'comparison' THEN ga.slug END AS subject_a_game_slug,
      CASE WHEN v.kind = 'comparison' THEN v.subject_b_id END AS subject_b_id,
      CASE WHEN v.kind = 'comparison' THEN sb.display_name END AS subject_b_name,
      CASE WHEN v.kind = 'comparison' THEN sb.slug END AS subject_b_slug,
      CASE WHEN v.kind = 'comparison' THEN gb.slug END AS subject_b_game_slug,
      v.value, v.result, v.created_at
    FROM attribute_vote_events v
    JOIN attribute_translations t ON t.attribute_id = v.attribute_id AND t.locale = 'zh-TW'
    JOIN attribute_subjects sa ON sa.id = v.subject_a_id
    LEFT JOIN attribute_subjects sb ON sb.id = v.subject_b_id
    LEFT JOIN games ga ON ga.id = sa.game_id
    LEFT JOIN games gb ON gb.id = sb.game_id
    LEFT JOIN users u ON u.id = v.actor_id
    WHERE v.session_id NOT LIKE 'seed:%'
    ORDER BY v.created_at DESC, v.id DESC
    LIMIT 12
  `).all<ActivityRow>();
  return (result.results ?? []).map(toActivity);
};

export const queryAttributesPayload = async (db: Database): Promise<AttributesPayload> => {
  const [attributes, subjects, values, candidates, activities] = await Promise.all([
    queryAttributeDefinitions(db),
    queryAttributeSubjects(db),
    queryAttributeValues(db),
    queryUnprocessedCandidates(db),
    queryRecentActivities(db),
  ]);
  return { attributes, subjects, values, candidates, activities, scoreModelVersion: ATTRIBUTE_SCORE_MODEL_VERSION };
};

const assertSubjectAndAttribute = async (db: Database, subjectId: string, attributeId: string) => {
  const [subject, attribute] = await Promise.all([
    db.statement(`
      SELECT s.id
      FROM attribute_subjects s
      LEFT JOIN games g ON g.id = s.game_id
      WHERE s.id = ? AND (
        s.kind = 'configuration'
        OR (
          g.merged_into_game_id IS NULL
          AND g.visibility = 'public'
          AND g.published_rule_count > 0
        )
      )
    `).bind(subjectId).first<{ id: string }>(),
    db.statement('SELECT id FROM attributes WHERE id = ? AND is_active = 1').bind(attributeId).first<{ id: string }>(),
  ]);
  if (!subject) throw new Error('attribute_subject_not_found');
  if (!attribute) throw new Error('attribute_not_found');
};

const pairKey = (subjectAId: string, subjectBId: string, attributeId: string) =>
  `${subjectAId <= subjectBId ? subjectAId : subjectBId}:${subjectAId <= subjectBId ? subjectBId : subjectAId}:${attributeId}`;

export const canonicalizeComparison = (subjectAId: string, subjectBId: string, result: AttributeComparisonResult) => {
  if (subjectAId <= subjectBId) return { subjectAId, subjectBId, result };
  return {
    subjectAId: subjectBId,
    subjectBId: subjectAId,
    result: result === 'A_HIGHER' ? 'B_HIGHER' : result === 'B_HIGHER' ? 'A_HIGHER' : 'SIMILAR',
  } satisfies { subjectAId: string; subjectBId: string; result: AttributeComparisonResult };
};

const weightedRandom = <T extends { weight: number }>(items: T[]): T | undefined => {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (!total) return items[Math.floor(Math.random() * items.length)];
  let cursor = Math.random() * total;
  for (const item of items) {
    cursor -= item.weight;
    if (cursor <= 0) return item;
  }
  return items.at(-1);
};

export const queryAttributeQuestion = async (
  db: Database,
  sessionId: string,
  options: AttributeQuestionOptions = {},
): Promise<AttributeQuestion | null> => {
  const [attributes, subjects, states, pairs, sessionRatings, sessionComparisons] = await Promise.all([
    queryAttributeDefinitions(db),
    queryAttributeSubjects(db),
    db.statement('SELECT subject_id, attribute_id, score, direct_sum, direct_count, comparison_count, decisive_comparison_count, evidence_count FROM attribute_score_states').all<AttributeScoreStateRow>(),
    db.statement('SELECT subject_a_id, subject_b_id, attribute_id, comparison_count FROM attribute_pair_stats').all<AttributePairStatsRow>(),
    db.statement("SELECT subject_a_id AS subject_id, attribute_id FROM attribute_vote_events WHERE session_id = ? AND kind = 'rating'").bind(sessionId).all<SessionRatingRow>(),
    db.statement("SELECT subject_a_id, subject_b_id, attribute_id FROM attribute_vote_events WHERE session_id = ? AND kind = 'comparison'").bind(sessionId).all<SessionComparisonRow>(),
  ]);
  const subjectMap = new Map(subjects.map((subject) => [subject.id, subject]));
  const attributeMap = new Map(attributes.map((attribute) => [attribute.id, attribute]));
  const stateMap = new Map((states.results ?? []).map((row) => [`${row.subject_id}:${row.attribute_id}`, {
    score: Number(row.score),
    evidenceCount: Number(row.evidence_count),
  }]));
  const comparisonCounts = new Map((pairs.results ?? []).map((row) => [pairKey(row.subject_a_id, row.subject_b_id, row.attribute_id), Number(row.comparison_count)]));
  const sessionRatingKeys = new Set((sessionRatings.results ?? []).map((row) => `${row.subject_id}:${row.attribute_id}`));
  const sessionComparisonKeys = new Set((sessionComparisons.results ?? []).map((row) => pairKey(row.subject_a_id, row.subject_b_id, row.attribute_id)));
  const fixedA = options.fixedSubjectAId ? subjectMap.get(options.fixedSubjectAId) : undefined;
  const fixedB = options.fixedSubjectBId ? subjectMap.get(options.fixedSubjectBId) : undefined;
  const fixedAttribute = options.fixedAttributeId ? attributeMap.get(options.fixedAttributeId) : undefined;
  if (options.fixedSubjectAId && !fixedA) return null;
  if (options.fixedSubjectBId && !fixedB) return null;
  if (options.fixedAttributeId && !fixedAttribute) return null;

  const subjectAs = fixedA ? [fixedA] : subjects;
  const subjectBs = fixedB ? [fixedB] : subjects;
  const questionAttributes = fixedAttribute ? [fixedAttribute] : attributes;
  const buildCandidates = (allowAnswered: boolean) => {
    const candidates: Array<AttributeQuestion & { evidenceCount: number; distance: number; comparisonCount: number }> = [];
    for (const attribute of questionAttributes) {
      for (const subjectA of subjectAs) {
        for (const subjectB of subjectBs) {
          if (subjectA.id === subjectB.id) continue;
          if (subjectA.id === options.excludeSubjectAId && subjectB.id === options.excludeSubjectBId && attribute.id === options.excludeAttributeId) continue;
          const key = pairKey(subjectA.id, subjectB.id, attribute.id);
          const aState = stateMap.get(`${subjectA.id}:${attribute.id}`) ?? { score: ATTRIBUTE_INITIAL_SCORE, evidenceCount: 0 };
          const bState = stateMap.get(`${subjectB.id}:${attribute.id}`) ?? { score: ATTRIBUTE_INITIAL_SCORE, evidenceCount: 0 };
          const alreadyRatedBoth = sessionRatingKeys.has(`${subjectA.id}:${attribute.id}`) && sessionRatingKeys.has(`${subjectB.id}:${attribute.id}`);
          if (!allowAnswered && (sessionComparisonKeys.has(key) || alreadyRatedBoth)) continue;
          const comparisonCount = comparisonCounts.get(key) ?? 0;
          candidates.push({
            subjectA,
            subjectB,
            attribute,
            evidenceCount: aState.evidenceCount + bState.evidenceCount,
            distance: Math.abs(aState.score - bState.score),
            comparisonCount,
          });
        }
      }
    }
    return candidates;
  };

  const candidates = buildCandidates(false);
  const fallbackCandidates = candidates.length ? candidates : buildCandidates(true);
  if (!fallbackCandidates.length) return null;

  const randomCandidate = () => fallbackCandidates[Math.floor(Math.random() * fallbackCandidates.length)];
  const selectWeighted = (items: typeof fallbackCandidates, weight: (item: typeof fallbackCandidates[number]) => number) =>
    weightedRandom(items.map((item) => ({ ...item, weight: Math.max(0.001, weight(item)) })));
  const mode = Math.random();
  if (mode < 0.4) {
    return selectWeighted(fallbackCandidates, (candidate) => 1 / (1 + candidate.evidenceCount)) ?? randomCandidate();
  }
  if (mode < 0.8) {
    return selectWeighted(fallbackCandidates, (candidate) => 1 / (1 + candidate.distance)) ?? randomCandidate();
  }
  return randomCandidate();
};

export const saveAttributeResponse = async (db: Database, input: AttributeResponseInput) => {
  if (input.subjectAId === input.subjectBId) throw new Error('attribute_subjects_must_differ');
  await assertSubjectAndAttribute(db, input.subjectAId, input.attributeId);
  await assertSubjectAndAttribute(db, input.subjectBId, input.attributeId);
  if (input.comparison == null && input.ratingA == null && input.ratingB == null) throw new Error('attribute_response_empty');
  const existingResponse = await db.statement('SELECT id FROM attribute_vote_events WHERE response_id = ? LIMIT 1')
    .bind(input.responseId)
    .first<{ id: string }>();
  if (existingResponse) return;

  const stateResult = await db.statement(`
    SELECT subject_id, attribute_id, score, direct_sum, direct_count,
      comparison_count, decisive_comparison_count, evidence_count
    FROM attribute_score_states
    WHERE attribute_id = ? AND subject_id IN (?, ?)
  `).bind(input.attributeId, input.subjectAId, input.subjectBId).all<AttributeScoreStateRow>();
  const stateMap = new Map((stateResult.results ?? []).map((row) => [row.subject_id, {
    score: Number(row.score),
    directSum: Number(row.direct_sum),
    directCount: Number(row.direct_count),
    comparisonCount: Number(row.comparison_count),
    decisiveComparisonCount: Number(row.decisive_comparison_count),
    evidenceCount: Number(row.evidence_count),
  } satisfies OnlineAttributeState]));
  let stateA = stateMap.get(input.subjectAId) ?? emptyAttributeState();
  let stateB = stateMap.get(input.subjectBId) ?? emptyAttributeState();
  const touchedSubjects = new Set<string>();

  // Process direct anchors first, then the explicit A/B relation. This order is
  // fixed within one response even though the overall online model accepts
  // order sensitivity between separate responses.
  if (input.ratingA != null) {
    stateA = applyDirectRating(stateA, input.ratingA).next;
    touchedSubjects.add(input.subjectAId);
  }
  if (input.ratingB != null) {
    stateB = applyDirectRating(stateB, input.ratingB).next;
    touchedSubjects.add(input.subjectBId);
  }

  const canonical = input.comparison == null
    ? undefined
    : canonicalizeComparison(input.subjectAId, input.subjectBId, input.comparison);
  if (input.comparison != null) {
    const updated = applyComparison(stateA, stateB, input.comparison);
    stateA = updated.a.next;
    stateB = updated.b.next;
    touchedSubjects.add(input.subjectAId);
    touchedSubjects.add(input.subjectBId);
  }

  const statements = [];
  const addEvent = (eventKey: string, kind: 'rating' | 'comparison', subjectAId: string, subjectBId: string | null, value: number | null, result: AttributeComparisonResult | null) => {
    statements.push(db.statement(`
      INSERT INTO attribute_vote_events
        (id, response_id, event_key, kind, attribute_id, subject_a_id, subject_b_id, value, result, actor_id, session_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      createId('attribute-vote'), input.responseId, eventKey, kind, input.attributeId,
      subjectAId, subjectBId, value, result, input.actorId, input.sessionId, input.timestamp, input.timestamp,
    ));
  };

  if (input.ratingA != null) addEvent(`rating:${input.subjectAId}`, 'rating', input.subjectAId, null, input.ratingA, null);
  if (input.ratingB != null) addEvent(`rating:${input.subjectBId}`, 'rating', input.subjectBId, null, input.ratingB, null);
  if (canonical) addEvent(`comparison:${canonical.subjectAId}:${canonical.subjectBId}`, 'comparison', canonical.subjectAId, canonical.subjectBId, null, canonical.result);

  const addStateUpsert = (subjectId: string, state: OnlineAttributeState) => {
    statements.push(db.statement(`
      INSERT INTO attribute_score_states
        (subject_id, attribute_id, score, direct_sum, direct_count, comparison_count, decisive_comparison_count, evidence_count, model_version, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(subject_id, attribute_id) DO UPDATE SET
        score = excluded.score,
        direct_sum = excluded.direct_sum,
        direct_count = excluded.direct_count,
        comparison_count = excluded.comparison_count,
        decisive_comparison_count = excluded.decisive_comparison_count,
        evidence_count = excluded.evidence_count,
        model_version = excluded.model_version,
        updated_at = excluded.updated_at
    `).bind(
      subjectId, input.attributeId, state.score, state.directSum, state.directCount,
      state.comparisonCount, state.decisiveComparisonCount, state.evidenceCount,
      ATTRIBUTE_SCORE_MODEL_VERSION, input.timestamp,
    ));
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

  await db.batch(statements);
};
