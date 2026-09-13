-- These names identify official Chinese editions. Keep the previous catalog
-- labels searchable as aliases, rather than treating the official names as
-- alternate text from Final_BggCollection.csv.
CREATE TABLE migration_0097_official_names (
  game_id TEXT PRIMARY KEY,
  bgg_id INTEGER NOT NULL,
  display_name TEXT NOT NULL,
  legacy_name TEXT NOT NULL
);

INSERT INTO migration_0097_official_names (game_id, bgg_id, display_name, legacy_name)
VALUES
  ('game_attribute_import_concordia', 124361, '康考迪婭', '和諧羅馬'),
  ('game_attribute_import_cryptid', 246784, '詭影尋蹤', '神祕生物');

INSERT OR IGNORE INTO game_aliases
  (id, game_id, alias, normalized_alias, alias_type, created_at)
SELECT
  'game-name-promotion:0097:' || repair.game_id,
  repair.game_id,
  repair.legacy_name,
  lower(replace(trim(repair.legacy_name), ' ', '')),
  'legacy',
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM migration_0097_official_names repair
JOIN games game ON game.id = repair.game_id AND game.bgg_id = repair.bgg_id;

-- The new primary names are not aliases. Existing 0096 rows are removed after
-- the legacy aliases are secured above.
DELETE FROM game_aliases
WHERE (game_id, alias) IN (
  SELECT game_id, display_name FROM migration_0097_official_names
);

UPDATE games
SET display_name = (
      SELECT repair.display_name
      FROM migration_0097_official_names repair
      WHERE repair.game_id = games.id
    ),
    normalized_name = (
      SELECT lower(replace(trim(repair.display_name), ' ', ''))
      FROM migration_0097_official_names repair
      WHERE repair.game_id = games.id
    ),
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE id IN (SELECT game_id FROM migration_0097_official_names)
  AND bgg_id = (
    SELECT repair.bgg_id
    FROM migration_0097_official_names repair
    WHERE repair.game_id = games.id
  );

UPDATE attribute_subjects
SET display_name = (
      SELECT game.display_name
      FROM games game
      WHERE game.id = attribute_subjects.game_id
    ),
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE kind = 'game'
  AND game_id IN (SELECT game_id FROM migration_0097_official_names);

UPDATE attribute_subject_components
SET label = (
  SELECT game.display_name
  FROM games game
  WHERE game.id = attribute_subject_components.game_id
)
WHERE component_type = 'base'
  AND game_id IN (SELECT game_id FROM migration_0097_official_names);

DROP TABLE migration_0097_official_names;

PRAGMA optimize;
