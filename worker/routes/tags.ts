import { Hono } from 'hono';
import { z } from 'zod';
import { FLOW_STAGES, type FlowStage, type GameDetail, type GameSummary, type HomePayload, type HomeIDPayload, type ReviewBatch, type ReviewContent as SharedReviewContent, type ReviewProposal, type RuleCard, type UserRole } from '../../src/shared/types';
import { requireRole, type AppContext, type AppVariables, exchangeGoogleCredential, signInAsLocalAdmin, signInWithGoogle, signOut } from '../auth';
import type { Env, D1Result, D1PreparedStatement } from '../env';
import { assertMutationOrigin, cleanOptional, createId, normalizeEmail, normalizeText, now, sha256Hex, slugify, trustedOrigins } from '../utils';
import { normalizedReviewContent, REVIEW_FORMAT, REVIEW_SCHEMA_VERSION, reviewContentHash, reviewContentSchema, reviewFileSchema, sameReviewContent, type ReviewContent, type ReviewFile } from '../review';
import { parseReviewCsv, serializeReviewCsv } from '../review-csv';
import { setNoCache, ruleSelect, homeRuleSelect, toRule, cleanTagNames, tagWriteStatements, toGame, reviewContentFromRow, reviewRuleSelect , RuleRow, GameRow, ReviewRuleRow } from './shared';

const tagsRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

tagsRoutes.get('/api/search', async (c) => {
  const rawQuery = (c.req.query('q') ?? '').trim().slice(0, 100);
  if (!rawQuery) return c.json({ games: [], rules: [] });
  const query = normalizeText(rawQuery);
  const result = await c.env.DB.prepare(`
    SELECT g.id, g.slug, g.display_name, g.english_name, g.updated_at,
      GROUP_CONCAT(DISTINCT a.alias) AS aliases_str
    FROM games g LEFT JOIN game_aliases a ON a.game_id = g.id
    WHERE g.merged_into_game_id IS NULL AND (g.normalized_name LIKE ? OR LOWER(g.english_name) LIKE ? OR a.normalized_alias LIKE ?)
    GROUP BY g.id ORDER BY CASE WHEN g.normalized_name = ? THEN 0 ELSE 1 END, g.display_name LIMIT 8
  `).bind(`%${query}%`, `%${query}%`, `%${query}%`, query).all<GameRow>();
  setNoCache(c);
  return c.json({
    games: (result.results ?? []).map(toGame),
    rules: [],
  });
});

tagsRoutes.get('/api/tags', async (c) => {
  const requestedIds = Array.from(new Set((c.req.query('ids') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean))).slice(0, 100);
  if (requestedIds.length > 0) {
    const placeholders = requestedIds.map(() => '?').join(',');
    const result = await c.env.DB.prepare(`
      SELECT t.id, t.slug, t.name, t.is_public, t.updated_at
      FROM tags t
      WHERE t.id IN (${placeholders})
    `).bind(...requestedIds).all<{ id: string; slug: string; name: string; is_public: number; updated_at: number }>();
    c.header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    return c.json({
      tags: (result.results ?? []).map((tag) => ({
        id: tag.id,
        slug: tag.slug,
        name: tag.name,
        isPublic: Boolean(tag.is_public),
        updatedAt: tag.updated_at,
      })),
    });
  }

  const result = await c.env.DB.prepare(`
    SELECT t.id, t.slug, t.name, t.is_public, t.updated_at,
      GROUP_CONCAT(DISTINCT ta.alias) AS aliases_str
    FROM tags t
    LEFT JOIN tag_aliases ta ON ta.tag_id = t.id
    WHERE t.status = 'active' AND t.is_public = 1
    GROUP BY t.id
    ORDER BY t.name
  `).all<{ id: string; slug: string; name: string; is_public: number; updated_at: number; aliases_str: string | null }>();
  c.header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
  return c.json({
    tags: (result.results ?? []).map((tag) => ({
      id: tag.id,
      slug: tag.slug,
      name: tag.name,
      isPublic: Boolean(tag.is_public),
      updatedAt: tag.updated_at,
      aliases: tag.aliases_str ? tag.aliases_str.split(',') : [],
    })),
  });
});

const tagAdminSchema = z.object({
  name: z.string().min(1).max(40),
  description: z.string().max(200).optional().nullable(),
  isPublic: z.boolean().default(true),
  aliases: z.array(z.string()).optional(),
});

