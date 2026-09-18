-- Catalog projection is being moved out of source-table triggers.  Keep the
-- initial mode compatible with the currently deployed Worker; the release
-- script switches to `outbox` only after the compatible Worker is live.
CREATE TABLE catalog_outbox_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  mode TEXT NOT NULL CHECK (mode IN ('legacy', 'outbox'))
);

INSERT INTO catalog_outbox_settings (id, mode) VALUES (1, 'legacy');

-- One changed identity survives repeated updates until the explicit
-- publisher has consumed it.  Revision prevents a publisher from deleting a
-- newer trigger notification that arrived while its point lookup was running.
CREATE TABLE catalog_change_outbox (
  catalog TEXT NOT NULL CHECK (catalog IN (
    'game', 'attribute-subject', 'attribute-definition',
    'attribute-candidate', 'tag'
  )),
  entity_key TEXT NOT NULL,
  change_kind TEXT NOT NULL CHECK (change_kind IN ('upsert', 'delete')),
  updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (catalog, entity_key)
) WITHOUT ROWID;

CREATE INDEX idx_catalog_change_outbox_delivery
  ON catalog_change_outbox(updated_at, catalog, entity_key);

-- Full replay compares against its own compact, Worker-only state baseline.
-- It must never reconstruct derived state by scanning the browser snapshot
-- plus every public catalog delta.
CREATE TABLE attribute_replay_state_snapshot_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active_generation INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  generated_at INTEGER NOT NULL
);

CREATE TABLE attribute_replay_state_snapshot_chunks (
  generation INTEGER NOT NULL,
  chunk_number INTEGER NOT NULL,
  states_json TEXT NOT NULL,
  PRIMARY KEY (generation, chunk_number)
);

-- Seed the private checkpoint from the materialized score rows once while
-- applying the migration.  The first Worker replay can then compare its
-- calculation to the current database state and write only genuine
-- corrections, instead of treating every score row as new.
WITH source_states AS (
  SELECT state.subject_id, state.attribute_id, state.score, state.rating_deviation,
    state.direct_sum, state.direct_count, state.comparison_count,
    state.decisive_comparison_count, state.evidence_count, state.model_version
  FROM attribute_score_states state
  JOIN attributes attribute ON attribute.id = state.attribute_id AND attribute.is_active = 1
  JOIN attribute_subjects subject ON subject.id = state.subject_id
  LEFT JOIN games game ON game.id = subject.game_id
  WHERE (
    subject.kind = 'game'
    AND game.entity_kind IN ('base', 'expansion')
    AND game.merged_into_game_id IS NULL
    AND game.visibility = 'public'
    AND (
      game.bgg_id IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM game_external_ids external_id
        WHERE external_id.game_id = game.id AND external_id.source = 'bgg'
      )
      OR EXISTS (
        SELECT 1 FROM attribute_subject_components component
        WHERE component.subject_id = subject.id
          AND component.component_type = 'base'
          AND component.bgg_id IS NOT NULL
      )
    )
  ) OR (
    subject.kind = 'configuration'
    AND EXISTS (
      SELECT 1 FROM attribute_subject_components component
      WHERE component.subject_id = subject.id
        AND component.component_type = 'base'
        AND component.bgg_id IS NOT NULL
    )
    AND EXISTS (
      SELECT 1 FROM attribute_subject_components component
      WHERE component.subject_id = subject.id
        AND component.component_type = 'expansion'
        AND component.bgg_id IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1 FROM attribute_subject_components component
      WHERE component.subject_id = subject.id
        AND component.component_type IN ('base', 'expansion')
        AND component.bgg_id IS NULL
    )
  )
), ordered AS (
  SELECT json_array(
    subject_id, attribute_id, score, rating_deviation, direct_sum, direct_count,
    comparison_count, decisive_comparison_count, evidence_count, model_version
  ) AS state_json,
    CAST((ROW_NUMBER() OVER (ORDER BY subject_id, attribute_id) - 1) / 1000 AS INTEGER) AS chunk_number
  FROM source_states
), grouped AS (
  SELECT chunk_number, json_group_array(json(state_json)) AS states_json
  FROM ordered
  GROUP BY chunk_number
)
INSERT INTO attribute_replay_state_snapshot_chunks (generation, chunk_number, states_json)
SELECT 0, chunk_number, states_json FROM grouped;

INSERT INTO attribute_replay_state_snapshot_chunks (generation, chunk_number, states_json)
SELECT 0, 0, '[]'
WHERE NOT EXISTS (
  SELECT 1 FROM attribute_replay_state_snapshot_chunks WHERE generation = 0
);

INSERT INTO attribute_replay_state_snapshot_state (id, active_generation, chunk_count, generated_at)
SELECT 1, 0, COUNT(*), 0
FROM attribute_replay_state_snapshot_chunks
WHERE generation = 0;
