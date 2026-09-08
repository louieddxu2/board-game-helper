-- Read-only release verification.
SELECT status, COUNT(*) AS job_count, MAX(updated_at) AS last_updated_at
FROM attribute_merge_rebuild_jobs GROUP BY status;
SELECT COUNT(*) AS conversion_snapshot_chunks
FROM attribute_catalog_snapshot_chunks WHERE generation = 88;
SELECT COUNT(*) AS durable_conversion_events
FROM attribute_vote_events WHERE session_id = 'win-conversion-v1';
SELECT COUNT(*) AS rated_win_subjects
FROM attribute_score_states WHERE attribute_id = 'attribute_win_method' AND evidence_count > 0;
