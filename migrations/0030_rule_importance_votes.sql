ALTER TABLE rules ADD COLUMN importance_count INTEGER NOT NULL DEFAULT 0 CHECK (importance_count >= 0);

CREATE TABLE rule_importance_votes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, rule_id)
) WITHOUT ROWID;

CREATE INDEX idx_rule_importance_votes_user_game
  ON rule_importance_votes(user_id, game_id, rule_id);

CREATE TRIGGER trg_rule_importance_vote_insert
AFTER INSERT ON rule_importance_votes
BEGIN
  UPDATE rules
  SET importance_count = importance_count + 1
  WHERE id = NEW.rule_id;
END;

CREATE TRIGGER trg_rule_importance_vote_delete
AFTER DELETE ON rule_importance_votes
BEGIN
  UPDATE rules
  SET importance_count = MAX(0, importance_count - 1)
  WHERE id = OLD.rule_id;
END;
