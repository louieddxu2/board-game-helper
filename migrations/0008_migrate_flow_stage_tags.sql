PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO tags (id, slug, name, normalized_name, created_at, updated_at, is_public) VALUES
  ('tag_stage_setup', '設置', '設置', '設置', 1700000000, 1700000000, 1),
  ('tag_stage_round', '回合階段', '回合階段', '回合階段', 1700000000, 1700000000, 1),
  ('tag_stage_action', '玩家行動', '玩家行動', '玩家行動', 1700000000, 1700000000, 1),
  ('tag_stage_end_scoring', '結算勝負', '結算勝負', '結算勝負', 1700000000, 1700000000, 1),
  ('tag_stage_edition', '人數擴充', '人數擴充', '人數擴充', 1700000000, 1700000000, 1),
  ('tag_stage_always', '全程適用', '全程適用', '全程適用', 1700000000, 1700000000, 1);

INSERT OR IGNORE INTO rule_tags (rule_id, tag_id, created_at)
SELECT id, 'tag_stage_setup', created_at FROM rules WHERE flow_stage = 'setup';

INSERT OR IGNORE INTO rule_tags (rule_id, tag_id, created_at)
SELECT id, 'tag_stage_round', created_at FROM rules WHERE flow_stage = 'round';

INSERT OR IGNORE INTO rule_tags (rule_id, tag_id, created_at)
SELECT id, 'tag_stage_action', created_at FROM rules WHERE flow_stage = 'action';

INSERT OR IGNORE INTO rule_tags (rule_id, tag_id, created_at)
SELECT id, 'tag_stage_end_scoring', created_at FROM rules WHERE flow_stage = 'end_scoring';

INSERT OR IGNORE INTO rule_tags (rule_id, tag_id, created_at)
SELECT id, 'tag_stage_edition', created_at FROM rules WHERE flow_stage = 'edition_player_count';

INSERT OR IGNORE INTO rule_tags (rule_id, tag_id, created_at)
SELECT id, 'tag_stage_always', created_at FROM rules WHERE flow_stage = 'always';

UPDATE rules SET flow_stage = 'uncategorized';
