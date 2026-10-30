-- Applied to production on 2026-10-30 at 22:10 Asia/Taipei after explicit approval.
-- Six missing primary IDs; Mountain Goats: Legacy was merged separately at 21:20.
-- Dance of Ibexes: https://boardgamegeek.com/boardgame/13005
UPDATE games SET bgg_id = 13005
WHERE id = 'game_3f158a0c614e443599aaf8fd1046c943'
  AND bgg_id IS NULL AND merged_into_game_id IS NULL
  AND entity_kind = 'base' AND visibility = 'public';

-- GHOST / 搜靈小隊: https://boardgamegeek.com/boardgame/470254
UPDATE games SET bgg_id = 470254
WHERE id = 'game_16d1b43a0d7b499085fee8c58a9e6768'
  AND bgg_id IS NULL AND merged_into_game_id IS NULL
  AND entity_kind = 'base' AND visibility = 'public';

-- Valley of Sky Lanterns / 天燈谷: https://boardgamegeek.com/boardgame/473111
UPDATE games SET bgg_id = 473111
WHERE id = 'game_e66b81bb84a143098f7e827686e487e8'
  AND bgg_id IS NULL AND merged_into_game_id IS NULL
  AND entity_kind = 'base' AND visibility = 'public';

-- Click A Tree: https://boardgamegeek.com/boardgame/399959
UPDATE games SET bgg_id = 399959
WHERE id = 'game_653a292c67d245daa39c56b2d480fe56'
  AND bgg_id IS NULL AND merged_into_game_id IS NULL
  AND entity_kind = 'base' AND visibility = 'public';

-- Speakeasy / 地下酒吧: https://boardgamegeek.com/boardgame/375459
UPDATE games SET bgg_id = 375459
WHERE id = 'game_d1dcb4d7c7184b1b90464c817482442b'
  AND bgg_id IS NULL AND merged_into_game_id IS NULL
  AND entity_kind = 'base' AND visibility = 'public';

-- Sweet Lands / 甜蜜國度: https://boardgamegeek.com/boardgame/425445
UPDATE games SET bgg_id = 425445
WHERE id = 'game_41452006d1c849278addfd595877558c'
  AND bgg_id IS NULL AND merged_into_game_id IS NULL
  AND entity_kind = 'base' AND visibility = 'public';
