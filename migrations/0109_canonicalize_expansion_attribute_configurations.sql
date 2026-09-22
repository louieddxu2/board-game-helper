-- An expansion remains a first-class catalog and rule-variant entity, but it
-- is never an independent attribute identity. Attribute voting represents a
-- playable setup: a base game alone, or a base game plus its expansion.
--
-- This migration only normalizes source history. The next complete replay
-- recalculates score states and publishes the new browser baseline.

-- Existing configurations predate the shared expansion entities. Attach each
-- component to its unique, public expansion entity when BGG identity resolves
-- it, so configurations and rule variants use the same game identity.
CREATE TABLE migration_0109_component_game_targets (
  subject_id TEXT NOT NULL,
  component_order INTEGER NOT NULL,
  game_id TEXT NOT NULL,
  PRIMARY KEY (subject_id, component_order)
);

INSERT INTO migration_0109_component_game_targets (subject_id, component_order, game_id)
SELECT component.subject_id, component.component_order, game.id
FROM attribute_subject_components component
JOIN games game ON game.entity_kind = 'expansion'
  AND game.merged_into_game_id IS NULL
  AND (
    game.bgg_id = component.bgg_id
    OR EXISTS (
      SELECT 1
      FROM game_external_ids external_id
      WHERE external_id.game_id = game.id
        AND external_id.source = 'bgg'
        AND CAST(external_id.external_id AS INTEGER) = component.bgg_id
    )
  )
WHERE component.component_type = 'expansion'
  AND component.game_id IS NULL
  AND component.bgg_id IS NOT NULL
  AND 1 = (
    SELECT COUNT(*)
    FROM games candidate
    WHERE candidate.entity_kind = 'expansion'
      AND candidate.merged_into_game_id IS NULL
      AND (
        candidate.bgg_id = component.bgg_id
        OR EXISTS (
          SELECT 1
          FROM game_external_ids external_id
          WHERE external_id.game_id = candidate.id
            AND external_id.source = 'bgg'
            AND CAST(external_id.external_id AS INTEGER) = component.bgg_id
        )
      )
  );

UPDATE attribute_subject_components
SET game_id = (
  SELECT target.game_id
  FROM migration_0109_component_game_targets target
  WHERE target.subject_id = attribute_subject_components.subject_id
    AND target.component_order = attribute_subject_components.component_order
)
WHERE EXISTS (
  SELECT 1
  FROM migration_0109_component_game_targets target
  WHERE target.subject_id = attribute_subject_components.subject_id
    AND target.component_order = attribute_subject_components.component_order
);

UPDATE attribute_subject_components
SET bgg_id = COALESCE(
      bgg_id,
      (SELECT game.bgg_id FROM games game WHERE game.id = attribute_subject_components.game_id),
      (
        SELECT CAST(external_id.external_id AS INTEGER)
        FROM game_external_ids external_id
        WHERE external_id.game_id = attribute_subject_components.game_id
          AND external_id.source = 'bgg'
        ORDER BY external_id.id
        LIMIT 1
      )
    ),
    english_name = COALESCE(
      english_name,
      (SELECT game.english_name FROM games game WHERE game.id = attribute_subject_components.game_id)
    )
WHERE component_type = 'expansion'
  AND game_id IS NOT NULL
  AND (bgg_id IS NULL OR english_name IS NULL);

-- Every recognized expansion relation gets exactly one configuration target.
-- Existing imported configurations retain their historical IDs; new ones use
-- a deterministic ID derived from both catalog entities.
CREATE TABLE migration_0109_expansion_configuration_targets (
  expansion_game_id TEXT NOT NULL,
  base_game_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  PRIMARY KEY (expansion_game_id, base_game_id)
);

INSERT INTO migration_0109_expansion_configuration_targets
  (expansion_game_id, base_game_id, subject_id)
SELECT relation.source_game_id,
  relation.target_game_id,
  COALESCE((
    SELECT subject.id
    FROM attribute_subjects subject
    WHERE subject.kind = 'configuration'
      AND EXISTS (
        SELECT 1
        FROM attribute_subject_components base_component
        WHERE base_component.subject_id = subject.id
          AND base_component.component_type = 'base'
          AND base_component.game_id = relation.target_game_id
      )
      AND EXISTS (
        SELECT 1
        FROM attribute_subject_components expansion_component
        WHERE expansion_component.subject_id = subject.id
          AND expansion_component.component_type = 'expansion'
          AND expansion_component.game_id = relation.source_game_id
      )
    ORDER BY subject.id
    LIMIT 1
  ), 'attribute_config_expansion:' || relation.source_game_id || ':' || relation.target_game_id)
