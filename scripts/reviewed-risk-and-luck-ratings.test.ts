// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';
// @ts-expect-error The schema builder is an intentional JavaScript test helper.
import { buildMigratedSchema } from './check-d1-trigger-fanout.mjs';
import { createHarness } from './attributeReplayTestHarness';
import { runCompleteAttributeReplay } from '../worker/workflows/attributeReplay';
import { processAttributeResponses } from '../worker/workflows/attributeOnlineScoring';

const migration = readFileSync('migrations/0134_seed_reviewed_risk_and_luck_ratings.sql', 'utf8');
const approved = [
  ['attribute_subject_game:game_attribute_import_gaia_project', 0, 0],
  ['attribute_subject_game:game_attribute_import_cryptid', 0, 2],
  ['attribute_subject_game:game_af1c6f0ccbf43ddee8f3', 2, 3],
  ['attribute_subject_game:game_attribute_import_maracaibo', 4, 3],
  ['attribute_subject_game:game_attribute_import_keyflower', 2, 5],
  ['attribute_subject_game:game_f6111657f5ff4844ffd4', 3, 4],
  ['attribute_subject_game:game_attribute_import_awkward_guests', 1, 5],
  ['attribute_subject_game:game_attribute_import_hansa_teutonica', 0, 1],
  ['attribute_subject_game:game_bba34ef47e1dccb322e3', 3, 3],
  ['attribute_subject_game:game_attribute_import_newton', 1, 2],
  ['attribute_subject_game:game_3b77f7f4b22d03184c5b', 1, 1],
  ['attribute_subject_game:game_attribute_import_santorini', 0, 1],
  ['attribute_subject_game:game_attribute_import_fields_of_arle', 0, 0],
  ['attribute_subject_game:game_attribute_import_concordia', 1, 1],
  ['attribute_subject_game:game_attribute_import_cottage_garden', 1, 2],
  ['attribute_subject_game:game_attribute_import_indian_summer', 0, 0],
  ['attribute_subject_game:game_attribute_import_spring_meadow', 1, 1],
  ['attribute_subject_game:game_attribute_import_tzolkin', 1, 1],
  ['attribute_config_tzolkin_tribes_prophecies', 1, 2],
  ['attribute_subject_game:game_d23674b15c14a9707f4b', 3, 4],
  ['attribute_config_feast_for_odin_norwegians', 1, 3],
  ['attribute_config_santa_maria_american_kingdoms', 2, 3],
  ['attribute_config_marco_polo_agents_venice', 1, 3],
  ['attribute_config_barenpark_bad_news_bears', 1, 2],
  ['attribute_subject_game:game_attribute_import_castell', 3, 4],
  ['attribute_subject_game:game_attribute_import_burano', 2, 4],
  ['attribute_subject_game:game_7f41f30c5507cccef21c', 2, 3],
  ['attribute_subject_game:game_attribute_import_skyliners', 3, 2],
  ['attribute_subject_game:game_attribute_import_the_mind', 0, 3],
  ['attribute_subject_game:game_bgg_231554', 1, 3],
] as const;
const expected = approved.flatMap(([subjectId, risk, luck]) => [
  { subjectId, attributeId: 'attribute_risk_planning', value: risk },
  { subjectId, attributeId: 'attribute_luck_dependence', value: luck },
]).sort((a, b) => a.subjectId.localeCompare(b.subjectId) || a.attributeId.localeCompare(b.attributeId));

const imported = (sqlite: ReturnType<typeof createHarness>['sqlite']) => sqlite.prepare(`
  SELECT subject_a_id AS subjectId, attribute_id AS attributeId, rating_a AS value
  FROM attribute_vote_responses WHERE session_id = 'attribute-seed:0134'
  ORDER BY subject_a_id, attribute_id
`).all();

