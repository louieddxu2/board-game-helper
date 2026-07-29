import { Hono } from 'hono';
import { z } from 'zod';
import { FLOW_STAGES, RULE_CATEGORIES, type FlowStage, type GameDetail, type GameSummary, type HomePayload, type HomeIDPayload, type ReviewBatch, type ReviewContent as SharedReviewContent, type ReviewProposal, type RuleCard, type UserRole } from '../../src/shared/types';
import { requireRole, type AppContext, type AppVariables, exchangeGoogleCredential, signInAsLocalAdmin, signInWithGoogle, signOut } from '../auth';
import type { RouteEnv } from '../env';
import { getDatabase, type DatabaseStatement } from '../data/database';
import { assertMutationOrigin, cleanOptional, createId, normalizeEmail, normalizeText, now, sha256Hex, slugify, trustedOrigins } from '../utils';
import { normalizedReviewContent, REVIEW_FORMAT, REVIEW_SCHEMA_VERSION, reviewContentHash, reviewContentSchema, reviewFileSchema, sameReviewContent, type ReviewContent, type ReviewFile } from '../review';
import { parseReviewCsv, serializeReviewCsv } from '../review-csv';
import { setNoCache, ruleSelect, homeRuleSelect, toRule, cleanDetectionKeywords, cleanRuleCategories, cleanTagNames, tagWriteStatements, toGame, reviewContentFromRow, reviewRuleSelect , RuleRow, GameRow, ReviewRuleRow } from './shared';
import { gameCatalogPayload, queryGameCatalogSnapshot } from '../data/gameCatalog';
import { filterGameCatalog } from '../../src/lib/gameCatalog';
import { logD1Query } from './shared';
import { publicTagCatalogChangesPayload, queryPublicTagCatalogChanges } from '../data/tagCatalog';

const tagsRoutes = new Hono<{ Bindings: RouteEnv; Variables: AppVariables }>();

tagsRoutes.get('/api/search', async (c) => {
  const rawQuery = (c.req.query('q') ?? '').trim().slice(0, 100);
  if (!rawQuery) return c.json({ games: [], rules: [] });
  const snapshot = await queryGameCatalogSnapshot(getDatabase(c));
  logD1Query(c, 'game_catalog_snapshot_state', snapshot.state);
  logD1Query(c, 'game_catalog_snapshot_chunks', snapshot.chunks);
  setNoCache(c);
  return c.json({
    games: filterGameCatalog(gameCatalogPayload(snapshot).games, rawQuery, 8),
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
    const result = await getDatabase(c).statement(`
      SELECT t.id, t.slug, t.name, t.is_public, t.updated_at, t.category_hints_json, t.detection_keywords_json
      FROM tags t
      WHERE t.id IN (${placeholders})
    `).bind(...requestedIds).all<{ id: string; slug: string; name: string; is_public: number; updated_at: number; category_hints_json: string | null; detection_keywords_json: string | null }>();
    c.header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    return c.json({
      tags: (result.results ?? []).map((tag) => ({
        id: tag.id,
        slug: tag.slug,
        name: tag.name,
        isPublic: Boolean(tag.is_public),
        updatedAt: tag.updated_at,
        categoryHints: (() => { try { return cleanRuleCategories(JSON.parse(tag.category_hints_json ?? '[]')); } catch { return []; } })(),
        detectionKeywords: (() => { try { return cleanDetectionKeywords(JSON.parse(tag.detection_keywords_json ?? '[]')); } catch { return []; } })(),
      })),
    });
  }

  const result = logD1Query(c, 'public_tag_catalog_bootstrap', await queryPublicTagCatalogChanges(getDatabase(c), 0));
  const payload = publicTagCatalogChangesPayload(result, 0);
  setNoCache(c);
  return c.json({
    tags: payload.changes.flatMap((change) => change.deleted || !change.tag ? [] : [change.tag]),
    throughVersion: payload.throughVersion,
  });
});

tagsRoutes.get('/api/tags/changes', async (c) => {
  const rawAfter = c.req.query('after') ?? '0';
  const after = Number(rawAfter);
  if (!Number.isSafeInteger(after) || after < 0) return c.json({ error: 'invalid_catalog_version' }, 400);
  const result = logD1Query(c, 'public_tag_catalog_changes', await queryPublicTagCatalogChanges(getDatabase(c), after));
  setNoCache(c);
  return c.json(publicTagCatalogChangesPayload(result, after));
});

const tagAdminSchema = z.object({
  name: z.string().min(1).max(40),
  description: z.string().max(200).optional().nullable(),
  isPublic: z.boolean().default(true),
  aliases: z.array(z.string()).optional(),
  categoryHints: z.array(z.enum(RULE_CATEGORIES)).max(RULE_CATEGORIES.length).optional(),
  detectionKeywords: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
});

tagsRoutes.get('/api/admin/tags', requireRole('editor'), async (c) => {
    const result = await getDatabase(c).statement(`
    SELECT t.id, t.slug, t.name, t.description, t.is_public, t.category_hints_json, t.detection_keywords_json, COUNT(DISTINCT rt.rule_id) AS usage_count
    FROM tags t
    LEFT JOIN rule_tags rt ON rt.tag_id = t.id
    WHERE t.status = 'active'
    GROUP BY t.id
    ORDER BY t.is_public DESC, usage_count DESC, t.name
  `).all<{ id: string; slug: string; name: string; description: string | null; is_public: number; category_hints_json: string | null; detection_keywords_json: string | null; usage_count: number }>();

  const aliasesResult = await getDatabase(c).statement(`SELECT tag_id, alias FROM tag_aliases ORDER BY alias`).all<{ tag_id: string; alias: string }>();
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
      categoryHints: (() => { try { return cleanRuleCategories(JSON.parse(tag.category_hints_json ?? '[]')); } catch { return []; } })(),
      detectionKeywords: (() => { try { return cleanDetectionKeywords(JSON.parse(tag.detection_keywords_json ?? '[]')); } catch { return []; } })(),
    })),
  });
});

