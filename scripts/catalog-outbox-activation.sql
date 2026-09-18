-- Run only after the Worker containing catalogOutbox.ts has been deployed.
-- This switches derived catalog writes from SQL trigger projection to a
-- compact identity outbox.  The operation is idempotent and does not alter
-- source games, rules, votes, or score state.

DROP TRIGGER IF EXISTS game_catalog_games_after_insert;
DROP TRIGGER IF EXISTS game_catalog_games_after_update;
DROP TRIGGER IF EXISTS game_catalog_games_after_delete;
DROP TRIGGER IF EXISTS game_catalog_aliases_after_insert;
DROP TRIGGER IF EXISTS game_catalog_aliases_after_delete;
DROP TRIGGER IF EXISTS game_catalog_aliases_after_update;
DROP TRIGGER IF EXISTS game_catalog_relations_after_insert;
DROP TRIGGER IF EXISTS game_catalog_relations_after_update;
DROP TRIGGER IF EXISTS game_catalog_relations_after_delete;

DROP TRIGGER IF EXISTS trg_public_tag_catalog_insert;
DROP TRIGGER IF EXISTS trg_public_tag_catalog_update;
DROP TRIGGER IF EXISTS trg_public_tag_catalog_delete;
DROP TRIGGER IF EXISTS trg_public_tag_catalog_alias_insert;
DROP TRIGGER IF EXISTS trg_public_tag_catalog_alias_delete;
DROP TRIGGER IF EXISTS trg_public_tag_catalog_alias_update;

DROP TRIGGER IF EXISTS attribute_score_states_catalog_after_insert;
DROP TRIGGER IF EXISTS attribute_score_states_catalog_after_update;
DROP TRIGGER IF EXISTS attribute_score_states_catalog_after_delete;
DROP TRIGGER IF EXISTS attribute_candidates_catalog_after_insert;
DROP TRIGGER IF EXISTS attribute_candidates_catalog_after_update;
DROP TRIGGER IF EXISTS attribute_candidates_catalog_after_delete;
DROP TRIGGER IF EXISTS attributes_catalog_after_insert;
DROP TRIGGER IF EXISTS attributes_catalog_after_update;
DROP TRIGGER IF EXISTS attributes_catalog_after_delete;
DROP TRIGGER IF EXISTS attribute_translations_catalog_after_insert;
DROP TRIGGER IF EXISTS attribute_translations_catalog_after_update;
DROP TRIGGER IF EXISTS attribute_translations_catalog_after_delete;
DROP TRIGGER IF EXISTS attribute_subjects_catalog_after_insert;
DROP TRIGGER IF EXISTS attribute_subjects_catalog_after_update;
DROP TRIGGER IF EXISTS attribute_subjects_catalog_after_delete;
DROP TRIGGER IF EXISTS attribute_games_catalog_after_update;
DROP TRIGGER IF EXISTS attribute_games_catalog_after_delete;
DROP TRIGGER IF EXISTS game_external_ids_catalog_after_insert;
DROP TRIGGER IF EXISTS game_external_ids_catalog_after_update;
DROP TRIGGER IF EXISTS game_external_ids_catalog_after_delete;
DROP TRIGGER IF EXISTS attribute_subject_components_catalog_after_insert;
DROP TRIGGER IF EXISTS attribute_subject_components_catalog_after_update;
DROP TRIGGER IF EXISTS attribute_subject_components_catalog_after_delete;
DROP TRIGGER IF EXISTS attribute_game_aliases_after_insert;
DROP TRIGGER IF EXISTS attribute_game_aliases_after_update;
DROP TRIGGER IF EXISTS attribute_game_aliases_after_delete;

