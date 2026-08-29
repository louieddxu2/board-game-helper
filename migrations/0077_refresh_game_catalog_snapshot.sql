-- Fold the owner collection import and its canonicalization deltas into the
-- compact game catalog. New browsers can then search zero-rule contribution
-- targets without replaying the bulk-import change set.

DELETE FROM game_catalog_snapshot_chunks;
DELETE FROM game_catalog_snapshot_state;

WITH ordered AS (
  SELECT entry_json,
    CAST((ROW_NUMBER() OVER (
      ORDER BY json_extract(entry_json, '$.displayName'), game_id
    ) - 1) / 1000 AS INTEGER) AS chunk_number
  FROM game_catalog_entries
  WHERE deleted = 0 AND entry_json IS NOT NULL
), grouped AS (
  SELECT chunk_number, json_group_array(json(entry_json)) AS games_json
  FROM ordered
  GROUP BY chunk_number
)
INSERT INTO game_catalog_snapshot_chunks (generation, chunk_number, games_json)
SELECT 77, chunk_number, games_json FROM grouped;

INSERT INTO game_catalog_snapshot_chunks (generation, chunk_number, games_json)
SELECT 77, 0, '[]'
WHERE NOT EXISTS (SELECT 1 FROM game_catalog_snapshot_chunks WHERE generation = 77);

INSERT INTO game_catalog_snapshot_state (id, active_generation, through_version, chunk_count, generated_at)
SELECT 1, 77,
  (SELECT current_version FROM game_catalog_clock WHERE id = 1),
  COUNT(*),
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM game_catalog_snapshot_chunks
WHERE generation = 77;
