-- Proposed batch. Run both statements in one D1 binding batch after approval.
-- Use verify.sql to identify blocked or missing rows. Existing game rows are preserved.
WITH seed(bgg_id, display_name, original_name, name_key, original_key, alternate_ids) AS (
VALUES
  (128882, '阿瓦隆', 'The Resistance: Avalon', '阿瓦隆', 'theresistanceavalon', ''),
  (822, '卡卡頌', 'Carcassonne', '卡卡頌', 'carcassonne', ''),
  (13, '卡坦島', 'Catan', '卡坦島', 'catan', ''),
  (148228, '璀璨寶石', 'Splendor', '璀璨寶石', 'splendor', ''),
  (811, '拉密', 'Rummikub', '拉密', 'rummikub', ''),
  (10547, '山中小屋', 'Betrayal at House on the Hill', '山中小屋', 'betrayalathouseonthehill', ''),
  (120677, '神秘大地', 'Terra Mystica', '神秘大地', 'terramystica', ''),
  (25821, '米勒山谷狼人', 'The Werewolves of Miller''s Hollow', '米勒山谷狼人', 'thewerewolvesofmillershollow', ''),
  (68448, '七大奇蹟', '7 Wonders', '七大奇蹟', '7wonders', '316377'),
  (2223, 'UNO', 'UNO', 'uno', 'uno', ''),
  (9220, '矮人礦坑', 'Saboteur', '矮人礦坑', 'saboteur', ''),
  (2651, '電力公司', 'Power Grid', '電力公司', 'powergrid', ''),
  (129622, '情書', 'Love Letter', '情書', 'loveletter', '277085'),
  (478, '富饒之城', 'Citadels', '富饒之城', 'citadels', '205398'),
  (205059, '瘋狂詭宅二版', 'Mansions of Madness: Second Edition', '瘋狂詭宅二版', 'mansionsofmadnesssecondedition', ''),
  (174430, '幽港迷城', 'Gloomhaven', '幽港迷城', 'gloomhaven', ''),
  (84876, '勃根地城堡', 'The Castles of Burgundy', '勃根地城堡', 'thecastlesofburgundy', '271320,363622'),
  (28143, '銀河路跑', 'Race for the Galaxy', '銀河路跑', 'raceforthegalaxy', ''),
  (96848, '魔法騎士', 'Mage Knight Board Game', '魔法騎士', 'mageknightboardgame', ''),
  (108745, '四季物語', 'Seasons', '四季物語', 'seasons', ''),
  (3076, '波多黎各', 'Puerto Rico', '波多黎各', 'puertorico', ''),
  (169786, '鐮刀戰爭', 'Scythe', '鐮刀戰爭', 'scythe', ''),
  (15987, '魔鎮驚魂', 'Arkham Horror', '魔鎮驚魂', 'arkhamhorror', ''),
  (199792, '仙境幽谷', 'Everdell', '仙境幽谷', 'everdell', '')
)
INSERT INTO games (
  id, slug, display_name, english_name, normalized_name, created_at, updated_at,
  visibility, review_status, attribute_enabled, bgg_id, entity_kind
)
SELECT 'game_bgg_' || seed.bgg_id, 'bgg-' || seed.bgg_id, seed.display_name,
  seed.original_name, seed.name_key, CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER),
  'public', 'pending', 1, seed.bgg_id, 'base'
FROM seed
WHERE NOT EXISTS (
  SELECT 1 FROM games
  WHERE bgg_id = seed.bgg_id OR id = 'game_bgg_' || seed.bgg_id OR slug = 'bgg-' || seed.bgg_id
)
AND NOT EXISTS (
  SELECT 1 FROM game_external_ids
  WHERE source = 'bgg' AND external_id = CAST(seed.bgg_id AS TEXT)
)
AND NOT EXISTS (
  SELECT 1 FROM json_each('[' || seed.alternate_ids || ']') AS alternate
  WHERE EXISTS (SELECT 1 FROM games WHERE bgg_id = alternate.value)
     OR EXISTS (
       SELECT 1 FROM game_external_ids WHERE source = 'bgg' AND external_id = CAST(alternate.value AS TEXT)
     )
)
AND NOT EXISTS (
  SELECT 1 FROM games WHERE normalized_name IN (seed.name_key, seed.original_key)
)
AND NOT EXISTS (
  SELECT 1 FROM game_aliases WHERE normalized_alias IN (seed.name_key, seed.original_key)
);

