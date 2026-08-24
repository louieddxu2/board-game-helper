-- Online bounded κ-Elo state for attribute voting.
-- The legacy attribute_ratings / attribute_comparisons tables remain intact as
-- historical storage. New votes are appended to this event stream instead of
-- being overwritten by the browser session key.

CREATE TABLE attribute_vote_events (
  id TEXT PRIMARY KEY,
  response_id TEXT NOT NULL,
  event_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('rating', 'comparison')),
  attribute_id TEXT NOT NULL REFERENCES attributes(id) ON DELETE CASCADE,
  subject_a_id TEXT NOT NULL REFERENCES attribute_subjects(id) ON DELETE CASCADE,
  subject_b_id TEXT REFERENCES attribute_subjects(id) ON DELETE CASCADE,
  value REAL,
  result TEXT,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  session_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (response_id, event_key),
  CHECK (
    (kind = 'rating' AND subject_b_id IS NULL AND value IS NOT NULL AND value >= 0 AND value <= 10 AND result IS NULL)
    OR
    (kind = 'comparison' AND subject_b_id IS NOT NULL AND value IS NULL AND result IN ('A_HIGHER', 'SIMILAR', 'B_HIGHER'))
  )
);
CREATE INDEX idx_attribute_vote_events_session ON attribute_vote_events(session_id, created_at DESC);
CREATE INDEX idx_attribute_vote_events_subject_attribute ON attribute_vote_events(subject_a_id, attribute_id, created_at DESC);
CREATE INDEX idx_attribute_vote_events_pair ON attribute_vote_events(subject_a_id, subject_b_id, attribute_id, created_at DESC);
CREATE INDEX idx_attribute_vote_events_recent ON attribute_vote_events(created_at DESC, id DESC);

CREATE TABLE attribute_score_states (
  subject_id TEXT NOT NULL REFERENCES attribute_subjects(id) ON DELETE CASCADE,
  attribute_id TEXT NOT NULL REFERENCES attributes(id) ON DELETE CASCADE,
  score REAL NOT NULL DEFAULT 5 CHECK (score >= 0 AND score <= 10),
  direct_sum REAL NOT NULL DEFAULT 0,
  direct_count INTEGER NOT NULL DEFAULT 0 CHECK (direct_count >= 0),
  comparison_count INTEGER NOT NULL DEFAULT 0 CHECK (comparison_count >= 0),
  decisive_comparison_count INTEGER NOT NULL DEFAULT 0 CHECK (decisive_comparison_count >= 0),
  evidence_count INTEGER NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
  model_version TEXT NOT NULL DEFAULT 'bounded-k-elo-v1',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (subject_id, attribute_id)
);
CREATE INDEX idx_attribute_score_states_attribute ON attribute_score_states(attribute_id, subject_id);

