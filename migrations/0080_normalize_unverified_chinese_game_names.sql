-- 0078 promoted CSV altnames to canonical display names.  An alternate name
-- is not evidence of a formally published Chinese edition, so restore the
-- English BGG title for the unverified rows and keep the Chinese text as a
-- searchable legacy alias.
CREATE TABLE migration_0080_game_name_repairs (
  game_id TEXT PRIMARY KEY,
  bgg_id INTEGER NOT NULL,
  canonical_display_name TEXT NOT NULL,
  canonical_english_name TEXT NOT NULL,
  legacy_alias TEXT NOT NULL,
  legacy_normalized_alias TEXT NOT NULL
);

INSERT INTO migration_0080_game_name_repairs
  (game_id, bgg_id, canonical_display_name, canonical_english_name,
   legacy_alias, legacy_normalized_alias)
VALUES
  ('game_bgg_360471', 360471, 'Aquamarine', 'Aquamarine', '紙筆潛水', '紙筆潛水'),
  ('game_f1cfad0788a94bca858f49ff281e51dd', 426513, 'Emberleaf', 'Emberleaf', '餘燼葉', '餘燼葉'),
  ('game_bgg_410238', 410238, 'Logic & Lore', 'Logic & Lore', '邏輯與知識', '邏輯與知識'),
  ('game_bgg_63975', 63975, 'Mountain Goats', 'Mountain Goats', '山羊爬山', '山羊爬山'),
  ('game_bgg_176887', 176887, 'Perspective', 'Perspective', '觀點', '觀點'),
  ('game_bgg_387780', 387780, '白鼠特工隊', 'Rats of Wistar', '白鼠特攻隊', '白鼠特攻隊'),
  ('game_bgg_352892', 352892, 'Stampede', 'Stampede', '集郵收藏家', '集郵收藏家'),
  ('game_bgg_279720', 279720, 'Streets', 'Streets', '街道', '街道');

-- Preserve the old CSV-derived text as a searchable alias.  The insert is
-- idempotent so a local database that already contains one of these aliases
-- can apply the migration safely as well.
INSERT OR IGNORE INTO game_aliases
  (id, game_id, alias, normalized_alias, alias_type, created_at)
SELECT
  'game-name-repair:0080:' || repair.game_id,
  repair.game_id,
  repair.legacy_alias,
  repair.legacy_normalized_alias,
  'legacy',
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM migration_0080_game_name_repairs repair
JOIN games game ON game.id = repair.game_id;

-- These games were already restored to their English primary names, but their
-- Chinese names must follow the same searchable-alias rule.
INSERT OR IGNORE INTO game_aliases
  (id, game_id, alias, normalized_alias, alias_type, created_at)
SELECT 'game-name-repair:0080:carson-city', game.id, '卡森市', '卡森市', 'alias',
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM games game
WHERE game.id = 'game_037e0f3314195ac0dfa1';

INSERT OR IGNORE INTO game_aliases
  (id, game_id, alias, normalized_alias, alias_type, created_at)
SELECT 'game-name-repair:0080:el-burro', game.id, '莊園小毛驢', '莊園小毛驢', 'alias',
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM games game
WHERE game.id = 'game_3c7b6d9a57a54c9abed486a39d854d50';

INSERT OR IGNORE INTO game_aliases
  (id, game_id, alias, normalized_alias, alias_type, created_at)
SELECT 'game-name-repair:0080:taxi-derby:1', game.id, '計程車生存戰', '計程車生存戰', 'alias',
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM games game
WHERE game.id = 'game_a0d89024390f36d09023';

INSERT OR IGNORE INTO game_aliases
  (id, game_id, alias, normalized_alias, alias_type, created_at)
SELECT 'game-name-repair:0080:taxi-derby:2', game.id, '終極殺陣', '終極殺陣', 'alias',
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM games game
WHERE game.id = 'game_a0d89024390f36d09023';

