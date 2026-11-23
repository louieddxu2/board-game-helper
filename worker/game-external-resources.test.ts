// @vitest-environment node
import { Hono } from 'hono';
import { expect, test } from 'vitest';
import { createHarness } from '../scripts/attributeReplayTestHarness';
import type { AppVariables } from './auth';
import type { RouteEnv } from './env';
import { gamesRoutes } from './routes/games';

const setup = () => {
  const h = createHarness();
  const game = h.sqlite.prepare(`SELECT id FROM games WHERE visibility = 'public' AND merged_into_game_id IS NULL LIMIT 1`).get() as { id: string };
  h.sqlite.exec(`INSERT INTO users(id, google_sub, email, email_normalized, created_at, last_login_at)
      VALUES('res-editor', 'sub-res-editor', 'res-editor@example.invalid', 'res-editor@example.invalid', 1, 1),
        ('res-other', 'sub-res-other', 'res-other@example.invalid', 'res-other@example.invalid', 1, 1);
    INSERT INTO game_external_resources(id, game_id, name, category, url, created_by, created_at, updated_at)
      VALUES('res-own', '${game.id}', '自己的教學', 'teaching', 'https://example.test/own', 'res-editor', 1, 1),
        ('res-others', '${game.id}', '別人的教學', 'teaching', 'https://example.test/others', 'res-other', 1, 1);`);
  const as = (user: { id: string; roles: Array<'admin' | 'editor'> }) => {
    const app = new Hono<{ Bindings: RouteEnv; Variables: AppVariables }>();
    app.use('*', async (c, next) => { c.set('database', h.gateway); c.set('user', user as never); await next(); });
    app.route('/', gamesRoutes);
    return (resourceId: string) => app.request(`/api/games/${game.id}/external-resources/${resourceId}`, { method: 'DELETE' });
  };
  const exists = (id: string) => Boolean(h.sqlite.prepare('SELECT 1 FROM game_external_resources WHERE id = ?').get(id));
  return { as, exists };
};

test('an editor deletes only the external resources they added', async () => {
  const { as, exists } = setup();
  const editor = as({ id: 'res-editor', roles: ['editor'] });
  const refused = await editor('res-others');
  expect(refused.status).toBe(403);
  expect(await refused.json()).toEqual({ error: 'external_resource_not_owned' });
  expect(exists('res-others')).toBe(true);
  expect((await editor('res-own')).status).toBe(200);
  expect(exists('res-own')).toBe(false);
  expect((await editor('res-missing')).status).toBe(404);
});

test('an admin deletes external resources anyone added', async () => {
  const { as, exists } = setup();
  expect((await as({ id: 'res-admin', roles: ['admin'] })('res-others')).status).toBe(200);
  expect(exists('res-others')).toBe(false);
});
