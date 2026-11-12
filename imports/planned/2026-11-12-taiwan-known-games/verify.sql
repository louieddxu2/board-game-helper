-- One row per missing or mismatched game. A complete first batch returns zero rows.
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
SELECT seed.bgg_id, seed.display_name,
  game.id IS NOT NULL AS game_found,
  external.id IS NOT NULL AS bgg_mapping_found,
  eligible.subject_id IS NOT NULL AS voting_subject_found,
  (SELECT COUNT(*) FROM attribute_score_states score JOIN attributes attribute
    ON attribute.id = score.attribute_id AND attribute.is_active = 1
    WHERE score.subject_id = eligible.subject_id) AS provisioned_attributes,
  (SELECT COUNT(*) FROM attributes WHERE is_active = 1) AS expected_attributes
FROM seed
LEFT JOIN games game ON game.id = 'game_bgg_' || seed.bgg_id
  AND game.bgg_id = seed.bgg_id AND game.slug = 'bgg-' || seed.bgg_id
  AND game.display_name = seed.display_name AND game.english_name = seed.original_name
  AND game.normalized_name = seed.name_key
  AND game.entity_kind = 'base' AND game.visibility = 'public' AND game.merged_into_game_id IS NULL
LEFT JOIN game_external_ids external ON external.source = 'bgg'
  AND external.external_id = CAST(seed.bgg_id AS TEXT) AND external.game_id = game.id AND external.relation = 'primary'
LEFT JOIN attribute_votable_subjects eligible ON eligible.subject_id = 'attribute_subject_game:' || game.id
WHERE NOT game_found OR NOT bgg_mapping_found OR NOT voting_subject_found OR provisioned_attributes <> expected_attributes;
