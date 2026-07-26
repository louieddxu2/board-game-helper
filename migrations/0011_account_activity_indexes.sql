CREATE INDEX IF NOT EXISTS idx_rules_created_by_created_at
  ON rules(created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_daily_views_user_rule_created_at
  ON daily_views(user_id, rule_id, created_at DESC);
