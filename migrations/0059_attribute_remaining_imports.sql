-- Reconcile every remaining spreadsheet candidate into the shared game layer.
-- Standalone rows become canonical games, repeated rows remain independent
-- historical ratings, and base-plus-expansion rows become configurations.

CREATE TABLE migration_0059_games (
  candidate_id TEXT,
  game_id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  display_name TEXT NOT NULL,
  english_name TEXT,
  normalized_name TEXT NOT NULL,
  bgg_id INTEGER NOT NULL,
  attribute_enabled INTEGER NOT NULL CHECK (attribute_enabled IN (0, 1))
);

INSERT INTO migration_0059_games
  (candidate_id, game_id, slug, display_name, english_name, normalized_name, bgg_id, attribute_enabled)
VALUES
  ('attribute_candidate:3',  'game_attribute_import_azul', 'azul', '花磚物語', 'Azul', '花磚物語', 230802, 1),
  ('attribute_candidate:5',  'game_attribute_import_castell', 'castell', '疊人塔', 'Castell', '疊人塔', 238638, 1),
  ('attribute_candidate:9',  'game_attribute_import_indian_summer', 'indian-summer', '暖秋物語', 'Indian Summer', '暖秋物語', 233678, 1),
  ('attribute_candidate:10', 'game_attribute_import_spring_meadow', 'spring-meadow', 'Spring Meadow', NULL, 'springmeadow', 253684, 1),
  ('attribute_candidate:11', 'game_attribute_import_keyflower', 'keyflower', '五月花號', 'Keyflower', '五月花號', 122515, 1),
  ('attribute_candidate:13', 'game_attribute_import_key_flow', 'key-flow', '五月花流', 'Key Flow', '五月花流', 252446, 1),
  ('attribute_candidate:14', 'game_attribute_import_patchwork', 'patchwork', '拼布藝術', 'Patchwork', '拼布藝術', 163412, 1),
  ('attribute_candidate:15', 'game_attribute_import_cottage_garden', 'cottage-garden', '花舍物語', 'Cottage Garden', '花舍物語', 204027, 1),
  ('attribute_candidate:17', 'game_attribute_import_a_feast_for_odin', 'a-feast-for-odin', '奧丁的盛宴', 'A Feast for Odin', '奧丁的盛宴', 177736, 1),
  ('attribute_candidate:19', 'game_attribute_import_burano', 'burano', '彩色島', 'Burano', '彩色島', 181260, 1),
  ('attribute_candidate:20', 'game_attribute_import_newton', 'newton', '牛頓', 'Newton', '牛頓', 244711, 1),
  ('attribute_candidate:22', 'game_attribute_import_fields_of_arle', 'fields-of-arle', '亞勒大地', 'Fields of Arle', '亞勒大地', 159675, 1),
  ('attribute_candidate:23', 'game_attribute_import_tzolkin', 'tzolkin-the-mayan-calendar', '馬雅曆法', 'Tzolk''in: The Mayan Calendar', '馬雅曆法', 126163, 1),
  ('attribute_candidate:29', 'game_attribute_import_skyliners', 'skyliners', '天際線', 'Skyliners', '天際線', 182605, 1),
  ('attribute_candidate:31', 'game_attribute_import_shear_panic', 'shear-panic', '羊羊危機', 'Shear Panic', '羊羊危機', 18866, 1),
  ('attribute_candidate:32', 'game_attribute_import_marco_polo', 'the-voyages-of-marco-polo', '馬可波羅', 'The Voyages of Marco Polo', '馬可波羅', 171623, 1),
  ('attribute_candidate:36', 'game_attribute_import_maracaibo', 'maracaibo', '馬拉開波', 'Maracaibo', '馬拉開波', 276025, 1),
  ('attribute_candidate:37', 'game_attribute_import_gaia_project', 'gaia-project', '蓋亞計劃', 'Gaia Project', '蓋亞計劃', 220308, 1),
  ('attribute_candidate:38', 'game_attribute_import_fog_of_love', 'fog-of-love', 'Fog of Love', NULL, 'fogoflove', 175324, 1),
  ('attribute_candidate:39', 'game_attribute_import_and_then_we_held_hands', 'and-then-we-held-hands', '…and then, we held hands.', NULL, 'andthenweheldhands', 153999, 1),
  ('attribute_candidate:41', 'game_attribute_import_hansa_teutonica', 'hansa-teutonica', '和薩同盟', 'Hansa Teutonica', '和薩同盟', 43015, 1),
  ('attribute_candidate:42', 'game_attribute_import_concordia', 'concordia', '和諧羅馬', 'Concordia', '和諧羅馬', 124361, 1),
  ('attribute_candidate:43', 'game_attribute_import_the_mind', 'the-mind', '心靈同步', 'The Mind', '心靈同步', 244992, 1),
  ('attribute_candidate:44', 'game_attribute_import_hanabi', 'hanabi', '花火', 'Hanabi', '花火', 98778, 1),
  ('attribute_candidate:45', 'game_attribute_import_awkward_guests', 'awkward-guests', '不速之客', 'Awkward Guests: The Walton Case', '不速之客', 188866, 1),
  ('attribute_candidate:46', 'game_attribute_import_herbaceous', 'herbaceous', '本草', 'Herbaceous', '本草', 195314, 1),
  ('attribute_candidate:47', 'game_attribute_import_cryptid', 'cryptid', '神祕生物', 'Cryptid', '神祕生物', 246784, 1),
  ('attribute_candidate:48', 'game_attribute_import_nova_luna', 'nova-luna', '新月任務', 'Nova Luna', '新月任務', 284435, 1),
  ('attribute_candidate:49', 'game_attribute_import_juicy_fruits', 'juicy-fruits', '水果莊園', 'Juicy Fruits', '水果莊園', 325698, 1),
  ('attribute_candidate:50', 'game_attribute_import_citrus', 'citrus', '柑橘園物語', 'Citrus', '柑橘園物語', 145588, 1),
  ('attribute_candidate:51', 'game_attribute_import_hanamikoji', 'hanamikoji', '花見小路', 'Hanamikoji', '花見小路', 158600, 1),
  ('attribute_candidate:52', 'game_attribute_import_the_grizzled', 'the-grizzled', '步兵的恐懼', 'The Grizzled', '步兵的恐懼', 171668, 1),
  ('attribute_candidate:54', 'game_attribute_import_azul_sintra', 'azul-stained-glass-of-sintra', '花磚物語：琉璃之光', 'Azul: Stained Glass of Sintra', '花磚物語琉璃之光', 256226, 1),
  ('attribute_candidate:55', 'game_attribute_import_azul_summer_pavilion', 'azul-summer-pavilion', '花磚物語：夏日行宮', 'Azul: Summer Pavilion', '花磚物語夏日行宮', 287954, 1),
  ('attribute_candidate:56', 'game_attribute_import_railroad_ink', 'railroad-ink', '鐵路墨軌', 'Railroad Ink', '鐵路墨軌', 245654, 1),
  ('attribute_candidate:58', 'game_attribute_import_topiary', 'topiary', '修剪藝術', 'Topiary', '修剪藝術', 210900, 1),
  ('attribute_candidate:60', 'game_attribute_import_wingspan', 'wingspan', '展翅翱翔', 'Wingspan', '展翅翱翔', 266192, 1),
  ('attribute_candidate:63', 'game_attribute_import_kingdomino', 'kingdomino', '多米諾王國', 'Kingdomino', '多米諾王國', 204583, 1),
  ('attribute_candidate:64', 'game_attribute_import_queendomino', 'queendomino', '多米諾女王', 'Queendomino', '多米諾女王', 232043, 1),
  ('attribute_candidate:68', 'game_attribute_import_the_isle_of_cats', 'the-isle-of-cats', '貓島', 'The Isle of Cats', '貓島', 281259, 1),
  (NULL, 'game_attribute_import_the_7th_continent', 'the-7th-continent', '第七大陸', 'The 7th Continent', '第七大陸', 180263, 0),
  (NULL, 'game_ece22ff7f8cc887f560d', 'santa-maria', '聖瑪利亞號', 'Santa Maria', '聖瑪利亞號', 229220, 0),
  (NULL, 'game_3b77f7f4b22d03184c5b', 'barenpark', '熊熊公園', 'Bärenpark', '熊熊公園', 219513, 0),
  (NULL, 'game_e93681b393644145994dfcf71ee62b67', 'trickerion', '魔幻傳奇', 'Trickerion: Legends of Illusion', '魔幻傳奇', 163068, 0),
  (NULL, 'game_188f6b31d9b1b4888025', 'food-chain-magnate', 'Food Chain Magnate 快餐連鎖店', NULL, 'foodchainmagnate快餐連鎖店', 175914, 0),
  (NULL, 'game_91279ecd97ec9e72afeb', 'great-western-trail', '大西部之旅', 'Great Western Trail', '大西部之旅', 193738, 0),
  (NULL, 'game_f399aaa279bd4d1f5f26', 'barrage', 'Barrage 水壩', NULL, 'barrage水壩', 251247, 0),
  -- These canonical rows normally predate the attribute import on production.
  -- Provisioning them here also makes a migrations-only database complete.
  (NULL, 'game_af1c6f0ccbf43ddee8f3', 'glen-more-ii-chronicles', '格蘭摩爾2', 'Glen More II: Chronicles', '格蘭摩爾2', 265188, 0),
  (NULL, 'game_bba34ef47e1dccb322e3', 'trajan', '圖拉真', 'Trajan', '圖拉真', 102680, 0),
  (NULL, 'game_89d06dbb36089642bcc1', 'heaven-and-ale', '天堂與麥酒', 'Heaven & Ale', '天堂與麥酒', 227789, 0),
  (NULL, 'game_b9d5d8eaf27e55734042', 'qe', 'QE', NULL, 'qe', 266830, 0),
  (NULL, 'game_f6111657f5ff4844ffd4', 'the-magnificent', '華麗開演', 'The Magnificent', '華麗開演', 283863, 0),
  (NULL, 'game_d23674b15c14a9707f4b', 'marco-polo-ii', 'Marco Polo II: In the Service of the Khan 馬可波羅2', NULL, 'marcopoloiiintheserviceofthekhan馬可波羅2', 283948, 0),
  (NULL, 'game_a1c38db3091a9231100d', 'railroad-ink-challenge', 'Railroad Ink Challenge', NULL, 'railroadinkchallenge', 306881, 0),
  (NULL, 'game_ed273ed757f26dd483b8', 'paladins-of-the-west-kingdom', '西方王國聖騎士', 'Paladins of the West Kingdom', '西方王國聖騎士', 266810, 0),
  (NULL, 'game_7f41f30c5507cccef21c', 'lovelace-and-babbage', 'Lovelace & Babbage', NULL, 'lovelacebabbage', 257056, 0),
  (NULL, 'game_72f3ca8f795a40d3ab8df914292cf402', 'agricola', '農家樂', 'Agricola', '農家樂', 31260, 0),
  (NULL, 'game_e5ba503d7d3748cfa9c05314b038b473', 'ecos-first-continent', '生態圈：第一大陸', 'Ecos: First Continent', '生態圈第一大陸', 279254, 0),
  (NULL, 'game_attribute_import_santorini', 'santorini', '聖托里尼', 'Santorini', '聖托里尼', 194655, 0);

