ALTER TABLE submissions ADD COLUMN source_notes TEXT;

CREATE TABLE submission_sources (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  label TEXT,
  url TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_submission_sources_unique
  ON submission_sources(submission_id, url);
CREATE INDEX idx_submission_sources_submission
  ON submission_sources(submission_id, position);
