-- Common Taiwan games verified on 2026-11-13. Execute this file as one D1 import.
-- Existing games are preserved. Only matching public game records can receive mappings or aliases.
WITH seed(bgg_id, display_name, english_name, zh_alias, name_key, english_key, alias_key, edition_ids) AS (
VALUES
  (2944, '德國心臟病', 'Halli Galli', NULL, '德國心臟病', 'halligalli', NULL, '[]'),
  (432, '誰是牛頭王', '6 nimmt!', NULL, '誰是牛頭王', '6nimmt', NULL, '[]'),
  (8946, 'Da Vinci Code', 'Da Vinci Code', '終極密碼', 'davincicode', 'davincicode', '終極密碼', '[]'),
  (63268, '嗒寶', 'Spot it!', NULL, '嗒寶', 'spotit', NULL, '[]'),
  (83195, '閃靈快手', 'Ghost Blitz', NULL, '閃靈快手', 'ghostblitz', NULL, '[]'),
  (172225, '爆炸貓', 'Exploding Kittens', NULL, '爆炸貓', 'explodingkittens', NULL, '[]'),
  (254640, '獨家暗語', 'Just One', NULL, '獨家暗語', 'justone', NULL, '[]'),
  (262543, '心靈共感', 'Wavelength', NULL, '心靈共感', 'wavelength', NULL, '[]'),
  (92415, '骷髏牌', 'Skull', NULL, '骷髏牌', 'skull', NULL, '[]'),
  (147949, 'One Night Ultimate Werewolf', 'One Night Ultimate Werewolf', '一夜終極狼人', 'onenightultimatewerewolf', 'onenightultimatewerewolf', '一夜終極狼人', '[]'),
  (420087, '七翻天', 'Flip 7', NULL, '七翻天', 'flip7', NULL, '[]'),
  (41, '欲罷不能', 'Can''t Stop', NULL, '欲罷不能', 'cantstop', NULL, '[]'),
  (169654, 'Deep Sea Adventure', 'Deep Sea Adventure', '海底探險', 'deepseaadventure', 'deepseaadventure', '海底探險', '[]'),
  (15512, '印加寶藏', 'Incan Gold', NULL, '印加寶藏', 'incangold', NULL, '[]'),
  (171131, 'Captain Sonar', 'Captain Sonar', '深海諜影', 'captainsonar', 'captainsonar', '深海諜影', '[]'),
  (295947, '卡斯卡迪亞之旅', 'Cascadia', NULL, '卡斯卡迪亞之旅', 'cascadia', NULL, '[]'),
  (199561, '聖家族大教堂', 'Sagrada', NULL, '聖家族大教堂', 'sagrada', NULL, '[]'),
  (70919, '熊貓御竹園', 'Takenoko', NULL, '熊貓御竹園', 'takenoko', NULL, '[]'),
  (123540, 'Tokaido', 'Tokaido', '東海道', 'tokaido', 'tokaido', '東海道', '[]'),
  (70323, '東京之王', 'King of Tokyo', NULL, '東京之王', 'kingoftokyo', NULL, '[]'),
  (191862, 'Imhotep', 'Imhotep', '印和闐', 'imhotep', 'imhotep', '印和闐', '[]'),
  (50, 'Lost Cities', 'Lost Cities', '失落的城市', 'lostcities', 'lostcities', '失落的城市', '[]'),
  (54043, 'Jaipur', 'Jaipur', '齋普爾', 'jaipur', 'jaipur', '齋普爾', '[]'),
  (2655, 'Hive', 'Hive', '蟲蟲攻防戰', 'hive', 'hive', '蟲蟲攻防戰', '[]'),
  (2453, 'Blokus', 'Blokus', '大格鬥', 'blokus', 'blokus', '大格鬥', '[]'),
  (624, '步步為營', 'Quoridor', NULL, '步步為營', 'quoridor', NULL, '[]'),
  (291453, 'SCOUT', 'SCOUT', '馬戲星探', 'scout', 'scout', '馬戲星探', '[]'),
  (283155, 'Calico', 'Calico', '貓與花毯', 'calico', 'calico', '貓與花毯', '[]'),
  (367220, '海鹽折紙', 'Sea Salt & Paper', NULL, '海鹽折紙', 'seasaltpaper', NULL, '[]'),
  (345972, '盒中貓', 'Cat in the Box', NULL, '盒中貓', 'catinthebox', NULL, '[]'),
  (411567, '紙牌幫', 'The Gang', NULL, '紙牌幫', 'thegang', NULL, '[]'),
  (391163, '森森不息', 'Forest Shuffle', NULL, '森森不息', 'forestshuffle', NULL, '[]'),
  (373106, '天合小隊', 'Sky Team', NULL, '天合小隊', 'skyteam', NULL, '[]'),
  (366013, '熱力狂飆', 'Heat: Pedal to the Metal', NULL, '熱力狂飆', 'heatpedaltothemetal', NULL, '[]'),
  (249259, 'War Chest', 'War Chest', '戰爭之匣', 'warchest', 'warchest', '戰爭之匣', '[]')
)
INSERT INTO games (
  id, slug, display_name, english_name, normalized_name, created_at, updated_at,
  visibility, review_status, attribute_enabled, bgg_id, entity_kind
)
SELECT 'game_bgg_' || seed.bgg_id, 'bgg-' || seed.bgg_id, seed.display_name,
  seed.english_name, seed.name_key, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER),
  'public', 'pending', 1, seed.bgg_id, 'base'
