-- Keep the materialized score matrix complete when attributes are added or
-- re-enabled after the initial seed.  New games already receive these rows
-- from attribute_subject_games_after_insert; this migration closes the
-- opposite direction of that invariant.

-- Repair any historical or manually-created gaps before installing the
-- triggers.  This is a migration-time operation, not part of the vote path.
INSERT OR IGNORE INTO attribute_score_states
  (subject_id, attribute_id, score, direct_sum, direct_count, comparison_count,
   decisive_comparison_count, evidence_count, model_version, updated_at,
   rating_deviation, random_key, question_slot)
SELECT s.id, a.id, 5, 0, 0, 0, 0, 0, 'glicko-rd-v1',
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
  3, lower(hex(randomblob(16))), (abs(random()) % 200) + 1
FROM attribute_subjects s
CROSS JOIN attributes a
LEFT JOIN games g ON g.id = s.game_id
WHERE a.is_active = 1
  AND (
    s.kind = 'configuration'
    OR (g.merged_into_game_id IS NULL AND g.visibility = 'public' AND g.published_rule_count > 0)
  );

-- A newly inserted active attribute must be available for every currently
-- eligible subject immediately.  INSERT OR IGNORE keeps this safe if an
-- importer has already provisioned some rows in the same transaction.
CREATE TRIGGER attributes_score_states_after_insert
AFTER INSERT ON attributes
WHEN NEW.is_active = 1
BEGIN
  INSERT OR IGNORE INTO attribute_score_states
    (subject_id, attribute_id, score, direct_sum, direct_count, comparison_count,
     decisive_comparison_count, evidence_count, model_version, updated_at,
     rating_deviation, random_key, question_slot)
  SELECT s.id, NEW.id, 5, 0, 0, 0, 0, 0, 'glicko-rd-v1',
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
    3, lower(hex(randomblob(16))), (abs(random()) % 200) + 1
  FROM attribute_subjects s
  LEFT JOIN games g ON g.id = s.game_id
  WHERE s.kind = 'configuration'
    OR (g.merged_into_game_id IS NULL AND g.visibility = 'public' AND g.published_rule_count > 0);
END;

-- An inactive attribute intentionally has no selectable score states.  When it
-- becomes active again, provision the missing rows without disturbing any
-- historical rows that may already exist.
CREATE TRIGGER attributes_score_states_after_activate
AFTER UPDATE OF is_active ON attributes
WHEN NEW.is_active = 1 AND OLD.is_active = 0
BEGIN
  INSERT OR IGNORE INTO attribute_score_states
    (subject_id, attribute_id, score, direct_sum, direct_count, comparison_count,
     decisive_comparison_count, evidence_count, model_version, updated_at,
     rating_deviation, random_key, question_slot)
  SELECT s.id, NEW.id, 5, 0, 0, 0, 0, 0, 'glicko-rd-v1',
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
    3, lower(hex(randomblob(16))), (abs(random()) % 200) + 1
  FROM attribute_subjects s
  LEFT JOIN games g ON g.id = s.game_id
  WHERE s.kind = 'configuration'
    OR (g.merged_into_game_id IS NULL AND g.visibility = 'public' AND g.published_rule_count > 0);
END;

PRAGMA optimize;
