-- Promote legacy edition/expansion labels into first-class game entities.
-- The legacy text columns remain intentionally intact for backwards compatibility.

ALTER TABLE games ADD COLUMN entity_kind TEXT NOT NULL DEFAULT 'base'
  CHECK (entity_kind IN ('base', 'expansion', 'version', 'unknown'));

CREATE TABLE game_entity_relations (
  id TEXT PRIMARY KEY,
  source_game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  target_game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('expansion_of', 'version_of')),
  created_at INTEGER NOT NULL,
  UNIQUE (source_game_id, target_game_id, relation_type),
  CHECK (source_game_id <> target_game_id)
);

CREATE INDEX idx_game_entity_relations_target_type_source
  ON game_entity_relations(target_game_id, relation_type, source_game_id);

CREATE INDEX idx_game_entity_relations_source_type_target
  ON game_entity_relations(source_game_id, relation_type, target_game_id);

CREATE TABLE rule_game_variants (
  rule_id TEXT NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (rule_id, game_id)
);

CREATE INDEX idx_rule_game_variants_game_rule
  ON rule_game_variants(game_id, rule_id);

CREATE INDEX idx_rule_game_variants_rule_game
  ON rule_game_variants(rule_id, game_id);

-- Keep this staging table while the two legacy sources resolve to the same
-- newly-created row. It is dropped at the end of the migration.
CREATE TABLE migration_0068_variant_candidates (
  candidate_key TEXT PRIMARY KEY,
  parent_game_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('expansion', 'version', 'unknown')),
  english_name TEXT,
  bgg_id INTEGER,
  entity_id TEXT,
  entity_slug TEXT
);

WITH source_rows AS (
  SELECT
    r.game_id AS parent_game_id,
    trim(notes.value) AS display_name,
    NULL AS english_name,
    NULL AS bgg_id,
    CASE
      WHEN instr(lower(trim(notes.value)), 'expansion') > 0
        OR instr(lower(trim(notes.value)), '擴充') > 0
        OR instr(lower(trim(notes.value)), '擴展') > 0
        OR instr(lower(trim(notes.value)), '擴') > 0
      THEN 'expansion'
      WHEN instr(lower(trim(notes.value)), 'edition') > 0
        OR instr(lower(trim(notes.value)), 'revised') > 0
        OR instr(lower(trim(notes.value)), 'revision') > 0
        OR instr(lower(trim(notes.value)), 'second edition') > 0
        OR instr(lower(trim(notes.value)), 'third edition') > 0
        OR instr(lower(trim(notes.value)), 'fourth edition') > 0
        OR instr(lower(trim(notes.value)), 'deluxe edition') > 0
        OR instr(lower(trim(notes.value)), 'big box') > 0
        OR instr(trim(notes.value), '版本') > 0
        OR instr(trim(notes.value), '修訂版') > 0
        OR instr(trim(notes.value), '新版') > 0
        OR instr(trim(notes.value), '第二版') > 0
        OR instr(trim(notes.value), '第三版') > 0
        OR instr(trim(notes.value), '第四版') > 0
        OR instr(trim(notes.value), '豪華版') > 0
        OR instr(trim(notes.value), '精裝版') > 0
        OR instr(trim(notes.value), '典藏版') > 0
        OR instr(trim(notes.value), '版') > 0
      THEN 'version'
      ELSE 'unknown'
    END AS entity_kind,
    1 AS source_priority
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

  UNION ALL

  SELECT
    base.game_id AS parent_game_id,
    trim(expansion.label) AS display_name,
    expansion.english_name,
    expansion.bgg_id,
    'expansion' AS entity_kind,
    2 AS source_priority
  FROM attribute_subject_components expansion
  JOIN attribute_subject_components base
    ON base.subject_id = expansion.subject_id
   AND base.component_type = 'base'
  WHERE expansion.component_type = 'expansion'
    AND base.game_id IS NOT NULL
    AND trim(expansion.label) <> ''
), normalized_rows AS (
  SELECT
    parent_game_id,
    display_name,
    english_name,
    bgg_id,
    entity_kind,
    source_priority,
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
  WHERE display_name <> ''
    AND entity_kind <> 'unknown'
), ranked_rows AS (
  SELECT
    parent_game_id,
    display_name,
    english_name,
    bgg_id,
    entity_kind,
    normalized_name,
    ROW_NUMBER() OVER (
      PARTITION BY parent_game_id, normalized_name
      ORDER BY source_priority DESC, length(display_name) DESC, display_name
    ) AS row_number
  FROM normalized_rows
)
INSERT INTO migration_0068_variant_candidates (
  candidate_key,
  parent_game_id,
  display_name,
  normalized_name,
  entity_kind,
  english_name,
  bgg_id
)
SELECT
  parent_game_id || ':' || normalized_name,
  parent_game_id,
  display_name,
  normalized_name,
  entity_kind,
  english_name,
  bgg_id
FROM ranked_rows
WHERE row_number = 1;

UPDATE migration_0068_variant_candidates
SET
  entity_id = 'game-variant-' || lower(hex(randomblob(16))),
  entity_slug = 'variant-' || lower(hex(randomblob(16)))
WHERE entity_id IS NULL;

