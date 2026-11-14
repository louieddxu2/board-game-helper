-- Voting resolves a missing score to its starting state on demand. Keep
-- creating subjects and components, which still define the voting pool.
DROP TRIGGER IF EXISTS attribute_subject_games_after_insert;
CREATE TRIGGER attribute_subject_games_after_insert AFTER INSERT ON games
WHEN NEW.merged_into_game_id IS NULL AND NEW.entity_kind = 'base'
BEGIN
  INSERT OR IGNORE INTO attribute_subjects
    (id, slug, kind, display_name, game_id, created_at, updated_at)
  VALUES ('attribute_subject_game:' || NEW.id, 'game-' || NEW.slug, 'game',
    NEW.display_name, NEW.id, NEW.created_at, NEW.updated_at);
  INSERT OR IGNORE INTO attribute_subject_components (subject_id, component_order, game_id, component_type, label)
  VALUES ('attribute_subject_game:' || NEW.id, 0, NEW.id, 'base', NEW.display_name);
END;

DROP TRIGGER IF EXISTS attribute_subject_games_after_classification;
CREATE TRIGGER attribute_subject_games_after_classification
AFTER UPDATE OF entity_kind, bgg_id, merged_into_game_id, visibility,
  published_rule_count, attribute_enabled ON games
WHEN NEW.merged_into_game_id IS NULL AND NEW.entity_kind = 'base'
BEGIN
  INSERT OR IGNORE INTO attribute_subjects
    (id, slug, kind, display_name, game_id, created_at, updated_at)
  VALUES ('attribute_subject_game:' || NEW.id, 'game-' || NEW.slug, 'game',
    NEW.display_name, NEW.id, NEW.created_at, NEW.updated_at);
  INSERT OR IGNORE INTO attribute_subject_components (subject_id, component_order, game_id, component_type, label)
  VALUES ('attribute_subject_game:' || NEW.id, 0, NEW.id, 'base', NEW.display_name);
END;

DROP TRIGGER IF EXISTS attribute_game_external_ids_after_insert;
DROP TRIGGER IF EXISTS attribute_subject_components_bgg_after_insert;
DROP TRIGGER IF EXISTS attribute_subject_components_bgg_after_update;

-- Let the next complete replay retire the old placeholder rows and publish
-- sparse snapshots atomically. Restart any work staged by the previous worker.
UPDATE attribute_replay_status
SET required_revision = required_revision + 1, history_revision = history_revision + 1
WHERE id = 1;
