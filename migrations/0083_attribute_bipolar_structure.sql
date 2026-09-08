-- Stage 1 only: keep all existing attributes and scores unchanged.
ALTER TABLE attributes ADD COLUMN scale_type TEXT NOT NULL DEFAULT 'unipolar'
  CHECK (scale_type IN ('unipolar', 'bipolar'));
ALTER TABLE attribute_translations ADD COLUMN endpoints_json TEXT
  CHECK (endpoints_json IS NULL OR (json_valid(endpoints_json) AND json_type(endpoints_json) = 'object'));

DROP TRIGGER IF EXISTS attributes_catalog_after_insert;
CREATE TRIGGER attributes_catalog_after_insert
AFTER INSERT ON attributes
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT
    'attribute:' || a.id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN a.is_active = 1 AND t.name IS NOT NULL THEN json_object(
      'kind', 'attribute',
      'attribute', json_object(
        'id', a.id,
        'key', a.key,
        'scaleType', a.scale_type,
        'name', t.name,
        'shortDescription', t.short_description,
        'fullDescription', t.full_description,
        'endpoints', json(t.endpoints_json),
        'minExample', t.min_example,
        'maxExample', t.max_example,
        'minValue', a.min_value,
        'maxValue', a.max_value,
        'sortOrder', a.sort_order
      )
    ) ELSE NULL END,
    CASE WHEN a.is_active = 1 AND t.name IS NOT NULL THEN 0 ELSE 1 END,
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  FROM attributes a
  LEFT JOIN attribute_translations t ON t.attribute_id = a.id AND t.locale = 'zh-TW'
  WHERE a.id = NEW.id
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

DROP TRIGGER IF EXISTS attributes_catalog_after_update;
CREATE TRIGGER attributes_catalog_after_update
AFTER UPDATE OF key, category, min_value, max_value, is_active, sort_order, scale_type ON attributes
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT
    'attribute:' || a.id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN a.is_active = 1 AND t.name IS NOT NULL THEN json_object(
      'kind', 'attribute',
      'attribute', json_object(
        'id', a.id,
        'key', a.key,
        'scaleType', a.scale_type,
        'name', t.name,
        'shortDescription', t.short_description,
        'fullDescription', t.full_description,
        'endpoints', json(t.endpoints_json),
        'minExample', t.min_example,
        'maxExample', t.max_example,
        'minValue', a.min_value,
        'maxValue', a.max_value,
        'sortOrder', a.sort_order
      )
    ) ELSE NULL END,
    CASE WHEN a.is_active = 1 AND t.name IS NOT NULL THEN 0 ELSE 1 END,
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  FROM attributes a
  LEFT JOIN attribute_translations t ON t.attribute_id = a.id AND t.locale = 'zh-TW'
  WHERE a.id = NEW.id
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

DROP TRIGGER IF EXISTS attribute_translations_catalog_after_insert;
CREATE TRIGGER attribute_translations_catalog_after_insert
AFTER INSERT ON attribute_translations
WHEN NEW.locale = 'zh-TW'
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT
    'attribute:' || a.id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN a.is_active = 1 THEN json_object(
      'kind', 'attribute',
      'attribute', json_object(
        'id', a.id,
        'key', a.key,
        'scaleType', a.scale_type,
        'name', NEW.name,
        'shortDescription', NEW.short_description,
        'fullDescription', NEW.full_description,
        'endpoints', json(NEW.endpoints_json),
        'minExample', NEW.min_example,
        'maxExample', NEW.max_example,
        'minValue', a.min_value,
        'maxValue', a.max_value,
        'sortOrder', a.sort_order
      )
    ) ELSE NULL END,
    CASE WHEN a.is_active = 1 THEN 0 ELSE 1 END,
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  FROM attributes a
  WHERE a.id = NEW.attribute_id
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

DROP TRIGGER IF EXISTS attribute_translations_catalog_after_update;
CREATE TRIGGER attribute_translations_catalog_after_update
AFTER UPDATE OF attribute_id, locale, name, short_description, full_description, min_example, max_example, endpoints_json ON attribute_translations
WHEN OLD.locale = 'zh-TW' OR NEW.locale = 'zh-TW'
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT
    'attribute:' || a.id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN a.is_active = 1 AND t.name IS NOT NULL THEN json_object(
      'kind', 'attribute',
      'attribute', json_object(
        'id', a.id,
        'key', a.key,
        'scaleType', a.scale_type,
        'name', t.name,
        'shortDescription', t.short_description,
        'fullDescription', t.full_description,
        'endpoints', json(t.endpoints_json),
        'minExample', t.min_example,
        'maxExample', t.max_example,
        'minValue', a.min_value,
        'maxValue', a.max_value,
        'sortOrder', a.sort_order
      )
    ) ELSE NULL END,
    CASE WHEN a.is_active = 1 AND t.name IS NOT NULL THEN 0 ELSE 1 END,
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  FROM attributes a
  LEFT JOIN attribute_translations t ON t.attribute_id = a.id AND t.locale = 'zh-TW'
  WHERE a.id = CASE WHEN NEW.locale = 'zh-TW' THEN NEW.attribute_id ELSE OLD.attribute_id END
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

-- Refresh the attribute definition embedded in the current weekly snapshot.
-- Subject/value chunks remain untouched; the next normal rebuild can replace
-- the complete snapshot as usual.
UPDATE attribute_catalog_snapshot_state
SET attributes_json = (
  SELECT json_group_array(json(attribute_json))
  FROM (
    SELECT json_object(
      'id', a.id,
      'key', a.key,
        'scaleType', a.scale_type,
      'name', t.name,
      'shortDescription', t.short_description,
      'fullDescription', t.full_description,
        'endpoints', json(t.endpoints_json),
      'minExample', t.min_example,
      'maxExample', t.max_example,
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
