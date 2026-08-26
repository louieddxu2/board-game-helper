-- Allow an attribute-only canonical game to remain available to the attribute
-- app before it has a published wrong-rule record. General game search still
-- filters these zero-rule rows in the client.
ALTER TABLE games ADD COLUMN attribute_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (attribute_enabled IN (0, 1));

-- A configuration can identify its expansion independently from its base
-- game. No BGG lookup behavior is implied yet; this is durable storage for a
-- future editor/import flow.
ALTER TABLE attribute_subject_components ADD COLUMN bgg_id INTEGER
  CHECK (bgg_id IS NULL OR bgg_id > 0);

-- Subject deltas must use the same visibility boundary as the worker and must
-- carry component metadata so future BGG IDs participate in incremental sync.
DROP TRIGGER attribute_subjects_catalog_after_insert;
CREATE TRIGGER attribute_subjects_catalog_after_insert
AFTER INSERT ON attribute_subjects
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT
    'subject:' || NEW.id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN NEW.kind = 'configuration' OR (
      g.merged_into_game_id IS NULL AND g.visibility = 'public'
      AND (g.published_rule_count > 0 OR g.attribute_enabled = 1)
    ) THEN json_object(
      'kind', 'subject',
      'subject', json_object(
        'id', NEW.id,
        'slug', NEW.slug,
        'kind', NEW.kind,
        'displayName', NEW.display_name,
        'secondaryName', g.english_name,
        'gameId', NEW.game_id,
        'gameSlug', g.slug,
        'components', json(COALESCE((
          SELECT json_group_array(json(component_json))
          FROM (
            SELECT json_object(
              'order', c.component_order,
              'gameId', c.game_id,
              'type', c.component_type,
              'label', c.label,
              'bggId', c.bgg_id
            ) AS component_json
            FROM attribute_subject_components c
            WHERE c.subject_id = NEW.id
            ORDER BY c.component_order
          )
        ), '[]'))
      )
    ) ELSE NULL END,
    CASE WHEN NEW.kind = 'configuration' OR (
      g.merged_into_game_id IS NULL AND g.visibility = 'public'
      AND (g.published_rule_count > 0 OR g.attribute_enabled = 1)
    ) THEN 0 ELSE 1 END,
    NEW.updated_at
  FROM attribute_subjects s
  LEFT JOIN games g ON g.id = s.game_id
  WHERE s.id = NEW.id
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

DROP TRIGGER attribute_subjects_catalog_after_update;
CREATE TRIGGER attribute_subjects_catalog_after_update
AFTER UPDATE OF slug, kind, display_name, game_id, updated_at ON attribute_subjects
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT
    'subject:' || NEW.id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN NEW.kind = 'configuration' OR (
      g.merged_into_game_id IS NULL AND g.visibility = 'public'
      AND (g.published_rule_count > 0 OR g.attribute_enabled = 1)
    ) THEN json_object(
      'kind', 'subject',
      'subject', json_object(
        'id', NEW.id,
        'slug', NEW.slug,
        'kind', NEW.kind,
        'displayName', NEW.display_name,
        'secondaryName', g.english_name,
        'gameId', NEW.game_id,
        'gameSlug', g.slug,
        'components', json(COALESCE((
          SELECT json_group_array(json(component_json))
          FROM (
            SELECT json_object(
              'order', c.component_order,
              'gameId', c.game_id,
              'type', c.component_type,
              'label', c.label,
              'bggId', c.bgg_id
            ) AS component_json
            FROM attribute_subject_components c
            WHERE c.subject_id = NEW.id
            ORDER BY c.component_order
          )
        ), '[]'))
      )
    ) ELSE NULL END,
    CASE WHEN NEW.kind = 'configuration' OR (
      g.merged_into_game_id IS NULL AND g.visibility = 'public'
      AND (g.published_rule_count > 0 OR g.attribute_enabled = 1)
    ) THEN 0 ELSE 1 END,
    NEW.updated_at
  FROM attribute_subjects s
  LEFT JOIN games g ON g.id = s.game_id
  WHERE s.id = NEW.id
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

-- Updating a component bumps its subject and therefore emits one normalized
-- subject delta through the trigger above.
CREATE TRIGGER attribute_subject_components_catalog_after_insert
AFTER INSERT ON attribute_subject_components
BEGIN
  UPDATE attribute_subjects
  SET updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  WHERE id = NEW.subject_id;