tagsRoutes.post('/api/admin/tags', requireRole('admin'), async (c) => {
  const parsed = tagAdminSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);

  const { name, description, isPublic, aliases, categoryHints, detectionKeywords } = parsed.data;
  const normalized = normalizeText(name);
  const existing = await getDatabase(c).statement(`
    SELECT id FROM tags WHERE status = 'active' AND normalized_name = ? LIMIT 1
  `).bind(normalized).first<{ id: string }>();

  const timestamp = Date.now();
  const userId = c.get('user')!.id;

  if (existing) {
    await getDatabase(c).statement(`
      UPDATE tags SET is_public = ?, description = COALESCE(?, description),
        category_hints_json = COALESCE(?, category_hints_json),
        detection_keywords_json = COALESCE(?, detection_keywords_json), updated_at = ? WHERE id = ?
    `).bind(isPublic ? 1 : 0, description || null,
      categoryHints === undefined ? null : JSON.stringify(cleanRuleCategories(categoryHints)),
      detectionKeywords === undefined ? null : JSON.stringify(cleanDetectionKeywords(detectionKeywords)), timestamp, existing.id).run();
    return c.json({ ok: true, tagId: existing.id });
  }

  const suffix = (await sha256Hex(normalized)).slice(0, 20);
  const tagId = `tag_${suffix}`;

  const statements: DatabaseStatement[] = [
    getDatabase(c).statement(`
      INSERT INTO tags (id, slug, name, normalized_name, description, is_public, category_hints_json, detection_keywords_json, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(tagId, slugify(name), name, normalized, description || null, isPublic ? 1 : 0,
      JSON.stringify(cleanRuleCategories(categoryHints)), JSON.stringify(cleanDetectionKeywords(detectionKeywords)), userId, timestamp, timestamp),
  ];

  for (const alias of cleanTagNames(aliases)) {
    const normAlias = normalizeText(alias);
    const aliasSuffix = (await sha256Hex(normAlias)).slice(0, 20);
    statements.push(
      getDatabase(c).statement(`
        INSERT OR IGNORE INTO tag_aliases (id, tag_id, alias, normalized_alias, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(`ta_${aliasSuffix}`, tagId, alias, normAlias, timestamp)
    );
  }

  await getDatabase(c).batch(statements);
  return c.json({ ok: true, tagId });
});

