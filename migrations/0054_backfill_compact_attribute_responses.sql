-- Remove the temporary migration-time shape and backfill legacy response IDs.
-- Legacy rows may not contain the normalized answer fields, so the compact
-- table intentionally keeps those columns nullable for historical records.
DROP INDEX IF EXISTS idx_attribute_vote_responses_recent;
ALTER TABLE attribute_vote_responses RENAME TO attribute_vote_responses_legacy;

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

INSERT INTO attribute_vote_responses
  (response_id, attribute_id, subject_a_id, subject_b_id, rating_a, rating_b,
   comparison, activity_json, actor_id, session_id, created_at, updated_at)
SELECT response_id, attribute_id, subject_a_id, subject_b_id, rating_a, rating_b,
  comparison, activity_json, actor_id, session_id, created_at, updated_at
FROM attribute_vote_responses_legacy;

INSERT OR IGNORE INTO attribute_vote_responses
  (response_id, activity_json, session_id, created_at, updated_at)
SELECT response_id, payload_json, 'legacy-feed', created_at, created_at
FROM attribute_activity_feed;

INSERT OR IGNORE INTO attribute_vote_responses
  (response_id, activity_json, session_id, created_at, updated_at)
SELECT response_id, '[]', 'legacy-events', MIN(created_at), MAX(updated_at)
FROM attribute_vote_events
GROUP BY response_id;

DROP TABLE attribute_vote_responses_legacy;

CREATE INDEX idx_attribute_vote_responses_recent
  ON attribute_vote_responses(created_at DESC, response_id DESC);