DROP TRIGGER IF EXISTS game_catalog_outbox_games_after_insert;
DROP TRIGGER IF EXISTS game_catalog_outbox_games_after_update;
DROP TRIGGER IF EXISTS game_catalog_outbox_games_after_delete;
DROP TRIGGER IF EXISTS game_catalog_outbox_parent_after_update;
DROP TRIGGER IF EXISTS game_catalog_outbox_aliases_after_insert;
DROP TRIGGER IF EXISTS game_catalog_outbox_aliases_after_delete;
DROP TRIGGER IF EXISTS game_catalog_outbox_aliases_after_update;
DROP TRIGGER IF EXISTS game_catalog_outbox_relations_after_insert;
DROP TRIGGER IF EXISTS game_catalog_outbox_relations_after_update;
DROP TRIGGER IF EXISTS game_catalog_outbox_relations_after_delete;
DROP TRIGGER IF EXISTS tag_catalog_outbox_after_insert;
DROP TRIGGER IF EXISTS tag_catalog_outbox_after_update;
DROP TRIGGER IF EXISTS tag_catalog_outbox_after_delete;
DROP TRIGGER IF EXISTS tag_catalog_outbox_aliases_after_insert;
DROP TRIGGER IF EXISTS tag_catalog_outbox_aliases_after_delete;
DROP TRIGGER IF EXISTS tag_catalog_outbox_aliases_after_update;
DROP TRIGGER IF EXISTS attribute_catalog_outbox_score_after_insert;
DROP TRIGGER IF EXISTS attribute_catalog_outbox_score_after_update;
DROP TRIGGER IF EXISTS attribute_catalog_outbox_score_after_delete;
DROP TRIGGER IF EXISTS attribute_catalog_outbox_subject_after_insert;
DROP TRIGGER IF EXISTS attribute_catalog_outbox_subject_after_update;
DROP TRIGGER IF EXISTS attribute_catalog_outbox_subject_after_delete;
DROP TRIGGER IF EXISTS attribute_catalog_outbox_games_after_update;
DROP TRIGGER IF EXISTS attribute_catalog_outbox_games_after_delete;
DROP TRIGGER IF EXISTS attribute_catalog_outbox_game_aliases_after_insert;
DROP TRIGGER IF EXISTS attribute_catalog_outbox_game_aliases_after_update;
DROP TRIGGER IF EXISTS attribute_catalog_outbox_game_aliases_after_delete;
DROP TRIGGER IF EXISTS attribute_catalog_outbox_external_id_after_insert;
DROP TRIGGER IF EXISTS attribute_catalog_outbox_external_id_after_update;
DROP TRIGGER IF EXISTS attribute_catalog_outbox_external_id_after_delete;
DROP TRIGGER IF EXISTS attribute_catalog_outbox_component_after_insert;
DROP TRIGGER IF EXISTS attribute_catalog_outbox_component_after_update;
DROP TRIGGER IF EXISTS attribute_catalog_outbox_component_after_delete;
DROP TRIGGER IF EXISTS attribute_catalog_outbox_definition_after_insert;
DROP TRIGGER IF EXISTS attribute_catalog_outbox_definition_after_update;
DROP TRIGGER IF EXISTS attribute_catalog_outbox_definition_after_delete;
DROP TRIGGER IF EXISTS attribute_catalog_outbox_translation_after_insert;
DROP TRIGGER IF EXISTS attribute_catalog_outbox_translation_after_update;
DROP TRIGGER IF EXISTS attribute_catalog_outbox_translation_after_delete;
DROP TRIGGER IF EXISTS attribute_catalog_outbox_candidate_after_insert;
DROP TRIGGER IF EXISTS attribute_catalog_outbox_candidate_after_update;
DROP TRIGGER IF EXISTS attribute_catalog_outbox_candidate_after_delete;

-- Source games, aliases, and entity relationships only enqueue their own
-- IDs.  The publisher later reads that single game through the indexed view.
CREATE TRIGGER game_catalog_outbox_games_after_insert
AFTER INSERT ON games
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('game', NEW.id, 'upsert', NEW.updated_at)
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER game_catalog_outbox_games_after_update
AFTER UPDATE OF slug, display_name, english_name, merged_into_game_id, visibility,
  published_rule_count, total_rule_count, latest_rule_updated_at, entity_kind ON games
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('game', NEW.id, 'upsert', NEW.updated_at)
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

