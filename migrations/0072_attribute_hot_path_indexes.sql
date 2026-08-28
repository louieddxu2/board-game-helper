-- Keep the question path's per-subject BGG checks and derived English names
-- as point lookups.  The score-state index chooses the candidate; these
-- covering subject indexes prevent each candidate from scanning the complete
-- component table while eligibility and display metadata are evaluated.
CREATE INDEX IF NOT EXISTS idx_attribute_subject_components_subject_type_bgg_order
  ON attribute_subject_components(subject_id, component_type, bgg_id, component_order);

CREATE INDEX IF NOT EXISTS idx_attribute_subject_components_subject_type_order
  ON attribute_subject_components(subject_id, component_type, component_order);

PRAGMA optimize;
