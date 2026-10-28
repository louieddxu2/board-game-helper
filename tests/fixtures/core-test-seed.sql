-- Schema exports intentionally omit data. These singleton rows are required by
-- catalog triggers when the core flow creates its first game and rule.
INSERT OR IGNORE INTO game_catalog_clock (id, current_version) VALUES (1, 0);
INSERT OR IGNORE INTO public_tag_catalog_clock (id, current_version) VALUES (1, 0);
INSERT OR IGNORE INTO attribute_catalog_clock (id, current_version) VALUES (1, 0);

-- A schema-only export has no active game snapshot. Start from an empty real
-- snapshot; submissions then publish their normal versioned catalog deltas.
INSERT OR IGNORE INTO game_catalog_snapshot_chunks (generation, chunk_number, games_json)
VALUES (1, 0, '[]');
INSERT OR IGNORE INTO game_catalog_snapshot_state (id, active_generation, through_version, chunk_count, generated_at)
VALUES (1, 1, 0, 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
