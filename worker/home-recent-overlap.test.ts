import { expect, test, vi } from 'vitest';
import { homeRoutes } from './routes/home';

vi.mock('./data/database', () => ({
  getDatabase: () => ({
    statement: (sql: string) => {
      const result = sql.includes('game_daily_view_counts') ? [{ game_id: 'game-1' }]
        : sql.includes('SELECT r.id FROM rules') ? [{ id: 'rule-1' }]
        : sql.includes('FROM games g') ? [{ id: 'game-1', slug: 'game-one', display_name: '遊戲', updated_at: 1, published_rule_count: 1 }]
        : sql.includes("WHERE game_id = ? AND status = 'published'") ? [{ id: 'rule-1' }, { id: 'rule-2' }]
        : (() => { throw new Error(`Unexpected query: ${sql}`); })();
      const statement = { result, bind: () => statement, all: async () => ({ results: result }) };
      return statement;
    },
    batch: async (statements: Array<{ result: unknown[] }>) => statements.map((statement) => ({ results: statement.result })),
  }),
}));

test('keeps a viewed game when its only featured rule is also recent', async () => {
  const response = await homeRoutes.request('https://example.test/api/home');
  expect(response.status).toBe(200);
  const body = await response.json() as { recentRuleIds: string[]; featured: Array<{ ruleId: string; gameSlug: string; moreRuleIds: string[] }> };
  expect(body.recentRuleIds).toEqual(['rule-1']);
  // The game's next newest rule rides along for the phone's rule window.
  expect(body.featured).toEqual([expect.objectContaining({ ruleId: 'rule-1', gameSlug: 'game-one', moreRuleIds: ['rule-2'] })]);
});
