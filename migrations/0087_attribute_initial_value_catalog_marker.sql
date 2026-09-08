-- Keep the public attribute catalog's incremental value entries aware of
-- retained merge baselines. This migration changes only derived catalog JSON;
-- it does not create votes or activate an attribute.

DROP TRIGGER IF EXISTS attribute_score_states_catalog_after_insert;
CREATE TRIGGER attribute_score_states_catalog_after_insert
AFTER INSERT ON attribute_score_states
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT
    'value:' || NEW.subject_id || ':' || NEW.attribute_id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    json_patch(
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
      CASE WHEN EXISTS (
        SELECT 1 FROM attribute_initial_values initial_value
        WHERE initial_value.subject_id = NEW.subject_id
          AND initial_value.attribute_id = NEW.attribute_id
      ) THEN json_object('initialValue', json('true')) ELSE '{}' END
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

DROP TRIGGER IF EXISTS attribute_score_states_catalog_after_update;
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
    json_patch(
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
      CASE WHEN EXISTS (
        SELECT 1 FROM attribute_initial_values initial_value
        WHERE initial_value.subject_id = NEW.subject_id
          AND initial_value.attribute_id = NEW.attribute_id
      ) THEN json_object('initialValue', json('true')) ELSE '{}' END
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

DROP TRIGGER IF EXISTS attribute_initial_values_catalog_after_insert;
CREATE TRIGGER attribute_initial_values_catalog_after_insert
AFTER INSERT ON attribute_initial_values
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT
    'value:' || state.subject_id || ':' || state.attribute_id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    json_patch(
      json_object(
        'kind', 'value',
        'subjectId', state.subject_id,
        'attributeId', state.attribute_id,
        'score', state.score,
        'ratingDeviation', state.rating_deviation,
        'directAverage', CASE WHEN state.direct_count > 0 THEN state.direct_sum / state.direct_count ELSE NULL END,
        'directCount', state.direct_count,
        'comparisonCount', state.comparison_count,
        'decisiveComparisonCount', state.decisive_comparison_count,
        'evidenceCount', state.evidence_count,
        'modelVersion', state.model_version,
        'subject', json_object(
          'id', subject.id,
          'slug', subject.slug,
          'kind', subject.kind,
          'displayName', subject.display_name,
          'gameId', subject.game_id,
          'gameSlug', game.slug
        )
      ),
      json_object('initialValue', json('true'))
    ),
    0,
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  FROM attribute_score_states state
  JOIN attribute_subjects subject ON subject.id = state.subject_id
  LEFT JOIN games game ON game.id = subject.game_id
  WHERE state.subject_id = NEW.subject_id AND state.attribute_id = NEW.attribute_id
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
