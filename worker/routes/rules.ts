import { Hono } from 'hono';
import { z } from 'zod';
import { FLOW_STAGES, type FlowStage, type GameDetail, type GameSummary, type HomePayload, type HomeIDPayload, type ReviewBatch, type ReviewContent as SharedReviewContent, type ReviewProposal, type RuleCard, type UserRole } from '../../src/shared/types';
import { requireRole, type AppContext, type AppVariables, exchangeGoogleCredential, signInAsLocalAdmin, signInWithGoogle, signOut } from '../auth';
import type { Env, D1Result, D1PreparedStatement } from '../env';
import { assertMutationOrigin, cleanOptional, createId, normalizeEmail, normalizeText, now, sha256Hex, slugify, trustedOrigins } from '../utils';
import { normalizedReviewContent, REVIEW_FORMAT, REVIEW_SCHEMA_VERSION, reviewContentHash, reviewContentSchema, reviewFileSchema, sameReviewContent, type ReviewContent, type ReviewFile } from '../review';
import { parseReviewCsv, serializeReviewCsv } from '../review-csv';
import { setNoCache, ruleSelect, homeRuleSelect, resolveRuleTags, toRule, cleanTagNames, tagWriteStatements, toGame, reviewContentFromRow, reviewRuleSelect , RuleRow, GameRow, ReviewRuleRow } from './shared';

const rulesRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

