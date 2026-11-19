-- Existing online answers have already affected live scores. Start at the
-- indexed history head; never scan or rewrite the old response table.
ALTER TABLE attribute_vote_responses ADD COLUMN online_weight REAL;

CREATE TABLE attribute_online_progress (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  through_rowid INTEGER NOT NULL,
  through_response_id TEXT,
  model_version TEXT NOT NULL
);
INSERT INTO attribute_online_progress (id, through_rowid, through_response_id, model_version)
VALUES (1, COALESCE((SELECT rowid FROM attribute_vote_responses ORDER BY rowid DESC LIMIT 1), 0),
  (SELECT response_id FROM attribute_vote_responses ORDER BY rowid DESC LIMIT 1), 'glicko-rd-v2');
