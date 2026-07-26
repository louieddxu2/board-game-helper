import { Hono } from 'hono';
import type { GameDetail } from '../../src/shared/types';
import { requireRole, type AppVariables } from '../auth';
import type { RouteEnv } from '../env';
import { getDatabase } from '../data/database';
import { setNoCache, ruleSelect, toGame, toRule, type GameRow, type RuleRow } from './shared';

const catalogRoutes = new Hono<{ Bindings: RouteEnv; Variables: AppVariables }>();

catalogRoutes.get('/api/editor/catalog/games', requireRole('editor'), async (c) => {
  const result = await getDatabase(c).statement(`
    SELECT g.id, g.slug, g.display_name, g.english_name, g.updated_at,
      COUNT(r.id) AS rule_count
    FROM games g
    LEFT JOIN rules r ON r.game_id = g.id
    WHERE g.merged_into_game_id IS NULL
    GROUP BY g.id
    ORDER BY LOWER(g.display_name), g.id
  `).all<GameRow>();
  setNoCache(c);
  return c.json({ games: (result.results ?? []).map(toGame) });
});

catalogRoutes.get('/api/editor/catalog/games/:identifier', requireRole('editor'), async (c) => {
  const identifier = c.req.param('identifier');
  const game = await getDatabase(c).statement(`
    SELECT g.id, g.slug, g.display_name, g.english_name, g.updated_at,
      0 AS rule_count
    FROM games g
    WHERE (g.id = ? OR g.slug = ?) AND g.merged_into_game_id IS NULL
    LIMIT 1
  `).bind(identifier, identifier).first<GameRow>();
  if (!game) return c.json({ error: 'game_not_found' }, 404);

  const [aliasesResult, rulesResult] = await Promise.all([
    getDatabase(c).statement('SELECT alias FROM game_aliases WHERE game_id = ? ORDER BY alias')
      .bind(game.id).all<{ alias: string }>(),
    getDatabase(c).statement(`${ruleSelect}
      WHERE r.game_id = ?
      ORDER BY r.updated_at DESC, r.id DESC
      `).bind(game.id).all<RuleRow>(),
  ]);
  const ruleRows = rulesResult.results ?? [];
  const detail: GameDetail = {
    ...toGame(game),
    ruleCount: ruleRows.length,
    aliases: (aliasesResult.results ?? []).map((row) => row.alias),
    rules: ruleRows.map((row) => toRule(row)),
  };
  setNoCache(c);
  return c.json({ game: detail });
});

export { catalogRoutes };