INSERT OR IGNORE INTO games (
  id, slug, display_name, english_name, normalized_name, created_by,
  created_at, updated_at, visibility, review_status, attribute_enabled
)
SELECT game_id, slug, display_name, english_name, normalized_name, NULL,
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
  'public', 'pending', attribute_enabled
FROM migration_0059_games;

UPDATE games
SET review_status = 'reviewed',
    reviewed_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE id IN (SELECT game_id FROM migration_0059_games)
  AND review_status = 'pending' AND created_by IS NULL;

UPDATE games
SET attribute_enabled = 1,
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE id IN (
  SELECT game_id FROM migration_0059_games
  WHERE candidate_id IS NOT NULL AND attribute_enabled = 1
);

-- Base components are the canonical location for BGG identity in the
-- attribute catalog. Existing shared games receive the same metadata without
-- changing their wrong-rule records or public names.
UPDATE attribute_subject_components
SET bgg_id = (
      SELECT imported.bgg_id FROM migration_0059_games imported
      WHERE imported.game_id = attribute_subject_components.game_id
    )
WHERE component_type = 'base'
  AND game_id IN (SELECT game_id FROM migration_0059_games);

CREATE TABLE migration_0059_configurations (
  candidate_id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  base_game_id TEXT NOT NULL REFERENCES games(id),
  expansion_label TEXT NOT NULL,
  expansion_bgg_id INTEGER NOT NULL
);

