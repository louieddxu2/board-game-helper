-- Import the owner's currently unmatched GeekGroup collection records into
-- the shared game identity layer. This is a reviewed, fixed migration: public
-- CSV uploads remain local-only and cannot create arbitrary D1 rows.
CREATE TABLE migration_0075_owner_collection_games (
  bgg_id INTEGER PRIMARY KEY,
  display_name TEXT NOT NULL,
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('base', 'expansion', 'unknown'))
);

INSERT INTO migration_0075_owner_collection_games (bgg_id, display_name, entity_kind)
VALUES
  (125, 'Money!', 'base'),
  (214, 'Café International', 'base'),
  (394, 'Kahuna', 'base'),
  (503, 'Through the Desert', 'base'),
  (32125, 'Felicity: The Cat in the Sack', 'base'),
  (40628, 'Finca', 'base'),
  (63975, 'Mountain Goats', 'base'),
  (71074, 'Expedition: Northwest Passage – HMS Terror Edition', 'base'),
  (72287, 'Mr. Jack Pocket', 'base'),
  (109969, 'Mutant Meeples', 'base'),
  (121041, 'Pluckin'' Pairs', 'base'),
  (128271, 'Ginkgopolis', 'base'),
  (161417, 'Red7', 'base'),
  (166384, 'Spyfall', 'base'),
  (168232, 'Project Dreamscape', 'base'),
  (176887, 'Perspective', 'base'),
  (178900, 'Codenames', 'base'),
  (184462, 'Alchemidus', 'base'),
  (186475, 'Tofu Kingdom', 'base'),
  (197443, 'Fugitive', 'base'),
  (200853, 'Habitats', 'base'),
  (224122, 'AVES', 'base'),
  (231554, 'Herbalism', 'base'),
  (242149, 'Vadoran Gardens', 'base'),
  (247935, 'Tramways Engineer''s Workbook', 'base'),
  (251412, 'On Tour', 'base'),
  (253215, 'Jetpack Joyride', 'base'),
  (258041, 'Majolica', 'base'),
  (267979, 'Tiwanaku', 'base'),
  (277927, 'Bites', 'base'),
  (279720, 'Streets', 'base'),
  (286063, 'The 7th Citadel', 'base'),
  (287941, 'Formosa Tea', 'base'),
  (290484, 'Unsettled', 'base'),
  (292126, 'Excavation Earth', 'base'),
  (294230, 'Remember Our Trip', 'base'),
  (296912, 'Fort', 'base'),
  (299946, 'Eiyo', 'base'),
  (300300, 'Chronicles of Crime: 1400', 'base'),
  (301257, 'Maglev Metro', 'base'),
  (302098, 'Chronicles of Crime: 1900', 'base'),
  (302312, 'Chronicles of Crime: 2400', 'base'),
  (302461, 'Intrepid', 'base'),
  (305984, 'GPS', 'base'),
  (305986, 'Sequoia', 'base'),
  (310873, 'Carnegie', 'base'),
  (311930, 'Block and Key', 'base'),
  (312251, 'Curious Cargo', 'base'),
  (313807, 'Oros', 'base'),
  (318983, 'Faiyum', 'base'),
  (329862, 'Tiny Turbo Cars', 'base'),
  (330403, 'Moon Adventure', 'base'),
  (338013, 'Maracaibo: The Uprising', 'expansion'),
  (338460, 'The Isle of Cats: Explore & Draw', 'base'),
  (341974, 'Power Plants', 'base'),
  (344258, 'That Time You Killed Me', 'base'),
  (344554, 'Décorum', 'base'),
  (347883, 'Dandelions', 'base'),
  (350184, 'Earth', 'base'),
  (350468, 'Hội Phố (Second Edition)', 'base'),
  (350637, 'Regroup! Chicken Army', 'base'),
  (352454, 'Trailblazers', 'base'),
  (352574, 'Fit to Print', 'base'),
  (352695, 'Oranienburger Kanal', 'base'),
  (352892, 'Stampede', 'base'),
  (356952, 'Empire''s End', 'base'),
  (360471, 'Aquamarine', 'base'),
  (360706, 'On Tour: Paris and New York', 'base'),
  (363614, 'Switchbacks', 'base'),
  (107529, 'Kingdom Builder', 'base'),
  (378477, 'Awkward Guests 2: The Berwick Cases', 'base'),
  (384213, 'Fromage', 'base'),
  (385761, 'Faraway', 'base'),
  (387780, 'Rats of Wistar', 'base'),
  (388329, 'Waypoints', 'base'),
  (388476, 'Spectral', 'base'),
  (391497, 'Tangram City', 'base'),
  (396790, 'Nucleum', 'base'),
  (399987, 'A Message From the Stars', 'base'),
  (401217, 'Cascadito', 'base'),
  (407297, 'River Valley Glassworks', 'base'),
  (410238, 'Logic & Lore', 'base'),
  (413246, 'Bomb Busters', 'base'),
  (414317, 'Harmonies', 'base'),
  (418354, 'Babylon', 'base'),
  (419070, 'Tramways Engineer''s Workbook 2', 'base'),
  (424981, 'Eternal Decks', 'base'),
  (425873, 'Koala Rescue Club', 'base'),
  (426229, 'Overparked', 'base'),
  (428635, 'Ruins', 'base'),
  (428636, 'Oddland', 'base'),
  (428638, 'Vegas Strip', 'base'),
  (439520, 'Dragonarium', 'base'),
  (439561, 'Gruntz', 'base'),
  (445423, 'Graft', 'base'),
  (445552, 'The Great Evening Banquet', 'base'),
  (445868, '10 to Leave', 'base'),
  (460712, 'Mountain Goats: Legacy', 'base'),
  (460716, 'Enchanted Ivy', 'base');

