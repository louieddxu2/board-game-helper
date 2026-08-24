import type {
  AttributeComparisonResult,
  AttributeComparisonSummary,
  AttributeDefinition,
  AttributeProfileEntry,
  AttributeScoreSummary,
  AttributeSubject,
  AttributeSubjectComponent,
  AttributeWorkbenchPayload,
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

interface RatingAggregateRow {
  subject_id: string;
  attribute_id: string;
  average_value: number;
  rating_count: number;
  my_value: number | null;
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
      OR (g.merged_into_game_id IS NULL AND g.visibility = 'public')
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

export const queryAttributesPayload = async (db: Database): Promise<AttributesPayload> => {
  const [attributes, subjects] = await Promise.all([
    queryAttributeDefinitions(db),
    queryAttributeSubjects(db),
  ]);
  return { attributes, subjects };
};

const assertSubjectAndAttribute = async (db: Database, subjectId: string, attributeId: string) => {
  const [subject, attribute] = await Promise.all([
    db.statement(`
      SELECT s.id
      FROM attribute_subjects s
      LEFT JOIN games g ON g.id = s.game_id
      WHERE s.id = ? AND (
        s.kind = 'configuration'
        OR (g.merged_into_game_id IS NULL AND g.visibility = 'public')
      )
    `).bind(subjectId).first<{ id: string }>(),
    db.statement('SELECT id FROM attributes WHERE id = ? AND is_active = 1').bind(attributeId).first<{ id: string }>(),
  ]);
  if (!subject) throw new Error('attribute_subject_not_found');
  if (!attribute) throw new Error('attribute_not_found');
};

const scoreFromAggregate = (row: RatingAggregateRow | undefined): AttributeScoreSummary => ({
  average: row ? Number(Number(row.average_value).toFixed(2)) : 0,
  count: row?.rating_count ?? 0,
  myValue: row?.my_value == null ? undefined : row.my_value,
});

const profileFromAggregates = (
  attributes: AttributeDefinition[],
  subjectId: string,
  rows: RatingAggregateRow[],
): AttributeProfileEntry[] => {
  const byAttribute = new Map(rows.filter((row) => row.subject_id === subjectId).map((row) => [row.attribute_id, row]));
  return attributes.map((attribute) => {
    const row = byAttribute.get(attribute.id);
    return {
      attributeId: attribute.id,
      ...scoreFromAggregate(row),
    };
  });
};

export const canonicalizeComparison = (subjectAId: string, subjectBId: string, result: AttributeComparisonResult) => {
  if (subjectAId <= subjectBId) return { subjectAId, subjectBId, result };
  return {
    subjectAId: subjectBId,
    subjectBId: subjectAId,
    result: result === 'A_HIGHER' ? 'B_HIGHER' : result === 'B_HIGHER' ? 'A_HIGHER' : 'SIMILAR',
  } satisfies { subjectAId: string; subjectBId: string; result: AttributeComparisonResult };
};

const invertComparisonResult = (result: AttributeComparisonResult): AttributeComparisonResult =>
  result === 'A_HIGHER' ? 'B_HIGHER' : result === 'B_HIGHER' ? 'A_HIGHER' : 'SIMILAR';

export const queryAttributeWorkbench = async (
  db: Database,
  subjectAId: string,
  subjectBId: string,
  attributeId: string,
  sessionId: string,
): Promise<AttributeWorkbenchPayload> => {
  if (subjectAId === subjectBId) throw new Error('attribute_subjects_must_differ');
  await assertSubjectAndAttribute(db, subjectAId, attributeId);
  await assertSubjectAndAttribute(db, subjectBId, attributeId);
  const [attributes, subjects, aggregateResult, comparisonResult] = await Promise.all([
    queryAttributeDefinitions(db),
    queryAttributeSubjects(db, [subjectAId, subjectBId]),
    db.statement(`
      SELECT subject_id, attribute_id, AVG(value) AS average_value, COUNT(*) AS rating_count,
        MAX(CASE WHEN session_id = ? THEN value END) AS my_value
      FROM attribute_ratings
      WHERE subject_id IN (?, ?)
      GROUP BY subject_id, attribute_id
    `).bind(sessionId, subjectAId, subjectBId).all<RatingAggregateRow>(),
    (async () => {
      const pair = canonicalizeComparison(subjectAId, subjectBId, 'SIMILAR');
      const [counts, mine] = await Promise.all([
        db.statement(`
          SELECT result, COUNT(*) AS count
          FROM attribute_comparisons
          WHERE attribute_id = ? AND subject_a_id = ? AND subject_b_id = ?
          GROUP BY result
        `).bind(attributeId, pair.subjectAId, pair.subjectBId).all<{ result: AttributeComparisonResult; count: number }>(),
        db.statement(`
          SELECT result
          FROM attribute_comparisons
          WHERE attribute_id = ? AND subject_a_id = ? AND subject_b_id = ? AND session_id = ?
          LIMIT 1
        `).bind(attributeId, pair.subjectAId, pair.subjectBId, sessionId).first<{ result: AttributeComparisonResult }>(),
      ]);
      return { counts: counts.results ?? [], mine: mine?.result };
    })(),
  ]);
  const subjectMap = new Map(subjects.map((subject) => [subject.id, subject]));
  const subjectA = subjectMap.get(subjectAId);
  const subjectB = subjectMap.get(subjectBId);
  if (!subjectA || !subjectB) throw new Error('attribute_subject_not_found');
  const aggregates = aggregateResult.results ?? [];
  const aggregateMap = new Map(aggregates.map((row) => [`${row.subject_id}:${row.attribute_id}`, row]));
  const selectedAttribute = attributes.find((attribute) => attribute.id === attributeId);
  if (!selectedAttribute) throw new Error('attribute_not_found');
  const comparisons: AttributeComparisonSummary[] = comparisonResult.counts.map((row) => ({
    result: subjectAId <= subjectBId ? row.result : invertComparisonResult(row.result),
    count: Number(row.count),
  }));
  const score = (subjectId: string) => scoreFromAggregate(aggregateMap.get(`${subjectId}:${selectedAttribute.id}`));
  return {
    subjectA,
    subjectB,
    attributeId,
    scores: { a: score(subjectAId), b: score(subjectBId) },
    profile: {
      a: profileFromAggregates(attributes, subjectAId, aggregates),
      b: profileFromAggregates(attributes, subjectBId, aggregates),
    },
    comparisons,
    myComparison: comparisonResult.mine == null
      ? undefined
      : subjectAId <= subjectBId ? comparisonResult.mine : invertComparisonResult(comparisonResult.mine),
  };
};

export const saveAttributeRating = async (
  db: Database,
  subjectId: string,
  attributeId: string,
  value: number,
  sessionId: string,
  actorId: string | null,
  timestamp: number,
) => {
  await assertSubjectAndAttribute(db, subjectId, attributeId);
  await db.statement(`
    INSERT INTO attribute_ratings
      (id, subject_id, attribute_id, value, actor_id, session_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, subject_id, attribute_id) DO UPDATE SET
      value = excluded.value,
      actor_id = excluded.actor_id,
      updated_at = excluded.updated_at
  `).bind(createId('attribute-rating'), subjectId, attributeId, value, actorId, sessionId, timestamp, timestamp).run();
};

export const saveAttributeComparison = async (
  db: Database,
  subjectAId: string,
  subjectBId: string,
  attributeId: string,
  result: AttributeComparisonResult,
  sessionId: string,
  actorId: string | null,
  timestamp: number,
) => {
  if (subjectAId === subjectBId) throw new Error('attribute_subjects_must_differ');
  await assertSubjectAndAttribute(db, subjectAId, attributeId);
  await assertSubjectAndAttribute(db, subjectBId, attributeId);
  const canonical = canonicalizeComparison(subjectAId, subjectBId, result);
  await db.statement(`
    INSERT INTO attribute_comparisons
      (id, attribute_id, subject_a_id, subject_b_id, result, actor_id, session_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id, attribute_id, subject_a_id, subject_b_id) DO UPDATE SET
      result = excluded.result,
      actor_id = excluded.actor_id,
      updated_at = excluded.updated_at
  `).bind(createId('attribute-comparison'), attributeId, canonical.subjectAId, canonical.subjectBId, canonical.result, actorId, sessionId, timestamp, timestamp).run();
};
