// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { expect, test } from 'vitest';
import { createHarness } from './attributeReplayTestHarness';
import { processAttributeResponses } from '../worker/workflows/attributeOnlineScoring';
import { runCompleteAttributeReplay } from '../worker/workflows/attributeReplay';

const name = '0139_correct_reviewed_risk_planning_ratings.sql';
const migration = readFileSync('migrations/' + name, 'utf8');
const approved = [
  ['attribute_subject_game:game_attribute_import_gaia_project', '0134', 1],
  ['attribute_subject_game:game_attribute_import_hansa_teutonica', '0134', 4],
  ['attribute_subject_game:game_04e027e4990a203f4899', '0135', 3],
  ['attribute_subject_game:game_attribute_import_fields_of_arle', '0134', 1],
  ['attribute_subject_game:game_attribute_import_cryptid', '0134', 1],
  ['attribute_subject_game:game_attribute_import_indian_summer', '0134', 3],
  ['attribute_subject_game:game_attribute_import_the_mind', '0134', 1],
] as const;
const expected = approved.map(([subject, batch, value]) => ({
  subject, value, responseId: `attribute-response-seed:${batch}:risk_planning:${subject}`,
}));
type Sqlite = ReturnType<typeof createHarness>['sqlite'];
const history = (db: Sqlite): Record<string, unknown>[] => db.prepare('SELECT * FROM attribute_vote_responses ORDER BY response_id').all();
const states = (db: Sqlite): Record<string, unknown>[] => db.prepare('SELECT * FROM attribute_score_states ORDER BY subject_id, attribute_id').all();
const revision = (db: Sqlite) => db.prepare('SELECT * FROM attribute_replay_status WHERE id = 1').get()!;
const clock = (db: Sqlite) => db.prepare('SELECT current_version FROM attribute_catalog_clock WHERE id = 1').get()!;
const receipts = (db: Sqlite) => expected.map(({ responseId }) => db.prepare(
  'SELECT response_id, rating_a, created_at, recorded_online FROM attribute_vote_responses WHERE response_id = ?',
).get(responseId));
const setup = () => {
  const harness = createHarness('0134_seed_reviewed_risk_and_luck_ratings.sql');
  harness.sqlite.exec(readFileSync('tests/fixtures/attribute-production-bus.sql', 'utf8'));
  for (const file of readdirSync('migrations').filter((file) => file.endsWith('.sql')
    && file > '0134_seed_reviewed_risk_and_luck_ratings.sql' && file < name).sort()) {
    harness.sqlite.exec(readFileSync('migrations/' + file, 'utf8'));
  }
  harness.sqlite.exec(`DELETE FROM catalog_change_outbox;
    UPDATE attribute_online_progress SET
      through_rowid = (SELECT MAX(rowid) FROM attribute_vote_responses),
      through_response_id = (SELECT response_id FROM attribute_vote_responses ORDER BY rowid DESC LIMIT 1)
    WHERE id = 1;`);
  return harness;
};

test('amends seven original receipts exactly once, preserves all other history, publishes and survives replay', async () => {
  const { sqlite, gateway } = setup();
  try {
    const beforeHistory = history(sqlite);
    const beforeStates = states(sqlite);
    const beforeRevision = revision(sqlite);
    const beforeClock = clock(sqlite);
    const beforeProgress = sqlite.prepare('SELECT * FROM attribute_online_progress WHERE id = 1').get();
    sqlite.exec(migration);
    expect(receipts(sqlite)).toEqual(expected.map(({ responseId, value }) => ({
      response_id: responseId, rating_a: value, created_at: 0, recorded_online: 0,
    })));
    const editedIds = new Set(expected.map(({ responseId }) => responseId));
    expect(history(sqlite).filter((row) => !editedIds.has(String(row.response_id))))
      .toEqual(beforeHistory.filter((row) => !editedIds.has(String(row.response_id))));
    expect(history(sqlite)).toHaveLength(beforeHistory.length);
    const editedSubjects = new Set(expected.map(({ subject }) => subject));
    const untouched = (row: Record<string, unknown>) => row.attribute_id !== 'attribute_risk_planning'
      || !editedSubjects.has(String(row.subject_id) as typeof expected[number]['subject']);
    expect(states(sqlite).filter(untouched)).toEqual(beforeStates.filter(untouched));
    expect(revision(sqlite)).toMatchObject({
      required_revision: Number(beforeRevision.required_revision) + 7,
      history_revision: Number(beforeRevision.history_revision) + 7,
      replayed_revision: beforeRevision.replayed_revision,
    });
    expect(clock(sqlite)).toEqual({ current_version: Number(beforeClock.current_version) + 7 });
    expect(sqlite.prepare('SELECT * FROM attribute_online_progress WHERE id = 1').get()).toEqual(beforeProgress);
    for (const { subject, value } of expected) {
      expect(sqlite.prepare(`SELECT score, direct_sum, direct_count FROM attribute_score_states
        WHERE subject_id = ? AND attribute_id = 'attribute_risk_planning'`).get(subject))
        .toEqual({ score: value, direct_sum: value, direct_count: 1 });
      const entry = sqlite.prepare('SELECT entry_json FROM attribute_catalog_entries WHERE entry_key = ?')
        .get('value:' + subject + ':attribute_risk_planning')!;
      expect(JSON.parse(String(entry.entry_json))).toMatchObject({ score: value, directAverage: value, directCount: 1 });
    }
    const correctedHistory = history(sqlite);
    const correctedStates = states(sqlite);
    const correctedRevision = revision(sqlite);
    const correctedClock = clock(sqlite);
    sqlite.exec(migration);
    expect(history(sqlite)).toEqual(correctedHistory);
    expect(states(sqlite)).toEqual(correctedStates);
    expect(revision(sqlite)).toEqual(correctedRevision);
    expect(clock(sqlite)).toEqual(correctedClock);
    await processAttributeResponses(gateway, { coalesceMs: 0 });
    await runCompleteAttributeReplay(gateway, Date.now());
    for (const { subject, value } of expected) {
      expect(sqlite.prepare(`SELECT score, direct_sum, direct_count FROM attribute_score_states
        WHERE subject_id = ? AND attribute_id = 'attribute_risk_planning'`).get(subject))
        .toEqual({ score: value, direct_sum: value, direct_count: 1 });
    }
    expect(history(sqlite)).toEqual(correctedHistory);
    expect(sqlite.prepare('SELECT id FROM attribute_catalog_rebuild_mode').all()).toEqual([]);
  } finally { sqlite.close(); }
});

