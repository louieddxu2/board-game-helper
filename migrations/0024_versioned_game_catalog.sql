CREATE TABLE game_catalog_clock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current_version INTEGER NOT NULL
);

INSERT INTO game_catalog_clock (id, current_version) VALUES (1, 0);

CREATE TABLE game_catalog_entries (
  game_id TEXT PRIMARY KEY,
  catalog_version INTEGER NOT NULL UNIQUE,
  entry_json TEXT,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_game_catalog_entries_version
  ON game_catalog_entries(catalog_version, game_id);

CREATE VIEW game_catalog_source AS
SELECT g.id AS game_id,
  CASE WHEN g.merged_into_game_id IS NULL THEN 0 ELSE 1 END AS deleted,
  json_object(
    'id', g.id,
    'slug', g.slug,
    'displayName', g.display_name,
    'englishName', g.english_name,
    'aliases', json(COALESCE((
      SELECT json_group_array(alias)
      FROM (SELECT alias FROM game_aliases a WHERE a.game_id = g.id ORDER BY alias)
    ), '[]')),
    'ruleCount', g.published_rule_count,
    'publishedRuleCount', g.published_rule_count,
    'totalRuleCount', g.total_rule_count,
    'latestRuleUpdatedAt', g.latest_rule_updated_at,
    'updatedAt', g.updated_at
  ) AS entry_json,
  g.updated_at
FROM games g;

WITH numbered AS (
  SELECT game_id, entry_json, deleted, updated_at,
    ROW_NUMBER() OVER (ORDER BY game_id) AS catalog_version
  FROM game_catalog_source
)
INSERT INTO game_catalog_entries (game_id, catalog_version, entry_json, deleted, updated_at)
SELECT game_id, catalog_version, entry_json, deleted, updated_at
FROM numbered;

UPDATE game_catalog_clock
SET current_version = COALESCE((SELECT MAX(catalog_version) FROM game_catalog_entries), 0)
WHERE id = 1;

CREATE TABLE game_catalog_snapshot_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active_generation INTEGER NOT NULL,
  through_version INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  generated_at INTEGER NOT NULL
);

CREATE TABLE game_catalog_snapshot_chunks (
  generation INTEGER NOT NULL,
  chunk_number INTEGER NOT NULL,
  games_json TEXT NOT NULL,
  PRIMARY KEY (generation, chunk_number)
);

WITH ordered AS (
  SELECT entry_json,
    CAST((ROW_NUMBER() OVER (
      ORDER BY json_extract(entry_json, '$.displayName'), game_id
    ) - 1) / 1000 AS INTEGER) AS chunk_number
  FROM game_catalog_entries
  WHERE deleted = 0
), grouped AS (
  SELECT chunk_number, json_group_array(json(entry_json)) AS games_json
  FROM ordered
  GROUP BY chunk_number
)
INSERT INTO game_catalog_snapshot_chunks (generation, chunk_number, games_json)
SELECT 1, chunk_number, games_json FROM grouped;

INSERT INTO game_catalog_snapshot_chunks (generation, chunk_number, games_json)
SELECT 1, 0, '[]'
WHERE NOT EXISTS (SELECT 1 FROM game_catalog_snapshot_chunks WHERE generation = 1);

INSERT INTO game_catalog_snapshot_state (id, active_generation, through_version, chunk_count, generated_at)
SELECT 1, 1,
  (SELECT current_version FROM game_catalog_clock WHERE id = 1),
  COUNT(*),
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM game_catalog_snapshot_chunks
WHERE generation = 1;

CREATE TRIGGER game_catalog_games_after_insert
AFTER INSERT ON games
BEGIN
  UPDATE game_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO game_catalog_entries (game_id, catalog_version, entry_json, deleted, updated_at)
  SELECT game_id, (SELECT current_version FROM game_catalog_clock WHERE id = 1), entry_json, deleted, updated_at
  FROM game_catalog_source WHERE game_id = NEW.id
  ON CONFLICT(game_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER game_catalog_games_after_update
AFTER UPDATE OF slug, display_name, english_name, merged_into_game_id,
  published_rule_count, total_rule_count, latest_rule_updated_at ON games
BEGIN
  UPDATE game_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO game_catalog_entries (game_id, catalog_version, entry_json, deleted, updated_at)
  SELECT game_id, (SELECT current_version FROM game_catalog_clock WHERE id = 1), entry_json, deleted, updated_at
  FROM game_catalog_source WHERE game_id = NEW.id
  ON CONFLICT(game_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER game_catalog_games_after_delete
AFTER DELETE ON games
BEGIN
  UPDATE game_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO game_catalog_entries (game_id, catalog_version, entry_json, deleted, updated_at)
  VALUES (
    OLD.id,
    (SELECT current_version FROM game_catalog_clock WHERE id = 1),
    NULL,
    1,
    CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
  )
  ON CONFLICT(game_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = NULL,
    deleted = 1,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER game_catalog_aliases_after_insert
AFTER INSERT ON game_aliases
BEGIN
  UPDATE game_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO game_catalog_entries (game_id, catalog_version, entry_json, deleted, updated_at)
  SELECT game_id, (SELECT current_version FROM game_catalog_clock WHERE id = 1), entry_json, deleted, updated_at
  FROM game_catalog_source WHERE game_id = NEW.game_id
  ON CONFLICT(game_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER game_catalog_aliases_after_delete
AFTER DELETE ON game_aliases
BEGIN
  UPDATE game_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO game_catalog_entries (game_id, catalog_version, entry_json, deleted, updated_at)
  SELECT game_id, (SELECT current_version FROM game_catalog_clock WHERE id = 1), entry_json, deleted, updated_at
  FROM game_catalog_source WHERE game_id = OLD.game_id
  ON CONFLICT(game_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER game_catalog_aliases_after_update
AFTER UPDATE OF game_id, alias ON game_aliases
BEGIN
  UPDATE game_catalog_clock SET current_version = current_version + 1 WHERE id = 1;
  INSERT INTO game_catalog_entries (game_id, catalog_version, entry_json, deleted, updated_at)
  SELECT game_id, (SELECT current_version FROM game_catalog_clock WHERE id = 1), entry_json, deleted, updated_at
  FROM game_catalog_source WHERE game_id = NEW.game_id
  ON CONFLICT(game_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;

  UPDATE game_catalog_clock SET current_version = current_version + 1
  WHERE id = 1 AND OLD.game_id <> NEW.game_id;
  INSERT INTO game_catalog_entries (game_id, catalog_version, entry_json, deleted, updated_at)
  SELECT game_id, (SELECT current_version FROM game_catalog_clock WHERE id = 1), entry_json, deleted, updated_at
  FROM game_catalog_source WHERE game_id = OLD.game_id AND OLD.game_id <> NEW.game_id
  ON CONFLICT(game_id) DO UPDATE SET
    catalog_version = excluded.catalog_version,
    entry_json = excluded.entry_json,
    deleted = excluded.deleted,
    updated_at = excluded.updated_at;
END;