-- Child catalog entries embed their parent game's visible name and slug.
-- Queue those few children through the target-side relation index when that
-- parent metadata changes, instead of waiting for the weekly full snapshot.
CREATE TRIGGER game_catalog_outbox_parent_after_update
AFTER UPDATE OF slug, display_name ON games
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  SELECT 'game', relation.source_game_id, 'upsert', NEW.updated_at
  FROM game_entity_relations relation
  WHERE relation.target_game_id = NEW.id
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER game_catalog_outbox_games_after_delete
AFTER DELETE ON games
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('game', OLD.id, 'delete', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER))
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER game_catalog_outbox_aliases_after_insert
AFTER INSERT ON game_aliases
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('game', NEW.game_id, 'upsert', NEW.created_at)
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER game_catalog_outbox_aliases_after_delete
AFTER DELETE ON game_aliases
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('game', OLD.game_id, 'upsert', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER))
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER game_catalog_outbox_aliases_after_update
AFTER UPDATE OF game_id, alias, normalized_alias ON game_aliases
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES
    ('game', NEW.game_id, 'upsert', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
    ('game', OLD.game_id, 'upsert', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER))
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER game_catalog_outbox_relations_after_insert
AFTER INSERT ON game_entity_relations
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('game', NEW.source_game_id, 'upsert', NEW.created_at)
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER game_catalog_outbox_relations_after_update
AFTER UPDATE OF source_game_id, target_game_id, relation_type ON game_entity_relations
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES
    ('game', NEW.source_game_id, 'upsert', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
    ('game', OLD.source_game_id, 'upsert', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER))
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER game_catalog_outbox_relations_after_delete
AFTER DELETE ON game_entity_relations
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('game', OLD.source_game_id, 'upsert', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER))
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

-- Public-tag changes use the same point-ID handoff.  Alias updates need no
-- visibility lookup in a trigger; non-public tags simply become tombstones.
CREATE TRIGGER tag_catalog_outbox_after_insert
AFTER INSERT ON tags
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('tag', NEW.id, 'upsert', NEW.updated_at)
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER tag_catalog_outbox_after_update
AFTER UPDATE OF slug, name, status, is_public, updated_at ON tags
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('tag', NEW.id, 'upsert', NEW.updated_at)
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER tag_catalog_outbox_after_delete
AFTER DELETE ON tags
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('tag', OLD.id, 'delete', OLD.updated_at)
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER tag_catalog_outbox_aliases_after_insert
AFTER INSERT ON tag_aliases
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('tag', NEW.tag_id, 'upsert', NEW.created_at)
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER tag_catalog_outbox_aliases_after_delete
AFTER DELETE ON tag_aliases
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('tag', OLD.tag_id, 'upsert', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER))
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER tag_catalog_outbox_aliases_after_update
AFTER UPDATE OF tag_id, alias, normalized_alias ON tag_aliases
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES
    ('tag', NEW.tag_id, 'upsert', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
    ('tag', OLD.tag_id, 'upsert', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER))
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

