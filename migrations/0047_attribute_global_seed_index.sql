-- The first draw is global: it chooses one low-confidence game+attribute
-- item before the question's attribute is known.  The leading slot column
-- makes each random 1..200 draw a direct index seek.
CREATE INDEX idx_attribute_score_states_question_slot_global
  ON attribute_score_states(question_slot, rating_deviation DESC, random_key, attribute_id, subject_id);

PRAGMA optimize;
