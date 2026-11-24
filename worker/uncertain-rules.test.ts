// @vitest-environment node
import { Hono } from 'hono';
import { expect, test } from 'vitest';
import { createHarness } from '../scripts/attributeReplayTestHarness';
import type { AppVariables } from './auth';
import { deleteAccount } from './data/accountDeletion';
import { mergeGames } from './data/gameMerge';
import type { RouteEnv } from './env';
import { uncertainRulesRoutes } from './routes/uncertainRules';

type Role = 'admin' | 'editor';

const setup = () => {
  const h = createHarness();
  const [game, other] = h.sqlite.prepare(`SELECT id FROM games WHERE visibility = 'public' AND merged_into_game_id IS NULL LIMIT 2`).all() as Array<{ id: string }>;
  h.sqlite.exec(`INSERT INTO users(id, google_sub, email, email_normalized, created_at, last_login_at)
    VALUES('ur-admin', 'sub-ur-admin', 'ur-admin@example.invalid', 'ur-admin@example.invalid', 1, 1)`);
  const as = (user?: { id: string; roles: Role[] }) => {
    const app = new Hono<{ Bindings: RouteEnv; Variables: AppVariables }>();
    app.use('*', async (c, next) => { c.set('database', h.gateway); if (user) c.set('user', user as never); await next(); });
    app.route('/', uncertainRulesRoutes);
    const send = (url: string, method: string, body?: unknown) => app.request(url, {
      method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
    });
    // Creating goes to /api/uncertain-rules with the game id; reading and changing stay under the game.
    return (path: string, method = 'GET', body?: unknown) => method === 'POST'
      ? send('/api/uncertain-rules', method, path === 'new' ? body : { gameId: game.id, ...(body as object) })
      : send(`/api/games/${game.id}/uncertain-rules${path}`, method, body);
  };
  const admin = as({ id: 'ur-admin', roles: ['admin'] });
  return { h, game, other, as, admin };
};

test('only admins can read or write uncertain rules', async () => {
  const { h, as, admin } = setup();
  const editor = as({ id: 'ur-editor', roles: ['editor'] });
  expect((await as()('')).status).toBe(401);
  expect((await editor('')).status).toBe(403);
  expect((await editor('', 'POST', { question: '可以嗎？' })).status).toBe(403);
  expect((await editor('/any', 'PATCH', { checked: true })).status).toBe(403);
  expect((await editor('/any', 'DELETE')).status).toBe(403);
  expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM uncertain_rules').get()).toEqual({ n: 0 });
  expect((await admin('')).status).toBe(200);
});

test('an admin records a question, marks it looked up, and clears it again', async () => {
  const { game, admin } = setup();
  const created = await admin('', 'POST', { question: '  急速運輸能啟動同一張牌兩次嗎？ ', tableRuling: '先當作不行' });
  expect(created.status).toBe(201);
  const { uncertainRule } = await created.json() as { uncertainRule: { id: string; checkedAt: number | null } };
  expect(uncertainRule).toMatchObject({ gameId: game.id, question: '急速運輸能啟動同一張牌兩次嗎？', tableRuling: '先當作不行', checkedAt: null });

  const checked = await (await admin(`/${uncertainRule.id}`, 'PATCH', { checked: true })).json() as { uncertainRule: { checkedAt: number | null } };
  expect(checked.uncertainRule.checkedAt).toEqual(expect.any(Number));
  const cleared = await (await admin(`/${uncertainRule.id}`, 'PATCH', { checked: false, tableRuling: '' })).json() as { uncertainRule: Record<string, unknown> };
  expect(cleared.uncertainRule.checkedAt).toBeNull();
  expect(cleared.uncertainRule).not.toHaveProperty('tableRuling');

  const listed = await (await admin('')).json() as { uncertainRules: Array<{ id: string }> };
  expect(listed.uncertainRules.map((rule) => rule.id)).toEqual([uncertainRule.id]);
  expect((await admin(`/${uncertainRule.id}`, 'DELETE')).status).toBe(200);
  expect((await admin(`/${uncertainRule.id}`, 'DELETE')).status).toBe(404);
});

test('a question created as already looked up carries that date', async () => {
  const { admin } = setup();
  const created = await (await admin('', 'POST', { question: '平手怎麼算？', checked: true })).json() as { uncertainRule: { checkedAt: number | null } };
  expect(created.uncertainRule.checkedAt).toEqual(expect.any(Number));
});

