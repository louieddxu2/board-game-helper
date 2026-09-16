-- Move the frozen, one-event-per-response legacy stream into the canonical
-- response records created as placeholders by migration 0054.
INSERT OR IGNORE INTO attribute_vote_responses
  (response_id, attribute_id, subject_a_id, subject_b_id, rating_a, rating_b,
   comparison, activity_json, actor_id, session_id, created_at, updated_at)
SELECT
  response_id, attribute_id, subject_a_id, subject_b_id,
  CASE WHEN kind = 'rating' THEN value END, NULL,
  CASE WHEN kind = 'comparison' THEN result END,
  '[]', actor_id, session_id, created_at, updated_at
FROM attribute_vote_events;

UPDATE attribute_vote_responses
SET
  attribute_id = (SELECT attribute_id FROM attribute_vote_events WHERE response_id = attribute_vote_responses.response_id),
  subject_a_id = (SELECT subject_a_id FROM attribute_vote_events WHERE response_id = attribute_vote_responses.response_id),
  subject_b_id = (SELECT subject_b_id FROM attribute_vote_events WHERE response_id = attribute_vote_responses.response_id),
  rating_a = (SELECT CASE WHEN kind = 'rating' THEN value END FROM attribute_vote_events WHERE response_id = attribute_vote_responses.response_id),
  rating_b = NULL,
  comparison = (SELECT CASE WHEN kind = 'comparison' THEN result END FROM attribute_vote_events WHERE response_id = attribute_vote_responses.response_id),
  actor_id = (SELECT actor_id FROM attribute_vote_events WHERE response_id = attribute_vote_responses.response_id),
  session_id = (SELECT session_id FROM attribute_vote_events WHERE response_id = attribute_vote_responses.response_id),
  created_at = (SELECT created_at FROM attribute_vote_events WHERE response_id = attribute_vote_responses.response_id),
  updated_at = (SELECT updated_at FROM attribute_vote_events WHERE response_id = attribute_vote_responses.response_id)
WHERE attribute_id IS NULL
  AND response_id IN (SELECT response_id FROM attribute_vote_events);

-- Refuse to delete any event which could not be represented as a response.
CREATE TRIGGER attribute_vote_events_retirement_guard
BEFORE DELETE ON attribute_vote_events
WHEN EXISTS (
  SELECT 1
  FROM attribute_vote_events e
  LEFT JOIN attribute_vote_responses r ON r.response_id = e.response_id
  WHERE (SELECT COUNT(*) FROM attribute_vote_events same_response WHERE same_response.response_id = e.response_id) <> 1
     OR r.attribute_id IS NOT e.attribute_id
     OR r.subject_a_id IS NULL
     OR (e.kind = 'rating' AND r.rating_a IS NOT e.value)
     OR (e.kind = 'comparison' AND (r.subject_b_id IS NOT e.subject_b_id OR r.comparison IS NOT e.result))
)
BEGIN
  SELECT RAISE(ABORT, 'attribute_vote_events_not_fully_migrated');
END;

DELETE FROM attribute_vote_events;
DROP TRIGGER attribute_vote_events_retirement_guard;
DROP TABLE attribute_vote_events;
