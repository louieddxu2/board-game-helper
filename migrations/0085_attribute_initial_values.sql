-- Storage only. No new attributes, scores, votes or activation are created here.
CREATE TABLE attribute_initial_value_batches (
  id TEXT PRIMARY KEY,
  target_attribute_id TEXT NOT NULL REFERENCES attributes(id),
  source_low_attribute_id TEXT NOT NULL REFERENCES attributes(id),
  source_high_attribute_id TEXT NOT NULL REFERENCES attributes(id),
  source_catalog_version INTEGER NOT NULL CHECK (source_catalog_version >= 0),
  formula_version TEXT NOT NULL,
  cutoff_created_at INTEGER NOT NULL CHECK (cutoff_created_at >= 0),
  created_at INTEGER NOT NULL,
  CHECK (target_attribute_id <> source_low_attribute_id),
  CHECK (target_attribute_id <> source_high_attribute_id),
  CHECK (source_low_attribute_id <> source_high_attribute_id),
  UNIQUE (target_attribute_id),
  UNIQUE (id, target_attribute_id)
);

-- Snapshot IDs and source state JSON are immutable provenance, not cascading vote data.
-- Current subject remapping must be explicit before a subject can be deleted.
CREATE TABLE attribute_initial_values (
  batch_id TEXT NOT NULL,
  attribute_id TEXT NOT NULL,
  subject_id TEXT NOT NULL REFERENCES attribute_subjects(id) ON DELETE RESTRICT,
  score REAL NOT NULL CHECK (score >= 0 AND score <= 10),
  source_low_json TEXT CHECK (source_low_json IS NULL OR (json_valid(source_low_json) AND json_type(source_low_json) = 'object')),
  source_high_json TEXT CHECK (source_high_json IS NULL OR (json_valid(source_high_json) AND json_type(source_high_json) = 'object')),
  correction_json TEXT CHECK (correction_json IS NULL OR (json_valid(correction_json) AND json_type(correction_json) = 'object')),
  PRIMARY KEY (subject_id, attribute_id),
  FOREIGN KEY (batch_id, attribute_id) REFERENCES attribute_initial_value_batches(id, target_attribute_id) ON DELETE RESTRICT,
  CHECK (source_low_json IS NOT NULL OR source_high_json IS NOT NULL OR correction_json IS NOT NULL)
);
CREATE INDEX idx_attribute_initial_values_batch ON attribute_initial_values(batch_id, subject_id);
