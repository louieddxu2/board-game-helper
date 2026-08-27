-- Promote reliable BGG identities into the shared games table. Existing
-- attribute component IDs are authoritative for the first group; the second
-- group comes from exact, one-to-one English-name matches in the owner's
-- GeekGroup export. No new games are created by this migration.
ALTER TABLE games ADD COLUMN bgg_id INTEGER
  CHECK (bgg_id IS NULL OR bgg_id > 0);

UPDATE games
SET bgg_id = (
  SELECT MAX(c.bgg_id)
  FROM attribute_subject_components c
  WHERE c.game_id = games.id
    AND c.component_type = 'base'
    AND c.bgg_id IS NOT NULL
)
WHERE bgg_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM attribute_subject_components c
    WHERE c.game_id = games.id
      AND c.component_type = 'base'
      AND c.bgg_id IS NOT NULL
  );

-- These rows were matched by exact current display/English name to one
-- distinct Game ID in BggDataFromGeekGroup_ddxu2.csv. Similar-name rows are
-- intentionally excluded; see the release notes for the manual review list.
UPDATE games
SET bgg_id = CASE id
  WHEN 'game_065d8fb1d5357aa97fe2' THEN 301255 -- Whistle Mountain
  WHEN 'game_118a76f54fad46109f6b3d77e6057252' THEN 281257 -- Aeolis
  WHEN 'game_239b0d21452b789fb8e6' THEN 197376 -- Charterstone
  WHEN 'game_273c8068d3668a8fa0a5' THEN 350736 -- Voyages
  WHEN 'game_28c1d42fe3a64bbeab8010d954f4dab0' THEN 427388 -- Tend
  WHEN 'game_291449cf7ff8e2b54bd0' THEN 318084 -- Furnace
  WHEN 'game_303f65261fb608e7510f' THEN 401216 -- Cascadero
  WHEN 'game_69f794b92d024a85984c31f3ba356ac2' THEN 436116 -- Sky Totems
  WHEN 'game_6cf70b189967a8a715bf' THEN 227224 -- The Red Cathedral
  WHEN 'game_76564f630f5af7fadd25' THEN 271324 -- It's a Wonderful World
  WHEN 'game_839250d9e1eaa9d1124a' THEN 350198 -- Terminus
  WHEN 'game_8ef478417ec6417290af785c9a36e18a' THEN 211364 -- Seize the Bean
  WHEN 'game_90eaf35d30c1bd0a5ea1' THEN 304510 -- Pampero
  WHEN 'game_97739eadc0273e188ff4' THEN 293972 -- Loot of Lima
  WHEN 'game_9776c797ee364dc280b7da7b542f240b' THEN 256730 -- Pipeline
  WHEN 'game_ac8643a25d35feb53388' THEN 875 -- Roads & Boats
  WHEN 'game_cd04743016436ccdede0' THEN 344768 -- Mobile Markets
  WHEN 'game_ce619002ee9795da3cd5' THEN 367375 -- Race to the Raft
  WHEN 'game_cea0d8b83eee06e0f2d8' THEN 299960 -- Alma Mater
  WHEN 'game_dd592e70d22552e3aa1c' THEN 321608 -- Hegemony
  WHEN 'game_ef9feefda18c88865117' THEN 183284 -- Factory Funner
  WHEN 'game_f1cfad0788a94bca858f49ff281e51dd' THEN 426513 -- Emberleaf
  WHEN 'game_ff46bcb10a652f1a1eae' THEN 246684 -- Smartphone Inc.
  ELSE bgg_id
END
WHERE bgg_id IS NULL
  AND id IN (
    'game_065d8fb1d5357aa97fe2',
    'game_118a76f54fad46109f6b3d77e6057252',
    'game_239b0d21452b789fb8e6',
    'game_273c8068d3668a8fa0a5',
    'game_28c1d42fe3a64bbeab8010d954f4dab0',
    'game_291449cf7ff8e2b54bd0',
    'game_303f65261fb608e7510f',
    'game_69f794b92d024a85984c31f3ba356ac2',
    'game_6cf70b189967a8a715bf',
    'game_76564f630f5af7fadd25',
    'game_839250d9e1eaa9d1124a',
    'game_8ef478417ec6417290af785c9a36e18a',
    'game_90eaf35d30c1bd0a5ea1',
    'game_97739eadc0273e188ff4',
    'game_9776c797ee364dc280b7da7b542f240b',
    'game_ac8643a25d35feb53388',
    'game_cd04743016436ccdede0',
    'game_ce619002ee9795da3cd5',
    'game_cea0d8b83eee06e0f2d8',
    'game_dd592e70d22552e3aa1c',
    'game_ef9feefda18c88865117',
    'game_f1cfad0788a94bca858f49ff281e51dd',
    'game_ff46bcb10a652f1a1eae'
  );

CREATE UNIQUE INDEX idx_games_bgg_id
  ON games(bgg_id)
  WHERE bgg_id IS NOT NULL;

PRAGMA optimize;
