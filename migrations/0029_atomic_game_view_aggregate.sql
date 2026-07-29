CREATE TRIGGER IF NOT EXISTS game_view_dedup_after_insert
AFTER INSERT ON game_view_dedup
BEGIN
  INSERT INTO game_daily_view_counts (game_id, view_date, view_count, last_view_at)
  VALUES (NEW.game_id, NEW.view_date, 1, NEW.created_at)
  ON CONFLICT(game_id, view_date) DO UPDATE SET
    view_count = game_daily_view_counts.view_count + 1,
    last_view_at = MAX(game_daily_view_counts.last_view_at, excluded.last_view_at);
END;