END;

CREATE TRIGGER attribute_subject_components_catalog_after_update
AFTER UPDATE OF component_order, game_id, component_type, label, bgg_id ON attribute_subject_components
BEGIN
  UPDATE attribute_subjects
  SET updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  WHERE id = NEW.subject_id;
END;

CREATE TRIGGER attribute_subject_components_catalog_after_delete
AFTER DELETE ON attribute_subject_components
BEGIN
  UPDATE attribute_subjects
  SET updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  WHERE id = OLD.subject_id;
END;

DROP TRIGGER attribute_games_catalog_after_update;
CREATE TRIGGER attribute_games_catalog_after_update
AFTER UPDATE OF slug, display_name, english_name, merged_into_game_id, visibility,
  published_rule_count, attribute_enabled ON games
BEGIN
  UPDATE attribute_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO attribute_catalog_entries (entry_key, catalog_version, entry_json, deleted, updated_at)
  SELECT
    'subject:' || s.id,
    (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    CASE WHEN NEW.merged_into_game_id IS NULL
      AND NEW.visibility = 'public'
      AND (NEW.published_rule_count > 0 OR NEW.attribute_enabled = 1)
      THEN json_object(
        'kind', 'subject',
        'subject', json_object(
          'id', s.id,
          'slug', s.slug,
          'kind', s.kind,
          'displayName', s.display_name,
          'secondaryName', NEW.english_name,
          'gameId', s.game_id,
          'gameSlug', NEW.slug,
          'components', json(COALESCE((
            SELECT json_group_array(json(component_json))
            FROM (
              SELECT json_object(
                'order', c.component_order,
                'gameId', c.game_id,
                'type', c.component_type,
                'label', c.label,
                'bggId', c.bgg_id
              ) AS component_json
              FROM attribute_subject_components c
              WHERE c.subject_id = s.id
              ORDER BY c.component_order
            )
          ), '[]'))
        )
      )
      ELSE NULL END,
    CASE WHEN NEW.merged_into_game_id IS NULL
      AND NEW.visibility = 'public'
      AND (NEW.published_rule_count > 0 OR NEW.attribute_enabled = 1) THEN 0 ELSE 1 END,
    NEW.updated_at
  FROM attribute_subjects s
  WHERE s.game_id = NEW.id AND s.kind = 'game'
  ON CONFLICT(entry_key) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

-- Two canonical matches were created on production after the original seed.
-- Provision them on older/local databases while retaining the same IDs.
INSERT OR IGNORE INTO games (
  id, slug, display_name, english_name, normalized_name, created_by,
  created_at, updated_at, visibility, review_status
) VALUES
  (
    'game_72f3ca8f795a40d3ab8df914292cf402', '農家樂', '農家樂', 'Agricola', '農家樂', NULL,
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), 'public', 'pending'
  ),
  (
    'game_e5ba503d7d3748cfa9c05314b038b473', 'ecos-first-continent', '生態圈：第一大陸', 'Ecos: First Continent', '生態圈第一大陸', NULL,
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER), 'public', 'pending'
  );

UPDATE games
SET review_status = 'reviewed',
    reviewed_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE id IN (
  'game_72f3ca8f795a40d3ab8df914292cf402',
  'game_e5ba503d7d3748cfa9c05314b038b473'
)
AND review_status = 'pending' AND created_by IS NULL;

-- Santorini is imported as a canonical shared game now. It deliberately has
-- no rule row: general search hides it, while the contribution picker can use
-- it and the attribute app can retain its imported scores.
INSERT INTO games (
  id, slug, display_name, english_name, normalized_name, created_by,
  created_at, updated_at, visibility, review_status
)
SELECT
  'game_attribute_import_santorini', 'santorini', '聖托里尼', 'Santorini', '聖托里尼', NULL,
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
  'public', 'pending'
WHERE NOT EXISTS (
  SELECT 1 FROM games
  WHERE merged_into_game_id IS NULL AND normalized_name = '聖托里尼'
);

UPDATE games
SET review_status = 'reviewed',
    reviewed_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE id = 'game_attribute_import_santorini' AND review_status = 'pending';