INSERT INTO migration_0059_configurations
  (candidate_id, subject_id, slug, display_name, base_game_id, expansion_label, expansion_bgg_id)
VALUES
  ('attribute_candidate:4',  'attribute_config_santa_maria_american_kingdoms', 'config-santa-maria-american-kingdoms', '聖瑪利亞號＋美洲大陸', 'game_ece22ff7f8cc887f560d', '美洲大陸（Santa Maria: American Kingdoms）', 251217),
  ('attribute_candidate:8',  'attribute_config_barenpark_bad_news_bears', 'config-barenpark-bad-news-bears', '熊熊公園＋灰熊大進擊', 'game_3b77f7f4b22d03184c5b', '灰熊大進擊（The Bad News Bears）', 264238),
  ('attribute_candidate:16', 'attribute_config_feast_for_odin_norwegians', 'config-feast-for-odin-norwegians', '奧丁的盛宴＋挪威人', 'game_attribute_import_a_feast_for_odin', '挪威人（The Norwegians）', 216788),
  ('attribute_candidate:21', 'attribute_config_trickerion_dahlgaards_academy', 'config-trickerion-dahlgaards-academy', '魔幻傳奇＋達爾加德學院', 'game_e93681b393644145994dfcf71ee62b67', '達爾加德學院（Dahlgaard''s Academy）', 244358),
  ('attribute_candidate:24', 'attribute_config_tzolkin_tribes_prophecies', 'config-tzolkin-tribes-prophecies', '馬雅曆法＋部落與預言', 'game_attribute_import_tzolkin', '部落與預言（Tribes & Prophecies）', 143065),
  ('attribute_candidate:26', 'attribute_config_food_chain_magnate_ketchup', 'config-food-chain-magnate-ketchup', '快餐連鎖店＋番茄醬機制', 'game_188f6b31d9b1b4888025', '番茄醬機制與其他點子（The Ketchup Mechanism & Other Ideas）', 261526),
  ('attribute_candidate:33', 'attribute_config_marco_polo_agents_venice', 'config-marco-polo-agents-venice', '馬可波羅＋威尼斯代理人', 'game_attribute_import_marco_polo', '威尼斯代理人（Agents of Venice）', 232945),
  ('attribute_candidate:35', 'attribute_config_great_western_trail_rails_north', 'config-great-western-trail-rails-north', '大西部之旅＋一路向北', 'game_91279ecd97ec9e72afeb', '一路向北（Rails to the North）', 245744),
  ('attribute_candidate:40', 'attribute_config_7th_continent_what_goes_up', 'config-7th-continent-what-goes-up', '第七大陸＋有起必有落', 'game_attribute_import_the_7th_continent', '有起必有落（What Goes Up, Must Come Down）', 236206),
  ('attribute_candidate:61', 'attribute_config_barrage_leeghwater', 'config-barrage-leeghwater', '水壩＋利格沃特計畫', 'game_f399aaa279bd4d1f5f26', '利格沃特計畫（The Leeghwater Project）', 263711);