FROM seed
WHERE NOT EXISTS (
  SELECT 1 FROM games
  WHERE bgg_id = seed.bgg_id OR id = 'game_bgg_' || seed.bgg_id OR slug = 'bgg-' || seed.bgg_id
    OR normalized_name IN (seed.name_key, seed.english_key, seed.alias_key)
    OR english_name = seed.english_name COLLATE NOCASE
)
AND NOT EXISTS (
  SELECT 1 FROM game_external_ids
  WHERE source = 'bgg' AND external_id = CAST(seed.bgg_id AS TEXT)
)
AND NOT EXISTS (
  SELECT 1 FROM json_each(seed.edition_ids) AS edition
  WHERE EXISTS (SELECT 1 FROM games WHERE bgg_id = edition.value)
    OR EXISTS (SELECT 1 FROM game_external_ids WHERE source = 'bgg' AND external_id = CAST(edition.value AS TEXT))
)
AND NOT EXISTS (
  SELECT 1 FROM game_aliases WHERE normalized_alias IN (seed.name_key, seed.english_key, seed.alias_key)
);

WITH seed(bgg_id, display_name, english_name, zh_alias, name_key, english_key, alias_key, edition_ids) AS (
VALUES
  (2944, '德國心臟病', 'Halli Galli', NULL, '德國心臟病', 'halligalli', NULL, '[]'),
  (432, '誰是牛頭王', '6 nimmt!', NULL, '誰是牛頭王', '6nimmt', NULL, '[]'),
  (8946, 'Da Vinci Code', 'Da Vinci Code', '終極密碼', 'davincicode', 'davincicode', '終極密碼', '[]'),
  (63268, '嗒寶', 'Spot it!', NULL, '嗒寶', 'spotit', NULL, '[]'),
  (83195, '閃靈快手', 'Ghost Blitz', NULL, '閃靈快手', 'ghostblitz', NULL, '[]'),
  (172225, '爆炸貓', 'Exploding Kittens', NULL, '爆炸貓', 'explodingkittens', NULL, '[]'),
  (254640, '獨家暗語', 'Just One', NULL, '獨家暗語', 'justone', NULL, '[]'),
  (262543, '心靈共感', 'Wavelength', NULL, '心靈共感', 'wavelength', NULL, '[]'),
  (92415, '骷髏牌', 'Skull', NULL, '骷髏牌', 'skull', NULL, '[]'),
  (147949, 'One Night Ultimate Werewolf', 'One Night Ultimate Werewolf', '一夜終極狼人', 'onenightultimatewerewolf', 'onenightultimatewerewolf', '一夜終極狼人', '[]'),
  (420087, '七翻天', 'Flip 7', NULL, '七翻天', 'flip7', NULL, '[]'),
  (41, '欲罷不能', 'Can''t Stop', NULL, '欲罷不能', 'cantstop', NULL, '[]'),
  (169654, 'Deep Sea Adventure', 'Deep Sea Adventure', '海底探險', 'deepseaadventure', 'deepseaadventure', '海底探險', '[]'),
  (15512, '印加寶藏', 'Incan Gold', NULL, '印加寶藏', 'incangold', NULL, '[]'),
  (171131, 'Captain Sonar', 'Captain Sonar', '深海諜影', 'captainsonar', 'captainsonar', '深海諜影', '[]'),
  (295947, '卡斯卡迪亞之旅', 'Cascadia', NULL, '卡斯卡迪亞之旅', 'cascadia', NULL, '[]'),
  (199561, '聖家族大教堂', 'Sagrada', NULL, '聖家族大教堂', 'sagrada', NULL, '[]'),
  (70919, '熊貓御竹園', 'Takenoko', NULL, '熊貓御竹園', 'takenoko', NULL, '[]'),
  (123540, 'Tokaido', 'Tokaido', '東海道', 'tokaido', 'tokaido', '東海道', '[]'),
  (70323, '東京之王', 'King of Tokyo', NULL, '東京之王', 'kingoftokyo', NULL, '[]'),
  (191862, 'Imhotep', 'Imhotep', '印和闐', 'imhotep', 'imhotep', '印和闐', '[]'),
  (50, 'Lost Cities', 'Lost Cities', '失落的城市', 'lostcities', 'lostcities', '失落的城市', '[]'),
  (54043, 'Jaipur', 'Jaipur', '齋普爾', 'jaipur', 'jaipur', '齋普爾', '[]'),
  (2655, 'Hive', 'Hive', '蟲蟲攻防戰', 'hive', 'hive', '蟲蟲攻防戰', '[]'),
  (2453, 'Blokus', 'Blokus', '大格鬥', 'blokus', 'blokus', '大格鬥', '[]'),
  (624, '步步為營', 'Quoridor', NULL, '步步為營', 'quoridor', NULL, '[]'),
  (291453, 'SCOUT', 'SCOUT', '馬戲星探', 'scout', 'scout', '馬戲星探', '[]'),
  (283155, 'Calico', 'Calico', '貓與花毯', 'calico', 'calico', '貓與花毯', '[]'),
  (367220, '海鹽折紙', 'Sea Salt & Paper', NULL, '海鹽折紙', 'seasaltpaper', NULL, '[]'),
  (345972, '盒中貓', 'Cat in the Box', NULL, '盒中貓', 'catinthebox', NULL, '[]'),
  (411567, '紙牌幫', 'The Gang', NULL, '紙牌幫', 'thegang', NULL, '[]'),
  (391163, '森森不息', 'Forest Shuffle', NULL, '森森不息', 'forestshuffle', NULL, '[]'),
  (373106, '天合小隊', 'Sky Team', NULL, '天合小隊', 'skyteam', NULL, '[]'),
  (366013, '熱力狂飆', 'Heat: Pedal to the Metal', NULL, '熱力狂飆', 'heatpedaltothemetal', NULL, '[]'),
  (249259, 'War Chest', 'War Chest', '戰爭之匣', 'warchest', 'warchest', '戰爭之匣', '[]')
)
INSERT INTO game_external_ids (id, game_id, source, external_id, relation, created_at)
SELECT 'game-external:bgg:' || seed.bgg_id, game.id, 'bgg',
  CAST(seed.bgg_id AS TEXT), 'primary', CAST(unixepoch('subsec') * 1000 AS INTEGER)