tagsRoutes.patch('/api/admin/tags/:id', requireRole('admin'), async (c) => {
  const tagId = c.req.param('id');
  const parsed = tagAdminSchema.partial().safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid_input' }, 400);

  const existing = await getDatabase(c).statement(`SELECT id FROM tags WHERE id = ? AND status = 'active'`).bind(tagId).first();
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
  if (parsed.data.categoryHints !== undefined) {
    updates.push('category_hints_json = ?');
    bindings.push(JSON.stringify(cleanRuleCategories(parsed.data.categoryHints)));
  }
  if (parsed.data.detectionKeywords !== undefined) {
    updates.push('detection_keywords_json = ?');
    bindings.push(JSON.stringify(cleanDetectionKeywords(parsed.data.detectionKeywords)));
  }

  bindings.push(tagId);
  await getDatabase(c).statement(`UPDATE tags SET ${updates.join(', ')} WHERE id = ?`).bind(...bindings).run();

  if (parsed.data.aliases !== undefined) {
    await getDatabase(c).statement(`DELETE FROM tag_aliases WHERE tag_id = ?`).bind(tagId).run();
    const aliasStatements: DatabaseStatement[] = [];
    for (const alias of cleanTagNames(parsed.data.aliases)) {
      const normAlias = normalizeText(alias);
      const aliasSuffix = (await sha256Hex(normAlias)).slice(0, 20);
      aliasStatements.push(
        getDatabase(c).statement(`
          INSERT OR IGNORE INTO tag_aliases (id, tag_id, alias, normalized_alias, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).bind(`ta_${aliasSuffix}`, tagId, alias, normAlias, timestamp)
      );
    }
    if (aliasStatements.length > 0) {
      await getDatabase(c).batch(aliasStatements);
    }
  }

  return c.json({ ok: true });
});

const mergeTagSchema = z.object({ targetTagId: z.string().min(1).max(100) });

tagsRoutes.post('/api/admin/tags/:id/merge', requireRole('admin'), async (c) => {
  const sourceTagId = c.req.param('id');
  const parsed = mergeTagSchema.safeParse(await c.req.json());
  if (!parsed.success || parsed.data.targetTagId === sourceTagId) return c.json({ error: 'invalid_input' }, 400);
  const targetTagId = parsed.data.targetTagId;
  const rows = await getDatabase(c).statement(`
    SELECT id, name, normalized_name FROM tags
    WHERE id IN (?, ?) AND status = 'active'
  `).bind(sourceTagId, targetTagId).all<{ id: string; name: string; normalized_name: string }>();
  const source = rows.results?.find((tag) => tag.id === sourceTagId);
  const target = rows.results?.find((tag) => tag.id === targetTagId);
  if (!source || !target) return c.json({ error: 'tag_not_found' }, 404);

  const timestamp = Date.now();
  const aliasSuffix = (await sha256Hex(source.normalized_name)).slice(0, 20);
  await getDatabase(c).batch([
    getDatabase(c).statement(`
      INSERT OR IGNORE INTO rule_tags (rule_id, tag_id, created_by, created_at)
      SELECT rule_id, ?, created_by, created_at FROM rule_tags WHERE tag_id = ?
    `).bind(targetTagId, sourceTagId),
    getDatabase(c).statement(`
      UPDATE rules SET tag_ids_json = COALESCE((
        SELECT json_group_array(tag_id) FROM rule_tags
        WHERE rule_id = rules.id AND tag_id <> ?
      ), '[]')
      WHERE id IN (SELECT rule_id FROM rule_tags WHERE tag_id = ?)
    `).bind(sourceTagId, sourceTagId),
    getDatabase(c).statement('DELETE FROM rule_tags WHERE tag_id = ?').bind(sourceTagId),
    getDatabase(c).statement('UPDATE tag_aliases SET tag_id = ? WHERE tag_id = ?').bind(targetTagId, sourceTagId),
    getDatabase(c).statement(`
      INSERT OR IGNORE INTO tag_aliases (id, tag_id, alias, normalized_alias, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(`ta_${aliasSuffix}`, targetTagId, source.name, source.normalized_name, timestamp),
    getDatabase(c).statement(`
      UPDATE tags SET status = 'merged', merged_into_tag_id = ?, is_public = 0, updated_at = ? WHERE id = ?
    `).bind(targetTagId, timestamp, sourceTagId),
    getDatabase(c).statement('UPDATE tags SET updated_at = ? WHERE id = ?').bind(timestamp, targetTagId),
  ]);
  return c.json({ ok: true, sourceTagId, targetTagId });
});


export { tagsRoutes };