-- The secondary label used by attribute voting is deliberately derived from
-- the shared game data.  If the primary name is English, show the first
-- Chinese alias; if the primary name is an official Chinese title, show its
-- English title instead.  Alias ordering matches the game detail/search API.
DROP VIEW IF EXISTS attribute_subject_secondary_names;
CREATE VIEW attribute_subject_secondary_names AS
WITH game_secondary_names AS (
  SELECT g.id,
    CASE
      WHEN g.display_name NOT GLOB '*[一-龥]*' THEN COALESCE(
        (
          SELECT alias
          FROM game_aliases a
          WHERE a.game_id = g.id
            AND a.alias GLOB '*[一-龥]*'
          ORDER BY a.alias, a.id
          LIMIT 1
        ),
        NULLIF(g.english_name, g.display_name)
      )
      ELSE NULLIF(g.english_name, g.display_name)
    END AS secondary_name
  FROM games g
), base_components AS (
  SELECT c.subject_id,
    COALESCE(game_names.secondary_name, NULLIF(c.english_name, '')) AS base_english_name
  FROM attribute_subject_components c
  LEFT JOIN game_secondary_names game_names ON game_names.id = c.game_id
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
  ELSE game_names.secondary_name END AS secondary_name
FROM attribute_subjects s
LEFT JOIN game_secondary_names game_names ON game_names.id = s.game_id
LEFT JOIN base_components ON base_components.subject_id = s.id
LEFT JOIN expansion_names ON expansion_names.subject_id = s.id;

-- Restore the canonical game names and keep attribute subjects aligned with
-- their shared game entity.  Both existing catalog triggers then emit a
-- bounded subject delta, so clients converge without a full snapshot scan.
UPDATE games
SET display_name = (
      SELECT repair.canonical_display_name
      FROM migration_0080_game_name_repairs repair
      WHERE repair.game_id = games.id
    ),
    english_name = (
      SELECT repair.canonical_english_name
      FROM migration_0080_game_name_repairs repair
      WHERE repair.game_id = games.id
    ),
    normalized_name = (
      SELECT CASE repair.game_id
        WHEN 'game_bgg_360471' THEN 'aquamarine'
        WHEN 'game_f1cfad0788a94bca858f49ff281e51dd' THEN 'emberleaf'
        WHEN 'game_bgg_410238' THEN 'logiclore'
        WHEN 'game_bgg_63975' THEN 'mountaingoats'
        WHEN 'game_bgg_176887' THEN 'perspective'
        WHEN 'game_bgg_387780' THEN '白鼠特工隊'
        WHEN 'game_bgg_352892' THEN 'stampede'
        WHEN 'game_bgg_279720' THEN 'streets'
      END
      FROM migration_0080_game_name_repairs repair
      WHERE repair.game_id = games.id
    ),
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE id IN (SELECT game_id FROM migration_0080_game_name_repairs)
  AND bgg_id = (
    SELECT repair.bgg_id
    FROM migration_0080_game_name_repairs repair
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
  AND game_id IN (SELECT game_id FROM migration_0080_game_name_repairs);

DROP TABLE migration_0080_game_name_repairs;

-- Alias edits must update the attribute catalog's subject delta too.  The
-- shared game catalog already has equivalent alias triggers; these two keep
-- the voting/table cache in step with the same canonical game data.
DROP TRIGGER IF EXISTS attribute_game_aliases_after_insert;
CREATE TRIGGER attribute_game_aliases_after_insert
AFTER INSERT ON game_aliases
WHEN EXISTS (
  SELECT 1 FROM attribute_subjects subject
  WHERE subject.game_id = NEW.game_id AND subject.kind = 'game'
)
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
  WHERE subject.game_id = NEW.game_id AND subject.kind = 'game'
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

DROP TRIGGER IF EXISTS attribute_game_aliases_after_delete;
CREATE TRIGGER attribute_game_aliases_after_delete
AFTER DELETE ON game_aliases
WHEN EXISTS (
  SELECT 1 FROM attribute_subjects subject
  WHERE subject.game_id = OLD.game_id AND subject.kind = 'game'
)
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
  WHERE subject.game_id = OLD.game_id AND subject.kind = 'game'
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

DROP TRIGGER IF EXISTS attribute_game_aliases_after_update;
CREATE TRIGGER attribute_game_aliases_after_update
AFTER UPDATE OF game_id, alias, normalized_alias ON game_aliases
WHEN EXISTS (
  SELECT 1 FROM attribute_subjects subject
  WHERE subject.game_id = NEW.game_id AND subject.kind = 'game'
)
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
  WHERE subject.game_id = NEW.game_id AND subject.kind = 'game'
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

PRAGMA optimize;
