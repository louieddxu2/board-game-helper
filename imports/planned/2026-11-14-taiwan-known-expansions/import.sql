-- Well-known expansions verified on 2026-11-14. Execute this file as one D1 import.
-- Each expansion is a public expansion entity of an existing base game: the rules site shows it
-- through its base game, and attribute voting creates the base-plus-expansion configuration.
WITH seed(bgg_id, display_name, english_name, name_key, english_key, base_id, base_name, label) AS (
VALUES
  (325, '卡坦島：海洋擴充', 'Catan: Seafarers', '卡坦島海洋擴充', 'catanseafarers', 'game_bgg_13', '卡坦島', '海洋擴充'),
  (926, '卡坦島：騎士擴充', 'Catan: Cities & Knights', '卡坦島騎士擴充', 'catancitiesknights', 'game_bgg_13', '卡坦島', '騎士擴充'),
  (5405, '卡卡頌：小豬與建築師', 'Carcassonne: Traders & Builders', '卡卡頌小豬與建築師', 'carcassonnetradersbuilders', 'game_bgg_822', '卡卡頌', '小豬與建築師擴'),
  (290448, '展翅翱翔：歐洲擴充', 'Wingspan: European Expansion', '展翅翱翔歐洲擴充', 'wingspaneuropeanexpansion', 'game_attribute_import_wingspan', '展翅翱翔', '歐洲擴充'),
  (300580, '展翅翱翔：大洋洲擴充', 'Wingspan: Oceania Expansion', '展翅翱翔大洋洲擴充', 'wingspanoceaniaexpansion', 'game_attribute_import_wingspan', '展翅翱翔', '大洋洲擴充'),
  (220653, '璀璨寶石：城市擴充', 'Cities of Splendor', '璀璨寶石城市擴充', 'citiesofsplendor', 'game_bgg_148228', '璀璨寶石', '城市擴充'),
  (247030, 'Terraforming Mars: Prelude', 'Terraforming Mars: Prelude', 'terraformingmarsprelude', 'terraformingmarsprelude', 'game_fa48b9030bdc156c3836', '重塑火星', '序幕擴充'),
  (255681, 'Terraforming Mars: Colonies', 'Terraforming Mars: Colonies', 'terraformingmarscolonies', 'terraformingmarscolonies', 'game_fa48b9030bdc156c3836', '重塑火星', '殖民與貿易擴充'),
  (40849, '瘟疫危機：爆發邊緣擴充', 'Pandemic: On the Brink', '瘟疫危機爆發邊緣擴充', 'pandemiconthebrink', 'game_bgg_30549', '瘟疫危機', '爆發邊緣擴充'),
  (51811, 'Dominion: Seaside', 'Dominion: Seaside', 'dominionseaside', 'dominionseaside', 'game_bgg_36218', '皇輿爭霸', '海國圖誌擴'),
  (385318, 'Cascadia: Landmarks', 'Cascadia: Landmarks', 'cascadialandmarks', 'cascadialandmarks', 'game_bgg_295947', '卡斯卡迪亞之旅', '地標擴'),
  (368966, '方舟動物園：海洋世界', 'Ark Nova: Marine Worlds', '方舟動物園海洋世界', 'arknovamarineworlds', 'game_e9dbfaa19cbab47e2ee8', '方舟動物園', '海洋世界擴'),
  (259996, '仙境幽谷：珍珠溪', 'Everdell: Pearlbrook', '仙境幽谷珍珠溪', 'everdellpearlbrook', 'game_bgg_199792', '仙境幽谷', '珍珠溪擴'),
  (202976, '七大奇蹟對決：帕特農擴充', '7 Wonders Duel: Pantheon', '七大奇蹟對決帕特農擴充', '7wondersduelpantheon', 'game_bgg_173346', '七大奇蹟對決', '帕特農擴充'),
  (127067, '東京之王：火力全開擴充', 'King of Tokyo: Power Up!', '東京之王火力全開擴充', 'kingoftokyopowerup', 'game_bgg_70323', '東京之王', '火力全開擴充')
)
INSERT INTO games (
  id, slug, display_name, english_name, normalized_name, created_at, updated_at,
  visibility, review_status, attribute_enabled, bgg_id, entity_kind
)
SELECT 'game_bgg_' || seed.bgg_id, 'bgg-' || seed.bgg_id, seed.display_name, seed.english_name, seed.name_key,
  CAST(unixepoch('subsec') * 1000 AS INTEGER), CAST(unixepoch('subsec') * 1000 AS INTEGER), 'public', 'pending', 1, seed.bgg_id, 'expansion'
