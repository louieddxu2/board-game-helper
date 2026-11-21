// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// D1 row counts tell whoever reads them which requests cost the most, so only local configs may expose them.
const { app } = await import('../worker');
const { createHarness } = await import('./attributeReplayTestHarness');

const metricHeaders = (response: Response) => ['x-d1-rows-read', 'x-d1-rows-written']
  .filter(name => response.headers.has(name) || (response.headers.get('access-control-expose-headers') ?? '').toLowerCase().includes(name));

const request = (path: string, exposed: boolean) => {
  const h = createHarness();
  const env = { ...h.env, APP_ORIGIN: 'https://metrics.test', ...(exposed ? { EXPOSE_D1_METRICS: '1' } : {}),
    PUBLIC_RATE_LIMITER: { limit: async () => ({ success: true }) }, WRITE_RATE_LIMITER: { limit: async () => ({ success: true }) } };
  return app.request(`https://metrics.test${path}`, { headers: { origin: 'https://metrics.test' } }, env);
};

// Routes that set the counts in each way: the shared database total, logD1Query, and the home page.
const paths = ['/api/tags', '/api/game-catalog/changes?after=0', '/api/home', '/api/attributes/activities'];

test.each(paths)('%s carries no D1 row counts unless the config exposes them', async (path) => {
  const hidden = await request(path, false);
  expect(hidden.status).toBeLessThan(500);
  expect(metricHeaders(hidden)).toEqual([]);
  expect(await hidden.text()).not.toMatch(/debugD1Metrics|rows_read/);

  const shown = await request(path, true);
  expect(shown.headers.get('x-d1-rows-read')).toMatch(/^\d+$/);
});

const vars = (file: string) => {
  const text = readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '');
  return (JSON.parse(text) as { vars?: Record<string, string> }).vars ?? {};
};

test('only the local development and test configs expose D1 row counts', () => {
  expect(vars('wrangler.production.jsonc')).not.toHaveProperty('EXPOSE_D1_METRICS');
  expect(vars('wrangler.jsonc').EXPOSE_D1_METRICS).toBe('1');
  expect(vars('wrangler.core-test.jsonc').EXPOSE_D1_METRICS).toBe('1');
});