INSERT INTO games (
  id, slug, display_name, english_name, normalized_name, merged_into_game_id,
  created_by, created_at, updated_at, visibility, review_status, reviewed_at,
  attribute_enabled, bgg_id, entity_kind
)
SELECT
  'game_bgg_' || CAST(imported.bgg_id AS TEXT),
  'bgg-' || CAST(imported.bgg_id AS TEXT),
  imported.display_name,
  NULL,
  lower(replace(trim(imported.display_name), ' ', '')),
  NULL,
  NULL,
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
  CASE imported.entity_kind WHEN 'unknown' THEN 'hidden' ELSE 'public' END,
  'pending',
  NULL,
  CASE imported.entity_kind WHEN 'unknown' THEN 0 ELSE 1 END,
  imported.bgg_id,
  imported.entity_kind
FROM migration_0075_owner_collection_games imported
WHERE NOT EXISTS (
  SELECT 1 FROM games game WHERE game.bgg_id = imported.bgg_id
)
AND NOT EXISTS (
  SELECT 1 FROM game_external_ids external_id
  WHERE external_id.source = 'bgg'
    AND external_id.external_id = CAST(imported.bgg_id AS TEXT)
);

UPDATE games
SET review_status = 'reviewed',
    reviewed_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE id IN (
  SELECT 'game_bgg_' || CAST(bgg_id AS TEXT)
  FROM migration_0075_owner_collection_games
)
AND review_status = 'pending'
AND created_by IS NULL;

-- Keep every primary BGG identity queryable from both the canonical game and
-- normalized external-ID directions.
INSERT OR IGNORE INTO game_external_ids
  (id, game_id, source, external_id, relation, created_at)
SELECT
  'game-external:bgg:' || CAST(imported.bgg_id AS TEXT),
  game.id,
  'bgg',
  CAST(imported.bgg_id AS TEXT),
  'primary',
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM migration_0075_owner_collection_games imported
JOIN games game ON game.bgg_id = imported.bgg_id;

-- Confirmed edition IDs map to existing canonical games and do not create
-- duplicate vote identities.
INSERT OR IGNORE INTO game_external_ids
  (id, game_id, source, external_id, relation, created_at)