INSERT INTO games (
  id,
  slug,
  display_name,
  english_name,
  normalized_name,
  merged_into_game_id,
  created_by,
  created_at,
  updated_at,
  visibility,
  review_status,
  attribute_enabled,
  entity_kind
)
SELECT
  candidates.entity_id,
  candidates.entity_slug,
  candidates.display_name,
  candidates.english_name,
  candidates.normalized_name,
  NULL,
  NULL,
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
  'hidden',
  'pending',
  0,
  candidates.entity_kind
FROM migration_0068_variant_candidates candidates;

-- System-promoted entities are reviewed immediately after passing the normal
-- insert guard (which requires non-editor inserts to start as pending).
UPDATE games
SET review_status = 'reviewed',
    reviewed_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE id IN (SELECT entity_id FROM migration_0068_variant_candidates);

INSERT INTO game_entity_relations (
  id,
  source_game_id,
  target_game_id,
  relation_type,
  created_at
)
SELECT
  'game-relation:' || candidates.entity_id || ':' || candidates.parent_game_id,
  candidates.entity_id,
  candidates.parent_game_id,
  CASE candidates.entity_kind
    WHEN 'expansion' THEN 'expansion_of'
    ELSE 'version_of'
  END,
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM migration_0068_variant_candidates candidates;

-- An existing canonical game keeps its BGG ID. A promoted entity may receive
-- an ID only when that ID is not already owned by another game.
UPDATE games
SET bgg_id = (
  SELECT candidates.bgg_id
  FROM migration_0068_variant_candidates candidates
  WHERE candidates.entity_id = games.id
    AND candidates.bgg_id IS NOT NULL
)
WHERE games.id IN (
  SELECT entity_id
  FROM migration_0068_variant_candidates
  WHERE bgg_id IS NOT NULL
)
  AND games.bgg_id IS NULL
  AND (
    SELECT COUNT(*)
    FROM migration_0068_variant_candidates candidates
    WHERE candidates.bgg_id = (
      SELECT candidate.bgg_id
      FROM migration_0068_variant_candidates candidate
      WHERE candidate.entity_id = games.id
    )
  ) = 1
  AND NOT EXISTS (
    SELECT 1
    FROM games other
    WHERE other.bgg_id = (
      SELECT candidate.bgg_id
      FROM migration_0068_variant_candidates candidate
      WHERE candidate.entity_id = games.id
    )
  );

INSERT OR IGNORE INTO game_external_ids (
  id,
  game_id,
  source,
  external_id,
  relation,
  created_at
)
SELECT
  'game-external:bgg:' || candidates.bgg_id,
  candidates.entity_id,
  'bgg',
  CAST(candidates.bgg_id AS TEXT),
  'primary',
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM migration_0068_variant_candidates candidates
WHERE candidates.bgg_id IS NOT NULL
  AND (
    SELECT COUNT(*)
    FROM migration_0068_variant_candidates same_id
    WHERE same_id.bgg_id = candidates.bgg_id
  ) = 1
  AND NOT EXISTS (
    SELECT 1
    FROM game_external_ids existing
    WHERE existing.source = 'bgg'
      AND existing.external_id = CAST(candidates.bgg_id AS TEXT)
  );

-- Carry component aliases into the shared entity alias table. The original
-- component aliases remain in place for the attribute catalog as well.
INSERT OR IGNORE INTO game_aliases (
  id,
  game_id,
  alias,
  normalized_alias,
  alias_type,
  created_at
)
SELECT
  'game-variant-alias:' || candidates.entity_id || ':' || lower(hex(randomblob(8))),
  candidates.entity_id,
  aliases.alias,
  aliases.normalized_alias,
  'alias',
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM migration_0068_variant_candidates candidates
JOIN attribute_subject_components expansion
  ON expansion.component_type = 'expansion'
 AND expansion.label = candidates.display_name
JOIN attribute_subject_components base
  ON base.subject_id = expansion.subject_id
 AND base.component_type = 'base'
 AND base.game_id = candidates.parent_game_id
JOIN attribute_subject_component_aliases aliases
  ON aliases.subject_id = expansion.subject_id
 AND aliases.component_order = expansion.component_order;

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
JOIN migration_0068_variant_candidates candidates
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

-- Attribute expansions already carry a parent component. Point them at the
-- promoted entity while retaining their existing BGG ID and label.
UPDATE attribute_subject_components
SET game_id = (
  SELECT candidates.entity_id
  FROM attribute_subject_components base
  JOIN migration_0068_variant_candidates candidates
    ON candidates.parent_game_id = base.game_id
   AND candidates.entity_kind = 'expansion'
   AND candidates.normalized_name = lower(
     replace(
       replace(
         replace(
         replace(
         replace(
           replace(
             replace(
               replace(trim(attribute_subject_components.label), ' ', ''),
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
  WHERE base.subject_id = attribute_subject_components.subject_id
    AND base.component_type = 'base'
  LIMIT 1
)
WHERE component_type = 'expansion'
  AND game_id IS NULL;

-- Expose the new classification and parent relation in the existing catalog
-- snapshot. Base games simply receive NULL parent fields.
DROP VIEW game_catalog_source;
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

DROP TRIGGER game_catalog_games_after_update;
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

DROP TABLE migration_0068_variant_candidates;