FROM seed
JOIN games base ON base.id = seed.base_id AND base.display_name = seed.base_name
  AND base.entity_kind = 'base' AND base.visibility = 'public' AND base.merged_into_game_id IS NULL
WHERE NOT EXISTS (
  SELECT 1 FROM games
  WHERE bgg_id = seed.bgg_id OR id = 'game_bgg_' || seed.bgg_id OR slug = 'bgg-' || seed.bgg_id
    OR normalized_name IN (seed.name_key, seed.english_key) OR english_name = seed.english_name COLLATE NOCASE
)
AND NOT EXISTS (SELECT 1 FROM game_external_ids WHERE source = 'bgg' AND external_id = CAST(seed.bgg_id AS TEXT))
AND NOT EXISTS (SELECT 1 FROM game_aliases WHERE normalized_alias IN (seed.name_key, seed.english_key));

WITH seed(bgg_id, display_name, english_name, name_key, english_key, base_id, base_name, label) AS (
VALUES
  (325, '卡坦島：海洋擴充', 'Catan: Seafarers', '卡坦島海洋擴充', 'catanseafarers', 'game_bgg_13', '卡坦島', '海洋擴充'),
  (926, '卡坦島：騎士擴充', 'Catan: Cities & Knights', '卡坦島騎士擴充', 'catancitiesknights', 'game_bgg_13', '卡坦島', '騎士擴充'),
  (5405, '卡卡頌：小豬與建築師', 'Carcassonne: Traders & Builders', '卡卡頌小豬與建築師', 'carcassonnetradersbuilders', 'game_bgg_822', '卡卡頌', '小豬與建築師擴'),
  (290448, '展翅翱翔：歐洲擴充', 'Wingspan: European Expansion', '展翅翱翔歐洲擴充', 'wingspaneuropeanexpansion', 'game_attribute_import_wingspan', '展翅翱翔', '歐洲擴充'),
  (300580, '展翅翱翔：大洋洲擴充', 'Wingspan: Oceania Expansion', '展翅翱翔大洋洲擴充', 'wingspanoceaniaexpansion', 'game_attribute_import_wingspan', '展翅翱翔', '大洋洲擴充'),
  (220653, '璀璨寶石：城市擴充', 'Cities of Splendor', '璀璨寶石城市擴充', 'citiesofsplendor', 'game_bgg_148228', '璀璨寶石', '城市擴充'),
  (247030, 'Terraforming Mars: Prelude', 'Terraforming Mars: Prelude', 'terraformingmarsprelude', 'terraformingmarsprelude', 'game_fa48b9030bdc156c3836', '重塑火星', '序幕擴充'),
  (255681, 'Terraforming Mars: Colonies', 'Terraforming Mars: Colonies', 'terraformingmarscolonies', 'terraformingmarscolonies', 'game_fa48b9030bdc156c3836', '重塑火星', '殖民與貿易擴充'),
  (40849, '瘟疫危機：爆發邊緣擴充', 'Pandemic: On the Brink', '瘟疫危機爆發邊緣擴充', 'pandemiconthebrink', 'game_bgg_30549', '瘟疫危機', '爆發邊緣擴充'),
  (51811, 'Dominion: Seaside', 'Dominion: Seaside', 'dominionseaside', 'dominionseaside', 'game_bgg_36218', '皇輿爭霸', '海國圖誌擴'),
  (385318, 'Cascadia: Landmarks', 'Cascadia: Landmarks', 'cascadialandmarks', 'cascadialandmarks', 'game_bgg_295947', '卡斯卡迪亞之旅', '地標擴'),
  (368966, '方舟動物園：海洋世界', 'Ark Nova: Marine Worlds', '方舟動物園海洋世界', 'arknovamarineworlds', 'game_e9dbfaa19cbab47e2ee8', '方舟動物園', '海洋世界擴'),
  (259996, '仙境幽谷：珍珠溪', 'Everdell: Pearlbrook', '仙境幽谷珍珠溪', 'everdellpearlbrook', 'game_bgg_199792', '仙境幽谷', '珍珠溪擴'),
  (202976, '七大奇蹟對決：帕特農擴充', '7 Wonders Duel: Pantheon', '七大奇蹟對決帕特農擴充', '7wondersduelpantheon', 'game_bgg_173346', '七大奇蹟對決', '帕特農擴充'),
  (127067, '東京之王：火力全開擴充', 'King of Tokyo: Power Up!', '東京之王火力全開擴充', 'kingoftokyopowerup', 'game_bgg_70323', '東京之王', '火力全開擴充')
)
INSERT INTO game_external_ids (id, game_id, source, external_id, relation, created_at)
SELECT 'game-external:bgg:' || seed.bgg_id, game.id, 'bgg', CAST(seed.bgg_id AS TEXT), 'primary', CAST(unixepoch('subsec') * 1000 AS INTEGER)
FROM seed
JOIN games game ON game.id = 'game_bgg_' || seed.bgg_id AND game.bgg_id = seed.bgg_id
  AND game.display_name = seed.display_name AND game.entity_kind = 'expansion' AND game.merged_into_game_id IS NULL
