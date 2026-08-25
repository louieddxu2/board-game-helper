-- Repair incremental synchronization semantics without changing the source
-- tables.  The catalog is derived data; vote events and materialized states
-- remain authoritative.

-- A candidate leaves the public "unprocessed" table when it becomes matched
-- or skipped. Represent that transition as a deletion in the delta stream.
DROP TRIGGER attribute_candidates_catalog_after_insert;
CREATE TRIGGER attribute_candidates_catalog_after_insert
AFTER INSERT ON attribute_import_candidates
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  VALUES (
    'candidate:' || NEW.id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN NEW.match_status IN ('pending', 'ambiguous') THEN json_object(
      'kind', 'candidate',
      'id', NEW.id,
      'displayName', NEW.source_name,
      'valuesJson', NEW.values_json,
      'matchStatus', NEW.match_status,
      'subjectId', NEW.subject_id,
      'sourceRowNumber', NEW.source_row_number
    ) ELSE NULL END,
    CASE WHEN NEW.match_status IN ('pending', 'ambiguous') THEN 0 ELSE 1 END,
    NEW.updated_at
  )
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

DROP TRIGGER attribute_candidates_catalog_after_update;
CREATE TRIGGER attribute_candidates_catalog_after_update
AFTER UPDATE OF source_name, values_json, match_status, subject_id, source_row_number, updated_at
  ON attribute_import_candidates
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  VALUES (
    'candidate:' || NEW.id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN NEW.match_status IN ('pending', 'ambiguous') THEN json_object(
      'kind', 'candidate',
      'id', NEW.id,
      'displayName', NEW.source_name,
      'valuesJson', NEW.values_json,
      'matchStatus', NEW.match_status,
      'subjectId', NEW.subject_id,
      'sourceRowNumber', NEW.source_row_number
    ) ELSE NULL END,
    CASE WHEN NEW.match_status IN ('pending', 'ambiguous') THEN 0 ELSE 1 END,
    NEW.updated_at
  )
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

-- ON DELETE SET NULL changes a game subject's game_id.  Such a subject must
-- disappear from the public attribute table, not become a game with no link.
DROP TRIGGER attribute_subjects_catalog_after_update;
CREATE TRIGGER attribute_subjects_catalog_after_update
AFTER UPDATE OF slug, kind, display_name, game_id, updated_at ON attribute_subjects
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT
    'subject:' || NEW.id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN NEW.kind = 'game' AND NEW.game_id IS NULL THEN NULL ELSE json_object(
      'kind', 'subject',
      'subject', json_object(
        'id', NEW.id,
        'slug', NEW.slug,
        'kind', NEW.kind,
        'displayName', NEW.display_name,
        'gameId', NEW.game_id,
        'gameSlug', g.slug
      )
    ) END,
    CASE WHEN NEW.kind = 'game' AND NEW.game_id IS NULL THEN 1 ELSE 0 END,
    NEW.updated_at
  FROM attribute_subjects s
  LEFT JOIN games g ON g.id = s.game_id
  WHERE s.id = NEW.id
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER attribute_games_catalog_after_delete
AFTER DELETE ON games
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  VALUES (
    'subject:attribute_subject_game:' || OLD.id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    NULL,
    1,
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  )
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = NULL,
    deleted = 1,
    updated_at = excluded.updated_at;
END;

-- Attribute names/descriptions and active state are also part of the table
-- payload. Keep them in the same bounded delta stream instead of waiting for
-- the weekly snapshot.
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
        'name', t.name,
        'shortDescription', t.short_description,
        'fullDescription', t.full_description,
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

CREATE TRIGGER attributes_catalog_after_update
AFTER UPDATE OF key, category, min_value, max_value, is_active, sort_order ON attributes
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
        'name', t.name,
        'shortDescription', t.short_description,
        'fullDescription', t.full_description,
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

CREATE TRIGGER attributes_catalog_after_delete
AFTER DELETE ON attributes
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  VALUES (
    'attribute:' || OLD.id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    NULL,
    1,
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  )
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = NULL,
    deleted = 1,
    updated_at = excluded.updated_at;
END;

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
        'name', NEW.name,
        'shortDescription', NEW.short_description,
        'fullDescription', NEW.full_description,
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

CREATE TRIGGER attribute_translations_catalog_after_update
AFTER UPDATE OF attribute_id, locale, name, short_description, full_description ON attribute_translations
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
        'name', t.name,
        'shortDescription', t.short_description,
        'fullDescription', t.full_description,
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

CREATE TRIGGER attribute_translations_catalog_after_delete
AFTER DELETE ON attribute_translations
WHEN OLD.locale = 'zh-TW'
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  VALUES (
    'attribute:' || OLD.attribute_id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    NULL,
    1,
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  )
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = NULL,
    deleted = 1,
    updated_at = excluded.updated_at;
END;

PRAGMA optimize;
