import { describe, expect, test, vi } from 'vitest';
import type { Database, DatabaseStatement } from './data/database';
import { queryAttributeSubjects } from './data/attributes';

const statement = (result: unknown): DatabaseStatement => ({
  bind: vi.fn(function (this: DatabaseStatement) { return this; }),
  first: vi.fn(),
  all: vi.fn().mockResolvedValue({ results: result }),
  run: vi.fn(),
});

describe('attribute voting game names', () => {
  test('keeps an English primary name and exposes the first Chinese alias as the secondary label', async () => {
    const subjectQuery = statement([{
      id: 'attribute_subject_game:carson-city',
      slug: 'carson-city',
      kind: 'game',
      display_name: 'Carson City',
      game_id: 'game-carson-city',
      game_slug: 'carson-city',
      secondary_name: '卡森市',
      bgg_ids_json: '[]',
    }]);
    const componentQuery = statement([]);
    const db = {
      statement: vi.fn((sql: string) => sql.includes('FROM attribute_subjects s') ? subjectQuery : componentQuery),
    } as unknown as Database;

    const subjects = await queryAttributeSubjects(db, ['attribute_subject_game:carson-city']);

    expect(subjects[0]).toMatchObject({
      displayName: 'Carson City',
      secondaryName: '卡森市',
    });
    expect(db.statement).toHaveBeenCalledWith(expect.stringContaining('FROM game_aliases'));
    expect(db.statement).toHaveBeenCalledWith(expect.stringContaining('ORDER BY alias, id'));
  });
});
