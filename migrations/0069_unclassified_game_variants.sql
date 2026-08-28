-- Keep variant entities even when the legacy label does not tell us whether it
-- is an expansion or an edition.  The entity remains hidden until an editor
-- classifies it, but its identity and rule associations are preserved.

DROP TRIGGER IF EXISTS game_catalog_games_after_insert;
DROP TRIGGER IF EXISTS game_catalog_games_after_update;
DROP TRIGGER IF EXISTS game_catalog_games_after_delete;
DROP TRIGGER IF EXISTS game_catalog_aliases_after_insert;
DROP TRIGGER IF EXISTS game_catalog_aliases_after_delete;
DROP TRIGGER IF EXISTS game_catalog_aliases_after_update;
DROP TRIGGER IF EXISTS game_catalog_relations_after_insert;
DROP TRIGGER IF EXISTS game_catalog_relations_after_update;
DROP TRIGGER IF EXISTS game_catalog_relations_after_delete;
DROP VIEW IF EXISTS game_catalog_source;

ALTER TABLE game_entity_relations RENAME TO game_entity_relations_0068;

CREATE TABLE game_entity_relations (
  id TEXT PRIMARY KEY,
  source_game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  target_game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('expansion_of', 'version_of', 'variant_of')),
  created_at INTEGER NOT NULL,
  UNIQUE (source_game_id, target_game_id, relation_type),
  CHECK (source_game_id <> target_game_id)
);

INSERT INTO game_entity_relations (id, source_game_id, target_game_id, relation_type, created_at)
SELECT id, source_game_id, target_game_id, relation_type, created_at
FROM game_entity_relations_0068;

DROP TABLE game_entity_relations_0068;

CREATE INDEX idx_game_entity_relations_target_type_source
  ON game_entity_relations(target_game_id, relation_type, source_game_id);

CREATE INDEX idx_game_entity_relations_source_type_target
  ON game_entity_relations(source_game_id, relation_type, target_game_id);

CREATE VIEW game_catalog_source AS
SELECT g.id AS game_id,
  CASE WHEN g.merged_into_game_id IS NULL AND g.visibility = 'public' THEN 0 ELSE 1 END AS deleted,
  json_object(
    'id', g.id,
    'slug', g.slug,
    'displayName', g.display_name,
    'englishName', g.english_name,
    'aliases', json(COALESCE((
      SELECT json_group_array(alias)
      FROM (SELECT alias FROM game_aliases a WHERE a.game_id = g.id ORDER BY alias)
    ), '[]')),
    'ruleCount', g.published_rule_count,
    'publishedRuleCount', g.published_rule_count,
    'totalRuleCount', g.total_rule_count,
    'latestRuleUpdatedAt', g.latest_rule_updated_at,
    'updatedAt', g.updated_at,
    'entityKind', g.entity_kind,
    'parentGameId', (
      SELECT relation.target_game_id
      FROM game_entity_relations relation
      WHERE relation.source_game_id = g.id
      ORDER BY relation.relation_type, relation.target_game_id
      LIMIT 1
    ),
    'parentGameName', (
      SELECT parent.display_name
      FROM game_entity_relations relation
      JOIN games parent ON parent.id = relation.target_game_id
      WHERE relation.source_game_id = g.id
      ORDER BY relation.relation_type, relation.target_game_id
      LIMIT 1
    ),
    'parentGameSlug', (
      SELECT parent.slug
      FROM game_entity_relations relation
      JOIN games parent ON parent.id = relation.target_game_id
      WHERE relation.source_game_id = g.id
      ORDER BY relation.relation_type, relation.target_game_id
      LIMIT 1
    )
  ) AS entry_json,
  g.updated_at
FROM games g;

