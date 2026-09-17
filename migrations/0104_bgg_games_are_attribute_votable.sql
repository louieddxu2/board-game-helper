-- A verified BGG identity is sufficient for a public base game or expansion
-- to receive attribute votes.  Wrong-rule submissions and attribute voting
-- have independent eligibility rules.
DROP VIEW IF EXISTS attribute_votable_subjects;
CREATE VIEW attribute_votable_subjects AS
SELECT s.id AS subject_id
FROM attribute_subjects s
LEFT JOIN games g ON g.id = s.game_id
WHERE (
  s.kind = 'game'
  AND g.entity_kind IN ('base', 'expansion')
  AND g.merged_into_game_id IS NULL
  AND g.visibility = 'public'
  AND (
    g.bgg_id IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM game_external_ids external_id
      WHERE external_id.game_id = g.id AND external_id.source = 'bgg'
    )
    OR EXISTS (
      SELECT 1 FROM attribute_subject_components component
      WHERE component.subject_id = s.id
        AND component.component_type = 'base'
        AND component.bgg_id IS NOT NULL
    )
  )
)
OR (
  s.kind = 'configuration'
  AND EXISTS (
    SELECT 1 FROM attribute_subject_components component
    WHERE component.subject_id = s.id
      AND component.component_type = 'base'
      AND component.bgg_id IS NOT NULL
  )
  AND EXISTS (
    SELECT 1 FROM attribute_subject_components component
    WHERE component.subject_id = s.id
      AND component.component_type = 'expansion'
      AND component.bgg_id IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM attribute_subject_components component
    WHERE component.subject_id = s.id
      AND component.component_type IN ('base', 'expansion')
      AND component.bgg_id IS NULL
  )
);
