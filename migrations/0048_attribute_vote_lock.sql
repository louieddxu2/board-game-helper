-- Serialize materialized attribute updates so two concurrent votes cannot
-- calculate from the same stale score state and overwrite one another.
CREATE TABLE attribute_vote_lock (
  lock_name TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
