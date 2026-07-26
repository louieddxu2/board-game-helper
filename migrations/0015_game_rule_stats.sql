ALTER TABLE games ADD COLUMN published_rule_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN total_rule_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN latest_rule_updated_at INTEGER;

UPDATE games
SET published_rule_count = (
      SELECT COUNT(*) FROM rules r
      WHERE r.game_id = games.id AND r.status = 'published'
    ),
    total_rule_count = (
      SELECT COUNT(*) FROM rules r
      WHERE r.game_id = games.id
    ),
    latest_rule_updated_at = (
      SELECT MAX(r.updated_at) FROM rules r
      WHERE r.game_id = games.id
    );

CREATE TRIGGER rules_stats_after_insert
AFTER INSERT ON rules
BEGIN
  UPDATE games
  SET published_rule_count = published_rule_count + CASE WHEN NEW.status = 'published' THEN 1 ELSE 0 END,
      total_rule_count = total_rule_count + 1,
      latest_rule_updated_at = CASE
        WHEN latest_rule_updated_at IS NULL OR NEW.updated_at > latest_rule_updated_at THEN NEW.updated_at
        ELSE latest_rule_updated_at
      END
  WHERE id = NEW.game_id;
END;

CREATE TRIGGER rules_stats_after_delete
AFTER DELETE ON rules
BEGIN
  UPDATE games
  SET published_rule_count = MAX(0, published_rule_count - CASE WHEN OLD.status = 'published' THEN 1 ELSE 0 END),
      total_rule_count = MAX(0, total_rule_count - 1),
      latest_rule_updated_at = (
        SELECT MAX(r.updated_at) FROM rules r WHERE r.game_id = OLD.game_id
      )
  WHERE id = OLD.game_id;
END;

CREATE TRIGGER rules_stats_after_update_same_game
AFTER UPDATE OF status, updated_at ON rules
WHEN OLD.game_id = NEW.game_id
BEGIN
  UPDATE games
  SET published_rule_count = MAX(0, published_rule_count
        - CASE WHEN OLD.status = 'published' THEN 1 ELSE 0 END
        + CASE WHEN NEW.status = 'published' THEN 1 ELSE 0 END),
      latest_rule_updated_at = CASE
        WHEN latest_rule_updated_at IS NULL OR NEW.updated_at > latest_rule_updated_at THEN NEW.updated_at
        ELSE latest_rule_updated_at
      END
  WHERE id = NEW.game_id;
END;

CREATE TRIGGER rules_stats_after_move_old_game
AFTER UPDATE OF game_id ON rules
WHEN OLD.game_id <> NEW.game_id
BEGIN
  UPDATE games
  SET published_rule_count = MAX(0, published_rule_count - CASE WHEN OLD.status = 'published' THEN 1 ELSE 0 END),
      total_rule_count = MAX(0, total_rule_count - 1),
      latest_rule_updated_at = (
        SELECT MAX(r.updated_at) FROM rules r WHERE r.game_id = OLD.game_id
      )
  WHERE id = OLD.game_id;
END;

CREATE TRIGGER rules_stats_after_move_new_game
AFTER UPDATE OF game_id ON rules
WHEN OLD.game_id <> NEW.game_id
BEGIN
  UPDATE games
  SET published_rule_count = published_rule_count + CASE WHEN NEW.status = 'published' THEN 1 ELSE 0 END,
      total_rule_count = total_rule_count + 1,
      latest_rule_updated_at = CASE
        WHEN latest_rule_updated_at IS NULL OR NEW.updated_at > latest_rule_updated_at THEN NEW.updated_at
        ELSE latest_rule_updated_at
      END
  WHERE id = NEW.game_id;
END;
