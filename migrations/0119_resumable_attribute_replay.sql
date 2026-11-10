-- A new response can be added to staged input. Rewriting or removing a
-- response invalidates pages that might already have captured it.
ALTER TABLE attribute_replay_status ADD COLUMN history_revision INTEGER NOT NULL DEFAULT 0;

DROP TRIGGER attribute_responses_require_replay_after_update;
CREATE TRIGGER attribute_responses_require_replay_after_update
AFTER UPDATE OF attribute_id, subject_a_id, subject_b_id, rating_a, rating_b, comparison, created_at
ON attribute_vote_responses
WHEN OLD.attribute_id IS NOT NEW.attribute_id
  OR OLD.subject_a_id IS NOT NEW.subject_a_id OR OLD.subject_b_id IS NOT NEW.subject_b_id
  OR OLD.rating_a IS NOT NEW.rating_a OR OLD.rating_b IS NOT NEW.rating_b
  OR OLD.comparison IS NOT NEW.comparison OR OLD.created_at IS NOT NEW.created_at
BEGIN
  UPDATE attribute_replay_status
  SET required_revision = required_revision + 1, history_revision = history_revision + 1
  WHERE id = 1;
END;

DROP TRIGGER attribute_responses_require_replay_after_delete;
CREATE TRIGGER attribute_responses_require_replay_after_delete
AFTER DELETE ON attribute_vote_responses
WHEN OLD.rating_a IS NOT NULL OR OLD.rating_b IS NOT NULL OR OLD.comparison IS NOT NULL
BEGIN
  UPDATE attribute_replay_status
  SET required_revision = required_revision + 1, history_revision = history_revision + 1
  WHERE id = 1;
END;

CREATE TABLE attribute_replay_work (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  history_revision INTEGER NOT NULL,
  model_version TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  target_rowid INTEGER NOT NULL,
  target_response_id TEXT,
  scanned_rowid INTEGER NOT NULL
);

CREATE TABLE attribute_replay_work_chunks (
  kind TEXT NOT NULL CHECK (kind IN ('history', 'states', 'pairs')),
  attribute_id TEXT NOT NULL,
  page INTEGER NOT NULL,
  chunk_number INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (kind, attribute_id, page, chunk_number)
) WITHOUT ROWID;
