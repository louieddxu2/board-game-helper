-- Owner-approved follow-up to 0123, confirmed on 2026-11-22.
-- Preserve historical responses and seed only these 30 subjects / 60 direct ratings.
CREATE TABLE migration_0134_ratings (
  subject_id TEXT NOT NULL PRIMARY KEY,
  risk_planning INTEGER NOT NULL CHECK (risk_planning BETWEEN 0 AND 10),
  luck_dependence INTEGER NOT NULL CHECK (luck_dependence BETWEEN 0 AND 10)
);

INSERT INTO migration_0134_ratings (subject_id, risk_planning, luck_dependence)
VALUES
  ('attribute_subject_game:game_attribute_import_gaia_project', 0, 0),
  ('attribute_subject_game:game_attribute_import_cryptid', 0, 2),
  ('attribute_subject_game:game_af1c6f0ccbf43ddee8f3', 2, 3),
  ('attribute_subject_game:game_attribute_import_maracaibo', 4, 3),
  ('attribute_subject_game:game_attribute_import_keyflower', 2, 5),
  ('attribute_subject_game:game_f6111657f5ff4844ffd4', 3, 4),
  ('attribute_subject_game:game_attribute_import_awkward_guests', 1, 5),
  ('attribute_subject_game:game_attribute_import_hansa_teutonica', 0, 1),
  ('attribute_subject_game:game_bba34ef47e1dccb322e3', 3, 3),
  ('attribute_subject_game:game_attribute_import_newton', 1, 2),
  ('attribute_subject_game:game_3b77f7f4b22d03184c5b', 1, 1),
  ('attribute_subject_game:game_attribute_import_santorini', 0, 1),
  ('attribute_subject_game:game_attribute_import_fields_of_arle', 0, 0),
  ('attribute_subject_game:game_attribute_import_concordia', 1, 1),
  ('attribute_subject_game:game_attribute_import_cottage_garden', 1, 2),
  ('attribute_subject_game:game_attribute_import_indian_summer', 0, 0),
  ('attribute_subject_game:game_attribute_import_spring_meadow', 1, 1),
  ('attribute_subject_game:game_attribute_import_tzolkin', 1, 1),
  ('attribute_config_tzolkin_tribes_prophecies', 1, 2),
  ('attribute_subject_game:game_d23674b15c14a9707f4b', 3, 4),
  ('attribute_config_feast_for_odin_norwegians', 1, 3),
  ('attribute_config_santa_maria_american_kingdoms', 2, 3),
  ('attribute_config_marco_polo_agents_venice', 1, 3),
  ('attribute_config_barenpark_bad_news_bears', 1, 2),
  ('attribute_subject_game:game_attribute_import_castell', 3, 4),
  ('attribute_subject_game:game_attribute_import_burano', 2, 4),
  ('attribute_subject_game:game_7f41f30c5507cccef21c', 2, 3),
  ('attribute_subject_game:game_attribute_import_skyliners', 3, 2),
  ('attribute_subject_game:game_attribute_import_the_mind', 0, 3),
  ('attribute_subject_game:game_bgg_231554', 1, 3);

INSERT INTO attribute_vote_responses
  (response_id, attribute_id, subject_a_id, rating_a, activity_json, session_id, created_at, updated_at)
SELECT 'attribute-response-seed:0134:' || attribute.key || ':' || rating.subject_id,
  attribute.id, rating.subject_id,
  CASE attribute.key WHEN 'risk_planning' THEN rating.risk_planning ELSE rating.luck_dependence END,
  '[]', 'attribute-seed:0134', 0, 0
FROM migration_0134_ratings rating
JOIN attribute_subjects subject ON subject.id = rating.subject_id
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
FROM attribute_vote_responses response
CROSS JOIN attribute_online_progress progress
WHERE response.response_id >= 'attribute-response-seed:0134:'
  AND response.response_id < 'attribute-response-seed:0134;'
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
  FROM migration_0134_ratings rating
  JOIN attribute_score_states state ON state.subject_id = rating.subject_id
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
DROP TABLE migration_0134_ratings;
