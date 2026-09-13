-- Add every game newly present in BggDataFromGeekGroup_ddxu2(1150913).csv
-- relative to the earlier GeekGroup export. The ten records already resolved
-- by a local BGG identity are intentionally not duplicated.
CREATE TABLE migration_0096_geekgroup_delta_games (
  bgg_id INTEGER PRIMARY KEY,
  display_name TEXT NOT NULL,
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('base', 'expansion'))
);

INSERT INTO migration_0096_geekgroup_delta_games (bgg_id, display_name, entity_kind)
VALUES
  (51, 'Ricochet Robots', 'base'),
  (552, 'Bus', 'base'),
  (19646, 'Cowabunga', 'base'),
  (29073, 'Blockers!', 'base'),
  (32666, 'Wealth of Nations', 'base'),
  (133473, 'Sushi Go!', 'base'),
  (155020, 'Animals Frightening Night!', 'base'),
  (158991, 'Hannin Wa Odoru', 'base'),
  (166571, 'Tramways', 'base'),
  (167791, 'Terraforming Mars', 'base'),
  (182120, 'Histrio', 'base'),
  (184267, 'On Mars', 'base'),
  (200680, 'Agricola (Revised Edition)', 'base'),
  (203430, 'Fuji Flush', 'base'),
  (217780, 'Gentes', 'base'),
  (225694, 'Decrypto', 'base'),
  (226441, 'Fields of Arle: Tea & Trade', 'expansion'),
  (229853, 'Teotihuacan: City of Gods', 'base'),
  (239840, 'Micropolis', 'base'),
  (242302, 'Space Base', 'base'),
  (255984, 'Sleeping Gods', 'base'),
  (258308, 'Fuji', 'base'),
  (258779, 'Planet Unknown', 'base'),
  (260180, 'Project L', 'base'),
  (263236, 'Philosophy', 'base'),
  (269207, 'The Taverns of Tiefenthal', 'base'),
  (269511, 'Cooper Island', 'base'),
  (274688, 'Board Game Cafe Frenzy', 'base'),
  (276502, 'Roads & Boats: 20th Anniversary Edition', 'base'),
  (279537, 'The Search for Planet X', 'base'),
  (283948, 'Marco Polo II: In the Service of the Khan', 'base'),
  (284189, 'Foundations of Rome', 'base'),
  (284269, 'Taxi Derby', 'base'),
  (285533, 'Miyabi', 'base'),
  (286287, 'Newton: Great Discoveries Expansion', 'expansion'),
  (295895, 'Distilled', 'base'),
  (296626, 'Sonora', 'base'),
  (298383, 'Golem', 'base'),
  (300322, 'Hallertau', 'base'),
  (300877, 'New York Zoo', 'base'),
  (308493, 'Relics of Rajavihara', 'base'),
  (318977, 'MicroMacro: Crime City', 'base'),
  (324856, 'The Crew: Mission Deep Sea', 'base'),
  (325022, 'Coffee Traders', 'base'),
  (327971, 'Hippocrates', 'base'),
  (329591, 'Ultimate Railroads', 'base'),
  (333981, 'Bear Raid', 'base'),
  (336794, 'Galaxy Trucker (Second Edition)', 'base'),
  (341169, 'Great Western Trail: Second Edition', 'base'),
  (341945, 'La Granja: Deluxe Master Set', 'base'),
  (342894, 'Mythic Mischief', 'base'),
  (343905, 'Boonlake', 'base'),
  (347703, 'First Rat', 'base'),
  (347767, 'Ostia', 'base'),
  (350458, 'Terracotta Army', 'base'),
  (350933, 'The Guild of Merchant Explorers', 'base'),
  (351964, 'Spirit Fire', 'base'),
  (353545, 'Next Station: London', 'base'),
  (356123, 'Turing Machine', 'base'),
  (364011, 'Great Western Trail: Argentina', 'base'),
  (366469, 'Barrage: The Nile Affair Expansion', 'expansion'),
  (367201, 'Taiwan Night Market', 'base'),
  (380607, 'Great Western Trail: New Zealand', 'base'),
  (386166, 'Santorini: Pantheon Edition', 'base'),
  (388339, 'Planta Nubo', 'base'),
  (404183, 'Factory Inс.: A Smartphone Inc. Game', 'base'),
  (416232, 'Square One', 'base'),
  (417197, 'Rebirth', 'base'),
  (418062, 'Railroad Tiles', 'base'),
  (420805, 'Black Forest', 'base'),
  (438975, 'Sail Legacy', 'base'),
  (445424, 'Time to Panic', 'base'),
  (478137, 'Autonomous', 'base');

