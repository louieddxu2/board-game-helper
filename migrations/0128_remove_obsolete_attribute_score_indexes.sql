-- Question selection and reference ordering use the browser catalog now.
-- Keep the subject primary key and attribute-prefixed random index for FKs.
DROP INDEX IF EXISTS idx_attribute_score_states_question_slot;
DROP INDEX IF EXISTS idx_attribute_score_states_question_slot_global;
DROP INDEX IF EXISTS idx_attribute_score_states_attribute_score;
