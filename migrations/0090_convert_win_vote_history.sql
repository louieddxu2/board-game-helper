-- Every source answer becomes canonical, replayable evidence. No aggregate seed.
INSERT INTO attribute_vote_responses
  (response_id,attribute_id,subject_a_id,rating_a,activity_json,actor_id,session_id,created_at,updated_at)
SELECT 'win-history-rating:' || rating.id,rating.attribute_id,rating.subject_id,rating.value,'[]',rating.actor_id,rating.session_id,rating.created_at,rating.updated_at
FROM attribute_ratings rating
WHERE rating.attribute_id IN ('attribute_score_race','attribute_end_condition')
  AND NOT EXISTS (SELECT 1 FROM attribute_vote_responses r WHERE r.attribute_id=rating.attribute_id AND r.subject_a_id=rating.subject_id AND r.session_id=rating.session_id AND r.rating_a=rating.value)
  AND NOT EXISTS (SELECT 1 FROM attribute_vote_events e WHERE e.attribute_id=rating.attribute_id AND e.subject_a_id=rating.subject_id AND e.session_id=rating.session_id AND e.value=rating.value);

UPDATE attribute_vote_responses
SET activity_json = COALESCE((
  SELECT json_group_array(json(
    json_patch(item.value, json_object(
      'attributeId', 'attribute_win_method', 'attributeName', '取勝方式',
      'attributePoles', json_object('low', '得分取勝', 'high', '條件取勝'),
      'value', CASE WHEN attribute_id = 'attribute_score_race' THEN 10 - json_extract(item.value, '$.value') ELSE json_extract(item.value, '$.value') END,
      'ratingA', CASE WHEN attribute_id = 'attribute_score_race' THEN 10 - json_extract(item.value, '$.ratingA') ELSE json_extract(item.value, '$.ratingA') END,
      'ratingB', CASE WHEN attribute_id = 'attribute_score_race' THEN 10 - json_extract(item.value, '$.ratingB') ELSE json_extract(item.value, '$.ratingB') END,
      'result', CASE WHEN attribute_id = 'attribute_score_race' THEN
        CASE json_extract(item.value, '$.result') WHEN 'A_HIGHER' THEN 'B_HIGHER' WHEN 'B_HIGHER' THEN 'A_HIGHER' ELSE json_extract(item.value, '$.result') END
        ELSE json_extract(item.value, '$.result') END
    ))
  )) FROM json_each(attribute_vote_responses.activity_json) item
), '[]'),
rating_a = CASE WHEN attribute_id = 'attribute_score_race' THEN 10 - rating_a ELSE rating_a END,
rating_b = CASE WHEN attribute_id = 'attribute_score_race' THEN 10 - rating_b ELSE rating_b END,
comparison = CASE WHEN attribute_id = 'attribute_score_race' THEN
  CASE comparison WHEN 'A_HIGHER' THEN 'B_HIGHER' WHEN 'B_HIGHER' THEN 'A_HIGHER' ELSE comparison END ELSE comparison END,
question_high_pole = CASE WHEN attribute_id = 'attribute_score_race' THEN 'low' ELSE 'high' END,
attribute_id = 'attribute_win_method'
WHERE attribute_id IN ('attribute_score_race', 'attribute_end_condition');

UPDATE attribute_vote_events
SET value = CASE WHEN attribute_id = 'attribute_score_race' THEN 10 - value ELSE value END,
result = CASE WHEN attribute_id = 'attribute_score_race' THEN
  CASE result WHEN 'A_HIGHER' THEN 'B_HIGHER' WHEN 'B_HIGHER' THEN 'A_HIGHER' ELSE result END ELSE result END,
attribute_id = 'attribute_win_method'
WHERE attribute_id IN ('attribute_score_race', 'attribute_end_condition');

-- These were generated from final averages, not individual votes.
DELETE FROM attribute_vote_events WHERE session_id = 'win-conversion-v1';

-- Retain the author's five explicit corrections as ordinary new ratings.
INSERT INTO attribute_vote_responses
  (response_id,attribute_id,subject_a_id,rating_a,activity_json,session_id,created_at,updated_at)
SELECT 'win-author-correction:' || id,'attribute_win_method',id,score,'[]','win-author-correction',
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM (
  SELECT 'attribute_subject_game:game_attribute_import_the_mind' id,9 score
  UNION ALL SELECT 'attribute_config_7th_continent_what_goes_up',10
  UNION ALL SELECT 'attribute_subject_game:game_attribute_import_and_then_we_held_hands',8
  UNION ALL SELECT 'attribute_subject_game:game_attribute_import_fog_of_love',10
  UNION ALL SELECT 'attribute_subject_game:game_attribute_import_hanabi',2
);

ALTER TABLE attribute_merge_rebuild_jobs ADD COLUMN attribute_id TEXT REFERENCES attributes(id);
INSERT INTO attribute_merge_rebuild_jobs
  (id,source_game_id,target_game_id,source_subject_id,target_subject_id,status,cutoff_created_at,created_at,updated_at,attribute_id)
SELECT 'win-history-replay-v1',game_id,game_id,id,id,'pending',
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),'attribute_win_method'
FROM attribute_subjects WHERE game_id IS NOT NULL ORDER BY id LIMIT 1;
