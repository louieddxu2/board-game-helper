-- Only subjects with complete BGG identity data may enter attribute voting.
-- Game subjects use games.bgg_id, a normalized external-ID row, or the base
-- component's BGG ID. A configuration must have a BGG ID for both its base and expansion
-- components. The subject itself is retained when incomplete so it can become
-- votable after its missing identity is supplied.
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
  AND (g.published_rule_count > 0 OR g.attribute_enabled = 1)
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

-- A newly-created subject receives states only after it is BGG-eligible.
DROP TRIGGER IF EXISTS attribute_subject_games_after_insert;
CREATE TRIGGER attribute_subject_games_after_insert AFTER INSERT ON games
WHEN NEW.merged_into_game_id IS NULL AND NEW.entity_kind IN ('base', 'expansion')
BEGIN
  INSERT OR IGNORE INTO attribute_subjects (id, slug, kind, display_name, game_id, created_at, updated_at)
  VALUES ('attribute_subject_game:' || NEW.id, 'game-' || NEW.slug, 'game', NEW.display_name, NEW.id, NEW.created_at, NEW.updated_at);
  INSERT OR IGNORE INTO attribute_subject_components (subject_id, component_order, game_id, component_type, label)
  VALUES ('attribute_subject_game:' || NEW.id, 0, NEW.id, 'base', NEW.display_name);
  INSERT OR IGNORE INTO attribute_score_states
    (subject_id, attribute_id, score, direct_sum, direct_count, comparison_count,
     decisive_comparison_count, evidence_count, model_version, updated_at,
     rating_deviation, random_key, question_slot)
  SELECT 'attribute_subject_game:' || NEW.id, id, 5, 0, 0, 0, 0, 0,
    'glicko-rd-v1', NEW.updated_at, 3, lower(hex(randomblob(16))),
    (abs(random()) % 200) + 1
  FROM attributes
  WHERE is_active = 1
    AND EXISTS (
      SELECT 1 FROM attribute_votable_subjects eligible
      WHERE eligible.subject_id = 'attribute_subject_game:' || NEW.id
    );
END;

-- Classification or BGG identity changes can make an existing subject
-- eligible. Provision the missing states without overwriting any history.
DROP TRIGGER IF EXISTS attribute_subject_games_after_classification;
CREATE TRIGGER attribute_subject_games_after_classification
AFTER UPDATE OF entity_kind, bgg_id, merged_into_game_id, visibility,
  published_rule_count, attribute_enabled ON games
WHEN NEW.merged_into_game_id IS NULL
  AND NEW.entity_kind IN ('base', 'expansion')
BEGIN
  INSERT OR IGNORE INTO attribute_subjects (id, slug, kind, display_name, game_id, created_at, updated_at)
  VALUES ('attribute_subject_game:' || NEW.id, 'game-' || NEW.slug, 'game', NEW.display_name, NEW.id, NEW.created_at, NEW.updated_at);
  INSERT OR IGNORE INTO attribute_subject_components (subject_id, component_order, game_id, component_type, label)
  VALUES ('attribute_subject_game:' || NEW.id, 0, NEW.id, 'base', NEW.display_name);
  INSERT OR IGNORE INTO attribute_score_states
    (subject_id, attribute_id, score, direct_sum, direct_count, comparison_count,
     decisive_comparison_count, evidence_count, model_version, updated_at,
     rating_deviation, random_key, question_slot)
  SELECT subject.id, attribute.id, 5, 0, 0, 0, 0, 0, 'glicko-rd-v1', NEW.updated_at,
    3, lower(hex(randomblob(16))), (abs(random()) % 200) + 1
  FROM attribute_subjects subject
  CROSS JOIN attributes attribute
  WHERE subject.game_id = NEW.id
    AND attribute.is_active = 1
    AND EXISTS (
      SELECT 1 FROM attribute_votable_subjects eligible
      WHERE eligible.subject_id = subject.id
    );
END;

-- If a classified expansion is changed into a version/unknown entity, remove
-- its materialized states. Historical evidence remains in the append-only
-- tables, and the subject is retained only when deleting it would lose that
-- evidence.
DROP TRIGGER IF EXISTS attribute_subject_games_after_declassification;
CREATE TRIGGER attribute_subject_games_after_declassification
AFTER UPDATE OF entity_kind ON games
WHEN NEW.entity_kind IN ('version', 'unknown')
  AND OLD.entity_kind IN ('base', 'expansion')
