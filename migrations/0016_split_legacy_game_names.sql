-- Split legacy "English 中文" display names into the existing display_name and english_name columns.
-- Slugs stay unchanged so existing links remain valid; the mixed names remain searchable aliases.

CREATE TABLE migration_0016_game_name_splits (
  key TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  mixed_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  english_name TEXT NOT NULL,
  normalized_display_name TEXT NOT NULL,
  normalized_english_name TEXT NOT NULL,
  normalized_mixed_name TEXT NOT NULL
);

INSERT INTO migration_0016_game_name_splits VALUES
  ('alma_mater', 'game_cea0d8b83eee06e0f2d8', 'Alma Mater 盛譽學園', '盛譽學園', 'Alma Mater', '盛譽學園', 'almamater', 'almamater盛譽學園'),
  ('charterstone', 'game_239b0d21452b789fb8e6', 'Charterstone 契約石', '契約石', 'Charterstone', '契約石', 'charterstone', 'charterstone契約石'),
  ('clinic', 'game_531a0dc4453f98df4dad', 'Clinic 主題診所', '主題診所', 'Clinic', '主題診所', 'clinic', 'clinic主題診所'),
  ('coimbra', 'game_f9e9320a86f3d19591c4', 'Coimbra 科英布拉', '科英布拉', 'Coimbra', '科英布拉', 'coimbra', 'coimbra科英布拉'),
  ('evolution', 'game_db98b5b57e133b1b1719', 'Evolution 新演化論', '新演化論', 'Evolution', '新演化論', 'evolution', 'evolution新演化論'),
  ('first_rat', 'game_5d29e35371b488f2af8e', 'First Rat 萌鼠拆月', '萌鼠拆月', 'First Rat', '萌鼠拆月', 'firstrat', 'firstrat萌鼠拆月'),
  ('forum_trajanum', 'game_c60bfdcbe524ea95e1ca', 'Forum Trajanum 圖拉真廣場', '圖拉真廣場', 'Forum Trajanum', '圖拉真廣場', 'forumtrajanum', 'forumtrajanum圖拉真廣場'),
  ('furnace', 'game_291449cf7ff8e2b54bd0', 'Furnace 熔爐革命', '熔爐革命', 'Furnace', '熔爐革命', 'furnace', 'furnace熔爐革命'),
  ('glen_more_ii', 'game_af1c6f0ccbf43ddee8f3', 'Glen More II: Chronicles 格蘭摩爾2', '格蘭摩爾2', 'Glen More II: Chronicles', '格蘭摩爾2', 'glenmoreiichronicles', 'glenmoreiichronicles格蘭摩爾2'),
  ('great_western_trail', 'game_91279ecd97ec9e72afeb', 'Great Western Trail 大西部之旅', '大西部之旅', 'Great Western Trail', '大西部之旅', 'greatwesterntrail', 'greatwesterntrail大西部之旅'),
  ('hadrians_wall', 'game_a650a4e8029c40c5146e', 'Hadrian''s Wall 哈德良長城', '哈德良長城', 'Hadrian''s Wall', '哈德良長城', 'hadrianswall', 'hadrianswall哈德良長城'),
  ('las_vegas_royale', 'game_6919d2bb19d1c5b5d865', 'Las Vegas Royale 拉斯維加斯豪華版', '拉斯維加斯豪華版', 'Las Vegas Royale', '拉斯維加斯豪華版', 'lasvegasroyale', 'lasvegasroyale拉斯維加斯豪華版'),
  ('nefertiti', 'game_b5e824037bf6ac4b8f2e', 'Nefertiti 娜芙蒂蒂', '娜芙蒂蒂', 'Nefertiti', '娜芙蒂蒂', 'nefertiti', 'nefertiti娜芙蒂蒂'),
  ('paladins_west_kingdom', 'game_ed273ed757f26dd483b8', 'Paladins of the West Kingdom 西方王國聖騎士', '西方王國聖騎士', 'Paladins of the West Kingdom', '西方王國聖騎士', 'paladinsofthewestkingdom', 'paladinsofthewestkingdom西方王國聖騎士'),
  ('roads_and_boats', 'game_ac8643a25d35feb53388', 'Roads & Boats 路與船', '路與船', 'Roads & Boats', '路與船', 'roadsboats', 'roadsboats路與船'),
  ('santa_maria', 'game_ece22ff7f8cc887f560d', 'Santa Maria 聖瑪利亞號', '聖瑪利亞號', 'Santa Maria', '聖瑪利亞號', 'santamaria', 'santamaria聖瑪利亞號'),
  ('tekhenu', 'game_85ddc459ae54d272356d', 'Tekhenu: Obelisk of the Sun 方尖碑', '方尖碑', 'Tekhenu: Obelisk of the Sun', '方尖碑', 'tekhenuobeliskofthesun', 'tekhenuobeliskofthesun方尖碑'),
  ('the_magnificent', 'game_f6111657f5ff4844ffd4', 'The Magnificent 華麗開演', '華麗開演', 'The Magnificent', '華麗開演', 'themagnificent', 'themagnificent華麗開演'),
  ('trajan', 'game_bba34ef47e1dccb322e3', 'Trajan 圖拉真', '圖拉真', 'Trajan', '圖拉真', 'trajan', 'trajan圖拉真'),
  ('wealth_of_nations', 'game_8292bf1c24947afe4aa0', 'Wealth of Nations 國富論', '國富論', 'Wealth of Nations', '國富論', 'wealthofnations', 'wealthofnations國富論');

UPDATE games
SET display_name = (
      SELECT split.display_name FROM migration_0016_game_name_splits split WHERE split.game_id = games.id
    ),
    english_name = (
      SELECT split.english_name FROM migration_0016_game_name_splits split WHERE split.game_id = games.id
    ),
    normalized_name = (
      SELECT split.normalized_display_name FROM migration_0016_game_name_splits split WHERE split.game_id = games.id
    ),
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE EXISTS (
  SELECT 1 FROM migration_0016_game_name_splits split
  WHERE split.game_id = games.id
    AND split.mixed_name = games.display_name
    AND COALESCE(games.english_name, '') = ''
);

INSERT OR IGNORE INTO game_aliases (id, game_id, alias, normalized_alias, alias_type, created_at)
SELECT 'alias_split_' || split.key || '_mixed', split.game_id, split.mixed_name,
  split.normalized_mixed_name, 'legacy', CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM migration_0016_game_name_splits split
JOIN games game ON game.id = split.game_id
WHERE game.display_name = split.display_name AND game.english_name = split.english_name;

INSERT OR IGNORE INTO game_aliases (id, game_id, alias, normalized_alias, alias_type, created_at)
SELECT 'alias_split_' || split.key || '_display', split.game_id, split.display_name,
  split.normalized_display_name, 'official', CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM migration_0016_game_name_splits split
JOIN games game ON game.id = split.game_id
WHERE game.display_name = split.display_name AND game.english_name = split.english_name;

INSERT OR IGNORE INTO game_aliases (id, game_id, alias, normalized_alias, alias_type, created_at)
SELECT 'alias_split_' || split.key || '_english', split.game_id, split.english_name,
  split.normalized_english_name, 'alias', CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM migration_0016_game_name_splits split
JOIN games game ON game.id = split.game_id
WHERE game.display_name = split.display_name AND game.english_name = split.english_name;

DROP TABLE migration_0016_game_name_splits;