-- Only unique, semantically identical base-game matches are reconciled here.
-- Expansion combinations remain pending configurations.
CREATE TABLE migration_0058_attribute_matches (
  candidate_id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES attribute_subjects(id)
);

WITH mapping(candidate_id, subject_id) AS (VALUES
  ('attribute_candidate:18', 'attribute_subject_game:game_72f3ca8f795a40d3ab8df914292cf402'),
  ('attribute_candidate:25', 'attribute_subject_game:game_188f6b31d9b1b4888025'),
  ('attribute_candidate:30', 'attribute_subject_game:game_e5ba503d7d3748cfa9c05314b038b473'),
  ('attribute_candidate:34', 'attribute_subject_game:game_d23674b15c14a9707f4b'),
  ('attribute_candidate:57', 'attribute_subject_game:game_a1c38db3091a9231100d'),
  ('attribute_candidate:62', 'attribute_subject_game:game_ed273ed757f26dd483b8'),
  ('attribute_candidate:66', 'attribute_subject_game:game_7f41f30c5507cccef21c')
)
INSERT INTO migration_0058_attribute_matches (candidate_id, subject_id)
SELECT mapping.candidate_id, mapping.subject_id
FROM mapping
JOIN attribute_subjects s ON s.id = mapping.subject_id;

INSERT INTO migration_0058_attribute_matches (candidate_id, subject_id)
SELECT 'attribute_candidate:28', s.id
FROM attribute_subjects s
JOIN games g ON g.id = s.game_id
WHERE g.merged_into_game_id IS NULL AND g.normalized_name = '聖托里尼'
ORDER BY g.created_at, g.id
LIMIT 1;

UPDATE attribute_import_candidates
SET match_status = 'matched',
    subject_id = (
      SELECT mapping.subject_id
      FROM migration_0058_attribute_matches mapping
      WHERE mapping.candidate_id = attribute_import_candidates.id
    ),
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE id IN (SELECT candidate_id FROM migration_0058_attribute_matches)
AND match_status = 'pending';

UPDATE games
SET attribute_enabled = 1,
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE id IN (
  SELECT s.game_id
  FROM attribute_import_candidates c
  JOIN attribute_subjects s ON s.id = c.subject_id
  WHERE c.id IN (
    'attribute_candidate:18', 'attribute_candidate:25', 'attribute_candidate:28',
    'attribute_candidate:30', 'attribute_candidate:34', 'attribute_candidate:57',
    'attribute_candidate:62', 'attribute_candidate:66'
  )
);

-- Materialize one historical direct rating per non-empty spreadsheet cell.
-- Keeping these rows makes the import auditable and idempotent.
CREATE TABLE migration_0058_attribute_rating_seed (
  candidate_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  attribute_id TEXT NOT NULL,
  value REAL NOT NULL,
  PRIMARY KEY (candidate_id, attribute_id)
);

INSERT INTO migration_0058_attribute_rating_seed (candidate_id, subject_id, attribute_id, value)
SELECT c.id, c.subject_id, a.id,
  CAST(json_extract(c.values_json, '$[' || a.sort_order || ']') AS REAL)
FROM attribute_import_candidates c
CROSS JOIN attributes a
WHERE c.id IN (
  'attribute_candidate:18', 'attribute_candidate:25', 'attribute_candidate:28',
  'attribute_candidate:30', 'attribute_candidate:34', 'attribute_candidate:57',
  'attribute_candidate:62', 'attribute_candidate:66'
)
AND c.match_status = 'matched'
AND c.subject_id IS NOT NULL
AND json_type(c.values_json, '$[' || a.sort_order || ']') IN ('integer', 'real');

-- The two matched subjects below already share one production response. The
-- constants later in this migration replay that response after the historical
-- import. Abort instead of overwriting if newer evidence arrived meanwhile.
CREATE TABLE migration_0058_replay_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
);

