import { expect, test, vi } from 'vitest';
import { homeRoutes } from './routes/home';

vi.mock('./data/database', () => ({
  getDatabase: () => ({
    statement: (sql: string) => {
      const result = sql.includes('game_daily_view_counts') ? [{ game_id: 'game-1' }]
        : sql.includes('SELECT r.id FROM rules') ? [{ id: 'rule-1' }]
        : sql.includes('FROM games g') ? [{ id: 'game-1', slug: 'game-one', display_name: '遊戲', updated_at: 1, published_rule_count: 1 }]
        : sql.includes('game_public_rule_heads') ? [{ game_id: 'game-1', rule_id: 'rule-1' }]
        : (() => { throw new Error(`Unexpected query: ${sql}`); })();
      const statement = { bind: () => statement, all: async () => ({ results: result }) };
      return statement;
    },
  }),
}));

test('keeps a viewed game when its only featured rule is also recent', async () => {
  const response = await homeRoutes.request('https://example.test/api/home');
  expect(response.status).toBe(200);
  const body = await response.json() as { recentRuleIds: string[]; featured: Array<{ ruleId: string; gameSlug: string }> };
  expect(body.recentRuleIds).toEqual(['rule-1']);
  expect(body.featured).toEqual([expect.objectContaining({ ruleId: 'rule-1', gameSlug: 'game-one' })]);
});
