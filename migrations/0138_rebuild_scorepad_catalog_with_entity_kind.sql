-- Score pad catalog entries now carry entityKind. Clearing the state row makes the next call or
-- weekly schedule rebuild every entry from the source tables once; the rebuilt version continues
-- after the stored entries, so a score pad holding version "1" receives the new games.
DELETE FROM scorepad_catalog_snapshot_state WHERE id = 1;
