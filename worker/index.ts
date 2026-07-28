import { Hono } from 'hono';
import { sessionMiddleware } from './auth';
import type { Env } from './env';
import { assertMutationOrigin, trustedOrigins } from './utils';
import { createDatabase } from './data/database';
import { rebuildGameCatalog } from './data/gameCatalog';

import { authRoutes } from './routes/auth';
import { homeRoutes } from './routes/home';
import { rulesRoutes } from './routes/rules';
import { gamesRoutes } from './routes/games';
import { tagsRoutes } from './routes/tags';
import adminRoutes from './routes/admin';
import { submissionsRoutes } from './routes/submissions';
import reviewRoutes from './routes/review';
import { catalogRoutes } from './routes/catalog';

const app = new Hono<{ Bindings: Env; Variables: any }>();

app.use('/api/*', async (c, next) => {
  c.set('database', createDatabase(c.env));
  await next();
});

const isPublicCacheableRequest = (method: string, path: string) => method === 'GET' && (
  ['/api/home', '/api/search', '/api/tags', '/api/game-catalog', '/api/games/search', '/api/games/resolve', '/api/export/public'].includes(path)
  || /^\/api\/games\/[^/]+$/.test(path)
);

app.use('/api/*', async (c, next) => {
  const origin = c.req.header('Origin')?.replace(/\/$/, '');
  const isTrusted = origin ? trustedOrigins(c.env, c.req.url).has(origin) : false;
  if (c.req.method === 'OPTIONS') {
    const path = new URL(c.req.url).pathname;
    const publicRead = c.req.header('Access-Control-Request-Method') === 'GET'
      && isPublicCacheableRequest('GET', path);
    if (!origin || (!isTrusted && !publicRead)) return c.json({ error: 'forbidden_origin' }, 403);
    c.header('Access-Control-Allow-Origin', publicRead ? '*' : origin);
    c.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, If-None-Match');
    c.header('Access-Control-Max-Age', '86400');
    c.header('Vary', 'Origin');
    c.header('Cache-Control', 'public, max-age=86400');
    return c.body(null, 204);
  }
  await next();
  const path = new URL(c.req.url).pathname;
  if (isPublicCacheableRequest(c.req.method, path)) {
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Access-Control-Expose-Headers', 'ETag, X-API-Version, X-D1-Rows-Read');
  } else if (origin && isTrusted) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Expose-Headers', 'ETag, X-API-Version, X-D1-Rows-Read');
    c.header('Vary', 'Origin');
  }
});

app.use('/api/*', async (c, next) => {
  const isRead = ['GET', 'HEAD'].includes(c.req.method);
  const limiter = isRead ? c.env.PUBLIC_RATE_LIMITER : c.env.WRITE_RATE_LIMITER;
  const client = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? 'local';
  const scope = isRead ? 'read' : 'write';
  const { success } = await limiter.limit({ key: `${scope}:${client}` });
  if (!success) {
    c.header('Retry-After', '60');
    c.header('Cache-Control', 'no-store');
    return c.json({ error: 'rate_limited' }, 429);
  }
  await next();
});

app.use('/api/*', sessionMiddleware);

app.use('/api/*', async (c, next) => {
  await next();
  const metrics = c.get('d1Metrics');
  if (metrics && c.res) {
    const headers = new Headers(c.res.headers);
    headers.set('X-D1-Rows-Read', String(metrics.totalRowsRead));
    headers.set('X-Robots-Tag', 'noindex, nofollow');
    headers.set('X-API-Version', '1');
    c.res = new Response(c.res.body, {
      status: c.res.status,
      statusText: c.res.statusText,
      headers,
    });
  } else if (c.res) {
    c.header('X-Robots-Tag', 'noindex, nofollow');
    c.header('X-API-Version', '1');
  }
  const path = new URL(c.req.url).pathname;
  if (!isPublicCacheableRequest(c.req.method, path)) {
    c.header('Cache-Control', 'no-store');
  }
});

app.onError((error, c) => {
  console.error('api_error', error);
  const message = error instanceof Error ? error.message : '';
  const safeCodes = new Set([
    'google_auth_not_configured', 'invalid_google_identity', 'google_identity_conflict', 'not_found',
    'session_creation_failed', 'game_not_found', 'rule_not_found',
    'unknown_tag', 'tag_not_found',
  ]);
  return c.json({ error: safeCodes.has(message) ? message : 'internal_error' }, 500);
});

app.use('/api/*', async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && !assertMutationOrigin(c)) {
    return c.json({ error: 'forbidden_origin' }, 403);
  }
  await next();
});

app.route('/', authRoutes);
app.route('/', homeRoutes);
app.route('/', rulesRoutes);
app.route('/', gamesRoutes);
app.route('/', tagsRoutes);
app.route('/', adminRoutes);
app.route('/', submissionsRoutes);
app.route('/', reviewRoutes);
app.route('/', catalogRoutes);

const scheduled = async (controller: { scheduledTime: number }, env: Env) => {
  await rebuildGameCatalog(createDatabase(env), controller.scheduledTime);
};

export { app, scheduled };
export default Object.assign(app, { scheduled });
