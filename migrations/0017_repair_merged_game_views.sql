-- Homepage heat only considers the recent bounded view window. Re-key matching
-- records from games that were merged before the merge flow handled view data.
UPDATE OR REPLACE daily_views
SET created_at = MAX(
      daily_views.created_at,
      COALESCE((
        SELECT target_view.created_at
        FROM daily_views target_view
        WHERE target_view.game_id = (
            SELECT source_game.merged_into_game_id
            FROM games source_game
            WHERE source_game.id = daily_views.game_id
          )
          AND target_view.rule_id = daily_views.rule_id
          AND target_view.user_id = daily_views.user_id
          AND target_view.view_date = daily_views.view_date
      ), daily_views.created_at)
    ),
    game_id = (
      SELECT source_game.merged_into_game_id
      FROM games source_game
      WHERE source_game.id = daily_views.game_id
    )
WHERE rowid IN (
  SELECT rowid
  FROM daily_views
  WHERE view_date >= DATE('now', '-37 days')
  ORDER BY view_date DESC, created_at DESC
  LIMIT 100
)
  AND EXISTS (
    SELECT 1
    FROM games source_game
    WHERE source_game.id = daily_views.game_id
      AND source_game.merged_into_game_id IS NOT NULL
  );
