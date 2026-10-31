// @vitest-environment node
import { expect, test, vi } from 'vitest';
import { app } from './index';
import type { Env } from './env';

const games = [
  { id: 'g1', slug: '姬路城', displayName: '姬路城', ruleCount: 3, updatedAt: Date.UTC(2026, 9, 1), latestRuleUpdatedAt: Date.UTC(2026, 9, 20) },
  { id: 'g2', slug: 'empty', displayName: '空白', ruleCount: 0, publishedRuleCount: 0, updatedAt: 1 },
];

const createEnv = (limited = false) => {
  const prepare = vi.fn((sql: string) => {
    const rows = sql.includes('game_catalog_snapshot_state')
      ? [{ active_generation: 7, through_version: 12, chunk_count: 1, generated_at: 1 }]
      : [{ chunk_number: 0, games_json: JSON.stringify(games) }];
    const statement = { bind: () => statement, all: async () => ({ results: rows, meta: { rows_read: rows.length } }) };
    return statement;
  });
  const env = {
    DB: { prepare },
    PUBLIC_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: !limited }) },
  } as unknown as Env;
  return { env, prepare };
};

test('lists only games with published rules from the catalog snapshot', async () => {
  const { env, prepare } = createEnv();
  const response = await app.fetch(new Request('https://rules.example/sitemap.xml'), env);
  const body = await response.text();

  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toContain('application/xml');
  expect(body).toContain('<loc>https://rules.example/</loc>');
  expect(body).toContain('<loc>https://rules.example/games/%E5%A7%AC%E8%B7%AF%E5%9F%8E</loc><lastmod>2026-10-20</lastmod>');
  expect(body).not.toContain('/games/empty');
  expect(prepare).toHaveBeenCalledTimes(2);
});

test('rate-limits the sitemap before reading the database', async () => {
  const { env, prepare } = createEnv(true);
  const response = await app.fetch(new Request('https://rules.example/sitemap.xml'), env);

  expect(response.status).toBe(429);
  expect(prepare).not.toHaveBeenCalled();
});
