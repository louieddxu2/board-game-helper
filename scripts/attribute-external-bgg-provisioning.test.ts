// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';

const setup = () => {
  const sqlite = new DatabaseSync(':memory:');
  for (const name of readdirSync('migrations').filter((file) => file.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(`migrations/${name}`, 'utf8'));
  }
  return sqlite;
};

const insertGame = (sqlite: DatabaseSync, id: string, bggId: number | null) => {
  sqlite.prepare(`
    INSERT INTO games
      (id, slug, display_name, english_name, normalized_name, created_at, updated_at,
       bgg_id, entity_kind, visibility, review_status)
    VALUES (?, ?, ?, ?, ?, 1, 1, ?, 'base', 'public', 'pending')
  `).run(id, `game-${id}`, `遊戲 ${id}`, `Game ${id}`, `game ${id}`, bggId);
};

const stateCount = (sqlite: DatabaseSync, gameId: string) => Number((sqlite.prepare(`
  SELECT COUNT(*) AS count
  FROM attribute_score_states
  WHERE subject_id = ?
`).get(`attribute_subject_game:${gameId}`) as { count: number }).count);

test('external BGG mappings make or keep subjects votable without provisioning scores', () => {
  const sqlite = setup();
  try {
    insertGame(sqlite, 'external-only', null);
    insertGame(sqlite, 'primary-bgg', 999992);
    expect(stateCount(sqlite, 'external-only')).toBe(0);
    expect(stateCount(sqlite, 'primary-bgg')).toBe(0);
    const eligible = sqlite.prepare('SELECT subject_id FROM attribute_votable_subjects WHERE subject_id = ?');
    const externalSubjectId = 'attribute_subject_game:external-only';
    const primarySubjectId = 'attribute_subject_game:primary-bgg';
    expect(eligible.get(externalSubjectId)).toBeUndefined();
    expect(eligible.get(primarySubjectId)).toEqual({ subject_id: primarySubjectId });

    const insertMapping = sqlite.prepare(`
      INSERT INTO game_external_ids (id, game_id, source, external_id, relation, created_at)
      VALUES (?, ?, 'bgg', ?, 'primary', 2)
    `);
    insertMapping.run('external:999991', 'external-only', '999991');
    insertMapping.run('external:999992', 'primary-bgg', '999992');
    expect(eligible.get(externalSubjectId)).toEqual({ subject_id: externalSubjectId });
    expect(eligible.get(primarySubjectId)).toEqual({ subject_id: primarySubjectId });
    expect(stateCount(sqlite, 'external-only')).toBe(0);
    expect(stateCount(sqlite, 'primary-bgg')).toBe(0);
  } finally {
    sqlite.close();
  }
});