-- Attribute score rows become one whole-subject bundle at publication time.
-- Rebuild mode suppresses replay's many derived state writes; the replay
-- publishes its complete snapshot separately.
CREATE TRIGGER attribute_catalog_outbox_score_after_insert
AFTER INSERT ON attribute_score_states
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
  AND NOT EXISTS (SELECT 1 FROM attribute_catalog_rebuild_mode WHERE id = 1)
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('attribute-subject', NEW.subject_id, 'upsert', NEW.updated_at)
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER attribute_catalog_outbox_score_after_update
AFTER UPDATE OF score, rating_deviation, direct_sum, direct_count,
  comparison_count, decisive_comparison_count, evidence_count, model_version ON attribute_score_states
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
  AND NOT EXISTS (SELECT 1 FROM attribute_catalog_rebuild_mode WHERE id = 1)
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('attribute-subject', NEW.subject_id, 'upsert', NEW.updated_at)
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER attribute_catalog_outbox_score_after_delete
AFTER DELETE ON attribute_score_states
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
  AND NOT EXISTS (SELECT 1 FROM attribute_catalog_rebuild_mode WHERE id = 1)
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('attribute-subject', OLD.subject_id, 'upsert', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER))
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER attribute_catalog_outbox_subject_after_insert
AFTER INSERT ON attribute_subjects
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('attribute-subject', NEW.id, 'upsert', NEW.updated_at)
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER attribute_catalog_outbox_subject_after_update
AFTER UPDATE OF slug, kind, display_name, game_id, updated_at ON attribute_subjects
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('attribute-subject', NEW.id, 'upsert', NEW.updated_at)
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER attribute_catalog_outbox_subject_after_delete
AFTER DELETE ON attribute_subjects
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('attribute-subject', OLD.id, 'delete', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER))
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