FROM game_entity_relations relation
JOIN games expansion ON expansion.id = relation.source_game_id
JOIN games base ON base.id = relation.target_game_id
WHERE relation.relation_type = 'expansion_of'
  AND expansion.entity_kind = 'expansion'
  AND expansion.merged_into_game_id IS NULL
  AND base.entity_kind = 'base'
  AND base.merged_into_game_id IS NULL;

INSERT OR IGNORE INTO attribute_subjects
  (id, slug, kind, display_name, game_id, created_at, updated_at)
SELECT target.subject_id,
  'config-' || base.slug || '-with-' || expansion.slug,
  'configuration',
  base.display_name || '＋' || expansion.display_name,
  NULL,
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM migration_0109_expansion_configuration_targets target
JOIN games expansion ON expansion.id = target.expansion_game_id
JOIN games base ON base.id = target.base_game_id;

INSERT OR IGNORE INTO attribute_subject_components
  (subject_id, component_order, game_id, component_type, label, english_name, bgg_id)
SELECT target.subject_id,
  0,
  base.id,
  'base',
  base.display_name,
  base.english_name,
  COALESCE(base.bgg_id, (
    SELECT CAST(external_id.external_id AS INTEGER)
    FROM game_external_ids external_id
    WHERE external_id.game_id = base.id
      AND external_id.source = 'bgg'
    ORDER BY external_id.id
    LIMIT 1
  ))
FROM migration_0109_expansion_configuration_targets target
JOIN games base ON base.id = target.base_game_id;

INSERT OR IGNORE INTO attribute_subject_components
  (subject_id, component_order, game_id, component_type, label, english_name, bgg_id)
SELECT target.subject_id,
  1,
  expansion.id,
  'expansion',
  expansion.display_name,
  expansion.english_name,
  COALESCE(expansion.bgg_id, (
    SELECT CAST(external_id.external_id AS INTEGER)
    FROM game_external_ids external_id
    WHERE external_id.game_id = expansion.id
      AND external_id.source = 'bgg'
    ORDER BY external_id.id
    LIMIT 1
  ))
FROM migration_0109_expansion_configuration_targets target
JOIN games expansion ON expansion.id = target.expansion_game_id;

-- Preserve every authoritative response, but attach it to the configuration
-- that names the same playable setup. Activity payloads are display caches;
-- clear only affected ones rather than retaining a stale standalone expansion
-- label in the recent feed.
CREATE TABLE migration_0109_subject_redirects (
  source_subject_id TEXT PRIMARY KEY,
  target_subject_id TEXT NOT NULL
);

INSERT INTO migration_0109_subject_redirects (source_subject_id, target_subject_id)
SELECT subject.id, target.subject_id
FROM attribute_subjects subject
JOIN migration_0109_expansion_configuration_targets target
  ON target.expansion_game_id = subject.game_id
WHERE subject.kind = 'game'
  -- A legacy direct-expansion vote has no parent information.  Redirect it
  -- only when the expansion has one unambiguous base relation; keep unusual
  -- multi-parent history intact for later editorial resolution.
  AND 1 = (
    SELECT COUNT(*)
    FROM migration_0109_expansion_configuration_targets candidate
    WHERE candidate.expansion_game_id = subject.game_id
  );

UPDATE attribute_vote_responses
SET subject_a_id = COALESCE((
      SELECT redirect.target_subject_id
      FROM migration_0109_subject_redirects redirect
      WHERE redirect.source_subject_id = attribute_vote_responses.subject_a_id
    ), subject_a_id),
    subject_b_id = COALESCE((
      SELECT redirect.target_subject_id
      FROM migration_0109_subject_redirects redirect
      WHERE redirect.source_subject_id = attribute_vote_responses.subject_b_id
    ), subject_b_id),
    activity_json = '[]'
WHERE subject_a_id IN (SELECT source_subject_id FROM migration_0109_subject_redirects)
   OR subject_b_id IN (SELECT source_subject_id FROM migration_0109_subject_redirects);

UPDATE attribute_vote_responses
SET comparison = NULL
WHERE comparison IS NOT NULL
  AND subject_a_id = subject_b_id;

