PRAGMA foreign_keys = ON;

CREATE TABLE review_batches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('file', 'ai', 'manual')),
  source_hash TEXT UNIQUE,
  base_dataset_version TEXT,
  scope_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'cancelled')),
  proposal_count INTEGER NOT NULL DEFAULT 0,
  pending_count INTEGER NOT NULL DEFAULT 0,
  accepted_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX idx_review_batches_status
  ON review_batches(status, updated_at DESC);

CREATE TABLE review_proposals (
  id TEXT PRIMARY KEY,
  batch_id TEXT REFERENCES review_batches(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL DEFAULT 'rule' CHECK (target_type IN ('rule')),
  target_id TEXT NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  operation TEXT NOT NULL DEFAULT 'edit' CHECK (operation IN ('edit', 'hide')),
  base_updated_at INTEGER NOT NULL,
  base_content_hash TEXT NOT NULL,
  original_json TEXT NOT NULL,
  proposed_json TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'conflict', 'cancelled')),
  claimed_by TEXT REFERENCES users(id),
  claimed_until INTEGER,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_review_proposals_batch_target
  ON review_proposals(batch_id, target_id, base_content_hash)
  WHERE batch_id IS NOT NULL;

CREATE INDEX idx_review_proposals_queue
  ON review_proposals(status, created_at DESC, id DESC);

CREATE INDEX idx_review_proposals_batch
  ON review_proposals(batch_id, status, created_at DESC);

CREATE INDEX idx_review_proposals_claim
  ON review_proposals(claimed_by, claimed_until);
