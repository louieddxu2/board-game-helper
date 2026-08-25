-- Versioned attribute-table catalog.  The weekly snapshot is the baseline;
-- current materialized score and candidate changes are kept as bounded deltas.
CREATE TABLE attribute_catalog_clock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current_version INTEGER NOT NULL
);

INSERT INTO attribute_catalog_clock (id, current_version) VALUES (1, 0);

CREATE TABLE attribute_catalog_entries (
  entry_key TEXT PRIMARY KEY,
  catalog_version INTEGER NOT NULL UNIQUE,
  entry_json TEXT,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_attribute_catalog_entries_version
  ON attribute_catalog_entries(catalog_version, entry_key);

CREATE TABLE attribute_catalog_snapshot_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active_generation INTEGER NOT NULL,
  through_version INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  attributes_json TEXT NOT NULL,
  score_model_version TEXT NOT NULL,
  generated_at INTEGER NOT NULL
);

CREATE TABLE attribute_catalog_snapshot_chunks (
  generation INTEGER NOT NULL,
  chunk_number INTEGER NOT NULL,
  entries_json TEXT NOT NULL,
  PRIMARY KEY (generation, chunk_number)
);

CREATE INDEX idx_attribute_catalog_snapshot_chunks_generation
  ON attribute_catalog_snapshot_chunks(generation, chunk_number);

-- Keep one latest delta per subject/attribute.  Older versions are not needed
-- because a client only needs the newest state after its cursor.
CREATE TRIGGER attribute_score_states_catalog_after_insert
AFTER INSERT ON attribute_score_states
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT
    'value:' || NEW.subject_id || ':' || NEW.attribute_id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    json_object(
      'kind', 'value',
      'subjectId', NEW.subject_id,
      'attributeId', NEW.attribute_id,
      'score', NEW.score,
      'ratingDeviation', NEW.rating_deviation,
      'directAverage', CASE WHEN NEW.direct_count > 0 THEN NEW.direct_sum / NEW.direct_count ELSE NULL END,
      'directCount', NEW.direct_count,
      'comparisonCount', NEW.comparison_count,
      'decisiveComparisonCount', NEW.decisive_comparison_count,
      'evidenceCount', NEW.evidence_count,
      'modelVersion', NEW.model_version,
      'subject', json_object(
        'id', s.id,
        'slug', s.slug,
        'kind', s.kind,
        'displayName', s.display_name,
        'gameId', s.game_id,
        'gameSlug', g.slug
      )
    ),
    0,
    NEW.updated_at
  FROM attribute_subjects s
  LEFT JOIN games g ON g.id = s.game_id
  WHERE s.id = NEW.subject_id
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER attribute_score_states_catalog_after_update
AFTER UPDATE OF score, rating_deviation, direct_sum, direct_count,
  comparison_count, decisive_comparison_count, evidence_count, model_version
  ON attribute_score_states
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT
    'value:' || NEW.subject_id || ':' || NEW.attribute_id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    json_object(
      'kind', 'value',
      'subjectId', NEW.subject_id,
      'attributeId', NEW.attribute_id,
      'score', NEW.score,
      'ratingDeviation', NEW.rating_deviation,
      'directAverage', CASE WHEN NEW.direct_count > 0 THEN NEW.direct_sum / NEW.direct_count ELSE NULL END,
      'directCount', NEW.direct_count,
      'comparisonCount', NEW.comparison_count,
      'decisiveComparisonCount', NEW.decisive_comparison_count,
      'evidenceCount', NEW.evidence_count,
      'modelVersion', NEW.model_version,
      'subject', json_object(
        'id', s.id,
        'slug', s.slug,
        'kind', s.kind,
        'displayName', s.display_name,
        'gameId', s.game_id,
        'gameSlug', g.slug
      )
    ),
    0,
    NEW.updated_at
  FROM attribute_subjects s
  LEFT JOIN games g ON g.id = s.game_id
  WHERE s.id = NEW.subject_id
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER attribute_score_states_catalog_after_delete
AFTER DELETE ON attribute_score_states
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  VALUES (
    'value:' || OLD.subject_id || ':' || OLD.attribute_id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    NULL,
    1,
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  )
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER attribute_candidates_catalog_after_insert
AFTER INSERT ON attribute_import_candidates
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  VALUES (
    'candidate:' || NEW.id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    json_object(
      'kind', 'candidate',
      'id', NEW.id,
      'displayName', NEW.source_name,
      'valuesJson', NEW.values_json,
      'matchStatus', NEW.match_status,
      'subjectId', NEW.subject_id,
      'sourceRowNumber', NEW.source_row_number
    ),
    0,
    NEW.updated_at
  )
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER attribute_candidates_catalog_after_update
AFTER UPDATE OF source_name, values_json, match_status, subject_id, source_row_number, updated_at
  ON attribute_import_candidates
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  VALUES (
    'candidate:' || NEW.id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    json_object(
      'kind', 'candidate',
      'id', NEW.id,
      'displayName', NEW.source_name,
      'valuesJson', NEW.values_json,
      'matchStatus', NEW.match_status,
      'subjectId', NEW.subject_id,
      'sourceRowNumber', NEW.source_row_number
    ),
    0,
    NEW.updated_at
  )
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER attribute_candidates_catalog_after_delete
AFTER DELETE ON attribute_import_candidates
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  VALUES (
    'candidate:' || OLD.id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    NULL,
    1,
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  )
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

PRAGMA optimize;
