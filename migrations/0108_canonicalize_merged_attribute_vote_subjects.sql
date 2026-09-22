-- A merged game's historical votes must belong to the surviving game before
-- the authoritative replay reads them. Follow multi-step merge chains so a
-- response is normalized directly to its final game subject in one update.
WITH RECURSIVE merge_chain(source_game_id, target_game_id) AS (
  SELECT id, merged_into_game_id
  FROM games
  WHERE merged_into_game_id IS NOT NULL

  UNION ALL

  SELECT chain.source_game_id, target.merged_into_game_id
  FROM merge_chain AS chain
  JOIN games AS target ON target.id = chain.target_game_id
  WHERE target.merged_into_game_id IS NOT NULL
), terminal_game_targets AS (
  SELECT chain.source_game_id, chain.target_game_id
  FROM merge_chain AS chain
  JOIN games AS target ON target.id = chain.target_game_id
  WHERE target.merged_into_game_id IS NULL
), subject_targets AS (
  SELECT source_subject.id AS source_subject_id,
         target_subject.id AS target_subject_id
  FROM terminal_game_targets
  JOIN attribute_subjects AS source_subject
    ON source_subject.kind = 'game'
   AND source_subject.game_id = terminal_game_targets.source_game_id
  JOIN attribute_subjects AS target_subject
    ON target_subject.kind = 'game'
   AND target_subject.game_id = terminal_game_targets.target_game_id
)
UPDATE attribute_vote_responses AS response
SET subject_a_id = COALESCE((
      SELECT target_subject_id
      FROM subject_targets
      WHERE source_subject_id = response.subject_a_id
    ), response.subject_a_id),
    subject_b_id = COALESCE((
      SELECT target_subject_id
      FROM subject_targets
      WHERE source_subject_id = response.subject_b_id
    ), response.subject_b_id)
WHERE response.subject_a_id IN (SELECT source_subject_id FROM subject_targets)
   OR response.subject_b_id IN (SELECT source_subject_id FROM subject_targets);

-- Merge jobs used a second, incomplete replay path. Raw history is now the
-- sole source of truth, so no pending job or job-only lock can block it.
DELETE FROM attribute_vote_lock
WHERE lock_name GLOB 'attribute-vote:rebuild:*';

DROP TABLE attribute_merge_rebuild_jobs;
