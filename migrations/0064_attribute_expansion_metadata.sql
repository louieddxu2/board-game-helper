-- Expansion metadata belongs to the attribute configuration component, not to
-- the shared games table. This keeps English names and aliases out of the
-- wrong-rule game search domain.
ALTER TABLE attribute_subject_components ADD COLUMN english_name TEXT;

CREATE TABLE attribute_subject_component_aliases (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  component_order INTEGER NOT NULL,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (subject_id, component_order)
    REFERENCES attribute_subject_components(subject_id, component_order)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_attribute_subject_component_aliases_unique
  ON attribute_subject_component_aliases(subject_id, component_order, normalized_alias);
CREATE INDEX idx_attribute_subject_component_aliases_search
  ON attribute_subject_component_aliases(normalized_alias, subject_id, component_order);

-- A configuration's English display name follows the same composition rule as
-- its Chinese display name: base game plus the English names that have been
-- entered for its expansion components. Missing expansion English names are
-- simply omitted until they are filled in.
CREATE VIEW attribute_subject_secondary_names AS
WITH base_components AS (
  SELECT c.subject_id,
    COALESCE(g.english_name, c.english_name) AS base_english_name
  FROM attribute_subject_components c
  LEFT JOIN games g ON g.id = c.game_id
  WHERE c.component_type = 'base'
), ordered_expansions AS (
  SELECT subject_id, component_order, english_name
  FROM attribute_subject_components
  WHERE component_type = 'expansion'
    AND NULLIF(TRIM(english_name), '') IS NOT NULL
), expansion_names AS (
  SELECT subject_id, group_concat(english_name, ' + ') AS expansion_english_name
  FROM (
    SELECT subject_id, component_order, english_name
    FROM ordered_expansions
    ORDER BY subject_id, component_order
  )
  GROUP BY subject_id
)
SELECT s.id,
  CASE WHEN s.kind = 'configuration' THEN
    CASE
      WHEN base_components.base_english_name IS NULL THEN expansion_names.expansion_english_name
      WHEN expansion_names.expansion_english_name IS NULL THEN base_components.base_english_name
      ELSE base_components.base_english_name || ' + ' || expansion_names.expansion_english_name
    END
  ELSE g.english_name END AS secondary_name
FROM attribute_subjects s
LEFT JOIN games g ON g.id = s.game_id
LEFT JOIN base_components ON base_components.subject_id = s.id
LEFT JOIN expansion_names ON expansion_names.subject_id = s.id;

-- Keep the normalized component payload used by the weekly snapshot and its
-- incremental entries in one place, including the new metadata.
CREATE VIEW attribute_subject_component_catalog_json AS
SELECT c.subject_id, c.component_order,
  json_object(
    'order', c.component_order,
    'gameId', c.game_id,
    'type', c.component_type,
    'label', c.label,
    'englishName', c.english_name,
    'bggId', c.bgg_id,
    'aliases', json(COALESCE((
      SELECT json_group_array(a.alias)
      FROM attribute_subject_component_aliases a
      WHERE a.subject_id = c.subject_id AND a.component_order = c.component_order
      ORDER BY a.alias
    ), '[]'))
  ) AS component_json
FROM attribute_subject_components c;

DROP TRIGGER IF EXISTS attribute_subjects_catalog_after_insert;
CREATE TRIGGER attribute_subjects_catalog_after_insert
AFTER INSERT ON attribute_subjects
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT
    'subject:' || NEW.id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN NEW.kind = 'configuration' OR (
      g.merged_into_game_id IS NULL AND g.visibility = 'public'
      AND (g.published_rule_count > 0 OR g.attribute_enabled = 1)
    ) THEN json_object(
      'kind', 'subject',
      'subject', json_object(
        'id', NEW.id,
        'slug', NEW.slug,
        'kind', NEW.kind,
        'displayName', NEW.display_name,
        'secondaryName', secondary_names.secondary_name,
        'gameId', NEW.game_id,
        'gameSlug', g.slug,
        'components', json(COALESCE((
          SELECT json_group_array(json(component_json))
          FROM (
            SELECT component_json
            FROM attribute_subject_component_catalog_json
            WHERE subject_id = NEW.id
            ORDER BY component_order
          )
        ), '[]'))
      )
    ) ELSE NULL END,
    CASE WHEN NEW.kind = 'configuration' OR (
      g.merged_into_game_id IS NULL AND g.visibility = 'public'
      AND (g.published_rule_count > 0 OR g.attribute_enabled = 1)
    ) THEN 0 ELSE 1 END,
    NEW.updated_at
  FROM attribute_subjects s
  LEFT JOIN games g ON g.id = s.game_id
  LEFT JOIN attribute_subject_secondary_names secondary_names ON secondary_names.id = s.id
  WHERE s.id = NEW.id
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

DROP TRIGGER IF EXISTS attribute_subjects_catalog_after_update;
CREATE TRIGGER attribute_subjects_catalog_after_update
AFTER UPDATE OF slug, kind, display_name, game_id, updated_at ON attribute_subjects
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT
    'subject:' || NEW.id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN NEW.kind = 'configuration' OR (
      g.merged_into_game_id IS NULL AND g.visibility = 'public'
      AND (g.published_rule_count > 0 OR g.attribute_enabled = 1)
    ) THEN json_object(
      'kind', 'subject',
      'subject', json_object(
        'id', NEW.id,
        'slug', NEW.slug,
        'kind', NEW.kind,
        'displayName', NEW.display_name,
        'secondaryName', secondary_names.secondary_name,
        'gameId', NEW.game_id,
        'gameSlug', g.slug,
        'components', json(COALESCE((
          SELECT json_group_array(json(component_json))
          FROM (
            SELECT component_json
            FROM attribute_subject_component_catalog_json
            WHERE subject_id = NEW.id
            ORDER BY component_order
          )
        ), '[]'))
      )
    ) ELSE NULL END,
    CASE WHEN NEW.kind = 'configuration' OR (
      g.merged_into_game_id IS NULL AND g.visibility = 'public'
      AND (g.published_rule_count > 0 OR g.attribute_enabled = 1)
    ) THEN 0 ELSE 1 END,
    NEW.updated_at
  FROM attribute_subjects s
  LEFT JOIN games g ON g.id = s.game_id
  LEFT JOIN attribute_subject_secondary_names secondary_names ON secondary_names.id = s.id
  WHERE s.id = NEW.id
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

DROP TRIGGER IF EXISTS attribute_subject_components_catalog_after_insert;
CREATE TRIGGER attribute_subject_components_catalog_after_insert
AFTER INSERT ON attribute_subject_components
BEGIN
  UPDATE attribute_subjects
  SET display_name = CASE WHEN kind = 'configuration'
    THEN (SELECT display_name FROM attribute_subject_display_names WHERE id = attribute_subjects.id)
    ELSE display_name END,
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  WHERE id = NEW.subject_id;
END;

DROP TRIGGER IF EXISTS attribute_subject_components_catalog_after_update;
CREATE TRIGGER attribute_subject_components_catalog_after_update
AFTER UPDATE OF component_order, game_id, component_type, label, english_name, bgg_id ON attribute_subject_components
BEGIN
  UPDATE attribute_subjects
  SET display_name = CASE WHEN kind = 'configuration'
    THEN (SELECT display_name FROM attribute_subject_display_names WHERE id = attribute_subjects.id)
    ELSE display_name END,
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  WHERE id = NEW.subject_id;
END;

DROP TRIGGER IF EXISTS attribute_subject_components_catalog_after_delete;
CREATE TRIGGER attribute_subject_components_catalog_after_delete
AFTER DELETE ON attribute_subject_components
BEGIN
  UPDATE attribute_subjects
  SET display_name = CASE WHEN kind = 'configuration'
    THEN (SELECT display_name FROM attribute_subject_display_names WHERE id = attribute_subjects.id)
    ELSE display_name END,
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  WHERE id = OLD.subject_id;
END;

DROP TRIGGER IF EXISTS attribute_subject_component_aliases_after_insert;
CREATE TRIGGER attribute_subject_component_aliases_after_insert
AFTER INSERT ON attribute_subject_component_aliases
BEGIN
  UPDATE attribute_subjects
  SET updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  WHERE id = NEW.subject_id;
END;

DROP TRIGGER IF EXISTS attribute_subject_component_aliases_after_update;
CREATE TRIGGER attribute_subject_component_aliases_after_update
AFTER UPDATE OF alias, normalized_alias ON attribute_subject_component_aliases
BEGIN
  UPDATE attribute_subjects
  SET updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  WHERE id = NEW.subject_id;
END;

DROP TRIGGER IF EXISTS attribute_subject_component_aliases_after_delete;
CREATE TRIGGER attribute_subject_component_aliases_after_delete
AFTER DELETE ON attribute_subject_component_aliases
BEGIN
  UPDATE attribute_subjects
  SET updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  WHERE id = OLD.subject_id;
END;

DROP TRIGGER IF EXISTS attribute_games_catalog_after_update;
CREATE TRIGGER attribute_games_catalog_after_update
AFTER UPDATE OF slug, display_name, english_name, merged_into_game_id, visibility,
  published_rule_count, attribute_enabled ON games
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT
    'subject:' || s.id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN NEW.merged_into_game_id IS NULL
      AND NEW.visibility = 'public'
      AND (NEW.published_rule_count > 0 OR NEW.attribute_enabled = 1)
      THEN json_object(
        'kind', 'subject',
        'subject', json_object(
          'id', s.id,
          'slug', s.slug,
          'kind', s.kind,
          'displayName', s.display_name,
          'secondaryName', secondary_names.secondary_name,
          'gameId', s.game_id,
          'gameSlug', NEW.slug,
          'components', json(COALESCE((
            SELECT json_group_array(json(component_json))
            FROM (
              SELECT component_json
              FROM attribute_subject_component_catalog_json
              WHERE subject_id = s.id
              ORDER BY component_order
            )
          ), '[]'))
        )
      )
      ELSE NULL END,
    CASE WHEN NEW.merged_into_game_id IS NULL
      AND NEW.visibility = 'public'
      AND (NEW.published_rule_count > 0 OR NEW.attribute_enabled = 1) THEN 0 ELSE 1 END,
    NEW.updated_at
  FROM attribute_subjects s
  LEFT JOIN attribute_subject_secondary_names secondary_names ON secondary_names.id = s.id
  WHERE s.game_id = NEW.id AND s.kind = 'game'
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

PRAGMA optimize;
