-- Attribute identities are intentionally narrower than the shared game entity
-- graph. Base games and confirmed expansions may have game subjects. Confirmed
-- expansion combinations also use kind = 'configuration' subjects; versions
-- and unclassified rule labels never get score states.

-- Stop future version/unknown game entities from receiving the base game's
-- materialized attribute matrix when they are created from a rule. An
-- explicitly classified expansion remains an eligible attribute identity.
DROP TRIGGER IF EXISTS attribute_subject_games_after_insert;
CREATE TRIGGER attribute_subject_games_after_insert AFTER INSERT ON games
WHEN NEW.merged_into_game_id IS NULL AND NEW.entity_kind IN ('base', 'expansion')
BEGIN
  INSERT OR IGNORE INTO attribute_subjects (id, slug, kind, display_name, game_id, created_at, updated_at)
  VALUES ('attribute_subject_game:' || NEW.id, 'game-' || NEW.slug, 'game', NEW.display_name, NEW.id, NEW.created_at, NEW.updated_at);
  INSERT OR IGNORE INTO attribute_subject_components (subject_id, component_order, game_id, component_type, label)
  VALUES ('attribute_subject_game:' || NEW.id, 0, NEW.id, 'base', NEW.display_name);
  INSERT OR IGNORE INTO attribute_score_states
    (subject_id, attribute_id, score, direct_sum, direct_count, comparison_count,
     decisive_comparison_count, evidence_count, model_version, updated_at,
     rating_deviation, random_key, question_slot)
  SELECT 'attribute_subject_game:' || NEW.id, id, 5, 0, 0, 0, 0, 0,
    'glicko-rd-v1', NEW.updated_at, 3, lower(hex(randomblob(16))),
    (abs(random()) % 200) + 1
  FROM attributes WHERE is_active = 1;
END;

-- Keep the reverse provisioning path subject to the same identity boundary.
DROP TRIGGER IF EXISTS attributes_score_states_after_insert;
CREATE TRIGGER attributes_score_states_after_insert
AFTER INSERT ON attributes
WHEN NEW.is_active = 1
BEGIN
  INSERT OR IGNORE INTO attribute_score_states
    (subject_id, attribute_id, score, direct_sum, direct_count, comparison_count,
     decisive_comparison_count, evidence_count, model_version, updated_at,
     rating_deviation, random_key, question_slot)
  SELECT s.id, NEW.id, 5, 0, 0, 0, 0, 0, 'glicko-rd-v1',
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
    3, lower(hex(randomblob(16))), (abs(random()) % 200) + 1
  FROM attribute_subjects s
  LEFT JOIN games g ON g.id = s.game_id
  WHERE s.kind = 'configuration'
    OR (s.kind = 'game' AND g.entity_kind IN ('base', 'expansion')
      AND g.merged_into_game_id IS NULL AND g.visibility = 'public'
      AND (g.published_rule_count > 0 OR g.attribute_enabled = 1));
END;

DROP TRIGGER IF EXISTS attributes_score_states_after_activate;
CREATE TRIGGER attributes_score_states_after_activate
AFTER UPDATE OF is_active ON attributes
WHEN NEW.is_active = 1 AND OLD.is_active = 0
BEGIN
  INSERT OR IGNORE INTO attribute_score_states
    (subject_id, attribute_id, score, direct_sum, direct_count, comparison_count,
     decisive_comparison_count, evidence_count, model_version, updated_at,
     rating_deviation, random_key, question_slot)
  SELECT s.id, NEW.id, 5, 0, 0, 0, 0, 0, 'glicko-rd-v1',
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
    3, lower(hex(randomblob(16))), (abs(random()) % 200) + 1
  FROM attribute_subjects s
  LEFT JOIN games g ON g.id = s.game_id
  WHERE s.kind = 'configuration'
    OR (s.kind = 'game' AND g.entity_kind IN ('base', 'expansion')
      AND g.merged_into_game_id IS NULL AND g.visibility = 'public'
      AND (g.published_rule_count > 0 OR g.attribute_enabled = 1));
END;

-- Remove score states accidentally provisioned for versions and unclassified
-- labels by migrations 0068/0069. Confirmed expansion subjects are retained.
-- The historical event/rating tables are kept when evidence exists; those old
-- identities are no longer selectable or rebuilt by the runtime boundary.
CREATE TABLE migration_0070_variant_attribute_subjects (
  subject_id TEXT PRIMARY KEY
);

INSERT INTO migration_0070_variant_attribute_subjects (subject_id)
SELECT s.id
FROM attribute_subjects s
JOIN games g ON g.id = s.game_id
WHERE s.kind = 'game'
  AND g.entity_kind IN ('version', 'unknown');

DELETE FROM attribute_score_states
WHERE subject_id IN (SELECT subject_id FROM migration_0070_variant_attribute_subjects);

-- Subjects with no historical evidence are removed completely. If an old
-- database somehow contains evidence against a variant subject, preserve the
-- append-only history and leave only the non-selectable historical identity.
DELETE FROM attribute_subjects
WHERE id IN (SELECT subject_id FROM migration_0070_variant_attribute_subjects)
  AND NOT EXISTS (SELECT 1 FROM attribute_ratings r WHERE r.subject_id = attribute_subjects.id)
  AND NOT EXISTS (
    SELECT 1 FROM attribute_comparisons c
    WHERE c.subject_a_id = attribute_subjects.id OR c.subject_b_id = attribute_subjects.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM attribute_vote_events e
    WHERE e.subject_a_id = attribute_subjects.id OR e.subject_b_id = attribute_subjects.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM attribute_vote_responses response
    WHERE response.subject_a_id = attribute_subjects.id OR response.subject_b_id = attribute_subjects.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM attribute_pair_stats pair_stats
    WHERE pair_stats.subject_a_id = attribute_subjects.id OR pair_stats.subject_b_id = attribute_subjects.id
  );

DROP TABLE migration_0070_variant_attribute_subjects;

PRAGMA optimize;
