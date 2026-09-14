-- Attribute examples are sampled from the browser's cached attribute catalog.
-- The Worker no longer queries these score bands, so the four write-heavy
-- partial indexes are unnecessary.
DROP INDEX IF EXISTS idx_attribute_score_states_low_example_random;
DROP INDEX IF EXISTS idx_attribute_score_states_high_example_random;
DROP INDEX IF EXISTS idx_attribute_score_states_low_example_score_random;
DROP INDEX IF EXISTS idx_attribute_score_states_high_example_score_random;
