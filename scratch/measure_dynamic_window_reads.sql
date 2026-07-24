-- 1. 時間視窗起點 (第6款遊戲日期 - 7 天)
WITH recent_games AS (
  SELECT game_id, MIN(view_date) as min_date, MAX(created_at) as last_seen
  FROM daily_views
  WHERE view_date >= DATE('now', '-30 days')
  GROUP BY game_id
  ORDER BY last_seen DESC
  LIMIT 6
)
SELECT MIN(min_date) as window_start FROM recent_games;

-- 2. 統計階段：100% 只讀 daily_views 取出 6 個熱門遊戲 ID (零大表 JOIN)
SELECT game_id, COUNT(DISTINCT user_id) AS view_count
FROM daily_views
WHERE view_date >= DATE('now', '-7 days')
GROUP BY game_id
ORDER BY view_count DESC, MAX(created_at) DESC
LIMIT 6;

-- 3. 內容解析階段：點對點精確點查 (WHERE id IN) 拿遊戲與規則
SELECT g.id, g.slug, g.display_name
FROM games g
LIMIT 6;

SELECT r.id, r.statement, g.display_name
FROM rules r JOIN games g ON g.id = r.game_id
LIMIT 6;