FROM seed
JOIN games game ON game.id = 'game_bgg_' || seed.bgg_id
  AND game.bgg_id = seed.bgg_id AND game.slug = 'bgg-' || seed.bgg_id
  AND game.display_name = seed.display_name AND game.english_name = seed.english_name
  AND game.normalized_name = seed.name_key AND game.attribute_enabled = 1
  AND game.entity_kind = 'base' AND game.visibility = 'public' AND game.merged_into_game_id IS NULL
WHERE NOT EXISTS (
  SELECT 1 FROM game_external_ids WHERE source = 'bgg' AND external_id = CAST(seed.bgg_id AS TEXT)
);

WITH seed(bgg_id, display_name, english_name, zh_alias, name_key, english_key, alias_key, edition_ids) AS (
VALUES
  (2944, '德國心臟病', 'Halli Galli', NULL, '德國心臟病', 'halligalli', NULL, '[]'),
  (432, '誰是牛頭王', '6 nimmt!', NULL, '誰是牛頭王', '6nimmt', NULL, '[]'),
  (8946, 'Da Vinci Code', 'Da Vinci Code', '終極密碼', 'davincicode', 'davincicode', '終極密碼', '[]'),
  (63268, '嗒寶', 'Spot it!', NULL, '嗒寶', 'spotit', NULL, '[]'),
  (83195, '閃靈快手', 'Ghost Blitz', NULL, '閃靈快手', 'ghostblitz', NULL, '[]'),
  (172225, '爆炸貓', 'Exploding Kittens', NULL, '爆炸貓', 'explodingkittens', NULL, '[]'),
  (254640, '獨家暗語', 'Just One', NULL, '獨家暗語', 'justone', NULL, '[]'),
  (262543, '心靈共感', 'Wavelength', NULL, '心靈共感', 'wavelength', NULL, '[]'),
  (92415, '骷髏牌', 'Skull', NULL, '骷髏牌', 'skull', NULL, '[]'),
  (147949, 'One Night Ultimate Werewolf', 'One Night Ultimate Werewolf', '一夜終極狼人', 'onenightultimatewerewolf', 'onenightultimatewerewolf', '一夜終極狼人', '[]'),
  (420087, '七翻天', 'Flip 7', NULL, '七翻天', 'flip7', NULL, '[]'),
  (41, '欲罷不能', 'Can''t Stop', NULL, '欲罷不能', 'cantstop', NULL, '[]'),
  (169654, 'Deep Sea Adventure', 'Deep Sea Adventure', '海底探險', 'deepseaadventure', 'deepseaadventure', '海底探險', '[]'),
  (15512, '印加寶藏', 'Incan Gold', NULL, '印加寶藏', 'incangold', NULL, '[]'),
  (171131, 'Captain Sonar', 'Captain Sonar', '深海諜影', 'captainsonar', 'captainsonar', '深海諜影', '[]'),
  (295947, '卡斯卡迪亞之旅', 'Cascadia', NULL, '卡斯卡迪亞之旅', 'cascadia', NULL, '[]'),
  (199561, '聖家族大教堂', 'Sagrada', NULL, '聖家族大教堂', 'sagrada', NULL, '[]'),
  (70919, '熊貓御竹園', 'Takenoko', NULL, '熊貓御竹園', 'takenoko', NULL, '[]'),
  (123540, 'Tokaido', 'Tokaido', '東海道', 'tokaido', 'tokaido', '東海道', '[]'),
  (70323, '東京之王', 'King of Tokyo', NULL, '東京之王', 'kingoftokyo', NULL, '[]'),
  (191862, 'Imhotep', 'Imhotep', '印和闐', 'imhotep', 'imhotep', '印和闐', '[]'),
  (50, 'Lost Cities', 'Lost Cities', '失落的城市', 'lostcities', 'lostcities', '失落的城市', '[]'),
  (54043, 'Jaipur', 'Jaipur', '齋普爾', 'jaipur', 'jaipur', '齋普爾', '[]'),
  (2655, 'Hive', 'Hive', '蟲蟲攻防戰', 'hive', 'hive', '蟲蟲攻防戰', '[]'),
  (2453, 'Blokus', 'Blokus', '大格鬥', 'blokus', 'blokus', '大格鬥', '[]'),
  (624, '步步為營', 'Quoridor', NULL, '步步為營', 'quoridor', NULL, '[]'),
  (291453, 'SCOUT', 'SCOUT', '馬戲星探', 'scout', 'scout', '馬戲星探', '[]'),
  (283155, 'Calico', 'Calico', '貓與花毯', 'calico', 'calico', '貓與花毯', '[]'),
  (367220, '海鹽折紙', 'Sea Salt & Paper', NULL, '海鹽折紙', 'seasaltpaper', NULL, '[]'),
  (345972, '盒中貓', 'Cat in the Box', NULL, '盒中貓', 'catinthebox', NULL, '[]'),
  (411567, '紙牌幫', 'The Gang', NULL, '紙牌幫', 'thegang', NULL, '[]'),
  (391163, '森森不息', 'Forest Shuffle', NULL, '森森不息', 'forestshuffle', NULL, '[]'),
  (373106, '天合小隊', 'Sky Team', NULL, '天合小隊', 'skyteam', NULL, '[]'),
  (366013, '熱力狂飆', 'Heat: Pedal to the Metal', NULL, '熱力狂飆', 'heatpedaltothemetal', NULL, '[]'),
  (249259, 'War Chest', 'War Chest', '戰爭之匣', 'warchest', 'warchest', '戰爭之匣', '[]')
)
INSERT INTO game_aliases (id, game_id, alias, normalized_alias, alias_type, created_at)
SELECT 'game-alias:taiwan-common:' || seed.bgg_id, game.id, seed.zh_alias, seed.alias_key, 'alias', CAST(unixepoch('subsec') * 1000 AS INTEGER)
FROM seed
JOIN games game ON game.id = 'game_bgg_' || seed.bgg_id
  AND game.bgg_id = seed.bgg_id AND game.slug = 'bgg-' || seed.bgg_id
  AND game.display_name = seed.display_name AND game.english_name = seed.english_name
  AND game.normalized_name = seed.name_key AND game.attribute_enabled = 1
  AND game.entity_kind = 'base' AND game.visibility = 'public' AND game.merged_into_game_id IS NULL
