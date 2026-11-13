-- Taiwan names for existing public games whose stored names did not match the research list. Added 2026-11-13.
-- Each alias is inserted only when the target game still has the expected id and name, and no game or alias already uses the key.
WITH seed(bgg_id, game_id, display_name, alias, alias_key) AS (
VALUES
  (178900, 'game_bgg_178900', 'Codenames', '機密代號', '機密代號'),
  (350184, 'game_bgg_350184', 'Earth', '藍星', '藍星'),
  (350184, 'game_bgg_350184', 'Earth', '地球', '地球'),
  (126163, 'game_attribute_import_tzolkin', '馬雅曆法', '卓爾金歷：瑪雅日曆', '卓爾金歷瑪雅日曆'),
  (163412, 'game_attribute_import_patchwork', '拼布藝術', '拼布對決', '拼布對決'),
  (171623, 'game_attribute_import_marco_polo', '馬可波羅', '馬可波羅遊記', '馬可波羅遊記'),
  (122515, 'game_attribute_import_keyflower', '五月花號', '大五月花號', '大五月花號'),
  (322289, 'game_c208fb0d657ac491df4e', '達爾文之旅', '達爾文的旅程', '達爾文的旅程'),
  (205637, 'game_529afe5dfdbf06141803', '詭鎮奇談LCG', '詭鎮奇談卡牌版', '詭鎮奇談卡牌版')
)
INSERT INTO game_aliases (id, game_id, alias, normalized_alias, alias_type, created_at)
SELECT 'game-alias:taiwan-known:' || seed.bgg_id || ':' || seed.alias_key, game.id, seed.alias, seed.alias_key,
  'alias', CAST(unixepoch('subsec') * 1000 AS INTEGER)
FROM seed
JOIN games game ON game.id = seed.game_id AND game.display_name = seed.display_name
  AND game.visibility = 'public' AND game.merged_into_game_id IS NULL
WHERE NOT EXISTS (SELECT 1 FROM game_aliases WHERE normalized_alias = seed.alias_key)
AND NOT EXISTS (SELECT 1 FROM games WHERE normalized_name = seed.alias_key);
