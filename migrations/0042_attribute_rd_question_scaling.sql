-- Glicko-style online state.  The score remains on the product's 0-10 scale;
-- rating_deviation is the only uncertainty value persisted for a subject.
ALTER TABLE attribute_score_states ADD COLUMN rating_deviation REAL NOT NULL DEFAULT 3;
ALTER TABLE attribute_score_states ADD COLUMN random_key TEXT NOT NULL DEFAULT '';

-- Existing rows keep their materialized score and counts.  Their RD is a
-- conservative one-time bootstrap from evidence; new rows start at the full
-- unrated RD and future votes update it with the Glicko equations.
UPDATE attribute_score_states
SET rating_deviation = CASE
  WHEN evidence_count <= 0 THEN 3
  WHEN evidence_count = 1 THEN 1.5
  WHEN evidence_count <= 4 THEN 1.1
  WHEN evidence_count <= 9 THEN 0.8
  WHEN evidence_count <= 19 THEN 0.6
  ELSE 0.45
END,
random_key = lower(hex(randomblob(16))),
model_version = 'glicko-rd-v1'
WHERE random_key = '' OR model_version <> 'glicko-rd-v1';

CREATE INDEX idx_attribute_score_states_low_confidence
  ON attribute_score_states(attribute_id, rating_deviation DESC, random_key, subject_id);
CREATE INDEX idx_attribute_score_states_random
  ON attribute_score_states(attribute_id, random_key, subject_id);

-- Materialize the complete active matrix for newly created subjects without
-- putting a matrix scan on the voting path.
INSERT OR IGNORE INTO attribute_score_states
  (subject_id, attribute_id, score, direct_sum, direct_count, comparison_count,
   decisive_comparison_count, evidence_count, model_version, updated_at,
   rating_deviation, random_key)
SELECT s.id, a.id, 5, 0, 0, 0, 0, 0, 'glicko-rd-v1', s.updated_at, 3,
  lower(hex(randomblob(16)))
FROM attribute_subjects s
CROSS JOIN attributes a
LEFT JOIN games g ON g.id = s.game_id
WHERE a.is_active = 1
  AND (
    s.kind = 'configuration'
    OR (g.merged_into_game_id IS NULL AND g.visibility = 'public' AND g.published_rule_count > 0)
  );

CREATE TABLE attribute_activity_feed (
  id TEXT PRIMARY KEY,
  response_id TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_attribute_activity_feed_recent
  ON attribute_activity_feed(created_at DESC, id DESC);

-- Keep the materialized matrix complete when a future game enters the subject
-- layer.  The existing subject/component trigger is replaced in-place because
-- migrations are append-only and the earlier trigger has already shipped.
DROP TRIGGER attribute_subject_games_after_insert;
CREATE TRIGGER attribute_subject_games_after_insert AFTER INSERT ON games
WHEN NEW.merged_into_game_id IS NULL
BEGIN
  INSERT OR IGNORE INTO attribute_subjects (id, slug, kind, display_name, game_id, created_at, updated_at)
  VALUES ('attribute_subject_game:' || NEW.id, 'game-' || NEW.slug, 'game', NEW.display_name, NEW.id, NEW.created_at, NEW.updated_at);
  INSERT OR IGNORE INTO attribute_subject_components (subject_id, component_order, game_id, component_type, label)
  VALUES ('attribute_subject_game:' || NEW.id, 0, NEW.id, 'base', NEW.display_name);
  INSERT OR IGNORE INTO attribute_score_states
    (subject_id, attribute_id, score, direct_sum, direct_count, comparison_count,
     decisive_comparison_count, evidence_count, model_version, updated_at,
     rating_deviation, random_key)
  SELECT 'attribute_subject_game:' || NEW.id, id, 5, 0, 0, 0, 0, 0,
    'glicko-rd-v1', NEW.updated_at, 3, lower(hex(randomblob(16)))
  FROM attributes WHERE is_active = 1;
END;
