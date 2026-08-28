-- Preserve varied low/high examples while keeping score-band lookup ordered
-- by the same leading columns as the query.  The BGG eligibility predicates
-- are still checked at the selected subject, but unrelated score rows are no
-- longer traversed to find a random-key pivot.
CREATE INDEX IF NOT EXISTS idx_attribute_score_states_low_example_score_random
  ON attribute_score_states(attribute_id, score, random_key, subject_id)
  WHERE evidence_count > 0 AND score >= 0 AND score <= 2;

CREATE INDEX IF NOT EXISTS idx_attribute_score_states_high_example_score_random
  ON attribute_score_states(attribute_id, score, random_key, subject_id)
  WHERE evidence_count > 0 AND score >= 8 AND score <= 10;

PRAGMA optimize;
