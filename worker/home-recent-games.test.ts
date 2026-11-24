// @vitest-environment node
import { expect, test } from 'vitest';
import { createHarness } from '../scripts/attributeReplayTestHarness';
import { HOME_RECENT_GAMES, queryHomeRecentGames } from './data/homeRecentGames';

const track = <T,>(_name: string, result: T) => result;

test('the home page lists each game once with the rules it published on its newest Taiwan day', async () => {
  const h = createHarness();
  const [busy, other] = (h.sqlite.prepare(`SELECT id FROM games WHERE visibility = 'public' AND merged_into_game_id IS NULL
    ORDER BY id LIMIT 2`).all() as Array<{ id: string }>).map((game) => game.id);
  h.sqlite.exec(`INSERT INTO users(id, google_sub, email, email_normalized, created_at, last_login_at)
      VALUES('recent-editor', 'sub-recent-editor', 'recent-editor@example.invalid', 'recent-editor@example.invalid', 1, 1);
    INSERT INTO user_roles (user_id, role, granted_at) VALUES ('recent-editor', 'editor', 1);`);
  const addRule = (id: string, gameId: string, at: number, status = 'published') => {
    h.sqlite.prepare(`INSERT INTO submissions (id, game_id) VALUES (?, ?)`).run(`sub-${id}`, gameId);
    h.sqlite.prepare(`INSERT INTO rules (id, submission_id, game_id, statement, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'recent-editor', ?, ?)`).run(id, `sub-${id}`, gameId, id, status, at, at);
  };
  // 11/19 16:00 and 00:30 in Taiwan count together; 11/18 23:30 in Taiwan is the day before.
  addRule('b1', busy, Date.UTC(2026, 10, 19, 8, 0));
  addRule('b2', busy, Date.UTC(2026, 10, 18, 16, 30));
  addRule('b3', busy, Date.UTC(2026, 10, 18, 15, 30));
  addRule('b-hidden', busy, Date.UTC(2026, 10, 19, 9, 0), 'hidden');
  addRule('o1', other, Date.UTC(2026, 10, 20, 1, 0));
  addRule('o0', other, Date.UTC(2026, 9, 1, 1, 0));
  const [b1, o1] = ['b1', 'o1'];

  h.executedSql.length = 0;
  const recent = await queryHomeRecentGames(h.gateway, track);
  expect(recent).toEqual([
    { ruleId: o1, addedOn: '2026-11-20', addedCount: 1 },
    { ruleId: b1, addedOn: '2026-11-19', addedCount: 2 },
  ]);
  expect(recent.length).toBeLessThanOrEqual(HOME_RECENT_GAMES);
  const ruleGames = recent.map(({ ruleId }) => (h.sqlite.prepare('SELECT game_id FROM rules WHERE id = ?').get(ruleId) as { game_id: string }).game_id);
  expect(new Set(ruleGames).size).toBe(recent.length);

  // Both queries reach the rules through their indexes.
  const plans = h.executedSql.flatMap((sql) => (h.sqlite.prepare('EXPLAIN QUERY PLAN ' + sql).all(...(sql.includes('?') ? [busy, 0] : [])) as Array<{ detail: unknown }>)
    .map((row) => String(row.detail)));
  expect(plans.filter((detail) => /^SCAN /.test(detail) && !/USING (COVERING )?INDEX/.test(detail))).toEqual([]);
});

test('the home page shows no recent games when nothing is published', async () => {
  const h = createHarness();
  expect(await queryHomeRecentGames(h.gateway, track)).toEqual([]);
});
