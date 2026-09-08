-- One-time conversion of the two legacy win attributes into one bipolar
-- attribute. The old append-only rows remain archival, but the runtime
-- matrix, candidates, catalog, and question selector use only the new field.

CREATE TABLE migration_0088_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
);
INSERT INTO migration_0088_guard (valid)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM attributes WHERE id IN ('attribute_score_race', 'attribute_end_condition')) = 2
  AND NOT EXISTS (SELECT 1 FROM attributes WHERE id = 'attribute_win_method')
  THEN 1 ELSE 0 END;
DROP TABLE migration_0088_guard;

CREATE TABLE migration_0088_win_merge_values (
  subject_id TEXT PRIMARY KEY,
  score_race REAL,
  end_condition REAL,
  merged_score REAL
);

INSERT INTO migration_0088_win_merge_values (subject_id, score_race, end_condition, merged_score)
WITH source_values AS (
  SELECT subject_id,
    MAX(CASE WHEN attribute_id = 'attribute_score_race' AND evidence_count > 0 THEN score END) AS score_race,
    MAX(CASE WHEN attribute_id = 'attribute_end_condition' AND evidence_count > 0 THEN score END) AS end_condition
  FROM attribute_score_states
  WHERE attribute_id IN ('attribute_score_race', 'attribute_end_condition')
  GROUP BY subject_id
), corrected AS (
  SELECT subject_id,
    CASE subject_id
      WHEN 'attribute_subject_game:game_attribute_import_the_mind' THEN 1
      WHEN 'attribute_config_7th_continent_what_goes_up' THEN 0
      WHEN 'attribute_subject_game:game_attribute_import_and_then_we_held_hands' THEN 2
      WHEN 'attribute_subject_game:game_attribute_import_fog_of_love' THEN 0
      WHEN 'attribute_subject_game:game_attribute_import_hanabi' THEN 8
      ELSE score_race
    END AS score_race,
    CASE subject_id
      WHEN 'attribute_subject_game:game_attribute_import_the_mind' THEN 9
      WHEN 'attribute_config_7th_continent_what_goes_up' THEN 10
      WHEN 'attribute_subject_game:game_attribute_import_and_then_we_held_hands' THEN 8
      WHEN 'attribute_subject_game:game_attribute_import_fog_of_love' THEN 10
      WHEN 'attribute_subject_game:game_attribute_import_hanabi' THEN 2
      ELSE end_condition
    END AS end_condition
  FROM source_values
  UNION ALL
  SELECT correction.subject_id, correction.score_race, correction.end_condition
  FROM (
    SELECT 'attribute_subject_game:game_attribute_import_the_mind' AS subject_id, 1.0 AS score_race, 9.0 AS end_condition
    UNION ALL SELECT 'attribute_config_7th_continent_what_goes_up', 0.0, 10.0
    UNION ALL SELECT 'attribute_subject_game:game_attribute_import_and_then_we_held_hands', 2.0, 8.0
    UNION ALL SELECT 'attribute_subject_game:game_attribute_import_fog_of_love', 0.0, 10.0
    UNION ALL SELECT 'attribute_subject_game:game_attribute_import_hanabi', 8.0, 2.0
  ) correction
  WHERE NOT EXISTS (SELECT 1 FROM source_values existing WHERE existing.subject_id = correction.subject_id)
), merged AS (
  SELECT subject_id, MAX(score_race) AS score_race, MAX(end_condition) AS end_condition
  FROM corrected
  GROUP BY subject_id
)
SELECT subject_id, score_race, end_condition,
  CASE
    WHEN score_race IS NULL THEN end_condition
    WHEN end_condition IS NULL THEN 10 - score_race
    ELSE ((10 - score_race) + end_condition) / 2.0
  END AS merged_score
FROM merged
WHERE score_race IS NOT NULL OR end_condition IS NOT NULL;

INSERT INTO attributes
  (id, key, category, min_value, max_value, is_active, sort_order, scale_type)
VALUES
  ('attribute_win_method', 'win_method', NULL, 0, 10, 1, 12, 'bipolar');

INSERT INTO attribute_translations
  (attribute_id, locale, name, short_description, full_description, endpoints_json)
