-- The collection names a physical edition, while attribute voting identifies
-- the underlying game. Keep edition labels and BGG IDs searchable without
-- creating a second score identity.

UPDATE games
SET display_name = 'Expedition: Northwest Passage',
    normalized_name = 'expeditionnorthwestpassage',
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE id = 'game_bgg_71074';

UPDATE attribute_subjects
SET display_name = 'Expedition: Northwest Passage',
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE id = 'attribute_subject_game:game_bgg_71074';

UPDATE attribute_subject_components
SET label = 'Expedition: Northwest Passage'
WHERE subject_id = 'attribute_subject_game:game_bgg_71074'
  AND component_type = 'base';

INSERT OR IGNORE INTO game_aliases
  (id, game_id, alias, normalized_alias, alias_type, created_at)
VALUES (
  'game-alias:bgg:71074-edition',
  'game_bgg_71074',
  'Expedition: Northwest Passage – HMS Terror Edition',
  'expeditionnorthwestpassagehmsterroredition',
  'attribute-import',
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
);

-- Hội Phố Second Edition has its own BGG thing ID, but remains one canonical
-- game for rules and attribute voting. The original thing ID becomes primary.
DELETE FROM game_external_ids
WHERE source = 'bgg' AND external_id = '350468';

UPDATE games
SET display_name = 'Hội Phố',
    normalized_name = 'hộiphố',
    bgg_id = 288920,
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE id = 'game_bgg_350468';

UPDATE attribute_subjects
SET display_name = 'Hội Phố',
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE id = 'attribute_subject_game:game_bgg_350468';

UPDATE attribute_subject_components
SET label = 'Hội Phố'
WHERE subject_id = 'attribute_subject_game:game_bgg_350468'
  AND component_type = 'base';

INSERT OR IGNORE INTO game_aliases
  (id, game_id, alias, normalized_alias, alias_type, created_at)
VALUES (
  'game-alias:bgg:350468-edition',
  'game_bgg_350468',
  'Hội Phố (Second Edition)',
  'hộiphốsecondedition',
  'attribute-import',
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
);

INSERT OR IGNORE INTO game_external_ids
  (id, game_id, source, external_id, relation, created_at)
VALUES
  (
    'game-external:bgg:288920',
    'game_bgg_350468',
    'bgg',
    '288920',
    'primary',
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  ),
  (
    'game-external:bgg:350468',
    'game_bgg_350468',
    'bgg',
    '350468',
    'edition',
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  );

PRAGMA optimize;
