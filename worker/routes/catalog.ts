import { Hono } from 'hono';
import { requireRole, type AppVariables } from '../auth';
import type { RouteEnv } from '../env';
import { getDatabase } from '../data/database';
import { setNoCache, toGame, type GameRow } from './shared';

const catalogRoutes = new Hono<{ Bindings: RouteEnv; Variables: AppVariables }>();

catalogRoutes.get('/api/editor/catalog/games', requireRole('editor'), async (c) => {
  const result = await getDatabase(c).statement(`
    SELECT g.id, g.slug, g.display_name, g.english_name, g.updated_at,
      g.total_rule_count AS rule_count, g.published_rule_count,
      g.total_rule_count, g.latest_rule_updated_at
    FROM games g
    WHERE g.merged_into_game_id IS NULL
    ORDER BY LOWER(g.display_name), g.id
  `).all<GameRow>();
  setNoCache(c);
  return c.json({ games: (result.results ?? []).map(toGame) });
});

export { catalogRoutes };
