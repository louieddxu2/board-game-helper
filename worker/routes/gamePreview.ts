import { Hono, type Handler } from 'hono';
import type { Env } from '../env';
import { createDatabase } from '../data/database';
import { queryPublicGamePreview } from '../data/gamePreview';
import { gamePreview, type PublicGamePreview } from '../../src/shared/gamePreview';
import { gamePreviewHtml } from '../gamePreviewHtml';

const routes = new Hono<{ Bindings: Env }>();

const renderGamePage: Handler<{ Bindings: Env }> = async c => {
  if (!c.env.ASSETS) return c.notFound();
  const shell = await c.env.ASSETS.fetch(new Request(new URL('/index.html', c.req.url), { headers: { Accept: 'text/html' } }));
  if (!shell.ok || !shell.headers.get('Content-Type')?.includes('text/html')) return shell;
  const origin = c.env.APP_ORIGIN ?? new URL(c.req.url).origin;
  const identifier = c.req.param('identifier') ?? '';
  const cache = (globalThis.caches as CacheStorage & { default?: Cache } | undefined)?.default;
  const cacheKey = new Request(new URL(`/__game-preview/v1/${encodeURIComponent(identifier)}`, origin));
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const lookup = async () => {
      const cached = await cache?.match(cacheKey).catch(() => undefined);
      if (cached) return cached.json() as Promise<PublicGamePreview>;
      const client = c.req.header('CF-Connecting-IP') ?? 'local';
      if (!(await c.env.PUBLIC_RATE_LIMITER.limit({ key: `preview:${client}` })).success) return null;
      const db = createDatabase(c.env);
      const preview = await queryPublicGamePreview(db, identifier);
      if (preview && cache) c.executionCtx.waitUntil(cache.put(cacheKey, Response.json(preview, {
        headers: { 'Cache-Control': 'public, max-age=300' },
      })).catch(() => undefined));
      return preview;
    };
    // Optional metadata must not hold up the application when D1 is unavailable.
    const preview = await Promise.race([lookup(), new Promise<null>(resolve => { timeout = setTimeout(() => resolve(null), 1500); })]);
    if (!preview) return shell;
    const html = gamePreviewHtml(await shell.clone().text(), gamePreview(preview, origin));
    const headers = new Headers(shell.headers);
    for (const name of ['Content-Length', 'Content-Encoding', 'ETag']) headers.delete(name);
    headers.set('Cache-Control', 'no-cache');
    return new Response(html, { status: shell.status, headers });
  } catch (caught) {
    console.warn('game_preview_unavailable', caught instanceof Error ? caught.message : 'unknown');
    return shell;
  } finally {
    clearTimeout(timeout);
  }
};

routes.get('/games/:identifier', renderGamePage);
routes.get('/games/:identifier/', renderGamePage);
export const gamePreviewRoutes = routes;
