CREATE TABLE IF NOT EXISTS game_public_rule_heads (
  game_id TEXT PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_game_public_rule_heads_recent
  ON game_public_rule_heads(updated_at DESC, rule_id DESC);

CREATE INDEX IF NOT EXISTS idx_rules_game_public_updated
  ON rules(game_id, status, updated_at DESC, id DESC);

INSERT OR REPLACE INTO game_public_rule_heads (game_id, rule_id, updated_at)
SELECT game_id, id, updated_at
FROM (
  SELECT game_id, id, updated_at,
    ROW_NUMBER() OVER (PARTITION BY game_id ORDER BY updated_at DESC, id DESC) AS position
  FROM rules
  WHERE status = 'published'
)
WHERE position = 1;

CREATE TRIGGER IF NOT EXISTS game_public_rule_heads_insert
AFTER INSERT ON rules
WHEN NEW.status = 'published'
BEGIN
  INSERT INTO game_public_rule_heads (game_id, rule_id, updated_at)
  VALUES (NEW.game_id, NEW.id, NEW.updated_at)
  ON CONFLICT(game_id) DO UPDATE SET
    rule_id = excluded.rule_id,
    updated_at = excluded.updated_at
  WHERE excluded.updated_at > game_public_rule_heads.updated_at
    OR (
      excluded.updated_at = game_public_rule_heads.updated_at
      AND excluded.rule_id > game_public_rule_heads.rule_id
    );
END;

CREATE TRIGGER IF NOT EXISTS game_public_rule_heads_update_same_game
AFTER UPDATE OF game_id, status, updated_at ON rules
WHEN OLD.game_id = NEW.game_id
BEGIN
  DELETE FROM game_public_rule_heads WHERE game_id = NEW.game_id;
  INSERT INTO game_public_rule_heads (game_id, rule_id, updated_at)
  SELECT game_id, id, updated_at
  FROM rules
  WHERE game_id = NEW.game_id AND status = 'published'
  ORDER BY updated_at DESC, id DESC
  LIMIT 1;
END;

CREATE TRIGGER IF NOT EXISTS game_public_rule_heads_update_moved_game
AFTER UPDATE OF game_id, status, updated_at ON rules
WHEN OLD.game_id <> NEW.game_id
BEGIN
  DELETE FROM game_public_rule_heads
  WHERE game_id = OLD.game_id OR game_id = NEW.game_id;

  INSERT INTO game_public_rule_heads (game_id, rule_id, updated_at)
  SELECT game_id, id, updated_at
  FROM rules
  WHERE game_id = OLD.game_id AND status = 'published'
  ORDER BY updated_at DESC, id DESC
  LIMIT 1;

  INSERT INTO game_public_rule_heads (game_id, rule_id, updated_at)
  SELECT game_id, id, updated_at
  FROM rules
  WHERE game_id = NEW.game_id AND status = 'published'
  ORDER BY updated_at DESC, id DESC
  LIMIT 1;
END;

CREATE TRIGGER IF NOT EXISTS game_public_rule_heads_delete
AFTER DELETE ON rules
WHEN OLD.status = 'published'
BEGIN
  DELETE FROM game_public_rule_heads WHERE game_id = OLD.game_id;
  INSERT INTO game_public_rule_heads (game_id, rule_id, updated_at)
  SELECT game_id, id, updated_at
  FROM rules
  WHERE game_id = OLD.game_id AND status = 'published'
  ORDER BY updated_at DESC, id DESC
  LIMIT 1;
END;
