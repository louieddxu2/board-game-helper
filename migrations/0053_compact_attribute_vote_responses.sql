-- Store one durable row per user answer instead of three indexed event rows.
-- The answer row contains both optional direct ratings, the comparison result,
-- and the activity payload used by the recent feed.  The legacy event/feed
-- tables remain available for historical data and migration compatibility.
CREATE TABLE attribute_vote_responses (
  response_id TEXT NOT NULL PRIMARY KEY,
  attribute_id TEXT REFERENCES attributes(id) ON DELETE SET NULL,
  subject_a_id TEXT REFERENCES attribute_subjects(id) ON DELETE SET NULL,
  subject_b_id TEXT REFERENCES attribute_subjects(id) ON DELETE SET NULL,
  rating_a REAL,
  rating_b REAL,
  comparison TEXT CHECK (comparison IS NULL OR comparison IN ('A_HIGHER', 'SIMILAR', 'B_HIGHER')),
  activity_json TEXT NOT NULL,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  session_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (rating_a IS NULL OR (rating_a >= 0 AND rating_a <= 10)),
  CHECK (rating_b IS NULL OR (rating_b >= 0 AND rating_b <= 10))
);

CREATE INDEX idx_attribute_vote_responses_recent
  ON attribute_vote_responses(created_at DESC, response_id DESC);

-- These indexes are not used by the current worker.  Exact state reads use
-- the primary key, while question selection uses the question-slot and random
-- indexes below.  Removing them avoids rewriting redundant index entries on
-- every score update.
DROP INDEX IF EXISTS idx_attribute_score_states_attribute;
DROP INDEX IF EXISTS idx_attribute_score_states_low_confidence;
