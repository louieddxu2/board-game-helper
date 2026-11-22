-- Production retained the site's original Bus ID instead of the migration's BGG ID.
-- Reproduce that identity with real triggers. This is only isolated test setup.
DELETE FROM games WHERE id = 'game_bgg_552';
INSERT INTO games
  (id, slug, display_name, english_name, normalized_name, created_at, updated_at,
   attribute_enabled, bgg_id, review_status)
VALUES ('game_04e027e4990a203f4899', 'bus-3f4899', '公車', 'Bus', 'bus', 1, 1, 1, 552, 'pending');
DELETE FROM catalog_change_outbox;
