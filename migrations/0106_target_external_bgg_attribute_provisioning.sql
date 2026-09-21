-- A normalized BGG mapping can make only its direct game subject newly
-- votable. Configurations are eligible from component BGG IDs, so expanding
-- this write through every subject/component is both unnecessary and costly.
--
-- A game with games.bgg_id already populated has its states provisioned by
-- attribute_subject_games_after_classification. Adding its matching
-- normalized mapping must therefore do no score-state work at all.
DROP TRIGGER IF EXISTS attribute_game_external_ids_after_insert;
CREATE TRIGGER attribute_game_external_ids_after_insert
AFTER INSERT ON game_external_ids
WHEN NEW.source = 'bgg'
  AND NOT EXISTS (
    SELECT 1
    FROM games game
    WHERE game.id = NEW.game_id
      AND game.bgg_id IS NOT NULL
  )
BEGIN
  INSERT OR IGNORE INTO attribute_score_states
    (subject_id, attribute_id, score, direct_sum, direct_count, comparison_count,
     decisive_comparison_count, evidence_count, model_version, updated_at,
     rating_deviation, random_key, question_slot)
  SELECT subject.id, attribute.id, 5, 0, 0, 0, 0, 0, 'glicko-rd-v1',
    NEW.created_at, 3, lower(hex(randomblob(16))), (abs(random()) % 200) + 1
  FROM attribute_subjects subject
  CROSS JOIN attributes attribute
  WHERE subject.game_id = NEW.game_id
    AND attribute.is_active = 1
    AND EXISTS (
      SELECT 1 FROM attribute_votable_subjects eligible
      WHERE eligible.subject_id = subject.id
    );
END;

PRAGMA optimize;
