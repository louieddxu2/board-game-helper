import { Hono } from 'hono';
import { z } from 'zod';
import { FLOW_STAGES, RULE_CATEGORIES, type FlowStage, type GameDetail, type GameSummary, type HomePayload, type HomeIDPayload, type ReviewBatch, type ReviewContent as SharedReviewContent, type ReviewProposal, type RuleCard, type UserRole } from '../../src/shared/types';
import { requireRole, requireUser, type AppContext, type AppVariables, exchangeGoogleCredential, signInAsLocalAdmin, signInWithGoogle, signOut } from '../auth';
import type { RouteEnv } from '../env';
import { getDatabase, type DatabaseStatement } from '../data/database';
import { assertMutationOrigin, cleanOptional, createId, normalizeEmail, normalizeText, now, sha256Hex, slugify, trustedOrigins } from '../utils';
import { normalizedReviewContent, REVIEW_FORMAT, REVIEW_SCHEMA_VERSION, reviewContentHash, reviewContentSchema, reviewFileSchema, sameReviewContent, type ReviewContent, type ReviewFile } from '../review';
import { parseReviewCsv, serializeReviewCsv } from '../review-csv';
import { setNoCache, ruleSelect, homeRuleSelect, toRule, cleanTagNames, cleanEditionNotes, cleanRuleCategories, parseEditionNotes, tagWriteStatements, toGame, resolvePublicNicknames, reviewContentFromRow, reviewRuleSelect , RuleRow, GameRow, ReviewRuleRow } from './shared';
import { queryUserRuleImportance, setRuleImportance } from '../data/ruleImportance';

const rulesRoutes = new Hono<{ Bindings: RouteEnv; Variables: AppVariables }>();

rulesRoutes.get('/api/rules/:id', async (c) => {
  const id = c.req.param('id');
  const row = await getDatabase(c).statement(`
    SELECT r.id, r.game_id, g.display_name game_name, g.slug game_slug,
      r.statement, r.common_mistake, r.details, r.flow_stage, r.categories_json,
      r.player_counts_json, r.edition_notes_json, r.edition_note, r.status, r.created_by, r.created_at, r.updated_at, r.editor_ids_json, r.importance_count,
      r.tag_ids_json, r.source_label, r.source_url
    FROM rules r
    JOIN games g ON g.id = r.game_id
    WHERE r.id = ? AND r.status = 'published'
    LIMIT 1
  `).bind(id).first<RuleRow & { game_name: string; game_slug: string }>();

  if (!row) return c.json({ error: 'rule_not_found' }, 404);
  const nicknameMap = await resolvePublicNicknames(getDatabase(c), [row]);
  setNoCache(c);
  return c.json({ rule: { ...toRule(row, undefined, nicknameMap), gameName: row.game_name, gameSlug: row.game_slug } });
});

const rulePatchSchema = z.object({
  statement: z.string().trim().min(1).max(2000).optional(),
  commonMistake: z.string().trim().max(2000).nullable().optional(),
  details: z.string().trim().max(5000).nullable().optional(),
  flowStage: z.enum(FLOW_STAGES).optional(),
  categories: z.array(z.enum(RULE_CATEGORIES)).max(RULE_CATEGORIES.length).optional(),
  playerCounts: z.array(z.number().int().min(1).max(8)).max(8).nullable().optional(),
  editionNotes: z.array(z.string().trim().min(1).max(300)).max(20).nullable().optional(),
  editionNote: z.string().trim().max(300).nullable().optional(),
  reason: z.string().trim().max(300).optional(),
  tagNames: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
  tagIds: z.array(z.string().trim().min(1).max(100)).max(8).optional(),
  newTagNames: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
  sourceLabel: z.string().trim().max(300).nullable().optional(),
  sourceUrl: z.url().max(2000).nullable().optional().or(z.literal('')),
}).refine((value) => (value.tagIds?.length ?? 0) + (value.newTagNames?.length ?? value.tagNames?.length ?? 0) <= 8, {
  message: '最多只能選擇 8 個標籤',
});

