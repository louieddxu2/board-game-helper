-- 實測搜尋框查詢 (GET /api/games/search?q=whistle)
SELECT g.id, g.slug, g.display_name, g.english_name, g.updated_at,
  COUNT(DISTINCT r.id) AS rule_count,
  GROUP_CONCAT(DISTINCT a.alias) AS aliases_str
FROM games g
LEFT JOIN game_aliases a ON a.game_id = g.id
LEFT JOIN rules r ON r.game_id = g.id AND r.status = 'published'
WHERE g.merged_into_game_id IS NULL
  AND (g.normalized_name LIKE '%whistle%' OR LOWER(g.english_name) LIKE '%whistle%' OR a.normalized_alias LIKE '%whistle%')
GROUP BY g.id
ORDER BY CASE WHEN g.normalized_name = 'whistle' THEN 0 ELSE 1 END,
  rule_count DESC, g.display_name
LIMIT 20;
