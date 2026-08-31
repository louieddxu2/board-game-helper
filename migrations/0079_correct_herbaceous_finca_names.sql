-- Correct two pre-existing Chinese names that were assigned to the wrong
-- canonical BGG game rows. These are separate games, not edition mappings.
-- Move the old names away before assigning them to the intended games so the
-- normalized-name uniqueness constraint remains valid throughout the migration.

UPDATE games
SET display_name = '香草花園',
    normalized_name = '香草花園',
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE id = 'game_attribute_import_herbaceous'
  AND bgg_id = 195314;

UPDATE games
SET display_name = 'Juicy Fruits',
    normalized_name = 'juicyfruits',
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE id = 'game_attribute_import_juicy_fruits'
  AND bgg_id = 325698;

UPDATE games
SET english_name = COALESCE(NULLIF(TRIM(english_name), ''), display_name),
    display_name = '本草',
    normalized_name = '本草',
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE id = 'game_bgg_231554'
  AND bgg_id = 231554;

UPDATE games
SET english_name = COALESCE(NULLIF(TRIM(english_name), ''), display_name),
    display_name = '水果莊園',
    normalized_name = '水果莊園',
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE id = 'game_bgg_40628'
  AND bgg_id = 40628;

-- Make the corrected names visible immediately to both compact catalog readers.
DELETE FROM game_catalog_snapshot_chunks;
DELETE FROM game_catalog_snapshot_state;

WITH ordered AS (
  SELECT entry_json,
    CAST((ROW_NUMBER() OVER (
      ORDER BY json_extract(entry_json, '$.displayName'), game_id
    ) - 1) / 1000 AS INTEGER) AS chunk_number
  FROM game_catalog_entries
  WHERE deleted = 0 AND entry_json IS NOT NULL
), grouped AS (
  SELECT chunk_number, json_group_array(json(entry_json)) AS games_json
  FROM ordered
  GROUP BY chunk_number
)
INSERT INTO game_catalog_snapshot_chunks (generation, chunk_number, games_json)
SELECT 79, chunk_number, games_json FROM grouped;

INSERT INTO game_catalog_snapshot_chunks (generation, chunk_number, games_json)
SELECT 79, 0, '[]'
WHERE NOT EXISTS (SELECT 1 FROM game_catalog_snapshot_chunks WHERE generation = 79);

INSERT INTO game_catalog_snapshot_state (id, active_generation, through_version, chunk_count, generated_at)
SELECT 1, 79,
  (SELECT current_version FROM game_catalog_clock WHERE id = 1),
  COUNT(*),
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM game_catalog_snapshot_chunks
WHERE generation = 79;

DELETE FROM attribute_catalog_snapshot_chunks;
DELETE FROM attribute_catalog_snapshot_state;

WITH source_entries AS (
  SELECT
    'subject:' || source.subject_id AS entry_key,
    json_set(
      source.entry_json,
      '$.values',
      json(COALESCE((
        SELECT json_group_array(json(value_json))
        FROM (
          SELECT json_object(
            'subjectId', state.subject_id,
            'attributeId', state.attribute_id,
            'score', state.score,
            'ratingDeviation', state.rating_deviation,
            'directAverage', CASE
              WHEN state.direct_count > 0 THEN state.direct_sum / state.direct_count
              ELSE NULL
            END,
            'directCount', state.direct_count,
            'comparisonCount', state.comparison_count,
            'decisiveComparisonCount', state.decisive_comparison_count,
            'evidenceCount', state.evidence_count,
            'modelVersion', state.model_version
          ) AS value_json
          FROM attribute_score_states state
          WHERE state.subject_id = source.subject_id
          ORDER BY state.attribute_id
        )
      ), '[]'))
    ) AS entry_json
  FROM attribute_subject_catalog_source source
  WHERE source.is_eligible = 1

  UNION ALL

  SELECT
    'candidate:' || candidate.id,
    json_object(
      'kind', 'candidate',
      'candidate', json_object(
        'id', candidate.id,
        'displayName', candidate.source_name,
        'values', json(candidate.values_json),
        'matchStatus', candidate.match_status,
        'subjectId', candidate.subject_id,
        'sourceRowNumber', candidate.source_row_number
      )
    )
  FROM attribute_import_candidates candidate
  WHERE candidate.match_status IN ('pending', 'ambiguous')
), ordered AS (
  SELECT entry_json,
    CAST((ROW_NUMBER() OVER (ORDER BY entry_key) - 1) / 100 AS INTEGER) AS chunk_number
  FROM source_entries
), grouped AS (
  SELECT chunk_number, json_group_array(json(entry_json)) AS entries_json
  FROM ordered
  GROUP BY chunk_number
)
INSERT INTO attribute_catalog_snapshot_chunks (generation, chunk_number, entries_json)
SELECT 79, chunk_number, entries_json
FROM grouped;

INSERT INTO attribute_catalog_snapshot_chunks (generation, chunk_number, entries_json)
SELECT 79, 0, '[]'
WHERE NOT EXISTS (
  SELECT 1 FROM attribute_catalog_snapshot_chunks WHERE generation = 79
);

INSERT INTO attribute_catalog_snapshot_state
  (id, active_generation, through_version, chunk_count, attributes_json, score_model_version, generated_at)
SELECT
  1,
  79,
  (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
  COUNT(*),
  (
    SELECT json_group_array(json(attribute_json))
    FROM (
      SELECT json_object(
        'id', attribute.id,
        'key', attribute.key,
        'name', translation.name,
        'shortDescription', translation.short_description,
        'fullDescription', translation.full_description,
        'minValue', attribute.min_value,
        'maxValue', attribute.max_value,
        'sortOrder', attribute.sort_order
      ) AS attribute_json
      FROM attributes attribute
      JOIN attribute_translations translation
        ON translation.attribute_id = attribute.id
        AND translation.locale = 'zh-TW'
      WHERE attribute.is_active = 1
      ORDER BY attribute.sort_order, attribute.id
    )
  ),
  'glicko-rd-v1',
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM attribute_catalog_snapshot_chunks
WHERE generation = 79;

PRAGMA optimize;