INSERT OR IGNORE INTO attribute_subjects
  (id, slug, kind, display_name, game_id, created_at, updated_at)
SELECT subject_id, slug, 'configuration', display_name, NULL,
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM migration_0059_configurations;

INSERT OR IGNORE INTO attribute_subject_components
  (subject_id, component_order, game_id, component_type, label, bgg_id)
SELECT config.subject_id, 0, config.base_game_id, 'base', game.display_name, imported.bgg_id
FROM migration_0059_configurations config
JOIN games game ON game.id = config.base_game_id
JOIN migration_0059_games imported ON imported.game_id = config.base_game_id;

INSERT OR IGNORE INTO attribute_subject_components
  (subject_id, component_order, game_id, component_type, label, bgg_id)
SELECT subject_id, 1, NULL, 'expansion', expansion_label, expansion_bgg_id
FROM migration_0059_configurations;

INSERT OR IGNORE INTO attribute_score_states
  (subject_id, attribute_id, score, direct_sum, direct_count, comparison_count,
   decisive_comparison_count, evidence_count, model_version, updated_at,
   rating_deviation, random_key, question_slot)
SELECT config.subject_id, attribute.id, 5, 0, 0, 0, 0, 0, 'glicko-rd-v1',
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
  3, lower(hex(randomblob(16))), (abs(random()) % 200) + 1
