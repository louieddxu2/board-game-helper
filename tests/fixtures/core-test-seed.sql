-- Schema exports intentionally omit data. These singleton rows are required by
-- catalog triggers when the core flow creates its first game and rule.
INSERT OR IGNORE INTO game_catalog_clock (id, current_version) VALUES (1, 0);
INSERT OR IGNORE INTO public_tag_catalog_clock (id, current_version) VALUES (1, 0);
INSERT OR IGNORE INTO attribute_catalog_clock (id, current_version) VALUES (1, 0);
