-- A game merge changes the identity used by historical attribute votes.  Keep
-- the merge request small and rebuild the materialized score matrix in
-- resumable background batches instead of replaying the complete history in
-- the editor request.
CREATE TABLE attribute_merge_rebuild_jobs (
  id TEXT PRIMARY KEY,
  source_game_id TEXT NOT NULL REFERENCES games(id),
  target_game_id TEXT NOT NULL REFERENCES games(id),
  source_subject_id TEXT NOT NULL REFERENCES attribute_subjects(id),
  target_subject_id TEXT NOT NULL REFERENCES attribute_subjects(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  reset_completed INTEGER NOT NULL DEFAULT 0 CHECK (reset_completed IN (0, 1)),
  cursor_created_at INTEGER NOT NULL DEFAULT -1,
  cursor_stream_id TEXT NOT NULL DEFAULT '',
  cutoff_created_at INTEGER NOT NULL,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_attribute_merge_rebuild_jobs_queue
  ON attribute_merge_rebuild_jobs(status, created_at, id);

CREATE UNIQUE INDEX idx_attribute_merge_rebuild_jobs_one_active
  ON attribute_merge_rebuild_jobs(status)
  WHERE status IN ('pending', 'running');

PRAGMA optimize;