tagsRoutes.get('/api/admin/tags', requireRole('editor'), async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT t.id, t.slug, t.name, t.description, t.is_public, COUNT(DISTINCT rt.rule_id) AS usage_count
    FROM tags t
    LEFT JOIN rule_tags rt ON rt.tag_id = t.id
    WHERE t.status = 'active'
    GROUP BY t.id
    ORDER BY t.is_public DESC, usage_count DESC, t.name
  `).all<{ id: string; slug: string; name: string; description: string | null; is_public: number; usage_count: number }>();

  const aliasesResult = await c.env.DB.prepare(`SELECT tag_id, alias FROM tag_aliases ORDER BY alias`).all<{ tag_id: string; alias: string }>();
  const aliasMap = new Map<string, string[]>();
  (aliasesResult.results ?? []).forEach((row) => {
    const list = aliasMap.get(row.tag_id) ?? [];
    list.push(row.alias);
    aliasMap.set(row.tag_id, list);
  });

  return c.json({
    tags: (result.results ?? []).map((tag) => ({
      id: tag.id,
      slug: tag.slug,
      name: tag.name,
      description: tag.description ?? undefined,
      isPublic: Boolean(tag.is_public),
      usageCount: tag.usage_count,
      aliases: aliasMap.get(tag.id) ?? [],
    })),
  });
});

tagsRoutes.post('/api/admin/tags', requireRole('admin'), async (c) => {
  const parsed = tagAdminSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);

  const { name, description, isPublic, aliases } = parsed.data;
  const normalized = normalizeText(name);
  const existing = await c.env.DB.prepare(`
    SELECT id FROM tags WHERE status = 'active' AND normalized_name = ? LIMIT 1
  `).bind(normalized).first<{ id: string }>();

  const timestamp = Date.now();
  const userId = c.get('user')!.id;

  if (existing) {
    await c.env.DB.prepare(`
      UPDATE tags SET is_public = ?, description = COALESCE(?, description), updated_at = ? WHERE id = ?
    `).bind(isPublic ? 1 : 0, description || null, timestamp, existing.id).run();
    return c.json({ ok: true, tagId: existing.id });
  }

  const suffix = (await sha256Hex(normalized)).slice(0, 20);
  const tagId = `tag_${suffix}`;

  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(`
      INSERT INTO tags (id, slug, name, normalized_name, description, is_public, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(tagId, slugify(name), name, normalized, description || null, isPublic ? 1 : 0, userId, timestamp, timestamp),
  ];

  for (const alias of cleanTagNames(aliases)) {
    const normAlias = normalizeText(alias);
    const aliasSuffix = (await sha256Hex(normAlias)).slice(0, 20);
    statements.push(
      c.env.DB.prepare(`
        INSERT OR IGNORE INTO tag_aliases (id, tag_id, alias, normalized_alias, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(`ta_${aliasSuffix}`, tagId, alias, normAlias, timestamp)
    );
  }

  await c.env.DB.batch(statements);
  return c.json({ ok: true, tagId });
});

tagsRoutes.patch('/api/admin/tags/:id', requireRole('admin'), async (c) => {
  const tagId = c.req.param('id');
  const parsed = tagAdminSchema.partial().safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);

  const existing = await c.env.DB.prepare(`SELECT id FROM tags WHERE id = ? AND status = 'active'`).bind(tagId).first();
  if (!existing) return c.json({ error: 'tag_not_found' }, 404);

  const timestamp = Date.now();
  const updates: string[] = ['updated_at = ?'];
  const bindings: unknown[] = [timestamp];

  if (parsed.data.name !== undefined) {
    updates.push('name = ?', 'slug = ?', 'normalized_name = ?');
    bindings.push(parsed.data.name, slugify(parsed.data.name), normalizeText(parsed.data.name));
  }
  if (parsed.data.description !== undefined) {
    updates.push('description = ?');
    bindings.push(parsed.data.description || null);
  }
  if (parsed.data.isPublic !== undefined) {
    updates.push('is_public = ?');
    bindings.push(parsed.data.isPublic ? 1 : 0);
  }

  bindings.push(tagId);
  await c.env.DB.prepare(`UPDATE tags SET ${updates.join(', ')} WHERE id = ?`).bind(...bindings).run();

  if (parsed.data.aliases !== undefined) {
    await c.env.DB.prepare(`DELETE FROM tag_aliases WHERE tag_id = ?`).bind(tagId).run();
    const aliasStatements: D1PreparedStatement[] = [];
    for (const alias of cleanTagNames(parsed.data.aliases)) {
      const normAlias = normalizeText(alias);
      const aliasSuffix = (await sha256Hex(normAlias)).slice(0, 20);
      aliasStatements.push(
        c.env.DB.prepare(`
          INSERT OR IGNORE INTO tag_aliases (id, tag_id, alias, normalized_alias, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).bind(`ta_${aliasSuffix}`, tagId, alias, normAlias, timestamp)
      );
    }
    if (aliasStatements.length > 0) {
      await c.env.DB.batch(aliasStatements);
    }
  }

  return c.json({ ok: true });
});


export { tagsRoutes };
