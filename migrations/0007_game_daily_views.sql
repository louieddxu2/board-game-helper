CREATE TABLE IF NOT EXISTS game_daily_views (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  view_date TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, user_id, view_date)
);

CREATE INDEX IF NOT EXISTS idx_game_daily_views_date ON game_daily_views(view_date);
