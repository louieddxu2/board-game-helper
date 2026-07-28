CREATE TABLE game_search_catalog (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  catalog_date TEXT NOT NULL,
  games_json TEXT NOT NULL,
  generated_at INTEGER NOT NULL
);

INSERT INTO game_search_catalog (id, catalog_date, games_json, generated_at)
SELECT 1,
  DATE('now', '+8 hours'),
  COALESCE(json_group_array(json_object(
    'id', id,
    'slug', slug,
    'displayName', display_name,
    'englishName', english_name,
    'aliases', json(aliases_json),
    'ruleCount', published_rule_count,
    'publishedRuleCount', published_rule_count,
    'totalRuleCount', total_rule_count,
    'latestRuleUpdatedAt', latest_rule_updated_at,
    'updatedAt', updated_at
  )), '[]'),
  CAST((JULIANDAY('now') - 2440587.5) * 86400000 AS INTEGER)
FROM (
  SELECT g.id, g.slug, g.display_name, g.english_name,
    COALESCE((
      SELECT json_group_array(alias)
      FROM (SELECT alias FROM game_aliases a WHERE a.game_id = g.id ORDER BY alias)
    ), '[]') AS aliases_json,
    g.published_rule_count, g.total_rule_count, g.latest_rule_updated_at, g.updated_at
  FROM games g
  WHERE g.merged_into_game_id IS NULL
  ORDER BY g.display_name
);