BEGIN
  DELETE FROM attribute_score_states
  WHERE subject_id = 'attribute_subject_game:' || NEW.id;
  DELETE FROM attribute_subjects
  WHERE id = 'attribute_subject_game:' || NEW.id
    AND NOT EXISTS (SELECT 1 FROM attribute_ratings r WHERE r.subject_id = attribute_subjects.id)
    AND NOT EXISTS (
      SELECT 1 FROM attribute_comparisons c
      WHERE c.subject_a_id = attribute_subjects.id OR c.subject_b_id = attribute_subjects.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM attribute_vote_events e
      WHERE e.subject_a_id = attribute_subjects.id OR e.subject_b_id = attribute_subjects.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM attribute_vote_responses response
      WHERE response.subject_a_id = attribute_subjects.id OR response.subject_b_id = attribute_subjects.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM attribute_pair_stats pair_stats
      WHERE pair_stats.subject_a_id = attribute_subjects.id OR pair_stats.subject_b_id = attribute_subjects.id
    );
END;

DROP TRIGGER IF EXISTS attribute_game_external_ids_after_insert;
CREATE TRIGGER attribute_game_external_ids_after_insert
AFTER INSERT ON game_external_ids
WHEN NEW.source = 'bgg'
BEGIN
  INSERT OR IGNORE INTO attribute_score_states
    (subject_id, attribute_id, score, direct_sum, direct_count, comparison_count,
     decisive_comparison_count, evidence_count, model_version, updated_at,
     rating_deviation, random_key, question_slot)
  SELECT subject.id, attribute.id, 5, 0, 0, 0, 0, 0, 'glicko-rd-v1',
    NEW.created_at, 3, lower(hex(randomblob(16))), (abs(random()) % 200) + 1
  FROM attribute_subjects subject
  CROSS JOIN attributes attribute
  WHERE (subject.game_id = NEW.game_id OR EXISTS (
      SELECT 1 FROM attribute_subject_components component
      WHERE component.subject_id = subject.id AND component.game_id = NEW.game_id
    ))
    AND attribute.is_active = 1
    AND EXISTS (
      SELECT 1 FROM attribute_votable_subjects eligible
      WHERE eligible.subject_id = subject.id
    );
END;

DROP TRIGGER IF EXISTS attribute_subject_components_bgg_after_insert;
CREATE TRIGGER attribute_subject_components_bgg_after_insert
AFTER INSERT ON attribute_subject_components
WHEN NEW.bgg_id IS NOT NULL
BEGIN
  INSERT OR IGNORE INTO attribute_score_states
    (subject_id, attribute_id, score, direct_sum, direct_count, comparison_count,
     decisive_comparison_count, evidence_count, model_version, updated_at,
     rating_deviation, random_key, question_slot)
  SELECT subject.id, attribute.id, 5, 0, 0, 0, 0, 0, 'glicko-rd-v1',
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
    3, lower(hex(randomblob(16))), (abs(random()) % 200) + 1
  FROM attribute_subjects subject
  CROSS JOIN attributes attribute
  WHERE subject.id = NEW.subject_id
    AND attribute.is_active = 1
    AND EXISTS (
      SELECT 1 FROM attribute_votable_subjects eligible
      WHERE eligible.subject_id = subject.id
    );
END;

DROP TRIGGER IF EXISTS attribute_subject_components_bgg_after_update;
CREATE TRIGGER attribute_subject_components_bgg_after_update
AFTER UPDATE OF bgg_id ON attribute_subject_components
WHEN NEW.bgg_id IS NOT NULL
  AND (OLD.bgg_id IS NULL OR OLD.bgg_id <> NEW.bgg_id)