-- Only metadata that affects the subject bundle is queued.  Rule-count
-- changes update the game catalog alone and no longer touch attribute views.
CREATE TRIGGER attribute_catalog_outbox_games_after_update
AFTER UPDATE OF slug, display_name, english_name, bgg_id, entity_kind,
  merged_into_game_id, visibility ON games
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  SELECT 'attribute-subject', subject.id, 'upsert', NEW.updated_at
  FROM attribute_subjects subject
  WHERE subject.game_id = NEW.id
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  SELECT 'attribute-subject', component.subject_id, 'upsert', NEW.updated_at
  FROM attribute_subject_components component
  WHERE component.game_id = NEW.id
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER attribute_catalog_outbox_games_after_delete
AFTER DELETE ON games
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('attribute-subject', 'attribute_subject_game:' || OLD.id, 'delete', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER))
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER attribute_catalog_outbox_game_aliases_after_insert
AFTER INSERT ON game_aliases
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  SELECT 'attribute-subject', subject.id, 'upsert', NEW.created_at
  FROM attribute_subjects subject
  WHERE subject.game_id = NEW.game_id
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  SELECT 'attribute-subject', component.subject_id, 'upsert', NEW.created_at
  FROM attribute_subject_components component
  WHERE component.game_id = NEW.game_id
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER attribute_catalog_outbox_game_aliases_after_update
AFTER UPDATE OF game_id, alias, normalized_alias ON game_aliases
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  SELECT 'attribute-subject', subject.id, 'upsert', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  FROM attribute_subjects subject
  WHERE subject.game_id IN (NEW.game_id, OLD.game_id)
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  SELECT 'attribute-subject', component.subject_id, 'upsert', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  FROM attribute_subject_components component
  WHERE component.game_id IN (NEW.game_id, OLD.game_id)
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER attribute_catalog_outbox_game_aliases_after_delete
AFTER DELETE ON game_aliases
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  SELECT 'attribute-subject', subject.id, 'upsert', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  FROM attribute_subjects subject
  WHERE subject.game_id = OLD.game_id
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  SELECT 'attribute-subject', component.subject_id, 'upsert', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  FROM attribute_subject_components component
  WHERE component.game_id = OLD.game_id
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER attribute_catalog_outbox_external_id_after_insert
AFTER INSERT ON game_external_ids
WHEN NEW.source = 'bgg' AND (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('attribute-subject', 'attribute_subject_game:' || NEW.game_id, 'upsert', NEW.created_at)
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  SELECT 'attribute-subject', component.subject_id, 'upsert', NEW.created_at
  FROM attribute_subject_components component
  WHERE component.game_id = NEW.game_id
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER attribute_catalog_outbox_external_id_after_update
AFTER UPDATE OF game_id, source, external_id ON game_external_ids
WHEN (OLD.source = 'bgg' OR NEW.source = 'bgg')
  AND (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES
    ('attribute-subject', 'attribute_subject_game:' || NEW.game_id, 'upsert', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
    ('attribute-subject', 'attribute_subject_game:' || OLD.game_id, 'upsert', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER))
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER attribute_catalog_outbox_external_id_after_delete
AFTER DELETE ON game_external_ids
WHEN OLD.source = 'bgg' AND (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('attribute-subject', 'attribute_subject_game:' || OLD.game_id, 'upsert', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER))
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER attribute_catalog_outbox_component_after_insert
AFTER INSERT ON attribute_subject_components
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('attribute-subject', NEW.subject_id, 'upsert', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER))
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER attribute_catalog_outbox_component_after_update
AFTER UPDATE OF subject_id, component_order, game_id, component_type, label, english_name, bgg_id ON attribute_subject_components
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES
    ('attribute-subject', NEW.subject_id, 'upsert', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
    ('attribute-subject', OLD.subject_id, 'upsert', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER))
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER attribute_catalog_outbox_component_after_delete
AFTER DELETE ON attribute_subject_components
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('attribute-subject', OLD.subject_id, 'upsert', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER))
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER attribute_catalog_outbox_definition_after_insert
AFTER INSERT ON attributes
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('attribute-definition', NEW.id, 'upsert', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER))
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER attribute_catalog_outbox_definition_after_update
AFTER UPDATE OF key, category, min_value, max_value, is_active, sort_order, scale_type ON attributes
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('attribute-definition', NEW.id, 'upsert', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER))
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER attribute_catalog_outbox_definition_after_delete
AFTER DELETE ON attributes
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('attribute-definition', OLD.id, 'delete', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER))
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER attribute_catalog_outbox_translation_after_insert
AFTER INSERT ON attribute_translations
WHEN NEW.locale = 'zh-TW' AND (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('attribute-definition', NEW.attribute_id, 'upsert', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER))
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER attribute_catalog_outbox_translation_after_update
AFTER UPDATE OF attribute_id, locale, name, short_description, full_description, min_example, max_example, endpoints_json ON attribute_translations
WHEN (OLD.locale = 'zh-TW' OR NEW.locale = 'zh-TW')
  AND (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES
    ('attribute-definition', NEW.attribute_id, 'upsert', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
    ('attribute-definition', OLD.attribute_id, 'upsert', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER))
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER attribute_catalog_outbox_translation_after_delete
AFTER DELETE ON attribute_translations
WHEN OLD.locale = 'zh-TW' AND (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('attribute-definition', OLD.attribute_id, 'upsert', CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER))
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER attribute_catalog_outbox_candidate_after_insert
AFTER INSERT ON attribute_import_candidates
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('attribute-candidate', NEW.id, 'upsert', NEW.updated_at)
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER attribute_catalog_outbox_candidate_after_update
AFTER UPDATE OF source_name, values_json, match_status, subject_id, source_row_number, updated_at ON attribute_import_candidates
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('attribute-candidate', NEW.id, 'upsert', NEW.updated_at)
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

CREATE TRIGGER attribute_catalog_outbox_candidate_after_delete
AFTER DELETE ON attribute_import_candidates
WHEN (SELECT mode FROM catalog_outbox_settings WHERE id = 1) = 'outbox'
BEGIN
  INSERT INTO catalog_change_outbox (catalog, entity_key, change_kind, updated_at)
  VALUES ('attribute-candidate', OLD.id, 'delete', OLD.updated_at)
  ON CONFLICT(catalog, entity_key) DO UPDATE SET
    change_kind = excluded.change_kind, updated_at = excluded.updated_at,
    revision = catalog_change_outbox.revision + 1;
END;

-- No active trigger may expand this broad compatibility view after the
-- switch.  The explicit publisher uses indexed point queries instead.
DROP VIEW IF EXISTS attribute_subject_catalog_source;

UPDATE catalog_outbox_settings SET mode = 'outbox' WHERE id = 1;
