-- Applied to production on 2026-11-08 (Asia/Taipei).
-- Manual data repair, kept outside automatic migrations.
-- Lands of Galzyr: https://boardgamegeek.com/boardgame/281474/lands-of-galzyr
UPDATE games SET bgg_id = 281474
WHERE id = 'game_16f9631f136d43058c994bfc00f751f9'
  AND display_name = 'Lands of Galzyr' AND bgg_id IS NULL
  AND merged_into_game_id IS NULL AND visibility = 'public'
  AND entity_kind = 'base' AND published_rule_count > 0
  AND NOT EXISTS (SELECT 1 FROM games WHERE bgg_id = 281474)
  AND NOT EXISTS (
    SELECT 1 FROM game_external_ids WHERE source = 'bgg' AND external_id = '281474'
  );

-- GHOST: https://boardgamegeek.com/boardgame/470254/ghost
UPDATE games
SET english_name = 'GHOST',
    updated_at = MAX(updated_at, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER))
WHERE id = 'game_16d1b43a0d7b499085fee8c58a9e6768'
  AND display_name = '搜靈小隊' AND NULLIF(TRIM(english_name), '') IS NULL
  AND bgg_id = 470254 AND merged_into_game_id IS NULL AND visibility = 'public'
  AND entity_kind = 'base' AND published_rule_count > 0;

-- Sweet Lands: https://boardgamegeek.com/boardgame/425445/sweet-lands
UPDATE games
SET english_name = 'Sweet Lands',
    updated_at = MAX(updated_at, CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER))
WHERE id = 'game_41452006d1c849278addfd595877558c'
  AND display_name = '甜蜜國度' AND NULLIF(TRIM(english_name), '') IS NULL
  AND bgg_id = 425445 AND merged_into_game_id IS NULL AND visibility = 'public'
  AND entity_kind = 'base' AND published_rule_count > 0;
