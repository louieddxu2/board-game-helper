-- 1. windowRow
WITH recent_games AS (
  SELECT game_id, MIN(view_date) as min_date, MAX(created_at) as last_seen
  FROM daily_views
  WHERE view_date >= DATE('now', '-30 days')
  GROUP BY game_id
  ORDER BY last_seen DESC
  LIMIT 6
)
SELECT MIN(min_date) as window_start FROM recent_games;

-- 2. recentResult (最新 10 條規則與 JOIN)
SELECT r.id, r.statement, g.display_name,
  (SELECT json_group_array(json_object('id', t.id, 'name', t.name))
   FROM rule_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.rule_id = r.id) AS tags_json
FROM rules r
JOIN games g ON g.id = r.game_id
JOIN submissions s ON s.id = r.submission_id
WHERE r.status = 'published' AND g.merged_into_game_id IS NULL
ORDER BY r.created_at DESC LIMIT 10;

-- 3. popularViewsResult (7 天點擊熱門)
SELECT g.id, g.slug, g.display_name,
  COUNT(DISTINCT dv.user_id) AS view_count,
  (SELECT COUNT(r.id) FROM rules r WHERE r.game_id = g.id AND r.status = 'published') AS rule_count
FROM games g
JOIN daily_views dv ON g.id = dv.game_id
WHERE dv.view_date >= DATE('now', '-7 days') AND g.merged_into_game_id IS NULL
GROUP BY g.id
ORDER BY view_count DESC LIMIT 6;

-- 4. popularResult (備用熱門遊戲)
SELECT g.id, g.slug, g.display_name,
  COUNT(r.id) AS rule_count
FROM games g
LEFT JOIN rules r ON r.game_id = g.id AND r.status = 'published'
WHERE g.merged_into_game_id IS NULL
GROUP BY g.id
HAVING rule_count > 0
ORDER BY rule_count DESC LIMIT 6;
