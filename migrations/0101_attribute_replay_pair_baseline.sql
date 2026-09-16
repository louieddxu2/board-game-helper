-- The weekly full replay compares derived pair counts to this compact,
-- Worker-only baseline instead of scanning attribute_pair_stats.
CREATE TABLE attribute_replay_snapshot_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active_generation INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  generated_at INTEGER NOT NULL
);

CREATE TABLE attribute_replay_snapshot_chunks (
  generation INTEGER NOT NULL,
  chunk_number INTEGER NOT NULL,
  pairs_json TEXT NOT NULL,
  PRIMARY KEY (generation, chunk_number)
);

-- Seed from the already materialized table once at migration time.  Later
-- replays read this single compressed chunk instead of the individual rows.
INSERT INTO attribute_replay_snapshot_chunks (generation, chunk_number, pairs_json)
SELECT 0, 0, COALESCE(json_group_array(json_array(subject_a_id, subject_b_id, attribute_id, comparison_count)), '[]')
FROM attribute_pair_stats;

INSERT INTO attribute_replay_snapshot_state (id, active_generation, chunk_count, generated_at)
VALUES (1, 0, 1, 0);