INSERT INTO migration_0058_replay_guard (valid)
SELECT CASE WHEN
  (SELECT COALESCE(SUM(evidence_count), 0) FROM attribute_score_states
   WHERE subject_id = 'attribute_subject_game:game_7f41f30c5507cccef21c') = 1
  AND
  (SELECT COALESCE(SUM(evidence_count), 0) FROM attribute_score_states
   WHERE subject_id = 'attribute_subject_game:game_188f6b31d9b1b4888025') = 2
  AND
  (SELECT COUNT(*) FROM attribute_vote_responses
   WHERE subject_a_id IN (
     'attribute_subject_game:game_7f41f30c5507cccef21c',
     'attribute_subject_game:game_188f6b31d9b1b4888025'
   ) OR subject_b_id IN (
     'attribute_subject_game:game_7f41f30c5507cccef21c',
     'attribute_subject_game:game_188f6b31d9b1b4888025'
  )) = 1
  THEN 1 ELSE 0 END
WHERE EXISTS (
  SELECT 1 FROM attribute_vote_responses
  WHERE response_id = 'attr_response_de08854b-9258-49c1-8f60-9fe0d295421a'
);

DROP TABLE migration_0058_replay_guard;

INSERT OR IGNORE INTO attribute_ratings (
  id, subject_id, attribute_id, value, actor_id, session_id, created_at, updated_at
)
SELECT
  'attribute_rating_import:' || candidate_id || ':' || attribute_id,
  subject_id, attribute_id, value, NULL,
  'attribute-import:' || candidate_id, 0, 0
FROM migration_0058_attribute_rating_seed;

INSERT OR IGNORE INTO attribute_vote_responses (
  response_id, attribute_id, subject_a_id, subject_b_id, rating_a, rating_b,
  comparison, activity_json, actor_id, session_id, created_at, updated_at
)
SELECT
  'attribute-response-import:' || candidate_id || ':' || attribute_id,
  attribute_id, subject_id, NULL, value, NULL,
  NULL, '[]', NULL, 'attribute-import:' || candidate_id, 0, 0
FROM migration_0058_attribute_rating_seed;

-- Unvoted states receive the imported value as their first rating.
UPDATE attribute_score_states
SET score = (
      SELECT seed.value FROM migration_0058_attribute_rating_seed seed
      WHERE seed.subject_id = attribute_score_states.subject_id
        AND seed.attribute_id = attribute_score_states.attribute_id
    ),
    rating_deviation = 1.5,
    direct_sum = (
      SELECT seed.value FROM migration_0058_attribute_rating_seed seed
      WHERE seed.subject_id = attribute_score_states.subject_id
        AND seed.attribute_id = attribute_score_states.attribute_id
    ),
    direct_count = 1,
    evidence_count = 1,
    model_version = 'glicko-rd-v1',
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE evidence_count = 0
  AND EXISTS (
    SELECT 1 FROM migration_0058_attribute_rating_seed seed
    WHERE seed.subject_id = attribute_score_states.subject_id
      AND seed.attribute_id = attribute_score_states.attribute_id
  );

-- These two states already share one later response. Replay that single
-- response after the imported first ratings using the current Glicko-RD model.
UPDATE attribute_score_states
SET score = 2.9142773758959946,
    rating_deviation = 1.4878911160408204,
    direct_sum = 3,
    direct_count = 1,
    comparison_count = 1,
    decisive_comparison_count = 1,
    evidence_count = 2,
    model_version = 'glicko-rd-v1',
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE subject_id = 'attribute_subject_game:game_7f41f30c5507cccef21c'
  AND attribute_id = 'attribute_systemic_coherence'
  AND EXISTS (
    SELECT 1 FROM attribute_vote_responses
    WHERE response_id = 'attr_response_de08854b-9258-49c1-8f60-9fe0d295421a'
  );

UPDATE attribute_score_states
SET score = 10,
    rating_deviation = 1.467523651697506,
    direct_sum = 19,
    direct_count = 2,
    comparison_count = 1,
    decisive_comparison_count = 1,
    evidence_count = 3,
    model_version = 'glicko-rd-v1',
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE subject_id = 'attribute_subject_game:game_188f6b31d9b1b4888025'
  AND attribute_id = 'attribute_systemic_coherence'
  AND EXISTS (
    SELECT 1 FROM attribute_vote_responses
    WHERE response_id = 'attr_response_de08854b-9258-49c1-8f60-9fe0d295421a'
  );

DROP TABLE migration_0058_attribute_rating_seed;
DROP TABLE migration_0058_attribute_matches;

PRAGMA optimize;
