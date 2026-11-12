-- Taiwan candidate names verified on 2026-11-12. Execute this file as one D1 import.
-- Existing games are preserved. Only matching public game records can receive mappings or aliases.
WITH seed(bgg_id, display_name, english_name, zh_alias, name_key, english_key, alias_key, edition_ids) AS (
VALUES
  (266507, 'Clank! Legacy: Acquisitions Incorporated', 'Clank! Legacy: Acquisitions Incorporated', '蠢賊一籮筐：承傳', 'clanklegacyacquisitionsincorporated', 'clanklegacyacquisitionsincorporated', '蠢賊一籮筐承傳', '[]'),
  (55690, 'Kingdom Death: Monster', 'Kingdom Death: Monster', '死亡國度：怪物', 'kingdomdeathmonster', 'kingdomdeathmonster', '死亡國度怪物', '[]'),
  (233371, 'Clank! In! Space!: A Deck-Building Adventure', 'Clank! In! Space!: A Deck-Building Adventure', '蠢賊一籮筐：太空版', 'clankinspaceadeckbuildingadventure', 'clankinspaceadeckbuildingadventure', '蠢賊一籮筐太空版', '[]'),
  (17133, 'Railways of the World', 'Railways of the World', '鐵路大亨', 'railwaysoftheworld', 'railwaysoftheworld', '鐵路大亨', '[]'),
  (133848, 'Euphoria: Build a Better Dystopia', 'Euphoria: Build a Better Dystopia', '幸福之境', 'euphoriabuildabetterdystopia', 'euphoriabuildabetterdystopia', '幸福之境', '[]'),
  (291572, 'Oath', 'Oath', '流離聖誓：帝國與流放者編年史', 'oath', 'oath', '流離聖誓帝國與流放者編年史', '[]'),
  (224783, 'Vindication', 'Vindication', '孤島贖生', 'vindication', 'vindication', '孤島贖生', '[]'),
  (232414, '新演化論：海洋', 'Oceans', NULL, '新演化論海洋', 'oceans', NULL, '[]')
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
  (266507, 'Clank! Legacy: Acquisitions Incorporated', 'Clank! Legacy: Acquisitions Incorporated', '蠢賊一籮筐：承傳', 'clanklegacyacquisitionsincorporated', 'clanklegacyacquisitionsincorporated', '蠢賊一籮筐承傳', '[]'),
  (55690, 'Kingdom Death: Monster', 'Kingdom Death: Monster', '死亡國度：怪物', 'kingdomdeathmonster', 'kingdomdeathmonster', '死亡國度怪物', '[]'),
  (233371, 'Clank! In! Space!: A Deck-Building Adventure', 'Clank! In! Space!: A Deck-Building Adventure', '蠢賊一籮筐：太空版', 'clankinspaceadeckbuildingadventure', 'clankinspaceadeckbuildingadventure', '蠢賊一籮筐太空版', '[]'),
  (17133, 'Railways of the World', 'Railways of the World', '鐵路大亨', 'railwaysoftheworld', 'railwaysoftheworld', '鐵路大亨', '[]'),
  (133848, 'Euphoria: Build a Better Dystopia', 'Euphoria: Build a Better Dystopia', '幸福之境', 'euphoriabuildabetterdystopia', 'euphoriabuildabetterdystopia', '幸福之境', '[]'),
  (291572, 'Oath', 'Oath', '流離聖誓：帝國與流放者編年史', 'oath', 'oath', '流離聖誓帝國與流放者編年史', '[]'),
  (224783, 'Vindication', 'Vindication', '孤島贖生', 'vindication', 'vindication', '孤島贖生', '[]'),
  (232414, '新演化論：海洋', 'Oceans', NULL, '新演化論海洋', 'oceans', NULL, '[]')
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
  (266507, 'Clank! Legacy: Acquisitions Incorporated', 'Clank! Legacy: Acquisitions Incorporated', '蠢賊一籮筐：承傳', 'clanklegacyacquisitionsincorporated', 'clanklegacyacquisitionsincorporated', '蠢賊一籮筐承傳', '[]'),
  (55690, 'Kingdom Death: Monster', 'Kingdom Death: Monster', '死亡國度：怪物', 'kingdomdeathmonster', 'kingdomdeathmonster', '死亡國度怪物', '[]'),
  (233371, 'Clank! In! Space!: A Deck-Building Adventure', 'Clank! In! Space!: A Deck-Building Adventure', '蠢賊一籮筐：太空版', 'clankinspaceadeckbuildingadventure', 'clankinspaceadeckbuildingadventure', '蠢賊一籮筐太空版', '[]'),
  (17133, 'Railways of the World', 'Railways of the World', '鐵路大亨', 'railwaysoftheworld', 'railwaysoftheworld', '鐵路大亨', '[]'),
  (133848, 'Euphoria: Build a Better Dystopia', 'Euphoria: Build a Better Dystopia', '幸福之境', 'euphoriabuildabetterdystopia', 'euphoriabuildabetterdystopia', '幸福之境', '[]'),
  (291572, 'Oath', 'Oath', '流離聖誓：帝國與流放者編年史', 'oath', 'oath', '流離聖誓帝國與流放者編年史', '[]'),
  (224783, 'Vindication', 'Vindication', '孤島贖生', 'vindication', 'vindication', '孤島贖生', '[]'),
  (232414, '新演化論：海洋', 'Oceans', NULL, '新演化論海洋', 'oceans', NULL, '[]')
)
INSERT INTO game_aliases (id, game_id, alias, normalized_alias, alias_type, created_at)
SELECT 'game-alias:taiwan-known:' || seed.bgg_id, game.id, seed.zh_alias, seed.alias_key, 'alias', CAST(unixepoch('subsec') * 1000 AS INTEGER)
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
