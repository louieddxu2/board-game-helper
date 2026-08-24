-- ALTER TABLE cannot add a CHECK constraint to an existing SQLite table, so
-- enforce the configured RD bounds at both write entry points.
CREATE TRIGGER attribute_score_states_rd_insert_guard
BEFORE INSERT ON attribute_score_states
WHEN NEW.rating_deviation < 0.25 OR NEW.rating_deviation > 3
BEGIN
  SELECT RAISE(ABORT, 'attribute_rating_deviation_out_of_range');
END;

CREATE TRIGGER attribute_score_states_rd_update_guard
BEFORE UPDATE OF rating_deviation ON attribute_score_states
WHEN NEW.rating_deviation < 0.25 OR NEW.rating_deviation > 3
BEGIN
  SELECT RAISE(ABORT, 'attribute_rating_deviation_out_of_range');
END;
