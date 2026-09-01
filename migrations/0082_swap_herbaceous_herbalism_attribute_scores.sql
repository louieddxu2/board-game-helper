-- The original attribute import row named 本草 was accidentally matched to
-- Herbaceous (BGG 195314). Keep the two games as separate entities, restore
-- their intended Chinese names, and move that row's ratings to Herbalism
-- (BGG 231554). The target currently has no rating evidence, so this is a
-- deterministic identity correction rather than a score merge or rebuild.

CREATE TABLE migration_0082_guard (
  valid INTEGER NOT NULL CHECK (valid = 1)
);

INSERT INTO migration_0082_guard (valid)
SELECT CASE WHEN
  EXISTS (
    SELECT 1 FROM games
    WHERE id = 'game_attribute_import_herbaceous' AND bgg_id = 195314
  )
  AND EXISTS (
    SELECT 1 FROM games
    WHERE id = 'game_bgg_231554' AND bgg_id = 231554
  )
  AND NOT EXISTS (
    SELECT 1 FROM attribute_ratings
    WHERE subject_id = 'attribute_subject_game:game_bgg_231554'
  )
  AND NOT EXISTS (
    SELECT 1 FROM attribute_vote_responses
    WHERE subject_a_id = 'attribute_subject_game:game_bgg_231554'
       OR subject_b_id = 'attribute_subject_game:game_bgg_231554'
  )
  AND NOT EXISTS (
    SELECT 1 FROM attribute_vote_events
    WHERE subject_a_id = 'attribute_subject_game:game_bgg_231554'
       OR subject_b_id = 'attribute_subject_game:game_bgg_231554'
  )
  AND NOT EXISTS (
    SELECT 1 FROM attribute_score_states
    WHERE subject_id = 'attribute_subject_game:game_bgg_231554'
      AND evidence_count > 0
  )
  AND NOT EXISTS (
    SELECT 1 FROM attribute_comparisons
    WHERE subject_a_id IN ('attribute_subject_game:game_attribute_import_herbaceous', 'attribute_subject_game:game_bgg_231554')
       OR subject_b_id IN ('attribute_subject_game:game_attribute_import_herbaceous', 'attribute_subject_game:game_bgg_231554')
  )
  AND NOT EXISTS (
    SELECT 1 FROM attribute_pair_stats
    WHERE subject_a_id IN ('attribute_subject_game:game_attribute_import_herbaceous', 'attribute_subject_game:game_bgg_231554')
       OR subject_b_id IN ('attribute_subject_game:game_attribute_import_herbaceous', 'attribute_subject_game:game_bgg_231554')
  )
  THEN 1 ELSE 0 END;

DROP TABLE migration_0082_guard;

-- Keep both canonical names explicit. The score-bearing entity is the game
-- from the original import, while Herbalism remains a separate unscored game.
UPDATE games
SET display_name = '香草花園',
    normalized_name = '香草花園',
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE id = 'game_attribute_import_herbaceous'
  AND bgg_id = 195314
  AND (display_name <> '香草花園' OR normalized_name <> '香草花園');

UPDATE games
SET display_name = '本草',
    normalized_name = '本草',
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE id = 'game_bgg_231554'
  AND bgg_id = 231554
  AND (display_name <> '本草' OR normalized_name <> '本草');

UPDATE attribute_subjects
SET display_name = '香草花園',
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE id = 'attribute_subject_game:game_attribute_import_herbaceous'
  AND display_name <> '香草花園';

UPDATE attribute_subjects
SET display_name = '本草',
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE id = 'attribute_subject_game:game_bgg_231554'
  AND display_name <> '本草';

UPDATE attribute_subject_components
SET label = '香草花園'
WHERE subject_id = 'attribute_subject_game:game_attribute_import_herbaceous'
  AND component_type = 'base'
  AND label <> '香草花園';

UPDATE attribute_subject_components
SET label = '本草'
WHERE subject_id = 'attribute_subject_game:game_bgg_231554'
  AND component_type = 'base'
  AND label <> '本草';

