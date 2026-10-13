-- One bounded revision row distinguishes live comparisons from changes that
-- require recalculating the direct-rating baseline or historical comparisons.
CREATE TABLE attribute_replay_status (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  required_revision INTEGER NOT NULL,
  replayed_revision INTEGER NOT NULL,
  replayed_model_version TEXT
);

-- Establish a verified baseline on the first weekly run after this migration.
INSERT INTO attribute_replay_status VALUES (1, 1, 0, NULL);

-- Ordinary responses update their materialized states in the same transaction.
-- Imports default to zero, including imports of comparison-only history.
ALTER TABLE attribute_vote_responses ADD COLUMN recorded_online INTEGER NOT NULL DEFAULT 0
  CHECK (recorded_online IN (0, 1));

CREATE TRIGGER attribute_responses_require_replay_after_insert
AFTER INSERT ON attribute_vote_responses
WHEN NEW.rating_a IS NOT NULL OR NEW.rating_b IS NOT NULL
  OR (NEW.comparison IS NOT NULL AND NEW.recorded_online = 0)
BEGIN
  UPDATE attribute_replay_status SET required_revision = required_revision + 1 WHERE id = 1;
END;

CREATE TRIGGER attribute_responses_require_replay_after_update
AFTER UPDATE OF attribute_id, subject_a_id, subject_b_id, rating_a, rating_b, comparison, created_at
ON attribute_vote_responses
WHEN OLD.attribute_id IS NOT NEW.attribute_id
  OR OLD.subject_a_id IS NOT NEW.subject_a_id OR OLD.subject_b_id IS NOT NEW.subject_b_id
  OR OLD.rating_a IS NOT NEW.rating_a OR OLD.rating_b IS NOT NEW.rating_b
  OR OLD.comparison IS NOT NEW.comparison OR OLD.created_at IS NOT NEW.created_at
BEGIN
  UPDATE attribute_replay_status SET required_revision = required_revision + 1 WHERE id = 1;
END;

CREATE TRIGGER attribute_responses_require_replay_after_delete
AFTER DELETE ON attribute_vote_responses
WHEN OLD.rating_a IS NOT NULL OR OLD.rating_b IS NOT NULL OR OLD.comparison IS NOT NULL
BEGIN
  UPDATE attribute_replay_status SET required_revision = required_revision + 1 WHERE id = 1;
END;
