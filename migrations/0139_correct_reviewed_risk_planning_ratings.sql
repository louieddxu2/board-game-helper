-- Owner-approved risk-planning review, confirmed on 2026-11-23.
-- Amend the original direct receipts in place. Do not add votes, change luck,
-- enable disabled games, or overwrite scores containing other players' evidence.
CREATE TABLE migration_0139_risk (
  response_id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  value INTEGER NOT NULL CHECK (value BETWEEN 0 AND 10),
  old_value REAL,
  repair_state INTEGER NOT NULL DEFAULT 0
);

WITH approved(subject_id, batch, value) AS (VALUES
  ('attribute_subject_game:game_attribute_import_gaia_project', '0134', 1),
  ('attribute_subject_game:game_attribute_import_hansa_teutonica', '0134', 4),
  ('attribute_subject_game:game_04e027e4990a203f4899', '0135', 3),
  ('attribute_subject_game:game_attribute_import_fields_of_arle', '0134', 1),
  ('attribute_subject_game:game_attribute_import_cryptid', '0134', 1),
  ('attribute_subject_game:game_attribute_import_indian_summer', '0134', 3),
  ('attribute_subject_game:game_attribute_import_the_mind', '0134', 1)
)
INSERT INTO migration_0139_risk (response_id, subject_id, session_id, value)
SELECT 'attribute-response-seed:' || batch || ':risk_planning:' || subject_id,
  subject_id, 'attribute-seed:' || batch, value FROM approved;

-- Schema-only databases may lack these subjects. An existing subject must have
-- the exact author-owned seed receipt; refuse unexpected identity or prior edits.
CREATE TABLE migration_0139_guard (valid INTEGER NOT NULL CHECK (valid = 1));
INSERT INTO migration_0139_guard
SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM migration_0139_risk correction
  LEFT JOIN attribute_subjects subject ON subject.id = correction.subject_id
  LEFT JOIN attribute_vote_responses response ON response.response_id = correction.response_id
  WHERE (subject.id IS NOT NULL AND response.response_id IS NULL)
    OR (response.response_id IS NOT NULL AND (
      response.attribute_id IS NOT 'attribute_risk_planning'
      OR response.subject_a_id IS NOT correction.subject_id
      OR response.session_id IS NOT correction.session_id
      OR response.actor_id IS NOT NULL OR response.recorded_online IS NOT 0
      OR response.subject_b_id IS NOT NULL OR response.rating_b IS NOT NULL
      OR response.comparison IS NOT NULL OR response.ranking_json IS NOT NULL
      OR response.rating_a IS NULL OR response.rating_a NOT IN (0, correction.value)))
) THEN 1 ELSE 0 END;

UPDATE migration_0139_risk SET old_value = (
  SELECT response.rating_a FROM attribute_vote_responses response
  WHERE response.response_id = migration_0139_risk.response_id
);
DELETE FROM migration_0139_risk WHERE old_value IS NULL OR old_value IS value;

-- Only a pristine single-rating state has an exact immediate correction.
-- Missing states (including disabled games) stay missing. More complex live
-- evidence stays intact until the normal authoritative history replay.
UPDATE migration_0139_risk SET repair_state = EXISTS (
  SELECT 1 FROM attribute_score_states state
  WHERE state.subject_id = migration_0139_risk.subject_id
    AND state.attribute_id = 'attribute_risk_planning'
    AND state.direct_count = 1 AND state.comparison_count = 0
    AND state.decisive_comparison_count = 0 AND state.evidence_count = 1
    AND state.direct_sum IS migration_0139_risk.old_value
    AND state.score IS migration_0139_risk.old_value
);

-- The existing update trigger invalidates replay, including any staged history.
UPDATE attribute_vote_responses
SET rating_a = (SELECT value FROM migration_0139_risk WHERE response_id = attribute_vote_responses.response_id),
  updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE response_id IN (SELECT response_id FROM migration_0139_risk);

INSERT INTO attribute_catalog_rebuild_mode (id)
SELECT 1 WHERE EXISTS (SELECT 1 FROM migration_0139_risk WHERE repair_state = 1);
UPDATE attribute_score_states
SET score = (SELECT value FROM migration_0139_risk WHERE subject_id = attribute_score_states.subject_id),
  direct_sum = (SELECT value FROM migration_0139_risk WHERE subject_id = attribute_score_states.subject_id),
  updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE attribute_id = 'attribute_risk_planning'
  AND subject_id IN (SELECT subject_id FROM migration_0139_risk WHERE repair_state = 1);

-- Drive publication from the fixed correction list, using subject/attribute keys.
WITH entries AS (
  SELECT 'value:' || state.subject_id || ':' || state.attribute_id AS entry_key,
    json_object('kind', 'value', 'subjectId', state.subject_id, 'attributeId', state.attribute_id,
      'score', state.score, 'ratingDeviation', state.rating_deviation,
      'directAverage', state.direct_sum / state.direct_count,
      'directCount', state.direct_count, 'comparisonCount', state.comparison_count,
      'decisiveComparisonCount', state.decisive_comparison_count,
      'evidenceCount', state.evidence_count, 'modelVersion', state.model_version) AS entry_json
  FROM migration_0139_risk correction
  CROSS JOIN attribute_score_states state ON state.subject_id = correction.subject_id
    AND state.attribute_id = 'attribute_risk_planning'
  WHERE correction.repair_state = 1
)
INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
SELECT entry.entry_key, clock.current_version + ROW_NUMBER() OVER (ORDER BY entry.entry_key),
  entry.entry_json, 0, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM entries entry CROSS JOIN attribute_catalog_clock clock
WHERE clock.id = 1
ON CONFLICT(entry_key) DO UPDATE SET
  catalog_version = excluded.catalog_version, entry_json = excluded.entry_json,
  deleted = excluded.deleted, updated_at = excluded.updated_at;
UPDATE attribute_catalog_clock SET current_version = current_version + changes()
WHERE id = 1 AND changes() > 0;
DELETE FROM attribute_catalog_rebuild_mode
WHERE id = 1 AND EXISTS (SELECT 1 FROM migration_0139_risk WHERE repair_state = 1);
DROP TABLE migration_0139_guard;
DROP TABLE migration_0139_risk;
