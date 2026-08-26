-- Smart question selection still reads a fixed candidate count. The existing
-- attribute/score index supports nearest-neighbour seeks; these two partial
-- indexes make random extreme examples seek only inside their score bands.
CREATE INDEX idx_attribute_score_states_low_example_random
  ON attribute_score_states(attribute_id, random_key, subject_id)
  WHERE evidence_count > 0 AND score >= 0 AND score <= 2;

CREATE INDEX idx_attribute_score_states_high_example_random
  ON attribute_score_states(attribute_id, random_key, subject_id)
  WHERE evidence_count > 0 AND score >= 8 AND score <= 10;

PRAGMA optimize;
