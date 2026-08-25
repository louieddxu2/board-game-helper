-- Keep subject metadata and visibility changes in the attribute-table delta
-- stream as well as score/candidate changes.
CREATE TRIGGER attribute_subjects_catalog_after_insert
AFTER INSERT ON attribute_subjects
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT
    'subject:' || NEW.id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    json_object(
      'kind', 'subject',
      'subject', json_object(
        'id', NEW.id,
        'slug', NEW.slug,
        'kind', NEW.kind,
        'displayName', NEW.display_name,
        'gameId', NEW.game_id,
        'gameSlug', g.slug
      )
    ),
    0,
    NEW.updated_at
  FROM attribute_subjects s
  LEFT JOIN games g ON g.id = s.game_id
  WHERE s.id = NEW.id;
END;

CREATE TRIGGER attribute_subjects_catalog_after_update
AFTER UPDATE OF slug, kind, display_name, game_id, updated_at ON attribute_subjects
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT
    'subject:' || NEW.id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    json_object(
      'kind', 'subject',
      'subject', json_object(
        'id', NEW.id,
        'slug', NEW.slug,
        'kind', NEW.kind,
        'displayName', NEW.display_name,
        'gameId', NEW.game_id,
        'gameSlug', g.slug
      )
    ),
    0,
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

CREATE TRIGGER attribute_subjects_catalog_after_delete
AFTER DELETE ON attribute_subjects
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  VALUES (
    'subject:' || OLD.id,
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

-- A game can remain in attribute_subjects while becoming hidden or merged.
-- Mirror the public table filter used by querySubjectRows in the delta stream.
CREATE TRIGGER attribute_games_catalog_after_update
AFTER UPDATE OF slug, merged_into_game_id, visibility, published_rule_count ON games
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT
    'subject:' || s.id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN NEW.merged_into_game_id IS NULL
      AND NEW.visibility = 'public'
      AND NEW.published_rule_count > 0
      THEN json_object(
        'kind', 'subject',
        'subject', json_object(
          'id', s.id,
          'slug', s.slug,
          'kind', s.kind,
          'displayName', s.display_name,
          'gameId', s.game_id,
          'gameSlug', NEW.slug
        )
      )
      ELSE NULL END,
    CASE WHEN NEW.merged_into_game_id IS NULL
      AND NEW.visibility = 'public'
      AND NEW.published_rule_count > 0 THEN 0 ELSE 1 END,
    NEW.updated_at
  FROM attribute_subjects s
  WHERE s.game_id = NEW.id AND s.kind = 'game'
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

PRAGMA optimize;