CREATE TRIGGER game_catalog_games_after_insert
AFTER INSERT ON games
BEGIN
  UPDATE game_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO game_catalog_entries (game_id, catalog_version, entry_json, deleted, updated_at)
  SELECT game_id, (SELECT current_version FROM game_catalog_clock WHERE id = 1), entry_json, deleted, updated_at
  FROM game_catalog_source WHERE game_id = NEW.id
  ON CONFLICT(game_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER game_catalog_games_after_update
AFTER UPDATE OF slug, display_name, english_name, merged_into_game_id, visibility,
  published_rule_count, total_rule_count, latest_rule_updated_at, entity_kind ON games
BEGIN
  UPDATE game_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO game_catalog_entries (game_id, catalog_version, entry_json, deleted, updated_at)
  SELECT game_id, (SELECT current_version FROM game_catalog_clock WHERE id = 1), entry_json, deleted, updated_at
  FROM game_catalog_source WHERE game_id = NEW.id
  ON CONFLICT(game_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER game_catalog_games_after_delete
AFTER DELETE ON games
BEGIN
  UPDATE game_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO game_catalog_entries (game_id, catalog_version, entry_json, deleted, updated_at)
  VALUES (
    OLD.id,
    (SELECT current_version FROM game_catalog_clock WHERE id = 1),
    NULL,
    1,
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  )
  ON CONFLICT(game_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = NULL,
    deleted = 1,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER game_catalog_aliases_after_insert
AFTER INSERT ON game_aliases
BEGIN
  UPDATE game_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO game_catalog_entries (game_id, catalog_version, entry_json, deleted, updated_at)
  SELECT game_id, (SELECT current_version FROM game_catalog_clock WHERE id = 1), entry_json, deleted, updated_at
  FROM game_catalog_source WHERE game_id = NEW.game_id
  ON CONFLICT(game_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER game_catalog_aliases_after_delete
AFTER DELETE ON game_aliases
BEGIN
  UPDATE game_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO game_catalog_entries (game_id, catalog_version, entry_json, deleted, updated_at)
  SELECT game_id, (SELECT current_version FROM game_catalog_clock WHERE id = 1), entry_json, deleted, updated_at
  FROM game_catalog_source WHERE game_id = OLD.game_id
  ON CONFLICT(game_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER game_catalog_aliases_after_update
AFTER UPDATE OF game_id, alias ON game_aliases
BEGIN
  UPDATE game_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO game_catalog_entries (game_id, catalog_version, entry_json, deleted, updated_at)
  SELECT game_id, (SELECT current_version FROM game_catalog_clock WHERE id = 1), entry_json, deleted, updated_at
  FROM game_catalog_source WHERE game_id = NEW.game_id
  ON CONFLICT(game_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;

  UPDATE game_catalog_clock SET current_version = current_version + 1
  WHERE id = 1 AND OLD.game_id <> NEW.game_id;
  INSERT INTO game_catalog_entries (game_id, catalog_version, entry_json, deleted, updated_at)
  SELECT game_id, (SELECT current_version FROM game_catalog_clock WHERE id = 1), entry_json, deleted, updated_at
  FROM game_catalog_source WHERE game_id = OLD.game_id AND OLD.game_id <> NEW.game_id
  ON CONFLICT(game_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER game_catalog_relations_after_insert
AFTER INSERT ON game_entity_relations
BEGIN
  UPDATE game_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO game_catalog_entries (game_id, catalog_version, entry_json, deleted, updated_at)
  SELECT game_id, (SELECT current_version FROM game_catalog_clock WHERE id = 1), entry_json, deleted, updated_at
  FROM game_catalog_source WHERE game_id = NEW.source_game_id
  ON CONFLICT(game_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER game_catalog_relations_after_update
AFTER UPDATE OF source_game_id, target_game_id, relation_type ON game_entity_relations
BEGIN
  UPDATE game_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO game_catalog_entries (game_id, catalog_version, entry_json, deleted, updated_at)
  SELECT game_id, (SELECT current_version FROM game_catalog_clock WHERE id = 1), entry_json, deleted, updated_at
  FROM game_catalog_source WHERE game_id = NEW.source_game_id
  ON CONFLICT(game_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER game_catalog_relations_after_delete
AFTER DELETE ON game_entity_relations
BEGIN
  UPDATE game_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO game_catalog_entries (game_id, catalog_version, entry_json, deleted, updated_at)
  SELECT game_id, (SELECT current_version FROM game_catalog_clock WHERE id = 1), entry_json, deleted, updated_at
  FROM game_catalog_source WHERE game_id = OLD.source_game_id
  ON CONFLICT(game_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

CREATE TABLE migration_0069_unknown_variant_candidates (
  candidate_key TEXT PRIMARY KEY,
  parent_game_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  entity_id TEXT NOT NULL
);

WITH source_rows AS (
  SELECT
    r.game_id AS parent_game_id,
    trim(notes.value) AS display_name
  FROM rules r
  JOIN json_each(
    CASE
      WHEN json_valid(r.edition_notes_json) AND json_array_length(r.edition_notes_json) > 0
        THEN r.edition_notes_json
      WHEN trim(COALESCE(r.edition_note, '')) <> '' THEN json_array(r.edition_note)
      ELSE '[]'
    END
  ) AS notes
  WHERE trim(notes.value) <> ''
), normalized_rows AS (
  SELECT
    parent_game_id,
    display_name,
    lower(
      replace(
        replace(
          replace(
            replace(
              replace(
                replace(
                  replace(
                    replace(trim(display_name), ' ', ''),
                    '　', ''
                  ),
                  '（', ''
                ),
                '）', ''
              ),
              '(', ''
            ),
            ')', ''
          ),
          '擴充', '擴'
        ),
        '擴展', '擴'
      )
    ) AS normalized_name
  FROM source_rows
), ranked_rows AS (
  SELECT
    parent_game_id,
    display_name,
    normalized_name,
    ROW_NUMBER() OVER (
      PARTITION BY parent_game_id, normalized_name
      ORDER BY length(display_name) DESC, display_name
    ) AS row_number
  FROM normalized_rows
  WHERE normalized_name <> ''
    AND instr(lower(display_name), 'expansion') = 0
    AND instr(lower(display_name), 'edition') = 0
    AND instr(lower(display_name), 'revised') = 0
    AND instr(lower(display_name), 'revision') = 0
    AND instr(lower(display_name), 'second edition') = 0
    AND instr(lower(display_name), 'third edition') = 0
    AND instr(lower(display_name), 'fourth edition') = 0
    AND instr(lower(display_name), 'deluxe edition') = 0
    AND instr(lower(display_name), 'big box') = 0
    AND instr(display_name, '版本') = 0
    AND instr(display_name, '修訂版') = 0
    AND instr(display_name, '新版') = 0
    AND instr(display_name, '第二版') = 0
    AND instr(display_name, '第三版') = 0
    AND instr(display_name, '第四版') = 0
    AND instr(display_name, '豪華版') = 0
    AND instr(display_name, '精裝版') = 0
    AND instr(display_name, '典藏版') = 0
    AND instr(display_name, '版') = 0
    AND instr(display_name, '擴') = 0
)
INSERT INTO migration_0069_unknown_variant_candidates (
  candidate_key, parent_game_id, display_name, normalized_name, entity_id
)
SELECT
  ranked.parent_game_id || ':' || ranked.normalized_name,
  ranked.parent_game_id,
  ranked.display_name,
  ranked.normalized_name,
  COALESCE(existing.id, 'game-variant-' || lower(hex(randomblob(16))))
FROM ranked_rows ranked
LEFT JOIN game_entity_relations relation
  ON relation.target_game_id = ranked.parent_game_id
 AND relation.relation_type = 'variant_of'
LEFT JOIN games existing
  ON existing.id = relation.source_game_id
 AND existing.entity_kind = 'unknown'
 AND existing.normalized_name = ranked.normalized_name
WHERE ranked.row_number = 1
  AND existing.id IS NULL;

INSERT INTO games (
  id, slug, display_name, english_name, normalized_name, merged_into_game_id,
  created_by, created_at, updated_at, visibility, review_status, attribute_enabled,
  entity_kind
)
SELECT
  entity_id,
  'variant-' || lower(hex(randomblob(16))),
  display_name,
  NULL,
  normalized_name,
  NULL,
  NULL,
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
  'hidden',
  'pending',
  0,
  'unknown'
FROM migration_0069_unknown_variant_candidates;

INSERT OR IGNORE INTO game_entity_relations (
  id, source_game_id, target_game_id, relation_type, created_at
)
SELECT
  'game-relation:' || candidates.entity_id || ':' || candidates.parent_game_id,
  candidates.entity_id,
  candidates.parent_game_id,
  'variant_of',
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM migration_0069_unknown_variant_candidates candidates;

INSERT OR IGNORE INTO rule_game_variants (rule_id, game_id, created_at)
SELECT
  rules.id,
  candidates.entity_id,
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM rules
JOIN json_each(
  CASE
    WHEN json_valid(rules.edition_notes_json) AND json_array_length(rules.edition_notes_json) > 0
      THEN rules.edition_notes_json
    WHEN trim(COALESCE(rules.edition_note, '')) <> '' THEN json_array(rules.edition_note)
    ELSE '[]'
  END
) AS notes
JOIN migration_0069_unknown_variant_candidates candidates
  ON candidates.parent_game_id = rules.game_id
 AND candidates.normalized_name = lower(
   replace(
     replace(
       replace(
         replace(
           replace(
             replace(
               replace(
                 replace(trim(notes.value), ' ', ''),
                 '　', ''
               ),
               '（', ''
             ),
             '）', ''
           ),
           '(', ''
         ),
         ')', ''
       ),
       '擴充', '擴'
     ),
     '擴展', '擴'
   )
 )
WHERE trim(notes.value) <> '';

DROP TABLE migration_0069_unknown_variant_candidates;
