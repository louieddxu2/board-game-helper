-- Read-only release verification.
SELECT status, COUNT(*) AS job_count, MAX(updated_at) AS last_updated_at
FROM attribute_merge_rebuild_jobs GROUP BY status;
-- Both obsolete record counts must remain zero.
SELECT COUNT(*) AS obsolete_aggregate_events
FROM attribute_vote_events WHERE session_id = 'win-conversion-v1';
SELECT COUNT(*) AS obsolete_correction_votes
FROM attribute_vote_responses WHERE session_id = 'win-author-correction';
SELECT attribute_id, COUNT(*) AS response_count
FROM attribute_vote_responses
WHERE attribute_id IN ('attribute_score_race', 'attribute_end_condition', 'attribute_win_method')
GROUP BY attribute_id;
SELECT COUNT(*) AS rated_win_subjects
FROM attribute_score_states WHERE attribute_id = 'attribute_win_method' AND evidence_count > 0;
