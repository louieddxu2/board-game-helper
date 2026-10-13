import { parseAttributeScale } from '../../src/shared/attributeScale';
import type {
  AttributeActivity,
  AttributeComparisonResult,
  AttributeDefinition,
  AttributeImportCandidate,
  AttributeMatrixValue,
  AttributeSubject,
  AttributeSubjectComponent
} from '../../src/shared/types';

export const ATTRIBUTE_QUESTION_SLOT_COUNT = 200;

export const ATTRIBUTE_ACTIVITY_FEED_LIMIT = 5;

export const ATTRIBUTE_TABLE_PAGE_SIZE = 50;

export const ATTRIBUTE_RESPONSE_MAX_READ_ROWS = 40;

export const ATTRIBUTE_RESPONSE_MAX_WRITE_ROWS = 30;

export const ATTRIBUTE_RESPONSE_LOCK_PREFIX = 'attribute-vote';

export const ATTRIBUTE_RESPONSE_LOCK_TTL_MS = 15_000;

export const ATTRIBUTE_REPLAY_LOCK_NAME = 'attribute-replay';

export const ATTRIBUTE_REPLAY_LOCK_TTL_MS = 2 * 60_000;

export const ATTRIBUTE_MERGE_OPERATION_LOCK_NAME = `${ATTRIBUTE_RESPONSE_LOCK_PREFIX}:merge-operation`;

export const ATTRIBUTE_REBUILD_STATE_ROWS_PER_STATEMENT = 9;

export const ATTRIBUTE_REBUILD_STATEMENTS_PER_BATCH = 50;

export const D1_SAFE_BOUND_PARAMETER_COUNT = 99;

export const chunk = <T>(values: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
};

export interface AttributeRow {
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

export interface SubjectRow {
  id: string;
  slug: string;
  kind: 'game' | 'configuration';
  display_name: string;
  game_id: string | null;
  game_slug: string | null;
  secondary_name: string | null;
  bgg_ids_json: string | null;
}

export interface ComponentRow {
  subject_id: string;
  component_order: number;
  game_id: string | null;
  component_type: AttributeSubjectComponent['type'];
  label: string;
  english_name: string | null;
  bgg_id: number | null;
}

export interface FullReplaySubjectSourceRow {
  id: string;
  slug: string;
  kind: 'game' | 'configuration';
  display_name: string;
  game_id: string | null;
}

export interface FullReplayGameSourceRow {
  id: string;
  slug: string;
  display_name: string;
  english_name: string | null;
  bgg_id: number | null;
  entity_kind: string;
  merged_into_game_id: string | null;
  visibility: string;
}

export interface FullReplayGameAliasRow {
  game_id: string;
  alias: string;
}

export interface FullReplayExternalIdRow {
  game_id: string;
  external_id: string;
}

export interface AttributeScoreStateRow {
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

export interface CandidateRow {
  id: string;
  source_name: string;
  values_json: string;
  match_status: AttributeImportCandidate['matchStatus'];
  subject_id: string | null;
  source_row_number: number;
}

export interface ActivityFeedRow {
  id: string;
  payload_json: string;
}

export const votableSubjectCondition = (subjectAlias: string, gameAlias: string) => `(
  (
    ${subjectAlias}.kind = 'game'
    AND ${gameAlias}.entity_kind = 'base'
    AND ${gameAlias}.merged_into_game_id IS NULL
    AND ${gameAlias}.visibility = 'public'
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

export const subjectSecondaryNameExpression = (subjectAlias: string, gameAlias: string) => {
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

export interface ResponseContextAndStateRow extends ResponseContextRow {
  state_a_subject_id: string | null;
  state_a_score: number | null;
  state_a_rating_deviation: number | null;
  state_a_direct_sum: number | null;
  state_a_direct_count: number | null;
  state_a_comparison_count: number | null;
  state_a_decisive_comparison_count: number | null;
  state_a_evidence_count: number | null;
  state_a_updated_at?: number | null;
  state_b_subject_id: string | null;
  state_b_score: number | null;
  state_b_rating_deviation: number | null;
  state_b_direct_sum: number | null;
  state_b_direct_count: number | null;
  state_b_comparison_count: number | null;
  state_b_decisive_comparison_count: number | null;
  state_b_evidence_count: number | null;
  state_b_updated_at?: number | null;
}

export interface SubjectPageOptions {
  cursor?: string;
  limit?: number;
}

export interface CandidatePageOptions {
  cursor?: string;
  limit?: number;
}

export interface AttributeTableQueryOptions {
  subjectCursor?: string;
  candidateCursor?: string;
  limit?: number;
  scope?: 'subjects' | 'candidates';
}

export interface AttributeResponseInput {
  highPole?: 'low' | 'high';
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

export interface AttributeMergeLock {
  token: string;
  names: string[];
  sourceSubjectId: string | null;
  targetSubjectId: string | null;
}

export const toAttribute = (row: AttributeRow): AttributeDefinition => ({
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

export const toSubject = (row: SubjectRow, components: Map<string, AttributeSubjectComponent[]>): AttributeSubject => {
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

export const toComponent = (row: ComponentRow): AttributeSubjectComponent => ({
  order: row.component_order,
  gameId: row.game_id ?? undefined,
  type: row.component_type,
  label: row.label,
  ...(row.english_name ? { englishName: row.english_name } : {}),
  bggId: row.bgg_id ?? undefined,
});

export const clampPageSize = (limit: number | undefined) => Math.min(ATTRIBUTE_TABLE_PAGE_SIZE, Math.max(1, Math.floor(limit ?? ATTRIBUTE_TABLE_PAGE_SIZE)));

export const encodeCursor = (...parts: string[]) => btoa(unescape(encodeURIComponent(parts.join('\u0000'))));

export const decodeCursor = (cursor: string | undefined): string[] | undefined => {
  if (!cursor) return undefined;
  try {
    const decoded = decodeURIComponent(escape(atob(cursor)));
    return decoded.split('\u0000');
  } catch {
    return undefined;
  }
};
