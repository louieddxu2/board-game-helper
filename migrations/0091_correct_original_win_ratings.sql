-- The author's corrections amend imported source ratings; they are not new votes.
CREATE TABLE migration_0091_corrections(subject_id TEXT PRIMARY KEY, score REAL NOT NULL);
INSERT INTO migration_0091_corrections VALUES
 ('attribute_subject_game:game_attribute_import_the_mind',9),
 ('attribute_config_7th_continent_what_goes_up',10),
 ('attribute_subject_game:game_attribute_import_and_then_we_held_hands',8),
 ('attribute_subject_game:game_attribute_import_fog_of_love',10),
 ('attribute_subject_game:game_attribute_import_hanabi',2);
CREATE TABLE migration_0091_guard(valid INTEGER NOT NULL CHECK(valid=1));
INSERT INTO migration_0091_guard SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM migration_0091_corrections c WHERE NOT EXISTS (
    SELECT 1 FROM attribute_vote_responses r WHERE r.subject_a_id=c.subject_id
      AND r.attribute_id='attribute_win_method' AND r.session_id LIKE 'attribute-import:%'
      AND r.rating_a IS NOT NULL AND r.comparison IS NULL
  )
) THEN 1 ELSE 0 END;
UPDATE attribute_vote_responses SET rating_a=(SELECT score FROM migration_0091_corrections c WHERE c.subject_id=subject_a_id)
WHERE attribute_id='attribute_win_method' AND session_id LIKE 'attribute-import:%'
  AND rating_a IS NOT NULL AND comparison IS NULL
  AND subject_a_id IN (SELECT subject_id FROM migration_0091_corrections);
UPDATE attribute_ratings SET value=(SELECT CASE WHEN attribute_id='attribute_score_race' THEN 10-score ELSE score END
  FROM migration_0091_corrections c WHERE c.subject_id=attribute_ratings.subject_id)
WHERE attribute_id IN ('attribute_score_race','attribute_end_condition') AND session_id LIKE 'attribute-import:%'
  AND subject_id IN (SELECT subject_id FROM migration_0091_corrections);
DELETE FROM attribute_vote_responses WHERE session_id='win-author-correction'
  AND response_id='win-author-correction:' || subject_a_id
  AND subject_a_id IN (SELECT subject_id FROM migration_0091_corrections);
UPDATE attribute_merge_rebuild_jobs SET status='pending',reset_completed=0,cursor_created_at=-1,cursor_stream_id='',error_message=NULL,
  cutoff_created_at=CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE id='win-history-replay-v1';
DROP TABLE migration_0091_guard;
DROP TABLE migration_0091_corrections;