CREATE TABLE attribute_pair_stats (
  subject_a_id TEXT NOT NULL REFERENCES attribute_subjects(id) ON DELETE CASCADE,
  subject_b_id TEXT NOT NULL REFERENCES attribute_subjects(id) ON DELETE CASCADE,
  attribute_id TEXT NOT NULL REFERENCES attributes(id) ON DELETE CASCADE,
  comparison_count INTEGER NOT NULL DEFAULT 0 CHECK (comparison_count >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (subject_a_id, subject_b_id, attribute_id),
  CHECK (subject_a_id < subject_b_id)
);
CREATE INDEX idx_attribute_pair_stats_attribute ON attribute_pair_stats(attribute_id, comparison_count, subject_a_id, subject_b_id);

-- Preserve the existing import and any earlier votes in the new append-only
-- stream. Seed rows are intentionally kept out of the public activity feed by
-- their existing seed session IDs.
INSERT OR IGNORE INTO attribute_vote_events
  (id, response_id, event_key, kind, attribute_id, subject_a_id, subject_b_id, value, result, actor_id, session_id, created_at, updated_at)
SELECT
  'legacy-rating:' || id,
  'legacy-rating:' || id,
  'rating:' || subject_id,
  'rating', attribute_id, subject_id, NULL, value, NULL, actor_id, session_id, created_at, updated_at
FROM attribute_ratings;

INSERT OR IGNORE INTO attribute_vote_events
  (id, response_id, event_key, kind, attribute_id, subject_a_id, subject_b_id, value, result, actor_id, session_id, created_at, updated_at)
SELECT
  'legacy-comparison:' || id,
  'legacy-comparison:' || id,
  'comparison:' || subject_a_id || ':' || subject_b_id,
  'comparison', attribute_id, subject_a_id, subject_b_id, NULL, result, actor_id, session_id, created_at, updated_at
FROM attribute_comparisons;

-- Imported direct scores establish the initial absolute coordinate. Existing
-- comparison counts are retained for exploration and future updates; new
-- comparisons use the online model from this state onward.
INSERT OR IGNORE INTO attribute_score_states
  (subject_id, attribute_id, score, direct_sum, direct_count, comparison_count, decisive_comparison_count, evidence_count, model_version, updated_at)
SELECT subject_id, attribute_id, AVG(value), SUM(value), COUNT(*), 0, 0, COUNT(*), 'bounded-k-elo-v1', MAX(updated_at)
FROM attribute_ratings
GROUP BY subject_id, attribute_id;

INSERT OR IGNORE INTO attribute_score_states
  (subject_id, attribute_id, score, direct_sum, direct_count, comparison_count, decisive_comparison_count, evidence_count, model_version, updated_at)
SELECT subject_id, attribute_id, 5, 0, 0, COUNT(*), SUM(CASE WHEN result <> 'SIMILAR' THEN 1 ELSE 0 END), COUNT(*), 'bounded-k-elo-v1', MAX(created_at)
FROM (
  SELECT subject_a_id AS subject_id, attribute_id, result, created_at FROM attribute_comparisons
  UNION ALL
  SELECT subject_b_id AS subject_id, attribute_id, result, created_at FROM attribute_comparisons
) comparison_subjects
GROUP BY subject_id, attribute_id;

UPDATE attribute_score_states
SET comparison_count = COALESCE((
      SELECT COUNT(*)
      FROM attribute_comparisons c
      WHERE c.attribute_id = attribute_score_states.attribute_id
        AND (c.subject_a_id = attribute_score_states.subject_id OR c.subject_b_id = attribute_score_states.subject_id)
    ), 0),
    decisive_comparison_count = COALESCE((
      SELECT COUNT(*)
      FROM attribute_comparisons c
      WHERE c.attribute_id = attribute_score_states.attribute_id
        AND c.result <> 'SIMILAR'
        AND (c.subject_a_id = attribute_score_states.subject_id OR c.subject_b_id = attribute_score_states.subject_id)
    ), 0),
    evidence_count = direct_count + COALESCE((
      SELECT COUNT(*)
      FROM attribute_comparisons c
      WHERE c.attribute_id = attribute_score_states.attribute_id
        AND (c.subject_a_id = attribute_score_states.subject_id OR c.subject_b_id = attribute_score_states.subject_id)
    ), 0);

INSERT OR IGNORE INTO attribute_pair_stats
  (subject_a_id, subject_b_id, attribute_id, comparison_count, updated_at)
SELECT
  CASE WHEN subject_a_id < subject_b_id THEN subject_a_id ELSE subject_b_id END,
  CASE WHEN subject_a_id < subject_b_id THEN subject_b_id ELSE subject_a_id END,
  attribute_id, COUNT(*), MAX(updated_at)
FROM attribute_comparisons
GROUP BY
  CASE WHEN subject_a_id < subject_b_id THEN subject_a_id ELSE subject_b_id END,
  CASE WHEN subject_a_id < subject_b_id THEN subject_b_id ELSE subject_a_id END,
  attribute_id;
