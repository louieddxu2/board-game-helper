-- Seed the first attribute-table snapshot during migration, so the first
-- public request never has to scan the complete score matrix.
-- The derived catalog may already contain partial deltas if an earlier build
-- was deployed between migrations 0049 and 0051. Replace that derived data
-- with one complete baseline; vote events and materialized score states remain
-- the source of truth.
DELETE FROM attribute_catalog_snapshot_chunks;
DELETE FROM attribute_catalog_snapshot_state;
DELETE FROM attribute_catalog_entries;
UPDATE attribute_catalog_clock SET current_version = 0 WHERE id = 1;

WITH source_entries AS (
  SELECT
    'subject:' || s.id AS entry_key,
    json_object(
      'kind', 'subject',
      'subject', json_object(
        'id', s.id,
        'slug', s.slug,
        'kind', s.kind,
        'displayName', s.display_name,
        'gameId', s.game_id,
        'gameSlug', g.slug,
        'components', json(COALESCE((
          SELECT json_group_array(json(component_json))
          FROM (
            SELECT json_object(
              'order', c.component_order,
              'gameId', c.game_id,
              'type', c.component_type,
              'label', c.label
            ) AS component_json
            FROM attribute_subject_components c
            WHERE c.subject_id = s.id
            ORDER BY c.component_order
          )
        ), '[]'))
      ),
      'values', json(COALESCE((
        SELECT json_group_array(json(value_json))
        FROM (
          SELECT json_object(
            'subjectId', st.subject_id,
            'attributeId', st.attribute_id,
            'score', st.score,
            'ratingDeviation', st.rating_deviation,
            'directAverage', CASE WHEN st.direct_count > 0 THEN st.direct_sum / st.direct_count ELSE NULL END,
            'directCount', st.direct_count,
            'comparisonCount', st.comparison_count,
            'decisiveComparisonCount', st.decisive_comparison_count,
            'evidenceCount', st.evidence_count,
            'modelVersion', st.model_version
          ) AS value_json
          FROM attribute_score_states st
          WHERE st.subject_id = s.id
          ORDER BY st.attribute_id
        )
      ), '[]'))
    ) AS entry_json,
    0 AS deleted,
    s.updated_at
  FROM attribute_subjects s
  LEFT JOIN games g ON g.id = s.game_id
  WHERE s.kind = 'configuration'
    OR (g.merged_into_game_id IS NULL AND g.visibility = 'public' AND g.published_rule_count > 0)

  UNION ALL

  SELECT
    'candidate:' || c.id,
    json_object(
      'kind', 'candidate',
      'id', c.id,
      'displayName', c.source_name,
      'valuesJson', c.values_json,
      'matchStatus', c.match_status,
      'subjectId', c.subject_id,
      'sourceRowNumber', c.source_row_number
    ),
    0,
    c.updated_at
  FROM attribute_import_candidates c
  WHERE c.match_status IN ('pending', 'ambiguous')
), numbered AS (
  SELECT entry_key, entry_json, deleted, updated_at,
    ROW_NUMBER() OVER (ORDER BY entry_key) AS catalog_version
  FROM source_entries
)
INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
SELECT entry_key, catalog_version, entry_json, deleted, updated_at
FROM numbered;

UPDATE attribute_catalog_clock
SET current_version = COALESCE((SELECT MAX(catalog_version) FROM attribute_catalog_entries), 0)
WHERE id = 1;

WITH ordered AS (
  SELECT entry_json,
    -- A subject entry contains the complete attribute row. Keep the initial
    -- SQL-only chunks conservative; the background TypeScript builder also
    -- enforces the 1 MB byte limit.
    CAST((ROW_NUMBER() OVER (ORDER BY entry_key) - 1) / 100 AS INTEGER) AS chunk_number
  FROM attribute_catalog_entries
  WHERE deleted = 0 AND entry_json IS NOT NULL
), grouped AS (
  SELECT chunk_number, json_group_array(json(entry_json)) AS entries_json
  FROM ordered
  GROUP BY chunk_number
)
INSERT INTO attribute_catalog_snapshot_chunks (generation, chunk_number, entries_json)
SELECT 1, chunk_number, entries_json FROM grouped;

INSERT INTO attribute_catalog_snapshot_chunks (generation, chunk_number, entries_json)
SELECT 1, 0, '[]'
WHERE NOT EXISTS (SELECT 1 FROM attribute_catalog_snapshot_chunks WHERE generation = 1);

INSERT INTO attribute_catalog_snapshot_state
  (id, active_generation, through_version, chunk_count, attributes_json, score_model_version, generated_at)
SELECT 1, 1,
  (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
  COUNT(*),
  (
    SELECT json_group_array(json(attribute_json))
    FROM (
      SELECT json_object(
        'id', a.id,
        'key', a.key,
        'name', t.name,
        'shortDescription', t.short_description,
        'fullDescription', t.full_description,
        'minValue', a.min_value,
        'maxValue', a.max_value,
        'sortOrder', a.sort_order
      ) AS attribute_json
      FROM attributes a
      JOIN attribute_translations t ON t.attribute_id = a.id AND t.locale = 'zh-TW'
      WHERE a.is_active = 1
      ORDER BY a.sort_order, a.id
    )
  ),
  'glicko-rd-v1',
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM attribute_catalog_snapshot_chunks
WHERE generation = 1;

PRAGMA optimize;
