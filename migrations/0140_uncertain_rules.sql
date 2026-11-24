-- 不確定的桌遊規則: questions about a game's rules that have no known answer yet.
-- checked_at NULL means not looked up yet; a timestamp means looked up then and nothing was found.
-- Admin-only for now; see docs/faq-maker-direction.md.
CREATE TABLE uncertain_rules (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  table_ruling TEXT,
  checked_at INTEGER,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_uncertain_rules_game ON uncertain_rules(game_id, created_at, id);
CREATE INDEX idx_uncertain_rules_creator ON uncertain_rules(created_by);
