-- The score pad syncs game names and BGG ids through game_catalog_entries
-- versions. BGG id changes must also advance the game catalog, or a new or
-- removed BGG id never reaches its incremental sync.
DROP TRIGGER IF EXISTS game_catalog_outbox_games_after_update;
CREATE TRIGGER game_catalog_outbox_games_after_update
AFTER UPDATE OF slug, display_name, english_name, merged_into_game_id, visibility,
  published_rule_count, total_rule_count, latest_rule_updated_at, entity_kind,
  bgg_id ON games
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('game', NEW.id, 'upsert', NEW.updated_at)
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER game_catalog_outbox_external_id_after_insert
AFTER INSERT ON game_external_ids
WHEN NEW.source = 'bgg'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('game', NEW.game_id, 'upsert', NEW.created_at)
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER game_catalog_outbox_external_id_after_update
AFTER UPDATE OF game_id, source, external_id ON game_external_ids
WHEN OLD.source = 'bgg' OR NEW.source = 'bgg'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('game', NEW.game_id, 'upsert', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
    ('game', OLD.game_id, 'upsert', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER))
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER game_catalog_outbox_external_id_after_delete
AFTER DELETE ON game_external_ids
WHEN OLD.source = 'bgg'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('game', OLD.game_id, 'upsert', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER))
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;