UPDATE attribute_import_candidates
SET subject_id = (
  SELECT redirect.target_subject_id
  FROM migration_0109_subject_redirects redirect
  WHERE redirect.source_subject_id = attribute_import_candidates.subject_id
),
updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE subject_id IN (SELECT source_subject_id FROM migration_0109_subject_redirects);

-- These two tables are retired compatibility history. Their canonical copies
-- already live in attribute_vote_responses, so a collision may discard only
-- the duplicate compatibility row, never an authoritative vote.
UPDATE OR IGNORE attribute_ratings
SET subject_id = (
  SELECT redirect.target_subject_id
  FROM migration_0109_subject_redirects redirect
  WHERE redirect.source_subject_id = attribute_ratings.subject_id
)
WHERE subject_id IN (SELECT source_subject_id FROM migration_0109_subject_redirects);

DELETE FROM attribute_ratings
WHERE subject_id IN (SELECT source_subject_id FROM migration_0109_subject_redirects);

UPDATE OR IGNORE attribute_comparisons
SET subject_a_id = COALESCE((
      SELECT redirect.target_subject_id
      FROM migration_0109_subject_redirects redirect
      WHERE redirect.source_subject_id = attribute_comparisons.subject_a_id
    ), subject_a_id),
    subject_b_id = COALESCE((
      SELECT redirect.target_subject_id
      FROM migration_0109_subject_redirects redirect
      WHERE redirect.source_subject_id = attribute_comparisons.subject_b_id
    ), subject_b_id)
WHERE subject_a_id IN (SELECT source_subject_id FROM migration_0109_subject_redirects)
   OR subject_b_id IN (SELECT source_subject_id FROM migration_0109_subject_redirects);

DELETE FROM attribute_comparisons
WHERE subject_a_id IN (SELECT source_subject_id FROM migration_0109_subject_redirects)
   OR subject_b_id IN (SELECT source_subject_id FROM migration_0109_subject_redirects);

-- Score and pair rows are derived state. Remove the obsolete side now; the
-- next complete replay materializes the configuration from normalized raw
-- responses in one pass.
DELETE FROM attribute_pair_stats
WHERE subject_a_id IN (SELECT source_subject_id FROM migration_0109_subject_redirects)
   OR subject_b_id IN (SELECT source_subject_id FROM migration_0109_subject_redirects);

DELETE FROM attribute_score_states
WHERE subject_id IN (SELECT source_subject_id FROM migration_0109_subject_redirects);

DELETE FROM attribute_subjects
WHERE id IN (SELECT source_subject_id FROM migration_0109_subject_redirects);

-- The new boundary is shared by D1's eligibility view, online question path,
-- complete replay, and future subject provisioning.
DROP VIEW IF EXISTS attribute_votable_subjects;
CREATE VIEW attribute_votable_subjects AS
SELECT subject.id AS subject_id
FROM attribute_subjects subject
LEFT JOIN games game ON game.id = subject.game_id
WHERE (
  subject.kind = 'game'
  AND game.entity_kind = 'base'
  AND game.merged_into_game_id IS NULL
  AND game.visibility = 'public'
  AND (
    game.bgg_id IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM game_external_ids external_id
      WHERE external_id.game_id = game.id AND external_id.source = 'bgg'
    )
    OR EXISTS (
      SELECT 1
      FROM attribute_subject_components component
      WHERE component.subject_id = subject.id
        AND component.component_type = 'base'
        AND component.bgg_id IS NOT NULL
    )
  )
)
OR (
  subject.kind = 'configuration'
  AND EXISTS (
    SELECT 1
    FROM attribute_subject_components component
    WHERE component.subject_id = subject.id
      AND component.component_type = 'base'
      AND component.bgg_id IS NOT NULL
  )
  AND EXISTS (
    SELECT 1
    FROM attribute_subject_components component
    WHERE component.subject_id = subject.id
      AND component.component_type = 'expansion'
      AND component.bgg_id IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1
    FROM attribute_subject_components component
    WHERE component.subject_id = subject.id
      AND component.component_type IN ('base', 'expansion')
      AND component.bgg_id IS NULL
  )
);

DROP TRIGGER IF EXISTS attribute_subject_games_after_insert;
CREATE TRIGGER attribute_subject_games_after_insert AFTER INSERT ON games
WHEN NEW.merged_into_game_id IS NULL AND NEW.entity_kind = 'base'
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
      SELECT 1
      FROM attribute_votable_subjects eligible
      WHERE eligible.subject_id = 'attribute_subject_game:' || NEW.id
    );
