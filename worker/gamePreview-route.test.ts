// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest';
import { gamePreviewRoutes } from './routes/gamePreview';
import type { Env } from './env';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const setup = () => {
  let html = '<html><head><title>Site</title></head><body><script src="old.js"></script></body></html>';
  const all = vi.fn().mockResolvedValue({ results: [{ slug: 'shipyard', displayName: '船廠', statement: '公開規則' }] });
  const statement = { bind: vi.fn().mockReturnThis(), all, first: vi.fn(), run: vi.fn() };
  const fetchAsset = vi.fn(async () => new Response(html, { headers: { 'Content-Type': 'text/html', ETag: 'shell-only' } }));
  const prepare = vi.fn(() => statement);
  const env: Env = { DB: { prepare, batch: vi.fn() }, ASSETS: { fetch: fetchAsset }, PUBLIC_RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) }, WRITE_RATE_LIMITER: { limit: vi.fn() } };
  return { env, all, prepare, fetchAsset, changeShell: () => { html = html.replace('old.js', 'new.js'); } };
};

test('caches metadata rather than the application shell and never loads sessions', async () => {
  const { env, all, prepare, changeShell } = setup();
  const entries = new Map<string, Response>();
  vi.stubGlobal('caches', { default: {
    match: async (key: Request) => entries.get(key.url)?.clone(),
    put: async (key: Request, value: Response) => { entries.set(key.url, value.clone()); },
  } });
  const pending: Promise<unknown>[] = [];
  const context = { waitUntil: (promise: Promise<unknown>) => pending.push(promise), passThroughOnException: vi.fn(), props: {} };
  const request = () => new Request('https://rules.example/games/shipyard', { headers: { Cookie: 'wbr_session=ignored' } });
  const first = await gamePreviewRoutes.fetch(request(), env, context);
  expect(await first.text()).toContain('船廠｜玩錯的桌遊規則');
  await Promise.all(pending);
  changeShell();
  const second = await gamePreviewRoutes.fetch(request(), env, context);
  expect(await second.text()).toContain('new.js');
  expect(second.headers.has('ETag')).toBe(false);
  expect(all).toHaveBeenCalledOnce();
  expect(prepare).toHaveBeenCalledOnce();
  expect(env.PUBLIC_RATE_LIMITER.limit).toHaveBeenCalledOnce();
});

test('serves the usable shell without database access when preview requests are limited', async () => {
  const { env, prepare } = setup();
  vi.mocked(env.PUBLIC_RATE_LIMITER.limit).mockResolvedValue({ success: false });
  const response = await gamePreviewRoutes.fetch(new Request('https://rules.example/games/shipyard'), env);
  expect(await response.text()).toContain('old.js');
  expect(prepare).not.toHaveBeenCalled();
});

test('falls back to the usable application shell within 1.5 seconds if metadata stalls', async () => {
  vi.useFakeTimers();
  const { env, all } = setup();
  all.mockReturnValue(new Promise(() => undefined));
  const response = gamePreviewRoutes.fetch(new Request('https://rules.example/games/shipyard'), env);
  await vi.advanceTimersByTimeAsync(1500);
  expect(await (await response).text()).toContain('old.js');
  expect(all).toHaveBeenCalledOnce();
});