WITH seed(bgg_id, display_name, original_name, name_key, original_key, alternate_ids) AS (
VALUES
  (128882, '阿瓦隆', 'The Resistance: Avalon', '阿瓦隆', 'theresistanceavalon', ''),
  (822, '卡卡頌', 'Carcassonne', '卡卡頌', 'carcassonne', ''),
  (13, '卡坦島', 'Catan', '卡坦島', 'catan', ''),
  (148228, '璀璨寶石', 'Splendor', '璀璨寶石', 'splendor', ''),
  (811, '拉密', 'Rummikub', '拉密', 'rummikub', ''),
  (10547, '山中小屋', 'Betrayal at House on the Hill', '山中小屋', 'betrayalathouseonthehill', ''),
  (120677, '神秘大地', 'Terra Mystica', '神秘大地', 'terramystica', ''),
  (25821, '米勒山谷狼人', 'The Werewolves of Miller''s Hollow', '米勒山谷狼人', 'thewerewolvesofmillershollow', ''),
  (68448, '七大奇蹟', '7 Wonders', '七大奇蹟', '7wonders', '316377'),
  (2223, 'UNO', 'UNO', 'uno', 'uno', ''),
  (9220, '矮人礦坑', 'Saboteur', '矮人礦坑', 'saboteur', ''),
  (2651, '電力公司', 'Power Grid', '電力公司', 'powergrid', ''),
  (129622, '情書', 'Love Letter', '情書', 'loveletter', '277085'),
  (478, '富饒之城', 'Citadels', '富饒之城', 'citadels', '205398'),
  (205059, '瘋狂詭宅二版', 'Mansions of Madness: Second Edition', '瘋狂詭宅二版', 'mansionsofmadnesssecondedition', ''),
  (174430, '幽港迷城', 'Gloomhaven', '幽港迷城', 'gloomhaven', ''),
  (84876, '勃根地城堡', 'The Castles of Burgundy', '勃根地城堡', 'thecastlesofburgundy', '271320,363622'),
  (28143, '銀河路跑', 'Race for the Galaxy', '銀河路跑', 'raceforthegalaxy', ''),
  (96848, '魔法騎士', 'Mage Knight Board Game', '魔法騎士', 'mageknightboardgame', ''),
  (108745, '四季物語', 'Seasons', '四季物語', 'seasons', ''),
  (3076, '波多黎各', 'Puerto Rico', '波多黎各', 'puertorico', ''),
  (169786, '鐮刀戰爭', 'Scythe', '鐮刀戰爭', 'scythe', ''),
  (15987, '魔鎮驚魂', 'Arkham Horror', '魔鎮驚魂', 'arkhamhorror', ''),
  (199792, '仙境幽谷', 'Everdell', '仙境幽谷', 'everdell', '')
)
INSERT INTO game_external_ids (id, game_id, source, external_id, relation, created_at)
SELECT 'game-external:bgg:' || seed.bgg_id, game.id, 'bgg',
  CAST(seed.bgg_id AS TEXT), 'primary', CAST(unixepoch('subsec') * 1000 AS INTEGER)
FROM seed
JOIN games game ON game.id = 'game_bgg_' || seed.bgg_id
  AND game.bgg_id = seed.bgg_id AND game.slug = 'bgg-' || seed.bgg_id
  AND game.display_name = seed.display_name AND game.english_name = seed.original_name
  AND game.entity_kind = 'base' AND game.visibility = 'public' AND game.merged_into_game_id IS NULL
WHERE NOT EXISTS (
  SELECT 1 FROM game_external_ids WHERE source = 'bgg' AND external_id = CAST(seed.bgg_id AS TEXT)
);
