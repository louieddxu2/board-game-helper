-- Ratings/comparisons remain canonical; retain the displayed direction so
-- the original answer can be reconstructed without changing scoring history.
ALTER TABLE attribute_vote_responses ADD COLUMN question_high_pole TEXT NOT NULL DEFAULT 'high'
  CHECK (question_high_pole IN ('low', 'high'));
