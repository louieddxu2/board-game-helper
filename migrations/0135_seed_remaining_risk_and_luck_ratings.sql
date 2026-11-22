-- Owner-approved follow-up to 0123, confirmed on 2026-11-22.
-- Preserve historical responses and seed only these 9 subjects / 18 direct ratings.
CREATE TABLE migration_0135_ratings (
  subject_id TEXT NOT NULL PRIMARY KEY,
  risk_planning INTEGER NOT NULL CHECK (risk_planning BETWEEN 0 AND 10),
  luck_dependence INTEGER NOT NULL CHECK (luck_dependence BETWEEN 0 AND 10)
);

INSERT INTO migration_0135_ratings (subject_id, risk_planning, luck_dependence)
VALUES
  ('attribute_subject_game:game_attribute_import_shear_panic', 3, 3),
  ('attribute_subject_game:game_04e027e4990a203f4899', 0, 0),
  ('attribute_config_food_chain_magnate_ketchup', 1, 1),
  ('attribute_config_great_western_trail_rails_north', 2, 3),
  ('attribute_config_trickerion_dahlgaards_academy', 1, 3),
  ('attribute_config_7th_continent_what_goes_up', 10, 2),
  ('attribute_subject_game:game_attribute_import_fog_of_love', 2, 5),
  ('attribute_subject_game:game_attribute_import_and_then_we_held_hands', 3, 6),
  ('attribute_subject_game:game_bgg_460712', 4, 6);

INSERT INTO attribute_vote_responses
  (response_id, attribute_id, subject_a_id, rating_a, activity_json, session_id, created_at, updated_at)
SELECT 'attribute-response-seed:0135:' || attribute.key || ':' || rating.subject_id,
  attribute.id, rating.subject_id,
  CASE attribute.key WHEN 'risk_planning' THEN rating.risk_planning ELSE rating.luck_dependence END,
  '[]', 'attribute-seed:0135', 0, 0
FROM migration_0135_ratings rating
-- CROSS JOIN deliberately keeps the approved list outside growing production tables.
CROSS JOIN attribute_subjects subject ON subject.id = rating.subject_id
CROSS JOIN attributes attribute
WHERE attribute.id IN ('attribute_risk_planning', 'attribute_luck_dependence')
ON CONFLICT(response_id) DO NOTHING;

-- Initial scores are immediately available. Existing evidence, if a vote
-- arrived before this migration, stays intact until authoritative replay.
-- Imported receipts retain recorded_online=0, so the online cursor cannot
-- apply these numbers a second time.
INSERT INTO attribute_catalog_rebuild_mode (id) VALUES (1);
INSERT INTO attribute_score_states
  (subject_id, attribute_id, score, direct_sum, direct_count, evidence_count,
   model_version, updated_at, rating_deviation, random_key, question_slot)
SELECT response.subject_a_id, response.attribute_id, response.rating_a, response.rating_a, 1, 1,
  progress.model_version, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
  1.5, lower(hex(randomblob(16))), (abs(random()) % 200) + 1
FROM migration_0135_ratings rating
CROSS JOIN attributes attribute
CROSS JOIN attribute_vote_responses response
  ON response.response_id = 'attribute-response-seed:0135:' || attribute.key || ':' || rating.subject_id
CROSS JOIN attribute_online_progress progress
WHERE attribute.id IN ('attribute_risk_planning', 'attribute_luck_dependence')
  AND progress.id = 1
ON CONFLICT(subject_id, attribute_id) DO NOTHING;

-- Publish a bounded delta, preserving the snapshot and its cursor so both
-- fresh clients and clients with a cached catalog receive the same values.
WITH entries AS (
  SELECT 'value:' || state.subject_id || ':' || state.attribute_id AS entry_key,
    json_object('kind', 'value', 'subjectId', state.subject_id, 'attributeId', state.attribute_id,
      'score', state.score, 'ratingDeviation', state.rating_deviation,
      'directAverage', state.direct_sum / state.direct_count,
      'directCount', state.direct_count, 'comparisonCount', state.comparison_count,
      'decisiveComparisonCount', state.decisive_comparison_count,
      'evidenceCount', state.evidence_count, 'modelVersion', state.model_version) AS entry_json
  FROM migration_0135_ratings rating
  CROSS JOIN attribute_score_states state ON state.subject_id = rating.subject_id
    AND state.attribute_id IN ('attribute_risk_planning', 'attribute_luck_dependence')
)
INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
SELECT entry.entry_key, clock.current_version + ROW_NUMBER() OVER (ORDER BY entry.entry_key),
  entry.entry_json, 0, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM entries entry
CROSS JOIN attribute_catalog_clock clock
WHERE clock.id = 1
ON CONFLICT(entry_key) DO UPDATE SET
  catalog_version = excluded.catalog_version, entry_json = excluded.entry_json,
  deleted = excluded.deleted, updated_at = excluded.updated_at;

UPDATE attribute_catalog_clock SET current_version = current_version + changes() WHERE id = 1;
DELETE FROM attribute_catalog_rebuild_mode WHERE id = 1;
DROP TABLE migration_0135_ratings;