rulesRoutes.get('/api/rules/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(`
    SELECT r.id, r.game_id, g.display_name game_name, g.slug game_slug,
      r.statement, r.common_mistake, r.details, r.flow_stage,
      r.player_count_note, r.edition_note, r.status, r.created_by, r.created_at, r.updated_at,
      r.tag_ids_json,
      s.source_label, s.source_url,
      (SELECT COALESCE(json_group_array(json_object('label', ss.label, 'url', ss.url)), '[]')
        FROM submission_sources ss WHERE ss.submission_id = s.id ORDER BY ss.position) AS sources_json
    FROM rules r
    JOIN games g ON g.id = r.game_id
    JOIN submissions s ON s.id = r.submission_id
    WHERE r.id = ? AND r.status = 'published'
    LIMIT 1
  `).bind(id).first<RuleRow & { game_name: string; game_slug: string }>();

  if (!row) return c.json({ error: 'rule_not_found' }, 404);
  const tagMap = await resolveRuleTags(c.env.DB, [row]);
  setNoCache(c);
  return c.json({ rule: { ...toRule(row, tagMap), gameName: row.game_name, gameSlug: row.game_slug } });
});

const rulePatchSchema = z.object({
  statement: z.string().trim().min(1).max(2000).optional(),
  commonMistake: z.string().trim().max(2000).nullable().optional(),
  details: z.string().trim().max(5000).nullable().optional(),
  flowStage: z.enum(FLOW_STAGES).optional(),
  playerCountNote: z.string().trim().max(300).nullable().optional(),
  editionNote: z.string().trim().max(300).nullable().optional(),
  reason: z.string().trim().max(300).optional(),
  tagNames: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
  sourceLabel: z.string().trim().max(300).nullable().optional(),
  sourceUrl: z.url().max(2000).nullable().optional().or(z.literal('')),
});

rulesRoutes.patch('/api/rules/:id', requireRole('editor'), async (c) => {
  const parsed = rulePatchSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid_rule', issues: parsed.error.issues }, 400);
  const row = await c.env.DB.prepare(`SELECT r.*, s.source_label, s.source_url FROM rules r JOIN submissions s ON s.id = r.submission_id WHERE r.id = ?`)
    .bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!row) return c.json({ error: 'rule_not_found' }, 404);
  const user = c.get('user')!;
  const isAdmin = user.roles.includes('admin');
  if (!isAdmin && row.created_by !== user.id) {
    return c.json({ error: 'forbidden' }, 403);
  }
  const existingTags = await c.env.DB.prepare(`SELECT t.name FROM rule_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.rule_id = ? ORDER BY t.name`)
    .bind(c.req.param('id')).all<{ name: string }>();
  const timestamp = now();
  const updated = {
    statement: parsed.data.statement ?? row.statement,
    commonMistake: parsed.data.commonMistake === undefined ? row.common_mistake : parsed.data.commonMistake,
    details: parsed.data.details === undefined ? row.details : parsed.data.details,
    flowStage: parsed.data.flowStage ?? row.flow_stage,
    playerCountNote: parsed.data.playerCountNote === undefined ? row.player_count_note : parsed.data.playerCountNote,
    editionNote: parsed.data.editionNote === undefined ? row.edition_note : parsed.data.editionNote,
  };
  await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO rule_revisions (id, rule_id, previous_json, edited_by, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(createId('rev'), c.req.param('id'), JSON.stringify({ ...row, tag_names: (existingTags.results ?? []).map((tag) => tag.name) }), user.id, parsed.data.reason ?? 'edit', timestamp),
    c.env.DB.prepare(`
      UPDATE rules SET statement = ?, common_mistake = ?, details = ?, flow_stage = ?,
        player_count_note = ?, edition_note = ?,
        updated_at = ? WHERE id = ?
    `).bind(
      updated.statement, updated.commonMistake, updated.details, updated.flowStage,
      updated.playerCountNote, updated.editionNote,
      timestamp, c.req.param('id'),
    ),
    ...(parsed.data.sourceLabel === undefined && parsed.data.sourceUrl === undefined ? [] : [c.env.DB.prepare(`
      UPDATE submissions SET source_label = ?, source_url = ? WHERE id = ?
    `).bind(
      parsed.data.sourceLabel === undefined ? row.source_label : parsed.data.sourceLabel,
      parsed.data.sourceUrl === undefined ? row.source_url : (parsed.data.sourceUrl || null),
      row.submission_id,
    ), c.env.DB.prepare('DELETE FROM submission_sources WHERE submission_id = ?').bind(row.submission_id),
    ...(parsed.data.sourceUrl ? [c.env.DB.prepare(`INSERT INTO submission_sources (id, submission_id, label, url, position, created_at) VALUES (?, ?, ?, ?, 0, ?)`)
      .bind(createId('source'), row.submission_id, parsed.data.sourceLabel === undefined ? row.source_label : parsed.data.sourceLabel, parsed.data.sourceUrl, timestamp)] : [])]),
    ...(parsed.data.tagNames === undefined ? [] : await tagWriteStatements(c, c.req.param('id'), parsed.data.tagNames, user.id, timestamp)),
    c.env.DB.prepare('UPDATE games SET updated_at = ? WHERE id = ?').bind(timestamp, row.game_id as string),
  ]);
  const cache = (caches as any).default;
  const gameSlug = await c.env.DB.prepare('SELECT g.slug FROM games g JOIN rules r ON r.game_id = g.id WHERE r.id = ?').bind(c.req.param('id')).first<{ slug: string }>();
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
  const row = await c.env.DB.prepare('SELECT * FROM rules WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!row) return c.json({ error: 'rule_not_found' }, 404);
  const user = c.get('user')!;
  const isAdmin = user.roles.includes('admin');
  if (!isAdmin && row.created_by !== user.id) {
    return c.json({ error: 'forbidden' }, 403);
  }
  const timestamp = now();
  await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO rule_revisions (id, rule_id, previous_json, edited_by, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(createId('rev'), id, JSON.stringify(row), user.id, status === 'hidden' ? 'hide' : 'restore', timestamp),
    c.env.DB.prepare(`
      UPDATE rules SET status = ?, hidden_at = ?, hidden_by = ?, updated_at = ? WHERE id = ?
    `).bind(status, status === 'hidden' ? timestamp : null, status === 'hidden' ? user.id : null, timestamp, id),
  ]);
  const cache = (caches as any).default;
  const gameSlug = await c.env.DB.prepare('SELECT g.slug FROM games g JOIN rules r ON r.game_id = g.id WHERE r.id = ?').bind(id).first<{ slug: string }>();
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
  const result = await c.env.DB.prepare(`
    SELECT rr.id, rr.previous_json, rr.reason, rr.created_at, u.email editor_email, r.created_by
    FROM rule_revisions rr
    JOIN rules r ON r.id = rr.rule_id
    LEFT JOIN users u ON u.id = rr.edited_by
    WHERE rr.rule_id = ? ORDER BY rr.created_at DESC LIMIT 30
  `).bind(c.req.param('id')).all<{ id: string; previous_json: string; reason: string | null; created_at: number; editor_email: string | null; created_by: string | null }>();
  const user = c.get('user')!;
  const isAdmin = user.roles.includes('admin');
  const firstRow = (result.results ?? [])[0];
  if (!isAdmin && firstRow && firstRow.created_by !== user.id) {
    return c.json({ error: 'forbidden' }, 403);
  }
  return c.json({ revisions: (result.results ?? []).map((row) => {
    let previousStatement = '先前版本';
    try { previousStatement = String((JSON.parse(row.previous_json) as Record<string, unknown>).statement ?? previousStatement); } catch { /* retain fallback */ }
    return { id: row.id, reason: row.reason ?? 'edit', createdAt: row.created_at, editorEmail: row.editor_email ?? undefined, previousStatement };
  }) });
});

rulesRoutes.post('/api/rules/:id/revisions/:revisionId/restore', requireRole('editor'), async (c) => {
  const [current, revision] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM rules WHERE id = ?').bind(c.req.param('id')).first<Record<string, unknown>>(),
    c.env.DB.prepare('SELECT previous_json FROM rule_revisions WHERE id = ? AND rule_id = ?')
      .bind(c.req.param('revisionId'), c.req.param('id')).first<{ previous_json: string }>(),
  ]);
  if (!current || !revision) return c.json({ error: 'revision_not_found' }, 404);
  const user = c.get('user')!;
  const isAdmin = user.roles.includes('admin');
  if (!isAdmin && current.created_by !== user.id) {
    return c.json({ error: 'forbidden' }, 403);
  }
  let previous: Record<string, unknown>;
  try { previous = JSON.parse(revision.previous_json) as Record<string, unknown>; } catch { return c.json({ error: 'invalid_revision' }, 409); }
  const restoredTagNames = Array.isArray(previous.tag_names) ? previous.tag_names.filter((name): name is string => typeof name === 'string') : undefined;
  const timestamp = now();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO rule_revisions (id, rule_id, previous_json, edited_by, reason, created_at) VALUES (?, ?, ?, ?, 'restore_revision', ?)`)
      .bind(createId('rev'), c.req.param('id'), JSON.stringify(current), user.id, timestamp),
    c.env.DB.prepare(`
      UPDATE rules SET statement = ?, common_mistake = ?, details = ?, flow_stage = ?, player_count_note = ?,
        edition_note = ?, status = ?, hidden_at = ?, hidden_by = ?, updated_at = ? WHERE id = ?
    `).bind(
      previous.statement, previous.common_mistake ?? null, previous.details ?? null, previous.flow_stage,
      previous.player_count_note ?? null, previous.edition_note ?? null, previous.status ?? 'published',
      previous.hidden_at ?? null,
      previous.hidden_by ?? null, timestamp, c.req.param('id'),
    ),
    ...(restoredTagNames ? await tagWriteStatements(c, c.req.param('id'), restoredTagNames, user.id, timestamp) : []),
  ]);
  return c.json({ ok: true });
});

rulesRoutes.get('/api/admin/hidden-rules', requireRole('editor'), async (c) => {
  const result = await c.env.DB.prepare(`${ruleSelect}
    WHERE r.status = 'hidden' ORDER BY r.updated_at DESC LIMIT 100
  `).all<RuleRow>();
  return c.json({ rules: (result.results ?? []).map((row) => toRule(row)) });
});

export { rulesRoutes };