-- Re-point the imported source row and preserve every historical rating row.
UPDATE attribute_import_candidates
SET subject_id = 'attribute_subject_game:game_bgg_231554',
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE id = 'attribute_candidate:46'
  AND subject_id = 'attribute_subject_game:game_attribute_import_herbaceous';

UPDATE attribute_ratings
SET subject_id = 'attribute_subject_game:game_bgg_231554'
WHERE subject_id = 'attribute_subject_game:game_attribute_import_herbaceous';

UPDATE attribute_vote_responses
SET subject_a_id = CASE
      WHEN subject_a_id = 'attribute_subject_game:game_attribute_import_herbaceous'
      THEN 'attribute_subject_game:game_bgg_231554'
      ELSE subject_a_id
    END,
    subject_b_id = CASE
      WHEN subject_b_id = 'attribute_subject_game:game_attribute_import_herbaceous'
      THEN 'attribute_subject_game:game_bgg_231554'
      ELSE subject_b_id
    END
WHERE subject_a_id = 'attribute_subject_game:game_attribute_import_herbaceous'
   OR subject_b_id = 'attribute_subject_game:game_attribute_import_herbaceous';

UPDATE attribute_vote_events
SET subject_a_id = CASE
      WHEN subject_a_id = 'attribute_subject_game:game_attribute_import_herbaceous'
      THEN 'attribute_subject_game:game_bgg_231554'
      ELSE subject_a_id
    END,
    subject_b_id = CASE
      WHEN subject_b_id = 'attribute_subject_game:game_attribute_import_herbaceous'
      THEN 'attribute_subject_game:game_bgg_231554'
      ELSE subject_b_id
    END
WHERE subject_a_id = 'attribute_subject_game:game_attribute_import_herbaceous'
   OR subject_b_id = 'attribute_subject_game:game_attribute_import_herbaceous';

-- Move all evidenced score-state fields to 本草, then reset the old
-- Herbaceous rows to the same unrated state used by the existing target.
UPDATE attribute_score_states
SET score = (
      SELECT source.score
      FROM attribute_score_states source
      WHERE source.subject_id = 'attribute_subject_game:game_attribute_import_herbaceous'
        AND source.attribute_id = attribute_score_states.attribute_id
    ),
    rating_deviation = (
      SELECT source.rating_deviation
      FROM attribute_score_states source
      WHERE source.subject_id = 'attribute_subject_game:game_attribute_import_herbaceous'
        AND source.attribute_id = attribute_score_states.attribute_id
    ),
    direct_sum = (
      SELECT source.direct_sum
      FROM attribute_score_states source
      WHERE source.subject_id = 'attribute_subject_game:game_attribute_import_herbaceous'
        AND source.attribute_id = attribute_score_states.attribute_id
    ),
    direct_count = (
      SELECT source.direct_count
      FROM attribute_score_states source
      WHERE source.subject_id = 'attribute_subject_game:game_attribute_import_herbaceous'
        AND source.attribute_id = attribute_score_states.attribute_id
    ),
    comparison_count = (
      SELECT source.comparison_count
      FROM attribute_score_states source
      WHERE source.subject_id = 'attribute_subject_game:game_attribute_import_herbaceous'
        AND source.attribute_id = attribute_score_states.attribute_id
    ),
    decisive_comparison_count = (
      SELECT source.decisive_comparison_count
      FROM attribute_score_states source
      WHERE source.subject_id = 'attribute_subject_game:game_attribute_import_herbaceous'
        AND source.attribute_id = attribute_score_states.attribute_id
    ),
    evidence_count = (
      SELECT source.evidence_count
      FROM attribute_score_states source
      WHERE source.subject_id = 'attribute_subject_game:game_attribute_import_herbaceous'
        AND source.attribute_id = attribute_score_states.attribute_id
    ),
    model_version = (
      SELECT source.model_version
      FROM attribute_score_states source
      WHERE source.subject_id = 'attribute_subject_game:game_attribute_import_herbaceous'
        AND source.attribute_id = attribute_score_states.attribute_id
    ),
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE subject_id = 'attribute_subject_game:game_bgg_231554'
  AND attribute_id IN (
    SELECT attribute_id
    FROM attribute_score_states
    WHERE subject_id = 'attribute_subject_game:game_attribute_import_herbaceous'
      AND evidence_count > 0
  );

