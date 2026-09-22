-- Read-only release verification.
-- A complete replay only consumes canonical responses, so no response may
-- retain a subject belonging to a merged game.
SELECT COUNT(*) AS merged_game_vote_references
FROM attribute_vote_responses AS response
WHERE EXISTS (
  SELECT 1
  FROM attribute_subjects AS subject
  JOIN games AS game ON game.id = subject.game_id
  WHERE game.merged_into_game_id IS NOT NULL
    AND subject.id IN (response.subject_a_id, response.subject_b_id)
);

SELECT attribute_id, COUNT(*) AS response_count
FROM attribute_vote_responses
WHERE attribute_id IN ('attribute_score_race', 'attribute_end_condition', 'attribute_win_method')
GROUP BY attribute_id;

SELECT COUNT(*) AS rated_win_subjects
FROM attribute_score_states WHERE attribute_id = 'attribute_win_method' AND evidence_count > 0;