test('retains disabled games and other voters evidence while correcting only the original receipt', () => {
  const { sqlite } = setup();
  try {
    const bus = expected[2].subject;
    sqlite.prepare('UPDATE games SET attribute_enabled = 0 WHERE id = ?').run('game_04e027e4990a203f4899');
    // Production's replay has already removed these disabled states, retaining receipts.
    sqlite.prepare('DELETE FROM attribute_score_states WHERE subject_id = ?').run(bus);
    const gaia = expected[0].subject;
    sqlite.prepare(`INSERT INTO attribute_vote_responses
      (response_id, attribute_id, subject_a_id, rating_a, activity_json, session_id, created_at, updated_at)
      VALUES ('another-voter', 'attribute_risk_planning', ?, 8, '[]', 'another-session', 1, 1)`).run(gaia);
    sqlite.prepare(`UPDATE attribute_score_states SET score = 4, direct_sum = 8,
      direct_count = 2, evidence_count = 2 WHERE subject_id = ? AND attribute_id = 'attribute_risk_planning'`).run(gaia);
    const gaiaState = sqlite.prepare("SELECT * FROM attribute_score_states WHERE subject_id = ? AND attribute_id = 'attribute_risk_planning'").get(gaia);
    const otherReceipt = sqlite.prepare("SELECT * FROM attribute_vote_responses WHERE response_id = 'another-voter'").get();
    const beforeClock = clock(sqlite);
    sqlite.exec(migration);
    expect(sqlite.prepare("SELECT * FROM attribute_score_states WHERE subject_id = ? AND attribute_id = 'attribute_risk_planning'").get(gaia)).toEqual(gaiaState);
    expect(sqlite.prepare("SELECT * FROM attribute_vote_responses WHERE response_id = 'another-voter'").get()).toEqual(otherReceipt);
    expect(sqlite.prepare('SELECT attribute_enabled FROM games WHERE id = ?').get('game_04e027e4990a203f4899')).toEqual({ attribute_enabled: 0 });
    expect(sqlite.prepare('SELECT subject_id FROM attribute_score_states WHERE subject_id = ?').all(bus)).toEqual([]);
    expect(receipts(sqlite).map((row) => row!.rating_a)).toEqual(expected.map(({ value }) => value));
    expect(clock(sqlite)).toEqual({ current_version: Number(beforeClock.current_version) + 5 });
  } finally { sqlite.close(); }
});

test.each([['session_id', "'different-owner'"], ['rating_a', '9']])('refuses unexpected %s changes atomically', (column, value) => {
  const { sqlite } = setup();
  try {
    sqlite.prepare(`UPDATE attribute_vote_responses SET ${column} = ${value} WHERE response_id = ?`).run(expected[0].responseId);
    const before = history(sqlite);
    sqlite.exec('BEGIN');
    try { expect(() => sqlite.exec(migration)).toThrow(/CHECK constraint failed/u); }
    finally { sqlite.exec('ROLLBACK'); }
    expect(history(sqlite)).toEqual(before);
  } finally { sqlite.close(); }
});