WHERE NOT EXISTS (SELECT 1 FROM game_external_ids WHERE source = 'bgg' AND external_id = CAST(seed.bgg_id AS TEXT));

WITH alias_seed(bgg_id, display_name, alias, alias_key) AS (
VALUES
  (325, '卡坦島：海洋擴充', 'Catan: Seafarers', 'catanseafarers'),
  (926, '卡坦島：騎士擴充', 'Catan: Cities & Knights', 'catancitiesknights'),
  (5405, '卡卡頌：小豬與建築師', 'Carcassonne: Traders & Builders', 'carcassonnetradersbuilders'),
  (5405, '卡卡頌：小豬與建築師', '卡卡頌：商人與建築師', '卡卡頌商人與建築師'),
  (290448, '展翅翱翔：歐洲擴充', 'Wingspan: European Expansion', 'wingspaneuropeanexpansion'),
  (300580, '展翅翱翔：大洋洲擴充', 'Wingspan: Oceania Expansion', 'wingspanoceaniaexpansion'),
  (220653, '璀璨寶石：城市擴充', 'Cities of Splendor', 'citiesofsplendor'),
  (247030, 'Terraforming Mars: Prelude', '殖民火星：序幕擴充', '殖民火星序幕擴充'),
  (247030, 'Terraforming Mars: Prelude', '重塑火星：序幕擴充', '重塑火星序幕擴充'),
  (255681, 'Terraforming Mars: Colonies', '殖民火星：殖民與貿易擴充', '殖民火星殖民與貿易擴充'),
  (255681, 'Terraforming Mars: Colonies', '重塑火星：殖民與貿易擴充', '重塑火星殖民與貿易擴充'),
  (40849, '瘟疫危機：爆發邊緣擴充', 'Pandemic: On the Brink', 'pandemiconthebrink'),
  (51811, 'Dominion: Seaside', '皇輿爭霸：海國圖誌', '皇輿爭霸海國圖誌'),
  (385318, 'Cascadia: Landmarks', '卡斯卡迪亞：地標', '卡斯卡迪亞地標'),
  (368966, '方舟動物園：海洋世界', 'Ark Nova: Marine Worlds', 'arknovamarineworlds'),
  (259996, '仙境幽谷：珍珠溪', 'Everdell: Pearlbrook', 'everdellpearlbrook'),
  (202976, '七大奇蹟對決：帕特農擴充', '7 Wonders Duel: Pantheon', '7wondersduelpantheon'),
  (127067, '東京之王：火力全開擴充', 'King of Tokyo: Power Up!', 'kingoftokyopowerup')
)
INSERT INTO game_aliases (id, game_id, alias, normalized_alias, alias_type, created_at)
SELECT 'game-alias:taiwan-expansion:' || alias_seed.bgg_id || ':' || alias_seed.alias_key, game.id, alias_seed.alias, alias_seed.alias_key, 'alias', CAST(unixepoch('subsec') * 1000 AS INTEGER)
FROM alias_seed
JOIN games game ON game.id = 'game_bgg_' || alias_seed.bgg_id AND game.bgg_id = alias_seed.bgg_id
  AND game.display_name = alias_seed.display_name AND game.entity_kind = 'expansion' AND game.merged_into_game_id IS NULL
WHERE NOT EXISTS (SELECT 1 FROM game_aliases WHERE normalized_alias = alias_seed.alias_key)
AND NOT EXISTS (SELECT 1 FROM games WHERE normalized_name = alias_seed.alias_key);