VALUES (
  'attribute_win_method', 'zh-TW', '取勝方式', NULL,
  '遊戲較偏向透過累積分數取勝，或透過特定條件達成取勝。',
  json_object(
    'low', json_object(
      'label', '得分取勝',
      'question', '哪款遊戲比較偏向得分取勝？',
      'fullDescription', '需要在遊戲過程中不斷不斷地增加分數，以至於最後總分最高取勝。'
    ),
    'high', json_object(
      'label', '條件取勝',
      'question', '哪款遊戲比較偏向條件取勝？',
      'fullDescription', '遊戲有多容易在一個情況發生時突如其然地結束。玩家有多容易在觀察到特定情況時可以直接體面退出遊戲。'
    )
  )
);

-- A candidate row uses the attribute sort order as its positional array. The
-- two source positions (12 and 13) become one merged position (12).
UPDATE attribute_import_candidates
SET values_json = json_set(
  json_remove(values_json, '$[13]'),
  '$[12]',
  CASE
    WHEN json_extract(values_json, '$[12]') IS NULL THEN json_extract(values_json, '$[13]')
    WHEN json_extract(values_json, '$[13]') IS NULL THEN 10 - json_extract(values_json, '$[12]')
    ELSE ((10 - json_extract(values_json, '$[12]')) + json_extract(values_json, '$[13]')) / 2.0
  END
),
updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE json_valid(values_json)
  AND json_type(values_json) = 'array';

-- Materialized merged values become ordinary data in the new attribute. A
-- converted aggregate is represented by one direct datum, while the next
-- real vote continues through the normal Glicko update path.
INSERT INTO attribute_score_states
  (subject_id, attribute_id, score, direct_sum, direct_count,
   comparison_count, decisive_comparison_count, evidence_count,
   model_version, updated_at, rating_deviation, random_key, question_slot)
SELECT subject_id, 'attribute_win_method', merged_score, merged_score, 1,
  0, 0, 1, 'glicko-rd-v1',
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
  3, lower(hex(randomblob(16))), (abs(random()) % 200) + 1
FROM migration_0088_win_merge_values
WHERE merged_score IS NOT NULL
ON CONFLICT(subject_id, attribute_id) DO UPDATE SET
  score = excluded.score,
  direct_sum = excluded.direct_sum,
  direct_count = excluded.direct_count,
  comparison_count = excluded.comparison_count,
  decisive_comparison_count = excluded.decisive_comparison_count,
  evidence_count = excluded.evidence_count,
  model_version = excluded.model_version,
  updated_at = excluded.updated_at,
  rating_deviation = excluded.rating_deviation,
  random_key = excluded.random_key,
  question_slot = excluded.question_slot;

-- Old materialized states and pair counts must not reappear in the public
-- matrix or in a future game-merge rebuild.
DELETE FROM attribute_pair_stats
WHERE attribute_id IN ('attribute_score_race', 'attribute_end_condition');
DELETE FROM attribute_score_states
WHERE attribute_id IN ('attribute_score_race', 'attribute_end_condition');

UPDATE attributes
SET is_active = 0
WHERE id IN ('attribute_score_race', 'attribute_end_condition');

-- The feed is a derived presentation cache; rebuild it from future bipolar
-- answers instead of showing stale legacy names and directions.
DELETE FROM attribute_activity_feed;

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
            'directAverage', CASE WHEN state.direct_count > 0 THEN state.direct_sum / state.direct_count ELSE NULL END,
            'directCount', state.direct_count,
            'comparisonCount', state.comparison_count,
            'decisiveComparisonCount', state.decisive_comparison_count,
            'evidenceCount', state.evidence_count,
            'modelVersion', state.model_version
          ) AS value_json
          FROM attribute_score_states state
          JOIN attributes active_attribute ON active_attribute.id = state.attribute_id AND active_attribute.is_active = 1
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
SELECT 88, chunk_number, entries_json
FROM grouped;

INSERT INTO attribute_catalog_snapshot_chunks (generation, chunk_number, entries_json)
SELECT 88, 0, '[]'
WHERE NOT EXISTS (
  SELECT 1 FROM attribute_catalog_snapshot_chunks WHERE generation = 88
);

INSERT INTO attribute_catalog_snapshot_state
  (id, active_generation, through_version, chunk_count, attributes_json, score_model_version, generated_at)
SELECT
  1,
  88,
  (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
  COUNT(*),
  (
    SELECT json_group_array(json(attribute_json))
    FROM (
      SELECT json_object(
        'id', attribute.id,
        'key', attribute.key,
        'scaleType', attribute.scale_type,
        'name', translation.name,
        'shortDescription', translation.short_description,
        'fullDescription', translation.full_description,
        'endpoints', json(translation.endpoints_json),
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
WHERE generation = 88;

DROP TABLE migration_0088_win_merge_values;

PRAGMA optimize;