-- A prior import created this canonical game before its BGG identity was
-- retained in every local database lineage. Restore that proven identity
-- before the generic insert so this migration cannot create a duplicate.
UPDATE games
SET bgg_id = 283948,
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE id = 'game_d23674b15c14a9707f4b'
  AND bgg_id IS NULL;

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
  'public',
  'pending',
  NULL,
  1,
  imported.bgg_id,
  imported.entity_kind
FROM migration_0096_geekgroup_delta_games imported
WHERE NOT EXISTS (SELECT 1 FROM games game WHERE game.bgg_id = imported.bgg_id)
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
  FROM migration_0096_geekgroup_delta_games
)
  AND review_status = 'pending'
  AND created_by IS NULL;

INSERT OR IGNORE INTO game_external_ids
  (id, game_id, source, external_id, relation, created_at)
SELECT
  'game-external:bgg:' || CAST(imported.bgg_id AS TEXT),
  game.id,
  'bgg',
  CAST(imported.bgg_id AS TEXT),
  'primary',
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM migration_0096_geekgroup_delta_games imported
JOIN games game ON game.bgg_id = imported.bgg_id;

CREATE TABLE migration_0096_geekgroup_aliases (
  bgg_id INTEGER NOT NULL,
  alias TEXT NOT NULL,
  PRIMARY KEY (bgg_id, alias)
);

-- Final_BggCollection.csv supplies search aliases only; it does not establish
-- that a Chinese label is the canonical published title.
INSERT INTO migration_0096_geekgroup_aliases (bgg_id, alias)
VALUES
  (124361, '康考迪婭'),
  (145588, '小柑橘'),
  (145588, '柑橘城物語'),
  (159675, '阿勒農場'),
  (220308, '蓋亞計畫'),
  (244358, '大魔術師：學院擴'),
  (244358, '魔幻傳奇：學院擴'),
  (246784, '詭影尋蹤'),
  (552, '公車'),
  (19646, '狂牛衝浪'),
  (29073, '大爆格'),
  (32666, '國富論'),
  (133473, '迴轉壽司'),
  (155020, '動物夜怕怕'),
  (158991, '犯人在跳舞'),
  (167791, '殖民火星'),
  (167791, '重朔火星'),
  (167791, '重塑火星'),
  (184267, '火星之上'),
  (200680, '農家樂新版'),
  (200680, '農家樂'),
  (203430, '富士流'),
  (217780, '氏族'),
  (225694, '截碼戰'),
  (225694, '黑盒'),
  (226441, '亞勒大地：茶與貿易'),
  (226441, '阿勒農場：茶與貿易'),
  (229853, '特奧蒂瓦坎'),
  (229853, '特奧蒂瓦坎：眾神之城'),
  (239840, '迷你都市'),
  (242302, '太空基地'),
  (255984, '沉睡的神祉'),
  (255984, '睡神'),
  (255984, '沉睡的神祇'),
  (258779, '未知行星'),
  (260180, 'L計劃'),
  (269207, '深谷酒館'),
  (269511, '庫柏島'),
  (274688, '瘋狂桌遊店'),
  (276502, '路與船'),
  (279537, '尋找X行星'),
  (283948, '馬可波羅2'),
  (283948, '馬可波羅 II: 可汗的託付'),
  (284189, '羅馬霸業'),
  (284269, '計程車生存戰'),
  (284269, '終極殺陣'),
  (286287, '牛頓：偉大發現擴'),
  (295895, '滴酒成釀'),
  (296626, '索諾拉沙漠'),
  (298383, '魁儡魔像'),
  (300322, '哈勒陶農場'),
  (300877, '紐約動物園'),
  (318977, '小城大案：罪惡城市'),
  (318977, '小城大案：罪惡都市'),
  (324856, '星際探險隊：深海任務'),
  (325022, '咖啡商人'),
  (325022, '咖啡交易商'),
  (327971, '醫學之父'),
  (329591, '終極鐵路'),
  (333981, '空頭轟炸'),
  (336794, '銀河卡車司機'),
  (341169, '大西部開拓者：美利堅'),
  (341169, '大西部開拓者'),
  (341945, '拉格蘭哈豪華大師版'),
  (343905, '天恩湖'),
  (347703, '萌鼠摘月'),
  (350458, '兵馬俑'),
  (350933, '提戈梅公會'),
  (353545, '下一站：倫敦'),
  (356123, '圖靈解密'),
  (364011, '大西部開拓者：阿根廷'),
  (364011, '大西部開拓者：阿根廷開拓史'),
  (366469, '水壩尼羅河擴'),
  (367201, '台灣夜市'),
  (380607, '大西部開拓者：紐西蘭'),
  (380607, '大西部開拓者：紐西蘭開拓史'),
  (386166, '聖托里尼'),
  (388339, '天空植物園'),
  (388339, '雲端建木'),
  (418062, '阡陌交通板塊版'),
  (420805, '翠光密林'),
  (438975, '深海迷途：傳承版');