BEGIN
  INSERT OR IGNORE INTO attribute_score_states
    (subject_id, attribute_id, score, direct_sum, direct_count, comparison_count,
     decisive_comparison_count, evidence_count, model_version, updated_at,
     rating_deviation, random_key, question_slot)
  SELECT subject.id, attribute.id, 5, 0, 0, 0, 0, 0, 'glicko-rd-v1',
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
    3, lower(hex(randomblob(16))), (abs(random()) % 200) + 1
  FROM attribute_subjects subject
  CROSS JOIN attributes attribute
  WHERE subject.id = NEW.subject_id
    AND attribute.is_active = 1
    AND EXISTS (
      SELECT 1 FROM attribute_votable_subjects eligible
      WHERE eligible.subject_id = subject.id
    );
END;

-- If an identity is removed, discard only empty materialized states. History
-- remains available for audit and for a later identity re-attachment.
DROP TRIGGER IF EXISTS attribute_games_after_bgg_loss;
CREATE TRIGGER attribute_games_after_bgg_loss
AFTER UPDATE OF bgg_id ON games
WHEN OLD.bgg_id IS NOT NULL
  AND NEW.bgg_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM game_external_ids external_id
    WHERE external_id.game_id = NEW.id AND external_id.source = 'bgg'
  )
  AND NOT EXISTS (
    SELECT 1 FROM attribute_subject_components component
    JOIN attribute_subjects subject ON subject.id = component.subject_id
    WHERE subject.game_id = NEW.id
      AND component.component_type = 'base'
      AND component.bgg_id IS NOT NULL
  )
BEGIN
  DELETE FROM attribute_score_states
  WHERE subject_id = 'attribute_subject_game:' || NEW.id
    AND evidence_count = 0;
END;

DROP TRIGGER IF EXISTS attribute_game_external_ids_after_delete;
CREATE TRIGGER attribute_game_external_ids_after_delete
AFTER DELETE ON game_external_ids
WHEN OLD.source = 'bgg'
  AND NOT EXISTS (
    SELECT 1 FROM games game
    WHERE game.id = OLD.game_id AND game.bgg_id IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM game_external_ids external_id
    WHERE external_id.game_id = OLD.game_id AND external_id.source = 'bgg'
  )
  AND NOT EXISTS (
    SELECT 1 FROM attribute_subject_components component
    JOIN attribute_subjects subject ON subject.id = component.subject_id
    WHERE subject.game_id = OLD.game_id
      AND component.component_type = 'base'
      AND component.bgg_id IS NOT NULL
  )
BEGIN
  DELETE FROM attribute_score_states
  WHERE subject_id = 'attribute_subject_game:' || OLD.game_id
    AND evidence_count = 0;
END;

DROP TRIGGER IF EXISTS attribute_subject_components_bgg_after_loss;
CREATE TRIGGER attribute_subject_components_bgg_after_loss
AFTER UPDATE OF bgg_id ON attribute_subject_components
WHEN OLD.bgg_id IS NOT NULL
  AND NEW.bgg_id IS NULL
BEGIN
  DELETE FROM attribute_score_states
  WHERE subject_id = NEW.subject_id
    AND evidence_count = 0
    AND NOT EXISTS (
      SELECT 1 FROM attribute_votable_subjects eligible
      WHERE eligible.subject_id = NEW.subject_id
    );
END;

DROP TRIGGER IF EXISTS attribute_subject_components_bgg_after_delete;
CREATE TRIGGER attribute_subject_components_bgg_after_delete
AFTER DELETE ON attribute_subject_components
WHEN OLD.bgg_id IS NOT NULL
BEGIN
  DELETE FROM attribute_score_states
  WHERE subject_id = OLD.subject_id
    AND evidence_count = 0
    AND NOT EXISTS (
      SELECT 1 FROM attribute_votable_subjects eligible
      WHERE eligible.subject_id = OLD.subject_id
    );
END;

DROP TRIGGER IF EXISTS attributes_score_states_after_insert;
CREATE TRIGGER attributes_score_states_after_insert
AFTER INSERT ON attributes
WHEN NEW.is_active = 1
BEGIN
  INSERT OR IGNORE INTO attribute_score_states
    (subject_id, attribute_id, score, direct_sum, direct_count, comparison_count,
     decisive_comparison_count, evidence_count, model_version, updated_at,
     rating_deviation, random_key, question_slot)
  SELECT subject.id, NEW.id, 5, 0, 0, 0, 0, 0, 'glicko-rd-v1',
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
    3, lower(hex(randomblob(16))), (abs(random()) % 200) + 1
  FROM attribute_subjects subject
  WHERE EXISTS (
    SELECT 1 FROM attribute_votable_subjects eligible
    WHERE eligible.subject_id = subject.id
  );
