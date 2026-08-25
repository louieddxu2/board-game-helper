-- Extreme examples are derived from the current score states at question
-- time. Retire the earlier hand-entered display values so the database has a
-- single source of truth for this UI.
UPDATE attribute_translations
SET min_example = NULL,
    max_example = NULL
WHERE min_example IS NOT NULL OR max_example IS NOT NULL;

-- The question endpoint orders a fixed-size slice by the materialized score.
CREATE INDEX IF NOT EXISTS idx_attribute_score_states_attribute_score
  ON attribute_score_states(attribute_id, score, subject_id);

-- Keep the current catalog snapshot aligned until the next scheduled rebuild.
UPDATE attribute_catalog_snapshot_state
SET attributes_json = (
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
)
WHERE id = 1;

PRAGMA optimize;
