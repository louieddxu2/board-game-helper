CREATE TABLE IF NOT EXISTS game_view_dedup (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  view_date TEXT NOT NULL,
  view_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, view_date, view_key)
);

CREATE INDEX IF NOT EXISTS idx_game_view_dedup_created_at
  ON game_view_dedup(created_at);

CREATE TABLE IF NOT EXISTS game_daily_view_counts (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  view_date TEXT NOT NULL,
  view_count INTEGER NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  last_view_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, view_date)
);

CREATE INDEX IF NOT EXISTS idx_game_daily_view_counts_date
  ON game_daily_view_counts(view_date, last_view_at DESC);

-- Preserve only short-lived aggregate continuity from the account-linked table.
INSERT INTO game_daily_view_counts (game_id, view_date, view_count, last_view_at)
SELECT game_id, view_date, COUNT(DISTINCT user_id), MAX(created_at)
FROM daily_views
WHERE rule_id = '' AND view_date >= DATE('now', '-13 days')
GROUP BY game_id, view_date
ON CONFLICT(game_id, view_date) DO UPDATE SET
  view_count = excluded.view_count,
  last_view_at = excluded.last_view_at;

DROP TABLE daily_views;
DROP TABLE IF EXISTS game_daily_views;