UPDATE attribute_score_states
SET score = 5,
    rating_deviation = 3,
    direct_sum = 0,
    direct_count = 0,
    comparison_count = 0,
    decisive_comparison_count = 0,
    evidence_count = 0,
    model_version = 'glicko-rd-v1',
    updated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE subject_id = 'attribute_subject_game:game_attribute_import_herbaceous'
  AND evidence_count > 0;

-- The current snapshot is intentionally patched in place. This avoids a
-- full catalog rebuild while making the corrected values visible immediately.
CREATE TABLE migration_0082_snapshot_values (
  subject_id TEXT PRIMARY KEY,
  values_json TEXT NOT NULL
);

INSERT INTO migration_0082_snapshot_values (subject_id, values_json)
SELECT subject_id, json_group_array(json(value_json))
FROM (
  SELECT state.subject_id,
    json_object(
      'subjectId', state.subject_id,
      'attributeId', state.attribute_id,
      'score', state.score,
      'ratingDeviation', state.rating_deviation,
      'directAverage', CASE
        WHEN state.direct_count > 0 THEN state.direct_sum / state.direct_count
        ELSE NULL
      END,
      'directCount', state.direct_count,
      'comparisonCount', state.comparison_count,
      'decisiveComparisonCount', state.decisive_comparison_count,
      'evidenceCount', state.evidence_count,
      'modelVersion', state.model_version
    ) AS value_json
  FROM attribute_score_states state
  WHERE state.subject_id IN (
    'attribute_subject_game:game_attribute_import_herbaceous',
    'attribute_subject_game:game_bgg_231554'
  )
  ORDER BY state.subject_id, state.attribute_id
)
GROUP BY subject_id;

UPDATE attribute_catalog_snapshot_chunks AS snapshot
SET entries_json = (
  SELECT json_group_array(json(entry_json))
  FROM (
    SELECT CASE
      WHEN json_extract(item.value, '$.subject.id') = 'attribute_subject_game:game_attribute_import_herbaceous'
      THEN json_set(
        json_set(
          json_set(item.value, '$.subject.displayName', '香草花園'),
          '$.subject.components[0].label', '香草花園'
        ),
        '$.values', json((
          SELECT values_json
          FROM migration_0082_snapshot_values
          WHERE subject_id = 'attribute_subject_game:game_attribute_import_herbaceous'
        ))
      )
      WHEN json_extract(item.value, '$.subject.id') = 'attribute_subject_game:game_bgg_231554'
      THEN json_set(
        json_set(
          json_set(item.value, '$.subject.displayName', '本草'),
          '$.subject.components[0].label', '本草'
        ),
        '$.values', json((
          SELECT values_json
          FROM migration_0082_snapshot_values
          WHERE subject_id = 'attribute_subject_game:game_bgg_231554'
        ))
      )
      ELSE item.value
    END AS entry_json
    FROM json_each(snapshot.entries_json) item
    ORDER BY CAST(item.key AS INTEGER)
  )
)
WHERE snapshot.generation = (
  SELECT active_generation FROM attribute_catalog_snapshot_state WHERE id = 1
)
  AND (
    instr(snapshot.entries_json, 'attribute_subject_game:game_attribute_import_herbaceous') > 0
    OR instr(snapshot.entries_json, 'attribute_subject_game:game_bgg_231554') > 0
  );

UPDATE attribute_catalog_snapshot_state
SET through_version = (SELECT current_version FROM attribute_catalog_clock WHERE id = 1),
    generated_at = CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
WHERE id = 1;

DROP TABLE migration_0082_snapshot_values;

PRAGMA optimize;