test('the 30 approved games publish 60 exact ratings, preserve history and survive online processing and replay', async () => {
  const { sqlite, gateway } = createHarness('0133_name_based_bgg_slugs.sql');
  try {
    const previousHistory = sqlite.prepare('SELECT * FROM attribute_vote_responses ORDER BY response_id').all();
    const previousStates = sqlite.prepare('SELECT * FROM attribute_score_states ORDER BY subject_id, attribute_id').all();
    sqlite.exec(migration);
    expect(imported(sqlite)).toEqual(expected);
    expect(sqlite.prepare(`SELECT * FROM attribute_vote_responses
      WHERE session_id <> 'attribute-seed:0134' ORDER BY response_id`).all())
      .toEqual(previousHistory);
    expect(sqlite.prepare(`SELECT * FROM attribute_score_states WHERE (subject_id, attribute_id) NOT IN (
      SELECT subject_a_id, attribute_id FROM attribute_vote_responses WHERE session_id = 'attribute-seed:0134'
    ) ORDER BY subject_id, attribute_id`).all())
      .toEqual(previousStates);

    for (const { subjectId, attributeId, value } of expected) {
      expect(sqlite.prepare(`SELECT score, direct_sum, direct_count, comparison_count, evidence_count
        FROM attribute_score_states WHERE subject_id = ? AND attribute_id = ?`).get(subjectId, attributeId))
        .toEqual({ score: value, direct_sum: value, direct_count: 1, comparison_count: 0, evidence_count: 1 });
      const published = sqlite.prepare('SELECT entry_json FROM attribute_catalog_entries WHERE entry_key = ?')
        .get('value:' + subjectId + ':' + attributeId) as { entry_json: string };
      expect(JSON.parse(published.entry_json)).toMatchObject({ subjectId, attributeId, score: value, directAverage: value, directCount: 1 });
    }

    // Deterministic receipt IDs prevent a retried import from adding another vote.
    sqlite.exec(migration);
    expect(imported(sqlite)).toEqual(expected);
    await processAttributeResponses(gateway, { coalesceMs: 0, pageSize: 100 });
    expect(sqlite.prepare(`SELECT SUM(direct_count) AS total FROM attribute_score_states
      WHERE (subject_id, attribute_id) IN (
        SELECT subject_a_id, attribute_id FROM attribute_vote_responses WHERE session_id = 'attribute-seed:0134'
      )`).get()).toEqual({ total: 60 });

    await runCompleteAttributeReplay(gateway, Date.now());
    expect(imported(sqlite)).toEqual(expected);
    for (const { subjectId, attributeId, value } of expected) {
      expect(sqlite.prepare(`SELECT score, direct_sum, direct_count, comparison_count
        FROM attribute_score_states WHERE subject_id = ? AND attribute_id = ?`).get(subjectId, attributeId))
        .toEqual({ score: value, direct_sum: value, direct_count: 1, comparison_count: 0 });
    }
    expect(sqlite.prepare('SELECT id FROM attribute_catalog_rebuild_mode').all()).toEqual([]);
  } finally {
    sqlite.close();
  }
});

test('the import retains a live score that arrived before deployment', () => {
  const sqlite = buildMigratedSchema('0133_name_based_bgg_slugs.sql');
  try {
    const subjectId = approved[0][0];
    sqlite.prepare(`INSERT INTO attribute_vote_responses
      (response_id, attribute_id, subject_a_id, rating_a, activity_json, session_id, created_at, updated_at)
      VALUES ('concurrent-rating', 'attribute_risk_planning', ?, 8, '[]', 'live-session', 1, 1)`).run(subjectId);
    sqlite.prepare(`INSERT INTO attribute_score_states
      (subject_id, attribute_id, score, direct_sum, direct_count, evidence_count, updated_at)
      VALUES (?, 'attribute_risk_planning', 8, 8, 1, 1, 1)`).run(subjectId);

    sqlite.exec(migration);

    expect(imported(sqlite)).toEqual(expected);
    expect(sqlite.prepare(`SELECT score, direct_sum, direct_count FROM attribute_score_states
      WHERE subject_id = ? AND attribute_id = 'attribute_risk_planning'`).get(subjectId))
      .toEqual({ score: 8, direct_sum: 8, direct_count: 1 });
    expect(sqlite.prepare(`SELECT rating_a FROM attribute_vote_responses WHERE response_id = 'concurrent-rating'`).get())
      .toEqual({ rating_a: 8 });
  } finally {
    sqlite.close();
  }
});

test('the schema-only release baseline can migrate without importing nonexistent games', () => {
  const sqlite = new DatabaseSync(':memory:');
  try {
    sqlite.exec('PRAGMA foreign_keys = ON');
    sqlite.exec(readFileSync('tests/fixtures/production-d1-schema.sql', 'utf8'));
    const baseline = readFileSync('tests/fixtures/production-d1-schema.version', 'utf8').trim();
    for (const name of readdirSync('migrations').filter((name) => name.endsWith('.sql') && name > baseline).sort()) {
      sqlite.exec(readFileSync('migrations/' + name, 'utf8'));
    }
    sqlite.exec(readFileSync('tests/fixtures/core-test-seed.sql', 'utf8'));
    expect(imported(sqlite)).toEqual([]);
    expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM attribute_subjects WHERE id GLOB 'core-rank-*'").get())
      .toEqual({ count: 22 });
  } finally {
    sqlite.close();
  }
});
