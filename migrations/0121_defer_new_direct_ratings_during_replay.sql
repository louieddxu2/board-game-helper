-- An existing job has no recorded input revision. The worker starts a fresh
-- checkpoint for it before using the new publication policy.
ALTER TABLE attribute_replay_work ADD COLUMN input_revision INTEGER;
ALTER TABLE attribute_replay_work ADD COLUMN online_rowid INTEGER;
ALTER TABLE attribute_replay_work ADD COLUMN online_response_id TEXT;
