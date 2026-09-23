-- Declassifying a game makes its direct attribute subject ineligible through
-- attribute_votable_subjects. Deleting the parent subject also scans several
-- unindexed foreign-key child columns, including both vote-response sides.
-- Keep that source identity for an explicit, relationship-aware history move.
DROP TRIGGER IF EXISTS attribute_subject_games_after_declassification;
