-- Keep the merged endpoint questions in the same form as the original
-- single-attribute questions. Existing production rows need this correction;
-- fresh databases receive the same wording from migration 0088.
UPDATE attribute_translations
SET endpoints_json = json_set(
  endpoints_json,
  '$.low.question', '哪款遊戲的「得分取勝」比重較高？',
  '$.high.question', '哪款遊戲的「條件取勝」比重較高？'
)
WHERE attribute_id = 'attribute_win_method'
  AND locale = 'zh-TW';

UPDATE attribute_catalog_snapshot_state
SET
  through_version = (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
  attributes_json = (
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
  generated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE id = 1;

PRAGMA optimize;
