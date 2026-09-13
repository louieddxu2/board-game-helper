-- Promote only names evidenced by a published Chinese edition, distributor
-- catalogue, or official product/rule page.  English BGG names stay in
-- english_name and the remaining 0096 labels remain aliases for search.
CREATE TABLE migration_0098_verified_names (
  bgg_id INTEGER PRIMARY KEY,
  display_name TEXT NOT NULL,
  english_name TEXT NOT NULL
);

INSERT INTO migration_0098_verified_names (bgg_id, display_name, english_name)
VALUES
  (19646, '狂牛衝浪', 'Cowabunga'),
  (29073, '大爆格', 'Blockers!'),
  (32666, '國富論', 'Wealth of Nations'),
  (133473, '迴轉壽司', 'Sushi Go!'),
  (155020, '動物夜怕怕', 'Animals Frightening Night!'),
  (158991, '犯人在跳舞', 'Hannin Wa Odoru'),
  (167791, '重塑火星', 'Terraforming Mars'),
  (203430, '富士流', 'Fuji Flush'),
  (217780, '氏族', 'Gentes'),
  (225694, '截碼戰', 'Decrypto'),
  (242302, '太空基地', 'Space Base'),
  (258779, '未知行星', 'Planet Unknown'),
  (260180, 'L計畫', 'Project L'),
  (269207, '深谷酒館', 'The Taverns of Tiefenthal'),
  (283948, '馬可波羅 II：可汗的託付', 'Marco Polo II: In the Service of the Khan'),
  (298383, '傀儡魔像', 'Golem'),
  (318977, '小城大案', 'MicroMacro: Crime City'),
  (327971, '醫學之父－希波克拉底', 'Hippocrates');

-- The Chinese candidates were already added by 0096 as aliases.  A primary
-- name is indexed separately, so remove that duplicate alias after promotion.
DELETE FROM game_aliases
WHERE (game_id, alias) IN (
  SELECT game.id, verified.display_name
  FROM migration_0098_verified_names verified
  JOIN games game ON game.bgg_id = verified.bgg_id
);

UPDATE games
SET display_name = (
      SELECT verified.display_name
      FROM migration_0098_verified_names verified
      WHERE verified.bgg_id = games.bgg_id
    ),
    english_name = COALESCE(NULLIF(trim(english_name), ''), (
      SELECT verified.english_name
      FROM migration_0098_verified_names verified
      WHERE verified.bgg_id = games.bgg_id
    )),
    normalized_name = (
      SELECT lower(replace(trim(verified.display_name), ' ', ''))
      FROM migration_0098_verified_names verified
      WHERE verified.bgg_id = games.bgg_id
    ),
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE bgg_id IN (SELECT bgg_id FROM migration_0098_verified_names);

UPDATE attribute_subjects
SET display_name = (
      SELECT game.display_name
      FROM games game
      WHERE game.id = attribute_subjects.game_id
    ),
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE kind = 'game'
  AND game_id IN (
    SELECT game.id
    FROM games game
    JOIN migration_0098_verified_names verified ON verified.bgg_id = game.bgg_id
  );

UPDATE attribute_subject_components
SET label = (
  SELECT game.display_name
  FROM games game
  WHERE game.id = attribute_subject_components.game_id
)
WHERE component_type = 'base'
  AND game_id IN (
    SELECT game.id
    FROM games game
    JOIN migration_0098_verified_names verified ON verified.bgg_id = game.bgg_id
  );

DROP TABLE migration_0098_verified_names;

PRAGMA optimize;
