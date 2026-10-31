import { Hono } from 'hono';
import type { RouteEnv } from '../env';
import type { AppVariables } from '../auth';
import { getDatabase } from '../data/database';
import { gameCatalogPayload, queryGameCatalogSnapshot } from '../data/gameCatalog';

const sitemapRoutes = new Hono<{ Bindings: RouteEnv; Variables: AppVariables }>();

const escapeXml = (value: string) => value.replace(/[<>&'"]/g, (char) => `&#${char.charCodeAt(0)};`);
const isoDate = (timestamp?: number) => (timestamp && Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : undefined);

// Lists only games with published rules, read from the weekly catalog snapshot (state + a few chunk rows).
sitemapRoutes.get('/sitemap.xml', async (c) => {
  const client = c.req.header('CF-Connecting-IP') ?? 'local';
  const { success } = await c.env.PUBLIC_RATE_LIMITER.limit({ key: `read:${client}` });
  if (!success) {
    c.header('Retry-After', '60');
    return c.text('rate_limited', 429);
  }
  const origin = new URL(c.req.url).origin;
  const { games } = gameCatalogPayload(await queryGameCatalogSnapshot(getDatabase(c)));
  const urls = [`<url><loc>${origin}/</loc></url>`, ...games.map((game) => {
    const lastmod = isoDate(Math.max(game.latestRuleUpdatedAt ?? 0, game.updatedAt ?? 0));
    return `<url><loc>${escapeXml(`${origin}/games/${encodeURIComponent(game.slug)}`)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`;
  })];
  c.header('Content-Type', 'application/xml; charset=utf-8');
  c.header('Cache-Control', 'public, max-age=86400');
  return c.body(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
});

export { sitemapRoutes };
