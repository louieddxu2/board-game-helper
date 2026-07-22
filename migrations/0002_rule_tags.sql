PRAGMA foreign_keys = ON;

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  tag_type TEXT NOT NULL DEFAULT 'topic' CHECK (tag_type IN ('topic')),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'merged', 'hidden')),
  merged_into_tag_id TEXT REFERENCES tags(id),
  created_by TEXT REFERENCES users(id),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'suggested')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_tags_name ON tags(name);

CREATE TABLE tag_aliases (
  id TEXT PRIMARY KEY,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_tag_aliases_tag ON tag_aliases(tag_id);

CREATE TABLE rule_tags (
  rule_id TEXT NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (rule_id, tag_id)
);

CREATE INDEX idx_rule_tags_tag ON rule_tags(tag_id, rule_id);

INSERT INTO tags (id, slug, name, normalized_name, description, created_at, updated_at) VALUES
  ('tag_timing', 'timing', '時機／觸發', '時機觸發', '效果在什麼時候發生，以及觸發順序。', 0, 0),
  ('tag_payment', 'payment', '資源與支付', '資源與支付', '支付、花費、取得或不足額處理。', 0, 0),
  ('tag_draw', 'draw-refill', '抽牌／補充', '抽牌補充', '抽牌、補牌、市場補充或手牌補滿。', 0, 0),
  ('tag_card_effect', 'card-effect', '卡牌效果', '卡牌效果', '卡牌文字、能力與效果解析。', 0, 0),
  ('tag_action_limit', 'action-limit', '行動限制', '行動限制', '能否行動、行動次數與前置條件。', 0, 0),
  ('tag_priority', 'priority', '優先順序', '優先順序', '多人、同價或同時發生時的先後順序。', 0, 0),
  ('tag_movement', 'movement-placement', '移動／放置', '移動放置', '移動、擺放、相鄰與空間限制。', 0, 0),
  ('tag_trade', 'trade', '交易', '交易', '玩家交易、買賣或市場交換。', 0, 0),
  ('tag_tie', 'tie-break', '平手', '平手', '平手判定與順位。', 0, 0),
  ('tag_special_power', 'special-power', '特殊能力', '特殊能力', '角色、陣營或其他不對稱能力。', 0, 0),
  ('tag_end_trigger', 'end-trigger', '結束觸發', '結束觸發', '終局條件、最後一輪與結束時機。', 0, 0),
  ('tag_scoring', 'scoring', '計分', '計分', '遊戲中或終局計分。', 0, 0);

INSERT INTO tag_aliases (id, tag_id, alias, normalized_alias, created_at) VALUES
  ('ta_draw', 'tag_draw', '抽牌', '抽牌', 0),
  ('ta_refill', 'tag_draw', '補牌', '補牌', 0),
  ('ta_refill_hand', 'tag_draw', '補手牌', '補手牌', 0),
  ('ta_timing', 'tag_timing', '時機', '時機', 0),
  ('ta_trigger', 'tag_timing', '觸發', '觸發', 0),
  ('ta_score', 'tag_scoring', '算分', '算分', 0);
