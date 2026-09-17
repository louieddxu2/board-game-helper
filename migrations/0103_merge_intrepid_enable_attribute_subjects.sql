-- Intrepid has two public rules on an older non-BGG record.  BGG 302461 is
-- already the canonical record, so move the rules there instead of assigning
-- a duplicate unique BGG ID to the older row.
UPDATE rules
SET game_id = 'game_bgg_302461'
WHERE game_id = 'game_ebc4df3a2a0f4ba4b0cb1497a024f105';

-- Retain the old record only as a merged alias/history source.  Its subject
-- stays hidden; its base component points at the canonical game for any
-- existing configuration metadata.
UPDATE attribute_subject_components
SET game_id = 'game_bgg_302461',
    label = 'Intrepid'
WHERE game_id = 'game_ebc4df3a2a0f4ba4b0cb1497a024f105'
  AND component_type = 'base';

UPDATE games
SET merged_into_game_id = 'game_bgg_302461',
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE id = 'game_ebc4df3a2a0f4ba4b0cb1497a024f105'
  AND EXISTS (SELECT 1 FROM games WHERE id = 'game_bgg_302461' AND bgg_id = 302461);

-- Both subjects have verified BoardGameGeek identities.  Enabling them lets
-- the existing eligibility trigger provision only their missing score states.
UPDATE games
SET attribute_enabled = 1,
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE id IN ('game_bgg_302461', 'game_attribute_import_the_7th_continent')
  AND attribute_enabled = 0;
