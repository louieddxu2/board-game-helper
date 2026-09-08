-- Activation-time mapping for signed answers obtained before a bipolar merge.
-- This migration creates no mappings and changes no existing responses.
CREATE TABLE attribute_response_attribute_maps (
  source_attribute_id TEXT PRIMARY KEY REFERENCES attributes(id) ON DELETE RESTRICT,
  target_attribute_id TEXT NOT NULL REFERENCES attributes(id) ON DELETE RESTRICT,
  invert_score INTEGER NOT NULL DEFAULT 0 CHECK (invert_score IN (0, 1)),
  mapping_version TEXT NOT NULL,
  activated_at INTEGER NOT NULL,
  CHECK (source_attribute_id <> target_attribute_id)
);
CREATE INDEX idx_attribute_response_attribute_maps_target ON attribute_response_attribute_maps(target_attribute_id);

CREATE TABLE attribute_response_mapping_receipts (
  response_id TEXT PRIMARY KEY REFERENCES attribute_vote_responses(response_id) ON DELETE RESTRICT,
  source_attribute_id TEXT NOT NULL,
  target_attribute_id TEXT NOT NULL,
  invert_score INTEGER NOT NULL CHECK (invert_score IN (0, 1)),
  mapping_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (source_attribute_id) REFERENCES attributes(id) ON DELETE RESTRICT,
  FOREIGN KEY (target_attribute_id) REFERENCES attributes(id) ON DELETE RESTRICT,
  CHECK (source_attribute_id <> target_attribute_id)
);