JOIN game_external_ids external ON external.game_id = game.id AND external.source = 'bgg'
  AND external.external_id = CAST(seed.bgg_id AS TEXT) AND external.relation = 'primary'
WHERE seed.zh_alias IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM game_aliases WHERE normalized_alias = seed.alias_key)
AND NOT EXISTS (SELECT 1 FROM games WHERE normalized_name = seed.alias_key);

-- Extra common names, including English trade names, for games created above.
WITH seed(bgg_id, display_name, alias, alias_key) AS (
VALUES
  (432, '誰是牛頭王', 'Take 6!', 'take6'),
  (8946, 'Da Vinci Code', '達文西密碼', '達文西密碼'),
  (63268, '嗒寶', '哆寶', '哆寶'),
  (63268, '嗒寶', 'Dobble', 'dobble'),
  (83195, '閃靈快手', 'Geistesblitz', 'geistesblitz'),
  (92415, '骷髏牌', '骷髏與玫瑰', '骷髏與玫瑰'),
  (199561, '聖家族大教堂', '聖家堂', '聖家堂'),
  (2453, 'Blokus', '格格不入', '格格不入')
)
INSERT INTO game_aliases (id, game_id, alias, normalized_alias, alias_type, created_at)
SELECT 'game-alias:taiwan-common:' || seed.bgg_id || ':' || seed.alias_key, game.id, seed.alias, seed.alias_key, 'alias', CAST(unixepoch('subsec') * 1000 AS INTEGER)
FROM seed
JOIN games game ON game.id = 'game_bgg_' || seed.bgg_id AND game.bgg_id = seed.bgg_id AND game.display_name = seed.display_name
  AND game.visibility = 'public' AND game.merged_into_game_id IS NULL
WHERE NOT EXISTS (SELECT 1 FROM game_aliases WHERE normalized_alias = seed.alias_key)
AND NOT EXISTS (SELECT 1 FROM games WHERE normalized_name = seed.alias_key);