FROM migration_0059_configurations config
CROSS JOIN attributes attribute
WHERE attribute.is_active = 1;

CREATE TABLE migration_0059_matches (
  candidate_id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES attribute_subjects(id)
);

INSERT INTO migration_0059_matches (candidate_id, subject_id)
SELECT candidate_id, 'attribute_subject_game:' || game_id
FROM migration_0059_games
WHERE candidate_id IS NOT NULL;

-- The spreadsheet contains Azul twice. Both rows are retained as separate
-- historical submissions against the same canonical subject.
INSERT INTO migration_0059_matches (candidate_id, subject_id)
VALUES ('attribute_candidate:53', 'attribute_subject_game:game_attribute_import_azul');

INSERT INTO migration_0059_matches (candidate_id, subject_id)
SELECT candidate_id, subject_id FROM migration_0059_configurations;

-- Earlier migrations matched these rows to games already present on the
-- production database. A migrations-only database has no seed catalog, so
-- repair only the rows that are still pending after provisioning the same
-- canonical IDs above. Production rows are intentionally left untouched.
WITH repair(candidate_id, game_id) AS (VALUES
  ('attribute_candidate:6',  'game_ece22ff7f8cc887f560d'),
  ('attribute_candidate:7',  'game_af1c6f0ccbf43ddee8f3'),
  ('attribute_candidate:12', 'game_3b77f7f4b22d03184c5b'),
  ('attribute_candidate:18', 'game_72f3ca8f795a40d3ab8df914292cf402'),
  ('attribute_candidate:25', 'game_188f6b31d9b1b4888025'),
  ('attribute_candidate:27', 'game_bba34ef47e1dccb322e3'),
  ('attribute_candidate:28', 'game_attribute_import_santorini'),
  ('attribute_candidate:30', 'game_e5ba503d7d3748cfa9c05314b038b473'),
  ('attribute_candidate:34', 'game_d23674b15c14a9707f4b'),
  ('attribute_candidate:57', 'game_a1c38db3091a9231100d'),
  ('attribute_candidate:59', 'game_89d06dbb36089642bcc1'),
  ('attribute_candidate:62', 'game_ed273ed757f26dd483b8'),
  ('attribute_candidate:65', 'game_b9d5d8eaf27e55734042'),
  ('attribute_candidate:66', 'game_7f41f30c5507cccef21c'),
  ('attribute_candidate:67', 'game_f6111657f5ff4844ffd4')
)
INSERT INTO migration_0059_matches (candidate_id, subject_id)
SELECT repair.candidate_id, subject.id
FROM repair
JOIN attribute_import_candidates candidate
  ON candidate.id = repair.candidate_id AND candidate.match_status = 'pending'
JOIN attribute_subjects subject
  ON subject.id = 'attribute_subject_game:' || repair.game_id;

UPDATE attribute_import_candidates
SET match_status = 'matched',
    subject_id = (
      SELECT mapping.subject_id FROM migration_0059_matches mapping
      WHERE mapping.candidate_id = attribute_import_candidates.id
    ),
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE id IN (SELECT candidate_id FROM migration_0059_matches)
  AND match_status = 'pending';

-- All targets are newly introduced score identities. Abort instead of
-- overwriting if a target somehow received evidence before this migration.
CREATE TABLE migration_0059_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
);

