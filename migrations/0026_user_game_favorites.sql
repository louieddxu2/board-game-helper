CREATE TABLE IF NOT EXISTS user_game_favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  seen_rule_updated_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, game_id)
);

CREATE INDEX IF NOT EXISTS idx_user_game_favorites_user_created
  ON user_game_favorites(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rules_public_updated
  ON rules(status, updated_at DESC, game_id);

CREATE TRIGGER IF NOT EXISTS user_game_favorites_limit
BEFORE INSERT ON user_game_favorites
WHEN (
  SELECT COUNT(*) FROM user_game_favorites WHERE user_id = NEW.user_id
) >= 6
BEGIN
  SELECT RAISE(ABORT, 'favorite_limit_reached');
END;
