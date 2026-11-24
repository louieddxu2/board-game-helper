-- 不確定的桌遊規則 take the same optional settings as a recorded rule.
-- JSON columns hold arrays; NULL means none chosen.
ALTER TABLE uncertain_rules ADD COLUMN details TEXT;
ALTER TABLE uncertain_rules ADD COLUMN categories_json TEXT;
ALTER TABLE uncertain_rules ADD COLUMN player_counts_json TEXT;
ALTER TABLE uncertain_rules ADD COLUMN edition_notes_json TEXT;