INSERT INTO migration_0059_guard (valid)
SELECT CASE WHEN NOT EXISTS (
  SELECT 1
  FROM attribute_score_states state
  JOIN migration_0059_matches mapping ON mapping.subject_id = state.subject_id
  WHERE state.evidence_count > 0
) THEN 1 ELSE 0 END;

DROP TABLE migration_0059_guard;

CREATE TABLE migration_0059_rating_seed (
  candidate_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  attribute_id TEXT NOT NULL,
  value REAL NOT NULL,
  PRIMARY KEY (candidate_id, attribute_id)
);

INSERT INTO migration_0059_rating_seed
  (candidate_id, subject_id, attribute_id, value)
SELECT candidate.id, candidate.subject_id, attribute.id,
  CAST(json_extract(candidate.values_json, '$[' || attribute.sort_order || ']') AS REAL)
FROM attribute_import_candidates candidate
CROSS JOIN attributes attribute
WHERE candidate.id IN (SELECT candidate_id FROM migration_0059_matches)
  AND candidate.match_status = 'matched'
  AND candidate.subject_id IS NOT NULL
  AND json_type(candidate.values_json, '$[' || attribute.sort_order || ']') IN ('integer', 'real');

INSERT OR IGNORE INTO attribute_ratings
  (id, subject_id, attribute_id, value, actor_id, session_id, created_at, updated_at)
SELECT 'attribute_rating_import:' || candidate_id || ':' || attribute_id,
  subject_id, attribute_id, value, NULL,
  'attribute-import:' || candidate_id, 0, 0
FROM migration_0059_rating_seed;

INSERT OR IGNORE INTO attribute_vote_responses
  (response_id, attribute_id, subject_a_id, subject_b_id, rating_a, rating_b,
   comparison, activity_json, actor_id, session_id, created_at, updated_at)
SELECT 'attribute-response-import:' || candidate_id || ':' || attribute_id,
  attribute_id, subject_id, NULL, value, NULL,
  NULL, '[]', NULL, 'attribute-import:' || candidate_id, 0, 0
FROM migration_0059_rating_seed;

-- Every imported subject has one source row except Azul, whose two rows carry
-- identical values. Aggregate by subject/attribute so source order cannot
-- affect the initialized state and both historical submissions remain counted.
UPDATE attribute_score_states
SET score = (
      SELECT AVG(seed.value) FROM migration_0059_rating_seed seed
      WHERE seed.subject_id = attribute_score_states.subject_id
        AND seed.attribute_id = attribute_score_states.attribute_id
    ),
    rating_deviation = CASE (
      SELECT COUNT(*) FROM migration_0059_rating_seed seed
      WHERE seed.subject_id = attribute_score_states.subject_id
        AND seed.attribute_id = attribute_score_states.attribute_id
    ) WHEN 1 THEN 1.5 ELSE 1.0606601717798212 END,
    direct_sum = (
      SELECT SUM(seed.value) FROM migration_0059_rating_seed seed
      WHERE seed.subject_id = attribute_score_states.subject_id
        AND seed.attribute_id = attribute_score_states.attribute_id
    ),
    direct_count = (
      SELECT COUNT(*) FROM migration_0059_rating_seed seed
      WHERE seed.subject_id = attribute_score_states.subject_id
        AND seed.attribute_id = attribute_score_states.attribute_id
    ),
    evidence_count = (
      SELECT COUNT(*) FROM migration_0059_rating_seed seed
      WHERE seed.subject_id = attribute_score_states.subject_id
        AND seed.attribute_id = attribute_score_states.attribute_id
    ),
    model_version = 'glicko-rd-v1',
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE evidence_count = 0
  AND EXISTS (
    SELECT 1 FROM migration_0059_rating_seed seed
    WHERE seed.subject_id = attribute_score_states.subject_id
      AND seed.attribute_id = attribute_score_states.attribute_id
  );

DROP TABLE migration_0059_rating_seed;
DROP TABLE migration_0059_matches;
DROP TABLE migration_0059_configurations;
DROP TABLE migration_0059_games;

PRAGMA optimize;