WITH seed(bgg_id, display_name, english_name, name_key, english_key, base_id, base_name, label) AS (
VALUES
  (325, '卡坦島：海洋擴充', 'Catan: Seafarers', '卡坦島海洋擴充', 'catanseafarers', 'game_bgg_13', '卡坦島', '海洋擴充'),
  (926, '卡坦島：騎士擴充', 'Catan: Cities & Knights', '卡坦島騎士擴充', 'catancitiesknights', 'game_bgg_13', '卡坦島', '騎士擴充'),
  (5405, '卡卡頌：小豬與建築師', 'Carcassonne: Traders & Builders', '卡卡頌小豬與建築師', 'carcassonnetradersbuilders', 'game_bgg_822', '卡卡頌', '小豬與建築師擴'),
  (290448, '展翅翱翔：歐洲擴充', 'Wingspan: European Expansion', '展翅翱翔歐洲擴充', 'wingspaneuropeanexpansion', 'game_attribute_import_wingspan', '展翅翱翔', '歐洲擴充'),
  (300580, '展翅翱翔：大洋洲擴充', 'Wingspan: Oceania Expansion', '展翅翱翔大洋洲擴充', 'wingspanoceaniaexpansion', 'game_attribute_import_wingspan', '展翅翱翔', '大洋洲擴充'),
  (220653, '璀璨寶石：城市擴充', 'Cities of Splendor', '璀璨寶石城市擴充', 'citiesofsplendor', 'game_bgg_148228', '璀璨寶石', '城市擴充'),
  (247030, 'Terraforming Mars: Prelude', 'Terraforming Mars: Prelude', 'terraformingmarsprelude', 'terraformingmarsprelude', 'game_fa48b9030bdc156c3836', '重塑火星', '序幕擴充'),
  (255681, 'Terraforming Mars: Colonies', 'Terraforming Mars: Colonies', 'terraformingmarscolonies', 'terraformingmarscolonies', 'game_fa48b9030bdc156c3836', '重塑火星', '殖民與貿易擴充'),
  (40849, '瘟疫危機：爆發邊緣擴充', 'Pandemic: On the Brink', '瘟疫危機爆發邊緣擴充', 'pandemiconthebrink', 'game_bgg_30549', '瘟疫危機', '爆發邊緣擴充'),
  (51811, 'Dominion: Seaside', 'Dominion: Seaside', 'dominionseaside', 'dominionseaside', 'game_bgg_36218', '皇輿爭霸', '海國圖誌擴'),
  (385318, 'Cascadia: Landmarks', 'Cascadia: Landmarks', 'cascadialandmarks', 'cascadialandmarks', 'game_bgg_295947', '卡斯卡迪亞之旅', '地標擴'),
  (368966, '方舟動物園：海洋世界', 'Ark Nova: Marine Worlds', '方舟動物園海洋世界', 'arknovamarineworlds', 'game_e9dbfaa19cbab47e2ee8', '方舟動物園', '海洋世界擴'),
  (259996, '仙境幽谷：珍珠溪', 'Everdell: Pearlbrook', '仙境幽谷珍珠溪', 'everdellpearlbrook', 'game_bgg_199792', '仙境幽谷', '珍珠溪擴'),
  (202976, '七大奇蹟對決：帕特農擴充', '7 Wonders Duel: Pantheon', '七大奇蹟對決帕特農擴充', '7wondersduelpantheon', 'game_bgg_173346', '七大奇蹟對決', '帕特農擴充'),
  (127067, '東京之王：火力全開擴充', 'King of Tokyo: Power Up!', '東京之王火力全開擴充', 'kingoftokyopowerup', 'game_bgg_70323', '東京之王', '火力全開擴充')
)
INSERT INTO game_entity_relations (id, source_game_id, target_game_id, relation_type, created_at)
SELECT 'game-relation:' || game.id || ':' || base.id, game.id, base.id, 'expansion_of', CAST(unixepoch('subsec') * 1000 AS INTEGER)
FROM seed
JOIN games game ON game.id = 'game_bgg_' || seed.bgg_id AND game.bgg_id = seed.bgg_id
  AND game.display_name = seed.display_name AND game.entity_kind = 'expansion' AND game.merged_into_game_id IS NULL
JOIN games base ON base.id = seed.base_id AND base.display_name = seed.base_name
  AND base.entity_kind = 'base' AND base.visibility = 'public' AND base.merged_into_game_id IS NULL
JOIN game_external_ids external ON external.game_id = game.id AND external.source = 'bgg'
  AND external.external_id = CAST(seed.bgg_id AS TEXT) AND external.relation = 'primary'
