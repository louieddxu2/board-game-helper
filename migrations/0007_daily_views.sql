CREATE TABLE IF NOT EXISTS daily_views (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  view_date TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, rule_id, user_id, view_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_views_date ON daily_views(view_date);
CREATE INDEX IF NOT EXISTS idx_daily_views_rule ON daily_views(rule_id);
