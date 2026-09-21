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

test('external BGG mappings provision only the direct game subject through its indexed game_id', () => {
  const sqlite = setup();
  try {
    insertGame(sqlite, 'external-only', null);
    expect(stateCount(sqlite, 'external-only')).toBe(0);

    sqlite.prepare(`
      INSERT INTO game_external_ids (id, game_id, source, external_id, relation, created_at)
      VALUES ('external:999991', 'external-only', 'bgg', '999991', 'primary', 2)
    `).run();
    const activeAttributeCount = Number((sqlite.prepare(
      'SELECT COUNT(*) AS count FROM attributes WHERE is_active = 1',
    ).get() as { count: number }).count);
    expect(stateCount(sqlite, 'external-only')).toBe(activeAttributeCount);

    const trigger = sqlite.prepare(`
      SELECT sql
      FROM sqlite_master
      WHERE type = 'trigger' AND name = 'attribute_game_external_ids_after_insert'
    `).get() as { sql: string };
    expect(trigger.sql).toContain('subject.game_id = NEW.game_id');
    expect(trigger.sql).not.toContain('attribute_subject_components');

    const plan = (sqlite.prepare(`
      EXPLAIN QUERY PLAN
      SELECT subject.id
      FROM attribute_subjects subject
      CROSS JOIN attributes attribute
      WHERE subject.game_id = ?
        AND attribute.is_active = 1
        AND EXISTS (
          SELECT 1 FROM attribute_votable_subjects eligible
          WHERE eligible.subject_id = subject.id
        )
    `).all('external-only') as Array<{ detail: string }>).map((row) => row.detail).join('\n');
    expect(plan).toMatch(/SEARCH subject USING (?:COVERING )?INDEX idx_attribute_subjects_game/);
  } finally {
    sqlite.close();
  }
});

test('a normalized mapping for an already-primary BGG ID does not provision states again', () => {
  const sqlite = setup();
  try {
    insertGame(sqlite, 'primary-bgg', 999992);
    sqlite.prepare('DELETE FROM attribute_score_states WHERE subject_id = ?')
      .run('attribute_subject_game:primary-bgg');
    expect(stateCount(sqlite, 'primary-bgg')).toBe(0);

    sqlite.prepare(`
      INSERT INTO game_external_ids (id, game_id, source, external_id, relation, created_at)
      VALUES ('external:999992', 'primary-bgg', 'bgg', '999992', 'primary', 2)
    `).run();
    expect(stateCount(sqlite, 'primary-bgg')).toBe(0);
  } finally {
    sqlite.close();
  }
});
