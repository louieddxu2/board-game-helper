UPDATE attributes SET is_active = 0 WHERE id = 'attribute_luck';

INSERT INTO attributes (id, key, min_value, max_value, is_active, sort_order)
VALUES
  ('attribute_risk_planning', 'risk_planning', 0, 10, 1, 26),
  ('attribute_luck_dependence', 'luck_dependence', 0, 10, 1, 27);

INSERT INTO attribute_translations (attribute_id, locale, name, full_description)
VALUES
  ('attribute_risk_planning', 'zh-TW', '風險規劃',
   '玩家要在遊戲中考慮未來可能的隨機性，預先做好準備。'),
  ('attribute_luck_dependence', 'zh-TW', '運氣成分',
   '玩家有多容易靠運氣取得勝利。');

CREATE TABLE migration_0123_ratings (
  subject_id TEXT NOT NULL REFERENCES attribute_subjects(id),
  risk_planning INTEGER NOT NULL,
  luck_dependence INTEGER NOT NULL
);

INSERT INTO migration_0123_ratings (subject_id, risk_planning, luck_dependence)
VALUES
  ('attribute_subject_game:game_attribute_import_railroad_ink', 7, 5),
  ('attribute_subject_game:game_a1c38db3091a9231100d', 8, 4),
  ('attribute_subject_game:game_bgg_63975', 3, 8),
  ('attribute_subject_game:game_72f3ca8f795a40d3ab8df914292cf402', 1, 2),
  ('attribute_subject_game:game_b9d5d8eaf27e55734042', 6, 3),
  ('attribute_subject_game:game_188f6b31d9b1b4888025', 1, 1),
  ('attribute_subject_game:game_attribute_import_patchwork', 1, 0),
  ('attribute_subject_game:game_bgg_107529', 7, 4),
  ('attribute_subject_game:game_e5ba503d7d3748cfa9c05314b038b473', 6, 5),
  ('attribute_subject_game:game_attribute_import_marco_polo', 2, 3),
  ('attribute_subject_game:game_ece22ff7f8cc887f560d', 1, 2),
  ('attribute_subject_game:game_attribute_import_key_flow', 4, 3),
  ('attribute_subject_game:game_attribute_import_hanabi', 1, 3),
  ('attribute_subject_game:game_attribute_import_the_isle_of_cats', 7, 4),
  ('attribute_subject_game:game_attribute_import_nova_luna', 7, 2),
  ('attribute_subject_game:game_attribute_import_a_feast_for_odin', 1, 3);

-- Record these as direct ratings with explicit import provenance. Replay
-- reads responses, and the score state makes the new ratings usable now.
INSERT INTO attribute_vote_responses
  (response_id, attribute_id, subject_a_id, rating_a, activity_json, session_id, created_at, updated_at)
SELECT 'attribute-response-seed:0123:' || key || ':' || subject_id,
  attribute.id, subject_id,
  CASE key WHEN 'risk_planning' THEN risk_planning ELSE luck_dependence END,
  '[]', 'attribute-seed:0123', 0, 0
FROM migration_0123_ratings
CROSS JOIN attributes attribute
WHERE attribute.id IN ('attribute_risk_planning', 'attribute_luck_dependence');

INSERT INTO attribute_score_states
  (subject_id, attribute_id, score, direct_sum, direct_count, evidence_count,
   model_version, updated_at, rating_deviation, random_key, question_slot)
SELECT subject_a_id, attribute_id, rating_a, rating_a, 1, 1, 'glicko-rd-v2',
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
  1.5, lower(hex(randomblob(16))), (abs(random()) % 200) + 1
FROM attribute_vote_responses
WHERE response_id >= 'attribute-response-seed:0123:'
  AND response_id < 'attribute-response-seed:0123;';

-- Publish the bounded change set immediately for fresh and cached clients.
-- Keep the snapshot cursor intact so the client can apply outstanding deltas.
WITH entries AS (
  SELECT 'attribute:attribute_luck' AS entry_key, NULL AS entry_json, 1 AS deleted
  UNION ALL
  SELECT 'attribute:' || attribute.id, json_object('kind', 'attribute', 'attribute', json_object(
    'id', attribute.id, 'key', attribute.key, 'name', translation.name,
    'fullDescription', translation.full_description, 'minValue', attribute.min_value,
    'maxValue', attribute.max_value, 'sortOrder', attribute.sort_order,
    'scaleType', attribute.scale_type
  )), 0
  FROM attributes attribute
  JOIN attribute_translations translation ON translation.attribute_id = attribute.id AND translation.locale = 'zh-TW'
  WHERE attribute.id IN ('attribute_risk_planning', 'attribute_luck_dependence')
  UNION ALL
  SELECT 'value:' || state.subject_id || ':' || state.attribute_id,
    json_object('kind', 'value', 'subjectId', state.subject_id, 'attributeId', state.attribute_id,
      'score', state.score, 'ratingDeviation', state.rating_deviation, 'directAverage', state.direct_sum,
      'directCount', state.direct_count, 'comparisonCount', 0, 'decisiveComparisonCount', 0,
      'evidenceCount', state.evidence_count, 'modelVersion', state.model_version), 0
  FROM migration_0123_ratings rating
  JOIN attribute_score_states state ON state.subject_id = rating.subject_id
    AND state.attribute_id IN ('attribute_risk_planning', 'attribute_luck_dependence')
)
INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
SELECT entry_key,
  (SELECT current_version FROM attribute_catalog_clock WHERE id = 1) +
    ROW_NUMBER() OVER (ORDER BY entry_key),
  entry_json, deleted, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM entries
WHERE 1
ON CONFLICT(entry_key) DO UPDATE SET
  catalog_version = excluded.catalog_version,
  entry_json = excluded.entry_json,
  deleted = excluded.deleted,
  updated_at = excluded.updated_at;

UPDATE attribute_catalog_clock
SET current_version = current_version + changes()
WHERE id = 1;

DROP TABLE migration_0123_ratings;
