-- The score pad catalog snapshot (worker/data/scorepadSnapshot.ts): every unmerged game with a
-- BGG id, rebuilt by the daily schedule. Empty here; the first schedule or call builds it.
CREATE TABLE scorepad_catalog_snapshot_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  generation INTEGER NOT NULL,
  version TEXT NOT NULL,
  through_version INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  generated_at INTEGER NOT NULL,
  checked_at INTEGER NOT NULL
);

CREATE TABLE scorepad_catalog_snapshot_chunks (
  generation INTEGER NOT NULL,
  chunk_number INTEGER NOT NULL,
  games_json TEXT NOT NULL,
  PRIMARY KEY (generation, chunk_number)
);
