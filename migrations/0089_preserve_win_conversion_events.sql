-- Preserve 0088's conversion snapshot as replayable data before later votes.
-- If generation 88 was replaced, stop: recover its snapshot from backup first.
CREATE TABLE migration_0089_guard (valid INTEGER NOT NULL CHECK (valid = 1));
INSERT INTO migration_0089_guard
SELECT CASE WHEN EXISTS (SELECT 1 FROM attribute_catalog_snapshot_chunks WHERE generation = 88) THEN 1 ELSE 0 END;
INSERT INTO attribute_vote_events
  (id, response_id, event_key, kind, attribute_id, subject_a_id, value, session_id, created_at, updated_at)
SELECT 'win-conversion-v1:' || json_extract(value.value, '$.subjectId'),
  'win-conversion-v1:' || json_extract(value.value, '$.subjectId'),
  'converted-rating', 'rating', 'attribute_win_method',
  json_extract(value.value, '$.subjectId'), json_extract(value.value, '$.score'),
  'win-conversion-v1', 0, 0
FROM attribute_catalog_snapshot_chunks chunk,
  json_each(chunk.entries_json) entry,
  json_each(entry.value, '$.values') value
WHERE chunk.generation = 88
  AND json_extract(value.value, '$.attributeId') = 'attribute_win_method'
  AND json_extract(value.value, '$.evidenceCount') > 0;
DROP TABLE migration_0089_guard;