END;

DROP TRIGGER IF EXISTS attributes_score_states_after_activate;
CREATE TRIGGER attributes_score_states_after_activate
AFTER UPDATE OF is_active ON attributes
WHEN NEW.is_active = 1 AND OLD.is_active = 0
BEGIN
  INSERT OR IGNORE INTO attribute_score_states
    (subject_id, attribute_id, score, direct_sum, direct_count, comparison_count,
     decisive_comparison_count, evidence_count, model_version, updated_at,
     rating_deviation, random_key, question_slot)
  SELECT subject.id, NEW.id, 5, 0, 0, 0, 0, 0, 'glicko-rd-v1',
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
    3, lower(hex(randomblob(16))), (abs(random()) % 200) + 1
  FROM attribute_subjects subject
  WHERE EXISTS (
    SELECT 1 FROM attribute_votable_subjects eligible
    WHERE eligible.subject_id = subject.id
  );
END;

-- Remove unvotable, empty materialized states. Subjects without an identity
-- remain available for later BGG-ID completion; states with evidence remain
-- available so a later identity completion does not reset their history.
DELETE FROM attribute_score_states
WHERE evidence_count = 0
  AND NOT EXISTS (
    SELECT 1 FROM attribute_votable_subjects eligible
    WHERE eligible.subject_id = attribute_score_states.subject_id
  );

-- Make the incremental catalog use exactly the same BGG boundary as the
-- worker. This prevents a stale no-BGG subject from reappearing in a delta.
DROP VIEW IF EXISTS attribute_subject_catalog_source;
CREATE VIEW attribute_subject_catalog_source AS
SELECT s.id AS subject_id,
  EXISTS (
    SELECT 1 FROM attribute_votable_subjects eligible
    WHERE eligible.subject_id = s.id
  ) AS is_eligible,
  json_object(
    'kind', 'subject',
    'subject', json_object(
      'id', s.id,
      'slug', s.slug,
      'kind', s.kind,
      'displayName', s.display_name,
      'secondaryName', secondary_names.secondary_name,
      'gameId', s.game_id,
      'gameSlug', g.slug,
      'bggIds', json(COALESCE((
        SELECT json_group_array(bgg_id)
        FROM (
          SELECT g.bgg_id AS bgg_id
          WHERE s.kind = 'game' AND g.bgg_id IS NOT NULL
          UNION
          SELECT CAST(external_id.external_id AS INTEGER) AS bgg_id
          FROM game_external_ids external_id
          WHERE external_id.game_id = s.game_id AND external_id.source = 'bgg'
          UNION
          SELECT component.bgg_id
          FROM attribute_subject_components component
          WHERE component.subject_id = s.id AND component.bgg_id IS NOT NULL
        )
      ), '[]')),
      'components', json(COALESCE((
        SELECT json_group_array(json(component_json))
        FROM (
          SELECT component_json
          FROM attribute_subject_component_catalog_json
          WHERE subject_id = s.id
          ORDER BY component_order
        )
      ), '[]'))
    )
  ) AS entry_json,
  s.updated_at
FROM attribute_subjects s
LEFT JOIN games g ON g.id = s.game_id
LEFT JOIN attribute_subject_secondary_names secondary_names ON secondary_names.id = s.id;

DROP TRIGGER IF EXISTS attribute_subjects_catalog_after_insert;
CREATE TRIGGER attribute_subjects_catalog_after_insert
AFTER INSERT ON attribute_subjects
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT 'subject:' || source.subject_id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN source.is_eligible THEN source.entry_json ELSE NULL END,
    CASE WHEN source.is_eligible THEN 0 ELSE 1 END,
    source.updated_at
  FROM attribute_subject_catalog_source source
  WHERE source.subject_id = NEW.id
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