rulesRoutes.get('/api/games/:gameId/rule-importance', requireUser, async (c) => {
  setNoCache(c);
  return c.json(await queryUserRuleImportance(getDatabase(c), c.get('user')!.id, c.req.param('gameId')));
});

const ruleImportanceSchema = z.object({ important: z.boolean() });

rulesRoutes.put('/api/rules/:id/importance', requireUser, async (c) => {
  const user = c.get('user')!;
  const accountLimit = await c.env.WRITE_RATE_LIMITER.limit({ key: `rule-importance:${user.id}` });
  if (!accountLimit.success) {
    c.header('Retry-After', '60');
    return c.json({ error: 'rate_limited' }, 429);
  }
  const parsed = ruleImportanceSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid_importance' }, 400);
  const result = await setRuleImportance(
    getDatabase(c), user.id, c.req.param('id'), parsed.data.important, now(),
  );
  if (!result) return c.json({ error: 'rule_not_found' }, 404);
  setNoCache(c);
  return c.json(result);
});

rulesRoutes.patch('/api/rules/:id', requireRole('editor'), async (c) => {
  const parsed = rulePatchSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid_rule', issues: parsed.error.issues }, 400);
  const row = await getDatabase(c).statement('SELECT r.* FROM rules r WHERE r.id = ?')
    .bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!row) return c.json({ error: 'rule_not_found' }, 404);
  const user = c.get('user')!;
  const isAdmin = user.roles.includes('admin');
  if (!isAdmin && row.created_by !== user.id) {
    return c.json({ error: 'forbidden' }, 403);
  }
  const existingTags = await getDatabase(c).statement(`SELECT t.name FROM rule_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.rule_id = ? ORDER BY t.name`)
    .bind(c.req.param('id')).all<{ name: string }>();
  const timestamp = now();
  const requestedTagNames = parsed.data.newTagNames ?? parsed.data.tagNames;
  const requestedTagIds = parsed.data.tagIds ?? [];
  const currentTagIds = (() => {
    try { return JSON.parse(String(row.tag_ids_json ?? '[]')) as string[]; }
    catch { return []; }
  })();
  const tagsRequested = requestedTagNames !== undefined || parsed.data.tagIds !== undefined;
  const tagIdsUnchanged = requestedTagNames?.length === 0
    && requestedTagIds.length === currentTagIds.length
    && requestedTagIds.every((id) => currentTagIds.includes(id));
  const currentEditionNotes = parseEditionNotes({
    edition_notes_json: typeof row.edition_notes_json === 'string' ? row.edition_notes_json : '[]',
    edition_note: typeof row.edition_note === 'string' ? row.edition_note : null,
  });
  const editionNotes = parsed.data.editionNotes !== undefined
    ? cleanEditionNotes(parsed.data.editionNotes ?? [])
    : parsed.data.editionNote !== undefined
      ? cleanEditionNotes(parsed.data.editionNote ? [parsed.data.editionNote] : [])
      : currentEditionNotes;
  const updated = {
    statement: parsed.data.statement ?? row.statement,
    commonMistake: parsed.data.commonMistake === undefined ? row.common_mistake : parsed.data.commonMistake,
    details: parsed.data.details === undefined ? row.details : parsed.data.details,
    flowStage: parsed.data.flowStage ?? row.flow_stage,
    categories: parsed.data.categories === undefined
      ? (() => { try { return cleanRuleCategories(JSON.parse(String(row.categories_json ?? '[]'))); } catch { return []; } })()
      : cleanRuleCategories(parsed.data.categories),
    playerCounts: parsed.data.playerCounts === undefined ? JSON.parse(String(row.player_counts_json ?? '[]')) as number[] : (parsed.data.playerCounts ?? []),
    editionNotes,
    sourceLabel: parsed.data.sourceLabel === undefined ? row.source_label : parsed.data.sourceLabel,
    sourceUrl: parsed.data.sourceUrl === undefined ? row.source_url : (parsed.data.sourceUrl || null),
  };
  await getDatabase(c).batch([
    getDatabase(c).statement(`
      INSERT INTO rule_revisions (id, rule_id, previous_json, edited_by, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(createId('rev'), c.req.param('id'), JSON.stringify({ ...row, tag_names: (existingTags.results ?? []).map((tag) => tag.name) }), user.id, parsed.data.reason ?? 'edit', timestamp),
    getDatabase(c).statement(`
      UPDATE rules SET statement = ?, common_mistake = ?, details = ?, flow_stage = ?, categories_json = ?,
        player_counts_json = ?, edition_notes_json = ?, edition_note = ?, source_label = ?, source_url = ?,
        updated_at = ? WHERE id = ?
    `).bind(
      updated.statement, updated.commonMistake, updated.details, updated.flowStage,
      JSON.stringify(updated.categories),
      JSON.stringify(Array.from(new Set(updated.playerCounts)).sort((a, b) => a - b)),
      JSON.stringify(updated.editionNotes), updated.editionNotes[0] ?? null, updated.sourceLabel, updated.sourceUrl,
      timestamp, c.req.param('id'),
    ),
    ...(!tagsRequested || tagIdsUnchanged ? [] : await tagWriteStatements(
      c, c.req.param('id'), requestedTagNames ?? [], user.id, timestamp, true, requestedTagIds,
    )),
    getDatabase(c).statement('UPDATE games SET updated_at = ? WHERE id = ?').bind(timestamp, row.game_id as string),
  ]);
  const cache = (caches as any).default;
  const gameSlug = await getDatabase(c).statement('SELECT g.slug FROM games g JOIN rules r ON r.game_id = g.id WHERE r.id = ?').bind(c.req.param('id')).first<{ slug: string }>();
  if (gameSlug) {
    c.executionCtx.waitUntil(Promise.all([
      cache.delete(new Request(new URL(`/api/games/${gameSlug.slug}`, c.req.url))),
      cache.delete(new Request(new URL('/api/home', c.req.url))),
    ]));
  }
  return c.json({ ok: true, updatedAt: timestamp });
});

const changeRuleVisibility = async (c: AppContext, status: 'hidden' | 'published') => {
  const id = c.req.param('id');
  const row = await getDatabase(c).statement('SELECT * FROM rules WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!row) return c.json({ error: 'rule_not_found' }, 404);
  const user = c.get('user')!;
  const isAdmin = user.roles.includes('admin');
  if (!isAdmin && row.created_by !== user.id) {
    return c.json({ error: 'forbidden' }, 403);
  }
  const timestamp = now();
  await getDatabase(c).batch([
    getDatabase(c).statement(`
      INSERT INTO rule_revisions (id, rule_id, previous_json, edited_by, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(createId('rev'), id, JSON.stringify(row), user.id, status === 'hidden' ? 'hide' : 'restore', timestamp),
    getDatabase(c).statement('UPDATE rules SET status = ?, hidden_at = ?, hidden_by = ?, updated_at = ? WHERE id = ?')
      .bind(status, status === 'hidden' ? timestamp : null, status === 'hidden' ? user.id : null, timestamp, id),
    getDatabase(c).statement('UPDATE games SET updated_at = ? WHERE id = ?').bind(timestamp, row.game_id as string),
  ]);
  const cache = (caches as any).default;
  const gameSlug = await getDatabase(c).statement('SELECT g.slug FROM games g JOIN rules r ON r.game_id = g.id WHERE r.id = ?').bind(id).first<{ slug: string }>();
  if (gameSlug) {
    c.executionCtx.waitUntil(Promise.all([
      cache.delete(new Request(new URL(`/api/games/${gameSlug.slug}`, c.req.url))),
      cache.delete(new Request(new URL('/api/home', c.req.url))),
    ]));
  }
  return c.json({ ok: true });
};

rulesRoutes.post('/api/rules/:id/hide', requireRole('editor'), (c) => changeRuleVisibility(c, 'hidden'));
rulesRoutes.post('/api/rules/:id/restore', requireRole('editor'), (c) => changeRuleVisibility(c, 'published'));

rulesRoutes.get('/api/rules/:id/revisions', requireRole('editor'), async (c) => {
  const revisions = await getDatabase(c).statement(`
    SELECT r.id, r.reason, r.created_at, r.previous_json, u.masked_email editor_email
    FROM rule_revisions r
    LEFT JOIN users u ON u.id = r.edited_by
    WHERE r.rule_id = ?
    ORDER BY r.created_at DESC
  `).bind(c.req.param('id')).all<{ id: string; reason: string; created_at: number; previous_json: string; editor_email: string | null }>();

  return c.json({
    revisions: (revisions.results ?? []).map((row) => {
      let previousStatement = '';
      try { previousStatement = (JSON.parse(row.previous_json) as { statement?: string }).statement ?? ''; } catch { /* ignore */ }
      return { id: row.id, reason: row.reason, createdAt: row.created_at, editorEmail: row.editor_email ?? undefined, previousStatement };
    }),
  });
});

rulesRoutes.post('/api/rules/:id/revisions/:revisionId/restore', requireRole('editor'), async (c) => {
  const revision = await getDatabase(c).statement(`
    SELECT * FROM rule_revisions WHERE id = ? AND rule_id = ?
  `).bind(c.req.param('revisionId'), c.req.param('id')).first<{ previous_json: string }>();
  if (!revision) return c.json({ error: 'revision_not_found' }, 404);
  const current = await getDatabase(c).statement('SELECT * FROM rules WHERE id = ?').bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!current) return c.json({ error: 'rule_not_found' }, 404);
  const user = c.get('user')!;
  const isAdmin = user.roles.includes('admin');
  if (!isAdmin && current.created_by !== user.id) {
    return c.json({ error: 'forbidden' }, 403);
  }
  let previous: Record<string, unknown>;
  try { previous = JSON.parse(revision.previous_json) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_revision' }, 409); }
  const restoredTagNames = Array.isArray(previous.tag_names) ? previous.tag_names.filter((name): name is string => typeof name === 'string') : undefined;
  const timestamp = now();
  await getDatabase(c).batch([
    getDatabase(c).statement(`INSERT INTO rule_revisions (id, rule_id, previous_json, edited_by, reason, created_at) VALUES (?, ?, ?, ?, 'restore_revision', ?)`)
      .bind(createId('rev'), c.req.param('id'), JSON.stringify(current), user.id, timestamp),
    getDatabase(c).statement(`
      UPDATE rules SET statement = ?, common_mistake = ?, details = ?, flow_stage = ?, categories_json = ?, player_counts_json = ?,
        edition_notes_json = ?, edition_note = ?, status = ?, hidden_at = ?, hidden_by = ?, updated_at = ? WHERE id = ?
    `).bind(
      previous.statement, previous.common_mistake ?? null, previous.details ?? null, previous.flow_stage,
      previous.categories_json ?? JSON.stringify(cleanRuleCategories(previous.categories)),
      previous.player_counts_json ?? '[]',
      previous.edition_notes_json ?? JSON.stringify(cleanEditionNotes(typeof previous.edition_note === 'string' ? [previous.edition_note] : [])),
      previous.edition_note ?? null, previous.status ?? 'published',
      previous.hidden_at ?? null,
      previous.hidden_by ?? null, timestamp, c.req.param('id'),
    ),
    ...(restoredTagNames ? await tagWriteStatements(c, c.req.param('id'), restoredTagNames, user.id, timestamp) : []),
  ]);
  return c.json({ ok: true });
});

rulesRoutes.get('/api/admin/hidden-rules', requireRole('editor'), async (c) => {
  const result = await getDatabase(c).statement(`${ruleSelect}
    WHERE r.status = 'hidden' ORDER BY r.updated_at DESC LIMIT 100
  `).all<RuleRow>();
  const rows = result.results ?? [];
  const nicknameMap = await resolvePublicNicknames(getDatabase(c), rows);
  return c.json({ rules: rows.map((row) => toRule(row, undefined, nicknameMap)) });
});

export { rulesRoutes };