END;

DROP TRIGGER IF EXISTS attribute_subject_games_after_classification;
CREATE TRIGGER attribute_subject_games_after_classification
AFTER UPDATE OF entity_kind, bgg_id, merged_into_game_id, visibility,
  published_rule_count, attribute_enabled ON games
WHEN NEW.merged_into_game_id IS NULL AND NEW.entity_kind = 'base'
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
      SELECT 1
      FROM attribute_votable_subjects eligible
      WHERE eligible.subject_id = subject.id
    );
END;

DROP TRIGGER IF EXISTS attribute_subject_games_after_declassification;
CREATE TRIGGER attribute_subject_games_after_declassification
AFTER UPDATE OF entity_kind ON games
WHEN OLD.entity_kind = 'base' AND NEW.entity_kind <> 'base'
BEGIN
  DELETE FROM attribute_score_states
  WHERE subject_id = 'attribute_subject_game:' || NEW.id;
  DELETE FROM attribute_subjects
  WHERE id = 'attribute_subject_game:' || NEW.id
    AND NOT EXISTS (SELECT 1 FROM attribute_ratings rating WHERE rating.subject_id = attribute_subjects.id)
    AND NOT EXISTS (
      SELECT 1
      FROM attribute_comparisons comparison
      WHERE comparison.subject_a_id = attribute_subjects.id OR comparison.subject_b_id = attribute_subjects.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM attribute_vote_responses response
      WHERE response.subject_a_id = attribute_subjects.id OR response.subject_b_id = attribute_subjects.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM attribute_pair_stats pair_stats
      WHERE pair_stats.subject_a_id = attribute_subjects.id OR pair_stats.subject_b_id = attribute_subjects.id
    );
END;

-- Creating a recognized expansion relation creates its playable configuration
-- instead of a standalone expansion subject. Components carry the same game
-- IDs used by rule variants, with BGG IDs as the eligibility boundary.
DROP TRIGGER IF EXISTS attribute_configuration_after_expansion_relation_insert;
CREATE TRIGGER attribute_configuration_after_expansion_relation_insert
AFTER INSERT ON game_entity_relations
WHEN NEW.relation_type = 'expansion_of'
  AND EXISTS (
    SELECT 1
    FROM games expansion
    WHERE expansion.id = NEW.source_game_id
      AND expansion.entity_kind = 'expansion'
      AND expansion.merged_into_game_id IS NULL
  )
  AND EXISTS (
    SELECT 1
    FROM games base
    WHERE base.id = NEW.target_game_id
      AND base.entity_kind = 'base'
      AND base.merged_into_game_id IS NULL
  )
