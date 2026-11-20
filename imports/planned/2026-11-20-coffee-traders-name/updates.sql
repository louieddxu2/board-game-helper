-- Applied to production on 2026-11-20 (Asia/Taipei).
-- Manual data repair, kept outside automatic migrations.
-- Coffee Traders: https://boardgamegeek.com/boardgame/325022/coffee-traders
-- The English name was missing its final "s" (BGG and the owner's BGG collection export use "Coffee Traders").
UPDATE games
SET english_name = 'Coffee Traders',
    updated_at = MAX(updated_at, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER))
WHERE id = 'game_8491bf47690da7c17185'
  AND display_name = '咖啡商人' AND english_name = 'Coffee Trader'
  AND bgg_id = 325022 AND merged_into_game_id IS NULL;