VALUES
  ('game-external:bgg:251678', 'game_attribute_import_railroad_ink', 'bgg', '251678', 'edition',
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
  ('game-external:bgg:286749', 'game_attribute_import_hansa_teutonica', 'bgg', '286749', 'edition',
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
  ('game-external:bgg:441548', 'game_e93681b393644145994dfcf71ee62b67', 'bgg', '441548', 'edition',
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
  ('game-external:bgg:371095', 'game_bgg_107529', 'bgg', '371095', 'edition',
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)),
  ('game-external:bgg:404587', 'game_bgg_200853', 'bgg', '404587', 'edition',
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER));

-- The CSV explicitly marks this record as an expansion.
INSERT OR IGNORE INTO game_entity_relations
  (id, source_game_id, target_game_id, relation_type, created_at)
SELECT
  'game-relation:game_bgg_338013:game_attribute_import_maracaibo',
  'game_bgg_338013',
  'game_attribute_import_maracaibo',
  'expansion_of',
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE EXISTS (SELECT 1 FROM games WHERE id = 'game_bgg_338013')
  AND EXISTS (SELECT 1 FROM games WHERE id = 'game_attribute_import_maracaibo');

DROP TABLE migration_0075_owner_collection_games;

-- Replace the active baseline immediately. Clients should not have to consume
-- thousands of game/state deltas in 32-row pages after this one-time import.
DELETE FROM attribute_catalog_snapshot_chunks;
DELETE FROM attribute_catalog_snapshot_state;

WITH source_entries AS (
  SELECT
    'subject:' || source.subject_id AS entry_key,
    json_set(
      source.entry_json,
      '$.values',
      json(COALESCE((
        SELECT json_group_array(json(value_json))
        FROM (
          SELECT json_object(
            'subjectId', state.subject_id,
            'attributeId', state.attribute_id,
            'score', state.score,
            'ratingDeviation', state.rating_deviation,
            'directAverage', CASE WHEN state.direct_count > 0 THEN state.direct_sum / state.direct_count ELSE NULL END,
            'directCount', state.direct_count,
            'comparisonCount', state.comparison_count,
            'decisiveComparisonCount', state.decisive_comparison_count,
            'evidenceCount', state.evidence_count,
            'modelVersion', state.model_version
          ) AS value_json
          FROM attribute_score_states state
          WHERE state.subject_id = source.subject_id
          ORDER BY state.attribute_id
        )
      ), '[]'))
    ) AS entry_json
  FROM attribute_subject_catalog_source source
  WHERE source.is_eligible = 1

  UNION ALL

  SELECT
    'candidate:' || candidate.id,
    json_object(
      'kind', 'candidate',
      'candidate', json_object(
        'id', candidate.id,
        'displayName', candidate.source_name,
        'values', json(candidate.values_json),
        'matchStatus', candidate.match_status,
        'subjectId', candidate.subject_id,
        'sourceRowNumber', candidate.source_row_number
      )
    )
  FROM attribute_import_candidates candidate
  WHERE candidate.match_status IN ('pending', 'ambiguous')
), ordered AS (
  SELECT entry_json,
    CAST((ROW_NUMBER() OVER (ORDER BY entry_key) - 1) / 100 AS INTEGER) AS chunk_number
  FROM source_entries
), grouped AS (
  SELECT chunk_number, json_group_array(json(entry_json)) AS entries_json
  FROM ordered
  GROUP BY chunk_number
)
INSERT INTO attribute_catalog_snapshot_chunks (generation, chunk_number, entries_json)
SELECT 75, chunk_number, entries_json
FROM grouped;

INSERT INTO attribute_catalog_snapshot_chunks (generation, chunk_number, entries_json)
SELECT 75, 0, '[]'
WHERE NOT EXISTS (
  SELECT 1 FROM attribute_catalog_snapshot_chunks WHERE generation = 75
);

INSERT INTO attribute_catalog_snapshot_state
  (id, active_generation, through_version, chunk_count, attributes_json, score_model_version, generated_at)
SELECT
  1,
  75,
  (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
  COUNT(*),
  (
    SELECT json_group_array(json(attribute_json))
    FROM (
      SELECT json_object(
        'id', attribute.id,
        'key', attribute.key,
        'name', translation.name,
        'shortDescription', translation.short_description,
        'fullDescription', translation.full_description,
        'minValue', attribute.min_value,
        'maxValue', attribute.max_value,
        'sortOrder', attribute.sort_order
      ) AS attribute_json
      FROM attributes attribute
      JOIN attribute_translations translation
        ON translation.attribute_id = attribute.id
        AND translation.locale = 'zh-TW'
      WHERE attribute.is_active = 1
      ORDER BY attribute.sort_order, attribute.id
    )
  ),
  'glicko-rd-v1',
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM attribute_catalog_snapshot_chunks
WHERE generation = 75;

PRAGMA optimize;
