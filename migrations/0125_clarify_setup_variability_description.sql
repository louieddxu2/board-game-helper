UPDATE attribute_translations
SET full_description = '在遊戲第一輪開始前會影響整場遊戲的隨機設置的變化性'
WHERE attribute_id = 'attribute_setup_variability' AND locale = 'zh-TW';

-- Publish the definition immediately so cached clients receive the new wording.
INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
SELECT 'attribute:' || attribute.id, clock.current_version + 1,
  json_object('kind', 'attribute', 'attribute', json_object(
    'id', attribute.id, 'key', attribute.key, 'name', translation.name,
    'shortDescription', translation.short_description,
    'fullDescription', translation.full_description,
    'scaleType', attribute.scale_type, 'endpoints', json(translation.endpoints_json),
    'minExample', translation.min_example, 'maxExample', translation.max_example,
    'minValue', attribute.min_value, 'maxValue', attribute.max_value,
    'sortOrder', attribute.sort_order
  )), 0, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM attributes attribute
JOIN attribute_translations translation ON translation.attribute_id = attribute.id AND translation.locale = 'zh-TW'
JOIN attribute_catalog_clock clock ON clock.id = 1
WHERE attribute.id = 'attribute_setup_variability' AND attribute.is_active = 1
ON CONFLICT(entry_key) DO UPDATE SET
  catalog_version = excluded.catalog_version,
  entry_json = excluded.entry_json,
  deleted = excluded.deleted,
  updated_at = excluded.updated_at;

UPDATE attribute_catalog_clock
SET current_version = current_version + changes()
WHERE id = 1;