BEGIN
  INSERT OR IGNORE INTO attribute_subjects
    (id, slug, kind, display_name, game_id, created_at, updated_at)
  SELECT 'attribute_config_expansion:' || NEW.source_game_id || ':' || NEW.target_game_id,
    'config-' || base.slug || '-with-' || expansion.slug,
    'configuration',
    base.display_name || '＋' || expansion.display_name,
    NULL,
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER),
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  FROM games expansion
  JOIN games base ON base.id = NEW.target_game_id
  WHERE expansion.id = NEW.source_game_id
    AND NOT EXISTS (
      SELECT 1
      FROM attribute_subjects subject
      WHERE subject.kind = 'configuration'
        AND EXISTS (
          SELECT 1
          FROM attribute_subject_components base_component
          WHERE base_component.subject_id = subject.id
            AND base_component.component_type = 'base'
            AND base_component.game_id = NEW.target_game_id
        )
        AND EXISTS (
          SELECT 1
          FROM attribute_subject_components expansion_component
          WHERE expansion_component.subject_id = subject.id
            AND expansion_component.component_type = 'expansion'
            AND expansion_component.game_id = NEW.source_game_id
        )
    );

  INSERT OR IGNORE INTO attribute_subject_components
    (subject_id, component_order, game_id, component_type, label, english_name, bgg_id)
  SELECT COALESCE((
      SELECT subject.id
      FROM attribute_subjects subject
      WHERE subject.kind = 'configuration'
        AND EXISTS (
          SELECT 1
          FROM attribute_subject_components base_component
          WHERE base_component.subject_id = subject.id
            AND base_component.component_type = 'base'
            AND base_component.game_id = NEW.target_game_id
        )
        AND EXISTS (
          SELECT 1
          FROM attribute_subject_components expansion_component
          WHERE expansion_component.subject_id = subject.id
            AND expansion_component.component_type = 'expansion'
            AND expansion_component.game_id = NEW.source_game_id
        )
      ORDER BY subject.id
      LIMIT 1
    ), 'attribute_config_expansion:' || NEW.source_game_id || ':' || NEW.target_game_id),
    0,
    base.id,
    'base',
    base.display_name,
    base.english_name,
    COALESCE(base.bgg_id, (
      SELECT CAST(external_id.external_id AS INTEGER)
      FROM game_external_ids external_id
      WHERE external_id.game_id = base.id AND external_id.source = 'bgg'
      ORDER BY external_id.id
      LIMIT 1
    ))
  FROM games base
  WHERE base.id = NEW.target_game_id;

  INSERT OR IGNORE INTO attribute_subject_components
    (subject_id, component_order, game_id, component_type, label, english_name, bgg_id)
  SELECT COALESCE((
      SELECT subject.id
      FROM attribute_subjects subject
      WHERE subject.kind = 'configuration'
        AND EXISTS (
          SELECT 1
          FROM attribute_subject_components base_component
          WHERE base_component.subject_id = subject.id
            AND base_component.component_type = 'base'
            AND base_component.game_id = NEW.target_game_id
        )
        AND EXISTS (
          SELECT 1
          FROM attribute_subject_components expansion_component
          WHERE expansion_component.subject_id = subject.id
            AND expansion_component.component_type = 'expansion'
            AND expansion_component.game_id = NEW.source_game_id
        )
      ORDER BY subject.id
      LIMIT 1
    ), 'attribute_config_expansion:' || NEW.source_game_id || ':' || NEW.target_game_id),
    1,
    expansion.id,
    'expansion',
    expansion.display_name,
    expansion.english_name,
    COALESCE(expansion.bgg_id, (
      SELECT CAST(external_id.external_id AS INTEGER)
      FROM game_external_ids external_id
      WHERE external_id.game_id = expansion.id AND external_id.source = 'bgg'
      ORDER BY external_id.id
      LIMIT 1
    ))
  FROM games expansion
  WHERE expansion.id = NEW.source_game_id;
END;

-- BGG identity can arrive after the relation. Keep the configuration component
-- current so it becomes votable through the existing component-state trigger.
DROP TRIGGER IF EXISTS attribute_configuration_components_after_game_bgg_update;
CREATE TRIGGER attribute_configuration_components_after_game_bgg_update
AFTER UPDATE OF bgg_id ON games
WHEN NEW.bgg_id IS NOT NULL AND (OLD.bgg_id IS NULL OR OLD.bgg_id <> NEW.bgg_id)
BEGIN
  UPDATE attribute_subject_components
  SET bgg_id = NEW.bgg_id
  WHERE game_id = NEW.id
    AND component_type IN ('base', 'expansion')
    AND (bgg_id IS NULL OR bgg_id <> NEW.bgg_id);
END;

DROP TRIGGER IF EXISTS attribute_configuration_components_after_external_bgg_insert;
CREATE TRIGGER attribute_configuration_components_after_external_bgg_insert
AFTER INSERT ON game_external_ids
WHEN NEW.source = 'bgg'
  AND NOT EXISTS (SELECT 1 FROM games game WHERE game.id = NEW.game_id AND game.bgg_id IS NOT NULL)
BEGIN
  UPDATE attribute_subject_components
  SET bgg_id = CAST(NEW.external_id AS INTEGER)
  WHERE game_id = NEW.game_id
    AND component_type IN ('base', 'expansion')
    AND bgg_id IS NULL;
END;

-- A migration must wait for the complete replay to publish the new baseline.
-- Drop only its affected incremental entries; later live mutations still use
-- the normal outbox path.
DELETE FROM catalog_change_outbox
WHERE catalog = 'attribute-subject'
  AND entity_key IN (
    SELECT subject_id FROM migration_0109_component_game_targets
    UNION
    SELECT subject_id FROM migration_0109_expansion_configuration_targets
    UNION
    SELECT source_subject_id FROM migration_0109_subject_redirects
  );

DROP TABLE migration_0109_subject_redirects;
DROP TABLE migration_0109_expansion_configuration_targets;
DROP TABLE migration_0109_component_game_targets;

PRAGMA optimize;