INSERT OR IGNORE INTO game_aliases
  (id, game_id, alias, normalized_alias, alias_type, created_at)
SELECT
  'game-alias:bgg:' || CAST(imported.bgg_id AS TEXT) || ':' || lower(replace(trim(imported.alias), ' ', '')),
  game.id,
  imported.alias,
  lower(replace(trim(imported.alias), ' ', '')),
  'alias',
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM migration_0096_geekgroup_aliases imported
JOIN games game ON game.bgg_id = imported.bgg_id;

-- This legacy expansion already had a Chinese display name, but no English
-- BGG label. Its identity comes directly from the newly reviewed CSV row.
UPDATE games
SET english_name = 'Trickerion: Dahlgaard''s Academy',
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE bgg_id = 244358
  AND (english_name IS NULL OR trim(english_name) = '');

-- The source CSV explicitly identifies these as expansions. Parent BGG IDs
-- are already canonical identities in the local catalog.
INSERT OR IGNORE INTO game_entity_relations
  (id, source_game_id, target_game_id, relation_type, created_at)
SELECT
  'game-relation:' || child.id || ':' || parent.id,
  child.id,
  parent.id,
  'expansion_of',
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM (
  SELECT 226441 AS child_bgg_id, 159675 AS parent_bgg_id
  UNION ALL SELECT 286287, 244711
  UNION ALL SELECT 366469, 251247
) mapping
JOIN games child ON child.bgg_id = mapping.child_bgg_id
JOIN games parent ON parent.bgg_id = mapping.parent_bgg_id;

DROP TABLE migration_0096_geekgroup_aliases;
DROP TABLE migration_0096_geekgroup_delta_games;

-- Rebuild compact snapshots so a fresh client receives this reviewed catalog
-- without replaying a large collection of game and attribute deltas.
DELETE FROM game_catalog_snapshot_chunks;
DELETE FROM game_catalog_snapshot_state;

WITH ordered AS (
  SELECT entry_json,
    CAST((ROW_NUMBER() OVER (
      ORDER BY json_extract(entry_json, '$.displayName'), game_id
    ) - 1) / 1000 AS INTEGER) AS chunk_number
  FROM game_catalog_entries
  WHERE deleted = 0 AND entry_json IS NOT NULL
), grouped AS (
  SELECT chunk_number, json_group_array(json(entry_json)) AS games_json
  FROM ordered
  GROUP BY chunk_number
)
INSERT INTO game_catalog_snapshot_chunks (generation, chunk_number, games_json)
SELECT 96, chunk_number, games_json FROM grouped;

INSERT INTO game_catalog_snapshot_chunks (generation, chunk_number, games_json)
SELECT 96, 0, '[]'
WHERE NOT EXISTS (SELECT 1 FROM game_catalog_snapshot_chunks WHERE generation = 96);

INSERT INTO game_catalog_snapshot_state (id, active_generation, through_version, chunk_count, generated_at)
SELECT 1, 96,
  (SELECT current_version FROM game_catalog_clock WHERE id = 1),
  COUNT(*),
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM game_catalog_snapshot_chunks
WHERE generation = 96;

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
SELECT 96, chunk_number, entries_json FROM grouped;

INSERT INTO attribute_catalog_snapshot_chunks (generation, chunk_number, entries_json)
SELECT 96, 0, '[]'
WHERE NOT EXISTS (SELECT 1 FROM attribute_catalog_snapshot_chunks WHERE generation = 96);

INSERT INTO attribute_catalog_snapshot_state
  (id, active_generation, through_version, chunk_count, attributes_json, score_model_version, generated_at)
SELECT
  1,
  96,
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
WHERE generation = 96;

PRAGMA optimize;
