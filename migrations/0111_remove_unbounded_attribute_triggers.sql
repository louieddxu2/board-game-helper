-- Adding or reactivating one attribute must not silently read every subject
-- and insert one score row per subject. A deliberate migration or full replay
-- provisions new scores; live response writes can upsert their own two states.
DROP TRIGGER IF EXISTS attributes_score_states_after_insert;
DROP TRIGGER IF EXISTS attributes_score_states_after_activate;

-- A new expansion relation is a single-entity operation. Start from the
-- expansion's indexed component.game_id instead of scanning every
-- configuration subject three times to find a pre-existing setup.
DROP TRIGGER IF EXISTS attribute_configuration_after_expansion_relation_insert;
CREATE TRIGGER attribute_configuration_after_expansion_relation_insert
AFTER INSERT ON game_entity_relations
WHEN NEW.relation_type = 'expansion_of'
  AND EXISTS (
    SELECT 1 FROM games expansion
    WHERE expansion.id = NEW.source_game_id
      AND expansion.entity_kind = 'expansion'
      AND expansion.merged_into_game_id IS NULL
  )
  AND EXISTS (
    SELECT 1 FROM games base
    WHERE base.id = NEW.target_game_id
      AND base.entity_kind = 'base'
      AND base.merged_into_game_id IS NULL
  )
BEGIN
  INSERT OR IGNORE INTO attribute_subjects
    (id, slug, kind, display_name, game_id, created_at, updated_at)
  SELECT 'attribute_config_expansion:' || NEW.source_game_id || ':' || NEW.target_game_id,
    'config-' || base.slug || '-with-' || expansion.slug,
    'configuration', base.display_name || '＋' || expansion.display_name, NULL,
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  FROM games expansion
  JOIN games base ON base.id = NEW.target_game_id
  WHERE expansion.id = NEW.source_game_id
    AND NOT EXISTS (
      SELECT 1
      FROM attribute_subject_components expansion_component
      JOIN attribute_subject_components base_component
        ON base_component.subject_id = expansion_component.subject_id
       AND base_component.game_id = NEW.target_game_id
       AND base_component.component_type = 'base'
      JOIN attribute_subjects subject
        ON subject.id = expansion_component.subject_id
       AND subject.kind = 'configuration'
      WHERE expansion_component.game_id = NEW.source_game_id
        AND expansion_component.component_type = 'expansion'
    );

  INSERT OR IGNORE INTO attribute_subject_components
    (subject_id, component_order, game_id, component_type, label, english_name, bgg_id)
  SELECT COALESCE((
      SELECT expansion_component.subject_id
      FROM attribute_subject_components expansion_component
      JOIN attribute_subject_components base_component
        ON base_component.subject_id = expansion_component.subject_id
       AND base_component.game_id = NEW.target_game_id
       AND base_component.component_type = 'base'
      JOIN attribute_subjects subject
        ON subject.id = expansion_component.subject_id
       AND subject.kind = 'configuration'
      WHERE expansion_component.game_id = NEW.source_game_id
        AND expansion_component.component_type = 'expansion'
      ORDER BY expansion_component.subject_id
      LIMIT 1
    ), 'attribute_config_expansion:' || NEW.source_game_id || ':' || NEW.target_game_id),
    0, base.id, 'base', base.display_name, base.english_name,
    COALESCE(base.bgg_id, (
      SELECT CAST(external_id.external_id AS INTEGER)
      FROM game_external_ids external_id
      WHERE external_id.game_id = base.id AND external_id.source = 'bgg'
      ORDER BY external_id.id LIMIT 1
    ))
  FROM games base
  WHERE base.id = NEW.target_game_id;

  INSERT OR IGNORE INTO attribute_subject_components
    (subject_id, component_order, game_id, component_type, label, english_name, bgg_id)
  SELECT COALESCE((
      SELECT expansion_component.subject_id
      FROM attribute_subject_components expansion_component
      JOIN attribute_subject_components base_component
        ON base_component.subject_id = expansion_component.subject_id
       AND base_component.game_id = NEW.target_game_id
       AND base_component.component_type = 'base'
      JOIN attribute_subjects subject
        ON subject.id = expansion_component.subject_id
       AND subject.kind = 'configuration'
      WHERE expansion_component.game_id = NEW.source_game_id
        AND expansion_component.component_type = 'expansion'
      ORDER BY expansion_component.subject_id
      LIMIT 1
    ), 'attribute_config_expansion:' || NEW.source_game_id || ':' || NEW.target_game_id),
    1, expansion.id, 'expansion', expansion.display_name, expansion.english_name,
    COALESCE(expansion.bgg_id, (
      SELECT CAST(external_id.external_id AS INTEGER)
      FROM game_external_ids external_id
      WHERE external_id.game_id = expansion.id AND external_id.source = 'bgg'
      ORDER BY external_id.id LIMIT 1
    ))
  FROM games expansion
  WHERE expansion.id = NEW.source_game_id;
END;