DROP TRIGGER IF EXISTS attribute_subjects_catalog_after_update;
CREATE TRIGGER attribute_subjects_catalog_after_update
AFTER UPDATE OF slug, kind, display_name, game_id, updated_at ON attribute_subjects
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT 'subject:' || source.subject_id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN source.is_eligible THEN source.entry_json ELSE NULL END,
    CASE WHEN source.is_eligible THEN 0 ELSE 1 END,
    source.updated_at
  FROM attribute_subject_catalog_source source
  WHERE source.subject_id = NEW.id
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

DROP TRIGGER IF EXISTS attribute_games_catalog_after_update;
CREATE TRIGGER attribute_games_catalog_after_update
AFTER UPDATE OF slug, display_name, english_name, bgg_id, entity_kind,
  merged_into_game_id, visibility, published_rule_count, attribute_enabled ON games
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT 'subject:' || source.subject_id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN source.is_eligible THEN source.entry_json ELSE NULL END,
    CASE WHEN source.is_eligible THEN 0 ELSE 1 END,
    source.updated_at
  FROM attribute_subject_catalog_source source
  JOIN attribute_subjects subject ON subject.id = source.subject_id
  WHERE subject.game_id = NEW.id AND subject.kind = 'game'
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

DROP TRIGGER IF EXISTS game_external_ids_catalog_after_insert;
CREATE TRIGGER game_external_ids_catalog_after_insert
AFTER INSERT ON game_external_ids
WHEN NEW.source = 'bgg'
  AND EXISTS (
    SELECT 1 FROM attribute_subjects
    WHERE id = 'attribute_subject_game:' || NEW.game_id
  )
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT 'subject:' || source.subject_id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN source.is_eligible THEN source.entry_json ELSE NULL END,
    CASE WHEN source.is_eligible THEN 0 ELSE 1 END,
    source.updated_at
  FROM attribute_subject_catalog_source source
  WHERE source.subject_id = 'attribute_subject_game:' || NEW.game_id
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

DROP TRIGGER IF EXISTS game_external_ids_catalog_after_delete;
CREATE TRIGGER game_external_ids_catalog_after_delete
AFTER DELETE ON game_external_ids
WHEN OLD.source = 'bgg'
  AND EXISTS (
    SELECT 1 FROM attribute_subjects
    WHERE id = 'attribute_subject_game:' || OLD.game_id
  )
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT 'subject:' || source.subject_id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN source.is_eligible THEN source.entry_json ELSE NULL END,
    CASE WHEN source.is_eligible THEN 0 ELSE 1 END,
    source.updated_at
  FROM attribute_subject_catalog_source source
  WHERE source.subject_id = 'attribute_subject_game:' || OLD.game_id
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

-- Existing snapshot generations can predate this boundary. Emit bounded
-- tombstones for their currently active ineligible subject/value entries so
-- clients converge through the normal catalog delta sync without downloading
-- or rebuilding the complete score matrix on a public request.
WITH stale_entries AS (
  SELECT entry_key
  FROM attribute_catalog_entries entry
  WHERE entry.deleted = 0
    AND (
      (
        entry.entry_key LIKE 'subject:%'
        AND NOT EXISTS (
          SELECT 1 FROM attribute_votable_subjects eligible
          WHERE entry.entry_key = 'subject:' || eligible.subject_id
        )
      )
      OR (
        entry.entry_key LIKE 'value:%'
        AND NOT EXISTS (
          SELECT 1 FROM attribute_votable_subjects eligible
          WHERE substr(entry.entry_key, 1, length('value:' || eligible.subject_id || ':'))
            = 'value:' || eligible.subject_id || ':'
        )
      )
    )
), numbered AS (
  SELECT entry_key,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1)
      + ROW_NUMBER() OVER (ORDER BY entry_key) AS catalog_version
  FROM stale_entries
)
INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
SELECT entry_key, catalog_version, NULL, 1,
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM numbered
WHERE 1
ON CONFLICT(entry_key) DO UPDATE SET
  catalog_version = excluded.catalog_version,
  entry_json = NULL,
  deleted = 1,
  updated_at = excluded.updated_at;

UPDATE attribute_catalog_clock
SET current_version = COALESCE((SELECT MAX(catalog_version) FROM attribute_catalog_entries), current_version)
WHERE id = 1;

PRAGMA optimize;
