-- The score pad catalog (worker/data/scorepadSnapshot.ts), built like the game catalog: one
-- entry per game with a BGG id, refreshed by the catalog outbox flush, and a weekly snapshot
-- of those entries. Empty here; the first weekly schedule or call builds both.
CREATE TABLE scorepad_catalog_entries (
  game_id TEXT PRIMARY KEY,
  entry_version INTEGER NOT NULL,
  entry_json TEXT,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_scorepad_catalog_entries_version ON scorepad_catalog_entries(entry_version);

CREATE TABLE scorepad_catalog_snapshot_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  generation INTEGER NOT NULL,
  through_version INTEGER NOT NULL,
  entries_version INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  generated_at INTEGER NOT NULL
);

CREATE TABLE scorepad_catalog_snapshot_chunks (
  generation INTEGER NOT NULL,
  chunk_number INTEGER NOT NULL,
  games_json TEXT NOT NULL,
  PRIMARY KEY (generation, chunk_number)
);