test('invalid input and unknown targets are refused', async () => {
  const { admin, h, other } = setup();
  expect((await admin('', 'POST', { question: '   ' })).status).toBe(400);
  expect((await admin('/missing', 'PATCH', {})).status).toBe(400);
  expect((await admin('/missing', 'PATCH', { checked: true })).status).toBe(404);
  h.sqlite.prepare(`INSERT INTO uncertain_rules(id, game_id, question, created_by, created_at, updated_at) VALUES('ur-other', ?, '別款', 'ur-admin', 1, 1)`).run(other.id);
  // A question is reachable only under its own game.
  expect((await admin('/ur-other', 'PATCH', { checked: true })).status).toBe(404);
  expect((await admin('/ur-other', 'DELETE')).status).toBe(404);
});

test('merging games keeps the questions, and deleting the account removes them', async () => {
  const { h, game, other } = setup();
  h.sqlite.prepare(`INSERT INTO uncertain_rules(id, game_id, question, created_by, created_at, updated_at) VALUES('ur-1', ?, '問題', 'ur-admin', 1, 1)`).run(game.id);
  await mergeGames(h.gateway, game.id, other.id);
  expect(h.sqlite.prepare('SELECT game_id FROM uncertain_rules WHERE id = ?').get('ur-1')).toEqual({ game_id: other.id });
  await deleteAccount(h.gateway, 'ur-admin', false);
  expect(h.sqlite.prepare('SELECT COUNT(*) AS n FROM uncertain_rules').get()).toEqual({ n: 0 });
});

test('a question carries the same optional settings as a recorded rule', async () => {
  const { admin } = setup();
  const created = await (await admin('', 'POST', {
    question: '平手怎麼算？', details: '終局', categories: ['flow_endgame_scoring'], playerCounts: [4, 2, 2], editionNotes: ['二版'],
  })).json() as { uncertainRule: { id: string } };
  expect(created.uncertainRule).toMatchObject({ details: '終局', categories: ['flow_endgame_scoring'], playerCounts: [2, 4], editionNotes: ['二版'] });
  const cleared = await (await admin(`/${created.uncertainRule.id}`, 'PATCH', { playerCounts: [], details: '' })).json() as { uncertainRule: Record<string, unknown> };
  expect(cleared.uncertainRule).not.toHaveProperty('playerCounts');
  expect(cleared.uncertainRule).not.toHaveProperty('details');
  expect(cleared.uncertainRule).toMatchObject({ categories: ['flow_endgame_scoring'], editionNotes: ['二版'] });
  expect((await admin('', 'POST', { question: '?', categories: ['rule_errata'] })).status).toBe(400);
  expect((await admin('', 'POST', { question: '?', playerCounts: [9] })).status).toBe(400);
});

test('a new game name creates a rule-less public game once, and the same name reuses it', async () => {
  const { h, admin } = setup();
  // The database lets only a trusted editor create a game without review.
  h.sqlite.exec(`INSERT INTO user_roles(user_id, role, granted_by, granted_at, revoked_at) VALUES('ur-admin', 'admin', NULL, 1, NULL)`);
  const first = await admin('new', 'POST', { newGame: { displayName: '不確定測試遊戲', englishName: 'Uncertain Test Game' }, question: '可以嗎？' });
  expect(first.status).toBe(201);
  const created = await first.json() as { uncertainRule: { gameId: string }; gameSlug: string; gameCreated: boolean };
  expect(created).toMatchObject({ gameSlug: 'uncertain-test-game', gameCreated: true });
  expect(h.sqlite.prepare('SELECT visibility, published_rule_count FROM games WHERE id = ?').get(created.uncertainRule.gameId))
    .toEqual({ visibility: 'public', published_rule_count: 0 });
  const again = await (await admin('new', 'POST', { newGame: { displayName: '不確定測試遊戲' }, question: '那這樣呢？' })).json() as { uncertainRule: { gameId: string }; gameCreated: boolean };
  expect(again).toMatchObject({ gameCreated: false, uncertainRule: { gameId: created.uncertainRule.gameId } });
  expect(h.sqlite.prepare("SELECT COUNT(*) AS n FROM games WHERE display_name = '不確定測試遊戲'").get()).toEqual({ n: 1 });
});

test('creating needs exactly one of a game id or a new game name', async () => {
  const { admin, game } = setup();
  expect((await admin('new', 'POST', { question: '?' })).status).toBe(400);
  expect((await admin('new', 'POST', { gameId: game.id, newGame: { displayName: 'x' }, question: '?' })).status).toBe(400);
  expect((await admin('new', 'POST', { gameId: 'missing', question: '?' })).status).toBe(404);
});
