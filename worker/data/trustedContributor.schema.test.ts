// @vitest-environment node

import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeAll, describe, expect, test } from 'vitest';
import type { Database, DatabaseStatement } from './database';
import { trustContributorStatements } from './trustedContributor';

// Real schema and triggers: trusting a contributor clears the review line on their own work.
const sqlite = new DatabaseSync(':memory:');
const statement = (sql: string, params: unknown[] = []): DatabaseStatement => ({
  bind: (...values: unknown[]) => statement(sql, values),
  first: async () => (sqlite.prepare(sql).get(...(params as never[])) ?? null) as never,
  all: async () => ({ results: sqlite.prepare(sql).all(...(params as never[])), success: true, meta: {} }) as never,
  run: async () => {
    const result = sqlite.prepare(sql).run(...(params as never[]));
    return { results: [], success: true, meta: { changes: Number(result.changes) } } as never;
  },
});
const db: Database = {
  statement: (sql) => statement(sql),
  batch: async (items) => { const results = []; for (const item of items) results.push(await item.run()); return results; },
};
const rule = (id: string) => sqlite.prepare('SELECT review_status, pending_review_by, reviewed_by, reviewed_by_nickname, reviewed_at, updated_at FROM rules WHERE id = ?').get(id);
const game = (id: string) => sqlite.prepare('SELECT review_status, reviewed_by, reviewed_by_nickname FROM games WHERE id = ?').get(id);

beforeAll(() => {
  for (const file of readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(`migrations/${file}`, 'utf8'));
  }
  sqlite.exec(`
    INSERT INTO users (id, google_sub, email, email_normalized, created_at, last_login_at)
    VALUES ('u-new', 'sub-new', 'x', 'x-new', 1, 1), ('u-admin', 'sub-admin', 'y', 'y-admin', 1, 1),
      ('u-other', 'sub-other', 'z', 'z-other', 1, 1);
    -- Contributions start pending, as the triggers require, and are reviewed afterwards.
    INSERT INTO games (id, slug, display_name, normalized_name, created_by, created_at, updated_at, review_status)
    VALUES ('g-reviewed', 'g-reviewed', 'Reviewed', 'reviewed', 'u-new', 1, 1, 'pending'),
      ('g-other', 'g-other', 'Other', 'other', 'u-other', 1, 1, 'pending');
    UPDATE games SET review_status = 'reviewed', reviewed_by = 'u-admin', reviewed_by_nickname = 'Admin';
    INSERT INTO submissions (id, game_id, author_id) VALUES ('s1', 'g-reviewed', 'u-new'), ('s2', 'g-other', 'u-other');
    INSERT INTO rules (id, submission_id, game_id, statement, created_by, created_at, updated_at, review_status, pending_review_by)
    VALUES ('r-reviewed', 's1', 'g-reviewed', 'A', 'u-new', 1, 7, 'pending', 'u-new'),
      ('r-own-pending', 's1', 'g-reviewed', 'B', 'u-new', 1, 7, 'pending', 'u-new'),
      ('r-edited-by-other', 's1', 'g-reviewed', 'C', 'u-new', 1, 7, 'pending', 'u-new'),
      ('r-other', 's2', 'g-other', 'D', 'u-other', 1, 7, 'pending', 'u-other');
    UPDATE rules SET review_status = 'reviewed', pending_review_by = NULL, reviewed_by = 'u-admin', reviewed_by_nickname = 'Admin', reviewed_at = 5
      WHERE id IN ('r-reviewed', 'r-other');
    UPDATE rules SET pending_review_by = 'u-other' WHERE id = 'r-edited-by-other';
  `);
});

describe('trusting a contributor', () => {
  test('clears the review line on their rules and games, but not on others or edits awaiting review', async () => {
    await db.batch(trustContributorStatements(db, 'u-new'));

    expect(rule('r-reviewed')).toEqual({ review_status: 'not_required', pending_review_by: null, reviewed_by: null, reviewed_by_nickname: null, reviewed_at: null, updated_at: 7 });
    expect(rule('r-own-pending')).toMatchObject({ review_status: 'not_required', pending_review_by: null });
    expect(rule('r-edited-by-other')).toMatchObject({ review_status: 'pending', pending_review_by: 'u-other' });
    expect(rule('r-other')).toMatchObject({ review_status: 'reviewed', reviewed_by_nickname: 'Admin' });
    expect(game('g-reviewed')).toEqual({ review_status: 'not_required', reviewed_by: null, reviewed_by_nickname: null });
    expect(game('g-other')).toMatchObject({ review_status: 'reviewed' });
  });

  test('lets a general contributor keep six games waiting for review, but not a seventh', () => {
    const insert = (index: number) => sqlite.exec(`
      INSERT INTO games (id, slug, display_name, normalized_name, created_by, created_at, updated_at, review_status)
      VALUES ('g-quota-${index}', 'g-quota-${index}', 'Quota ${index}', 'quota${index}', 'u-other', 1, 1, 'pending')
    `);
    for (let index = 1; index <= 6; index += 1) insert(index);
    expect(() => insert(7)).toThrow('pending_game_limit');
  });
});