WHERE NOT EXISTS (
  SELECT 1 FROM game_entity_relations relation
  WHERE relation.source_game_id = game.id AND relation.relation_type = 'expansion_of'
);

-- The relation trigger creates "<base>＋<expansion>"; keep the reviewed concise label.
WITH seed(bgg_id, display_name, english_name, name_key, english_key, base_id, base_name, label) AS (
VALUES
  (325, '卡坦島：海洋擴充', 'Catan: Seafarers', '卡坦島海洋擴充', 'catanseafarers', 'game_bgg_13', '卡坦島', '海洋擴充'),
  (926, '卡坦島：騎士擴充', 'Catan: Cities & Knights', '卡坦島騎士擴充', 'catancitiesknights', 'game_bgg_13', '卡坦島', '騎士擴充'),
  (5405, '卡卡頌：小豬與建築師', 'Carcassonne: Traders & Builders', '卡卡頌小豬與建築師', 'carcassonnetradersbuilders', 'game_bgg_822', '卡卡頌', '小豬與建築師擴'),
  (290448, '展翅翱翔：歐洲擴充', 'Wingspan: European Expansion', '展翅翱翔歐洲擴充', 'wingspaneuropeanexpansion', 'game_attribute_import_wingspan', '展翅翱翔', '歐洲擴充'),
  (300580, '展翅翱翔：大洋洲擴充', 'Wingspan: Oceania Expansion', '展翅翱翔大洋洲擴充', 'wingspanoceaniaexpansion', 'game_attribute_import_wingspan', '展翅翱翔', '大洋洲擴充'),
  (220653, '璀璨寶石：城市擴充', 'Cities of Splendor', '璀璨寶石城市擴充', 'citiesofsplendor', 'game_bgg_148228', '璀璨寶石', '城市擴充'),
  (247030, 'Terraforming Mars: Prelude', 'Terraforming Mars: Prelude', 'terraformingmarsprelude', 'terraformingmarsprelude', 'game_fa48b9030bdc156c3836', '重塑火星', '序幕擴充'),
  (255681, 'Terraforming Mars: Colonies', 'Terraforming Mars: Colonies', 'terraformingmarscolonies', 'terraformingmarscolonies', 'game_fa48b9030bdc156c3836', '重塑火星', '殖民與貿易擴充'),
  (40849, '瘟疫危機：爆發邊緣擴充', 'Pandemic: On the Brink', '瘟疫危機爆發邊緣擴充', 'pandemiconthebrink', 'game_bgg_30549', '瘟疫危機', '爆發邊緣擴充'),
  (51811, 'Dominion: Seaside', 'Dominion: Seaside', 'dominionseaside', 'dominionseaside', 'game_bgg_36218', '皇輿爭霸', '海國圖誌擴'),
  (385318, 'Cascadia: Landmarks', 'Cascadia: Landmarks', 'cascadialandmarks', 'cascadialandmarks', 'game_bgg_295947', '卡斯卡迪亞之旅', '地標擴'),
  (368966, '方舟動物園：海洋世界', 'Ark Nova: Marine Worlds', '方舟動物園海洋世界', 'arknovamarineworlds', 'game_e9dbfaa19cbab47e2ee8', '方舟動物園', '海洋世界擴'),
  (259996, '仙境幽谷：珍珠溪', 'Everdell: Pearlbrook', '仙境幽谷珍珠溪', 'everdellpearlbrook', 'game_bgg_199792', '仙境幽谷', '珍珠溪擴'),
  (202976, '七大奇蹟對決：帕特農擴充', '7 Wonders Duel: Pantheon', '七大奇蹟對決帕特農擴充', '7wondersduelpantheon', 'game_bgg_173346', '七大奇蹟對決', '帕特農擴充'),
  (127067, '東京之王：火力全開擴充', 'King of Tokyo: Power Up!', '東京之王火力全開擴充', 'kingoftokyopowerup', 'game_bgg_70323', '東京之王', '火力全開擴充')
)
UPDATE attribute_subject_components
SET label = (SELECT seed.label FROM seed WHERE 'game_bgg_' || seed.bgg_id = attribute_subject_components.game_id)
WHERE component_type = 'expansion'
  AND game_id IN (SELECT 'game_bgg_' || bgg_id FROM seed)
  AND label <> (SELECT seed.label FROM seed WHERE 'game_bgg_' || seed.bgg_id = attribute_subject_components.game_id);
