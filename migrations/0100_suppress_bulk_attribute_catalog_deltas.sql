-- Suppress per-row attribute catalog deltas during a bulk rebuild.
-- The caller builds one complete snapshot after its source rows are committed.

DROP TRIGGER IF EXISTS attribute_subjects_catalog_after_insert;
CREATE TRIGGER attribute_subjects_catalog_after_insert
AFTER INSERT ON attribute_subjects
WHEN NOT EXISTS (SELECT 1 FROM attribute_catalog_rebuild_mode WHERE id = 1)
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT 'subject:' || source.subject_id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN source.is_eligible THEN source.entry_json ELSE NULL END,
    CASE WHEN source.is_eligible THEN 0 ELSE 1 END,
    source.updated_at
  FROM attribute_subject_catalog_source source
  WHERE source.subject_id = NEW.id
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
DROP TRIGGER IF EXISTS attribute_subjects_catalog_after_update;
CREATE TRIGGER attribute_subjects_catalog_after_update
AFTER UPDATE OF slug, kind, display_name, game_id, updated_at ON attribute_subjects
WHEN NOT EXISTS (SELECT 1 FROM attribute_catalog_rebuild_mode WHERE id = 1)
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT 'subject:' || source.subject_id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN source.is_eligible THEN source.entry_json ELSE NULL END,
    CASE WHEN source.is_eligible THEN 0 ELSE 1 END,
    source.updated_at
  FROM attribute_subject_catalog_source source
  WHERE source.subject_id = NEW.id
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
DROP TRIGGER IF EXISTS attribute_games_catalog_after_update;
CREATE TRIGGER attribute_games_catalog_after_update
AFTER UPDATE OF slug, display_name, english_name, bgg_id, entity_kind,
  merged_into_game_id, visibility, published_rule_count, attribute_enabled ON games
WHEN NOT EXISTS (SELECT 1 FROM attribute_catalog_rebuild_mode WHERE id = 1)
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT 'subject:' || source.subject_id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN source.is_eligible THEN source.entry_json ELSE NULL END,
    CASE WHEN source.is_eligible THEN 0 ELSE 1 END,
    source.updated_at
  FROM attribute_subject_catalog_source source
  JOIN attribute_subjects subject ON subject.id = source.subject_id
  WHERE subject.game_id = NEW.id AND subject.kind = 'game'
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
DROP TRIGGER IF EXISTS game_external_ids_catalog_after_insert;
CREATE TRIGGER game_external_ids_catalog_after_insert
AFTER INSERT ON game_external_ids
WHEN NEW.source = 'bgg'
  AND EXISTS (
    SELECT 1 FROM attribute_subjects
    WHERE id = 'attribute_subject_game:' || NEW.game_id
  )
  AND NOT EXISTS (SELECT 1 FROM attribute_catalog_rebuild_mode WHERE id = 1)
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT 'subject:' || source.subject_id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN source.is_eligible THEN source.entry_json ELSE NULL END,
    CASE WHEN source.is_eligible THEN 0 ELSE 1 END,
    source.updated_at
  FROM attribute_subject_catalog_source source
  WHERE source.subject_id = 'attribute_subject_game:' || NEW.game_id
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
DROP TRIGGER IF EXISTS game_external_ids_catalog_after_delete;
CREATE TRIGGER game_external_ids_catalog_after_delete
AFTER DELETE ON game_external_ids
WHEN OLD.source = 'bgg'
  AND EXISTS (
    SELECT 1 FROM attribute_subjects
    WHERE id = 'attribute_subject_game:' || OLD.game_id
  )
  AND NOT EXISTS (SELECT 1 FROM attribute_catalog_rebuild_mode WHERE id = 1)
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT 'subject:' || source.subject_id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN source.is_eligible THEN source.entry_json ELSE NULL END,
    CASE WHEN source.is_eligible THEN 0 ELSE 1 END,
    source.updated_at
  FROM attribute_subject_catalog_source source
  WHERE source.subject_id = 'attribute_subject_game:' || OLD.game_id
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

PRAGMA optimize;
