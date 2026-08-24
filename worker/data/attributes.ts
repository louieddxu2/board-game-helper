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

interface AttributeValueRow {
  subject_id: string;
  attribute_id: string;
  average_value: number;
  rating_count: number;
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

interface EvidenceRatingRow {
  subject_id: string;
  attribute_id: string;
  rating_count: number;
}

interface EvidenceComparisonRow {
  subject_a_id: string;
  subject_b_id: string;
  attribute_id: string;
  comparison_count: number;
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
    SELECT subject_id, attribute_id, AVG(value) AS average_value, COUNT(*) AS rating_count
    FROM attribute_ratings
    GROUP BY subject_id, attribute_id
  `).all<AttributeValueRow>();
  return (result.results ?? []).map((row) => ({
    subjectId: row.subject_id,
    attributeId: row.attribute_id,
    average: Number(Number(row.average_value).toFixed(2)),
    count: Number(row.rating_count),
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
    SELECT id, kind, actor_name, attribute_id, attribute_name,
      subject_id, subject_name, subject_slug,
      subject_game_slug,
      subject_a_id, subject_a_name, subject_a_slug, subject_a_game_slug,
      subject_b_id, subject_b_name, subject_b_slug, subject_b_game_slug,
      value, result, created_at
    FROM (
      SELECT r.id, 'rating' AS kind,
        CASE WHEN u.show_nickname = 1 AND u.nickname IS NOT NULL THEN u.nickname ELSE '匿名玩家' END AS actor_name,
        r.attribute_id, t.name AS attribute_name,
        r.subject_id, s.display_name AS subject_name, s.slug AS subject_slug,
        g.slug AS subject_game_slug,
        NULL AS subject_a_id, NULL AS subject_a_name, NULL AS subject_a_slug, NULL AS subject_a_game_slug,
        NULL AS subject_b_id, NULL AS subject_b_name, NULL AS subject_b_slug, NULL AS subject_b_game_slug,
        r.value, NULL AS result, r.created_at
      FROM attribute_ratings r
      JOIN attribute_subjects s ON s.id = r.subject_id
      LEFT JOIN games g ON g.id = s.game_id
      JOIN attribute_translations t ON t.attribute_id = r.attribute_id AND t.locale = 'zh-TW'
      LEFT JOIN users u ON u.id = r.actor_id
      WHERE r.session_id NOT LIKE 'seed:%'
      UNION ALL
      SELECT c.id, 'comparison' AS kind,
        CASE WHEN u.show_nickname = 1 AND u.nickname IS NOT NULL THEN u.nickname ELSE '匿名玩家' END AS actor_name,
        c.attribute_id, t.name AS attribute_name,
        NULL AS subject_id, NULL AS subject_name, NULL AS subject_slug,
        NULL AS subject_game_slug,
        c.subject_a_id, sa.display_name AS subject_a_name, sa.slug AS subject_a_slug, ga.slug AS subject_a_game_slug,
        c.subject_b_id, sb.display_name AS subject_b_name, sb.slug AS subject_b_slug, gb.slug AS subject_b_game_slug,
        NULL AS value, c.result, c.created_at
      FROM attribute_comparisons c
      JOIN attribute_subjects sa ON sa.id = c.subject_a_id
      JOIN attribute_subjects sb ON sb.id = c.subject_b_id
      LEFT JOIN games ga ON ga.id = sa.game_id
      LEFT JOIN games gb ON gb.id = sb.game_id
      JOIN attribute_translations t ON t.attribute_id = c.attribute_id AND t.locale = 'zh-TW'
      LEFT JOIN users u ON u.id = c.actor_id
      WHERE c.session_id NOT LIKE 'seed:%'
    ) activities
    ORDER BY created_at DESC, id DESC
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
  return { attributes, subjects, values, candidates, activities };
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
  const [attributes, subjects, ratings, comparisons, sessionRatings, sessionComparisons] = await Promise.all([
    queryAttributeDefinitions(db),
    queryAttributeSubjects(db),
    db.statement('SELECT subject_id, attribute_id, COUNT(*) AS rating_count FROM attribute_ratings GROUP BY subject_id, attribute_id').all<EvidenceRatingRow>(),
    db.statement('SELECT subject_a_id, subject_b_id, attribute_id, COUNT(*) AS comparison_count FROM attribute_comparisons GROUP BY subject_a_id, subject_b_id, attribute_id').all<EvidenceComparisonRow>(),
    db.statement('SELECT subject_id, attribute_id FROM attribute_ratings WHERE session_id = ?').bind(sessionId).all<SessionRatingRow>(),
    db.statement('SELECT subject_a_id, subject_b_id, attribute_id FROM attribute_comparisons WHERE session_id = ?').bind(sessionId).all<SessionComparisonRow>(),
  ]);
  const subjectMap = new Map(subjects.map((subject) => [subject.id, subject]));
  const attributeMap = new Map(attributes.map((attribute) => [attribute.id, attribute]));
  const ratingCounts = new Map((ratings.results ?? []).map((row) => [`${row.subject_id}:${row.attribute_id}`, Number(row.rating_count)]));
  const comparisonCounts = new Map((comparisons.results ?? []).map((row) => [pairKey(row.subject_a_id, row.subject_b_id, row.attribute_id), Number(row.comparison_count)]));
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
    const candidates: Array<AttributeQuestion & { weight: number }> = [];
    for (const attribute of questionAttributes) {
      for (const subjectA of subjectAs) {
        for (const subjectB of subjectBs) {
          if (subjectA.id === subjectB.id) continue;
          if (subjectA.id === options.excludeSubjectAId && subjectB.id === options.excludeSubjectBId && attribute.id === options.excludeAttributeId) continue;
          const key = pairKey(subjectA.id, subjectB.id, attribute.id);
          const aRatingCount = ratingCounts.get(`${subjectA.id}:${attribute.id}`) ?? 0;
          const bRatingCount = ratingCounts.get(`${subjectB.id}:${attribute.id}`) ?? 0;
          const alreadyRatedBoth = sessionRatingKeys.has(`${subjectA.id}:${attribute.id}`) && sessionRatingKeys.has(`${subjectB.id}:${attribute.id}`);
          if (!allowAnswered && (sessionComparisonKeys.has(key) || alreadyRatedBoth)) continue;
          const comparisonCount = comparisonCounts.get(key) ?? 0;
          const missingRatings = (aRatingCount < 2 ? 2 : 0) + (bRatingCount < 2 ? 2 : 0);
          const weight = (comparisonCount === 0 ? 9 : 1) + missingRatings + Math.random();
          candidates.push({ subjectA, subjectB, attribute, weight });
        }
      }
    }
    return candidates;
  };

  const candidates = buildCandidates(false);
  const fallbackCandidates = candidates.length ? candidates : buildCandidates(true);
  return weightedRandom(fallbackCandidates) ?? null;
};

export const saveAttributeResponse = async (db: Database, input: AttributeResponseInput) => {
  if (input.subjectAId === input.subjectBId) throw new Error('attribute_subjects_must_differ');
  await assertSubjectAndAttribute(db, input.subjectAId, input.attributeId);
  await assertSubjectAndAttribute(db, input.subjectBId, input.attributeId);
  if (input.comparison == null && input.ratingA == null && input.ratingB == null) throw new Error('attribute_response_empty');
  const statements = [];
  if (input.ratingA != null) {
    statements.push(db.statement(`
      INSERT INTO attribute_ratings
        (id, subject_id, attribute_id, value, actor_id, session_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, subject_id, attribute_id) DO UPDATE SET
        value = excluded.value, actor_id = excluded.actor_id, updated_at = excluded.updated_at
    `).bind(createId('attribute-rating'), input.subjectAId, input.attributeId, input.ratingA, input.actorId, input.sessionId, input.timestamp, input.timestamp));
  }
  if (input.ratingB != null) {
    statements.push(db.statement(`
      INSERT INTO attribute_ratings
        (id, subject_id, attribute_id, value, actor_id, session_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, subject_id, attribute_id) DO UPDATE SET
        value = excluded.value, actor_id = excluded.actor_id, updated_at = excluded.updated_at
    `).bind(createId('attribute-rating'), input.subjectBId, input.attributeId, input.ratingB, input.actorId, input.sessionId, input.timestamp, input.timestamp));
  }
  if (input.comparison != null) {
    const canonical = canonicalizeComparison(input.subjectAId, input.subjectBId, input.comparison);
    statements.push(db.statement(`
      INSERT INTO attribute_comparisons
        (id, attribute_id, subject_a_id, subject_b_id, result, actor_id, session_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, attribute_id, subject_a_id, subject_b_id) DO UPDATE SET
        result = excluded.result, actor_id = excluded.actor_id, updated_at = excluded.updated_at
    `).bind(createId('attribute-comparison'), input.attributeId, canonical.subjectAId, canonical.subjectBId, canonical.result, input.actorId, input.sessionId, input.timestamp, input.timestamp));
  }
  await db.batch(statements);
};
