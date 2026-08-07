import { Hono } from 'hono';
import { z } from 'zod';
import { FLOW_STAGES, RULE_CATEGORIES } from '../../src/shared/types';
import { requireRole, requireUser, type AppContext, type AppVariables, exchangeGoogleCredential, signInAsLocalAdmin, signInWithGoogle, signOut } from '../auth';
import type { RouteEnv } from '../env';
import { getDatabase } from '../data/database';
import { assertMutationOrigin, cleanOptional, createId, normalizeEmail, normalizeText, now, sha256Hex, slugify, trustedOrigins } from '../utils';
import { parseReviewCsv, serializeReviewCsv } from '../review-csv';
import { setNoCache, ruleSelect, homeRuleSelect, toRule, cleanTagNames, cleanEditionNotes, cleanRuleCategories, parseEditionNotes, tagWriteStatements, toGame, resolvePublicNicknames, resolveRuleTags, reviewContentFromRow, reviewRuleSelect , RuleRow, GameRow, ReviewRuleRow } from './shared';
import { queryUserRuleImportance, setRuleImportance } from '../data/ruleImportance';
import { canEditContributionRule, canRestoreHiddenContributionRule, contributionErrorCode, queryContributionQuota } from '../contributions';
import { isSafeExternalUrl } from '../../src/shared/externalUrl';

const rulesRoutes = new Hono<{ Bindings: RouteEnv; Variables: AppVariables }>();

rulesRoutes.get('/api/rules/:id', async (c) => {
  const id = c.req.param('id');
  const row = await getDatabase(c).statement(`
    SELECT r.id, r.game_id, g.display_name game_name, g.slug game_slug,
      r.statement, r.common_mistake, r.details, r.flow_stage, r.categories_json,
      r.player_counts_json, r.edition_notes_json, r.edition_note, r.status, r.created_by, r.created_at, r.updated_at, r.editor_ids_json, r.importance_count,
      r.tag_ids_json, r.source_label, r.source_url, r.review_status, r.reviewed_by, r.reviewed_by_nickname, r.reviewed_at
    FROM rules r
    JOIN games g ON g.id = r.game_id
    WHERE r.id = ? AND r.status = 'published' AND g.visibility = 'public'
    LIMIT 1
  `).bind(id).first<RuleRow & { game_name: string; game_slug: string }>();

  if (!row) return c.json({ error: 'rule_not_found' }, 404);
  const nicknameMap = await resolvePublicNicknames(getDatabase(c), [row]);
  setNoCache(c);
  return c.json({ rule: { ...toRule(row, undefined, nicknameMap), gameName: row.game_name, gameSlug: row.game_slug } });
});

export const rulePatchSchema = z.object({
  baseUpdatedAt: z.number().int().nonnegative().optional(),
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
  sourceUrl: z.url().max(2000).refine(isSafeExternalUrl, 'source_url_must_be_https').nullable().optional().or(z.literal('')),
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

rulesRoutes.patch('/api/rules/:id', requireUser, async (c) => {
  const parsed = rulePatchSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid_rule', issues: parsed.error.issues }, 400);
  const row = await getDatabase(c).statement('SELECT r.* FROM rules r WHERE r.id = ?')
    .bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!row) return c.json({ error: 'rule_not_found' }, 404);
  const user = c.get('user')!;
  if (parsed.data.baseUpdatedAt !== undefined && Number(row.updated_at) !== parsed.data.baseUpdatedAt) {
    return c.json({ error: 'rule_changed_while_editing', currentUpdatedAt: Number(row.updated_at) }, 409);
  }
  const canEditDirectly = canEditContributionRule(row as {
    created_by: string | null;
    pending_review_by?: string | null;
    review_status: 'not_required' | 'pending' | 'reviewed';
    status: string;
  }, user);
  const needsReviewAfterEdit = !canEditDirectly
    && !user.roles.some((role) => role === 'editor' || role === 'admin')
    && row.created_by === user.id
    && row.status === 'published'
    && row.review_status !== 'pending';
  if (!canEditDirectly && !needsReviewAfterEdit) {
    return c.json({ error: 'forbidden' }, 403);
  }
  if (needsReviewAfterEdit) {
    const quota = await queryContributionQuota(getDatabase(c), user.id);
    if (quota.remainingRules < 1) return c.json({ error: 'PENDING_RULE_LIMIT_REACHED', quota }, 409);
  }
  const existingTags = await getDatabase(c).statement(`SELECT t.name FROM rule_tags rt JOIN tags t ON t.id = rt.tag_id WHERE rt.rule_id = ? ORDER BY t.name`)
    .bind(c.req.param('id')).all<{ name: string }>();
  const timestamp = Math.max(now(), Number(row.updated_at) + 1);
  const requestedTagNames = parsed.data.newTagNames ?? parsed.data.tagNames;
  const requestedTagIds = parsed.data.tagIds ?? [];
  if (!user.roles.some((role) => role === 'editor' || role === 'admin') && requestedTagNames?.length) {
    return c.json({ error: 'new_tags_require_editor' }, 403);
  }
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

  const updateRuleStatement = needsReviewAfterEdit
    ? getDatabase(c).statement(`
      UPDATE rules SET statement = ?, common_mistake = ?, details = ?, flow_stage = ?, categories_json = ?,
        player_counts_json = ?, edition_notes_json = ?, edition_note = ?, source_label = ?, source_url = ?,
        review_status = 'pending', pending_review_by = ?, reviewed_by = NULL, reviewed_by_nickname = NULL,
        reviewed_at = NULL, updated_at = ? WHERE id = ?${parsed.data.baseUpdatedAt === undefined ? '' : ' AND updated_at = ?'}
    `).bind(
      updated.statement, updated.commonMistake, updated.details, updated.flowStage,
      JSON.stringify(updated.categories),
      JSON.stringify(Array.from(new Set(updated.playerCounts)).sort((a, b) => a - b)),
      JSON.stringify(updated.editionNotes), updated.editionNotes[0] ?? null, updated.sourceLabel, updated.sourceUrl,
      user.id, timestamp, c.req.param('id'), ...(parsed.data.baseUpdatedAt === undefined ? [] : [parsed.data.baseUpdatedAt]),
    )
    : getDatabase(c).statement(`
      UPDATE rules SET statement = ?, common_mistake = ?, details = ?, flow_stage = ?, categories_json = ?,
        player_counts_json = ?, edition_notes_json = ?, edition_note = ?, source_label = ?, source_url = ?,
        updated_at = ? WHERE id = ?${parsed.data.baseUpdatedAt === undefined ? '' : ' AND updated_at = ?'}
    `).bind(
      updated.statement, updated.commonMistake, updated.details, updated.flowStage,
      JSON.stringify(updated.categories),
      JSON.stringify(Array.from(new Set(updated.playerCounts)).sort((a, b) => a - b)),
      JSON.stringify(updated.editionNotes), updated.editionNotes[0] ?? null, updated.sourceLabel, updated.sourceUrl,
      timestamp, c.req.param('id'), ...(parsed.data.baseUpdatedAt === undefined ? [] : [parsed.data.baseUpdatedAt]),
    );

  const followUpStatements = [
    getDatabase(c).statement(`
      INSERT INTO rule_revisions (id, rule_id, previous_json, edited_by, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(createId('rev'), c.req.param('id'), JSON.stringify({ ...row, tag_names: (existingTags.results ?? []).map((tag) => tag.name) }), user.id, parsed.data.reason ?? 'edit', timestamp),
    ...(!tagsRequested || tagIdsUnchanged ? [] : await tagWriteStatements(
      c, c.req.param('id'), requestedTagNames ?? [], user.id, timestamp, true, requestedTagIds,
    )),
    getDatabase(c).statement('UPDATE games SET updated_at = ? WHERE id = ?').bind(timestamp, row.game_id as string),
  ];
  try {
    if (parsed.data.baseUpdatedAt !== undefined) {
      const updateResult = await updateRuleStatement.run();
      if (Number(updateResult.meta?.changes ?? 0) !== 1) {
        return c.json({ error: 'rule_changed_while_editing' }, 409);
      }
      await getDatabase(c).batch(followUpStatements);
    } else {
      await getDatabase(c).batch([updateRuleStatement, ...followUpStatements]);
    }
  } catch (error) {
    const code = contributionErrorCode(error);
    if (code === 'PENDING_RULE_LIMIT_REACHED') {
      const quota = await queryContributionQuota(getDatabase(c), user.id);
      return c.json({ error: code, quota }, 409);
    }
    throw error;
  }
  const cache = (caches as any).default;
  const gameSlug = await getDatabase(c).statement('SELECT g.slug FROM games g JOIN rules r ON r.game_id = g.id WHERE r.id = ?').bind(c.req.param('id')).first<{ slug: string }>();
  if (gameSlug) {
    c.executionCtx.waitUntil(Promise.all([
      cache.delete(new Request(new URL(`/api/games/${gameSlug.slug}`, c.req.url))),
      cache.delete(new Request(new URL('/api/home', c.req.url))),
    ]));
  }
  const updatedRow = await getDatabase(c).statement(`
    SELECT r.*, g.display_name AS game_name, g.slug AS game_slug
    FROM rules r JOIN games g ON g.id = r.game_id
    WHERE r.id = ?
  `).bind(c.req.param('id')).first<RuleRow & { game_name: string; game_slug: string }>();
  if (!updatedRow) return c.json({ error: 'rule_not_found' }, 404);
  const [tagMap, nicknameMap] = await Promise.all([
    resolveRuleTags(getDatabase(c), [updatedRow]),
    resolvePublicNicknames(getDatabase(c), [updatedRow]),
  ]);
  setNoCache(c);
  return c.json({
    ok: true,
    updatedAt: timestamp,
    reviewStatus: updatedRow.review_status,
    rule: { ...toRule(updatedRow, tagMap, nicknameMap), gameName: updatedRow.game_name, gameSlug: updatedRow.game_slug },
  });
});

const changeRuleVisibility = async (c: AppContext, status: 'hidden' | 'published') => {
  const id = c.req.param('id');
  const row = await getDatabase(c).statement('SELECT * FROM rules WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!row) return c.json({ error: 'rule_not_found' }, 404);
  const user = c.get('user')!;
  const rulePermission = row as {
    created_by: string | null;
    pending_review_by?: string | null;
    hidden_by?: string | null;
    review_status: 'not_required' | 'pending' | 'reviewed';
    status: string;
  };
  const canChangeVisibility = status === 'hidden'
    ? canEditContributionRule(rulePermission, user)
    : canRestoreHiddenContributionRule(rulePermission, user);
  if (!canChangeVisibility) {
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
    ...(status === 'hidden' ? [getDatabase(c).statement(`
      UPDATE games SET visibility = 'hidden', updated_at = ?
      WHERE id = ? AND review_status = 'pending'
        AND NOT EXISTS (SELECT 1 FROM rules WHERE game_id = ? AND status = 'published')
    `).bind(timestamp, row.game_id as string, row.game_id as string)] : []),
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

rulesRoutes.post('/api/rules/:id/hide', requireUser, (c) => changeRuleVisibility(c, 'hidden'));
rulesRoutes.post('/api/rules/:id/restore', requireUser, (c) => changeRuleVisibility(c, 'published'));

rulesRoutes.post('/api/rules/:id/review', requireRole('editor'), async (c) => {
  const user = c.get('user')!;
  const reviewer = await getDatabase(c).statement(`
    SELECT nickname FROM users
    WHERE id = ? AND show_nickname = 1 AND nickname IS NOT NULL
  `).bind(user.id).first<{ nickname: string }>();
  if (!reviewer) return c.json({ error: 'reviewer_nickname_required' }, 409);
  const rule = await getDatabase(c).statement(`
    SELECT id, game_id, review_status FROM rules WHERE id = ?
  `).bind(c.req.param('id')).first<{ id: string; game_id: string; review_status: string }>();
  if (!rule) return c.json({ error: 'rule_not_found' }, 404);
  if (rule.review_status !== 'pending') return c.json({ error: 'rule_not_pending_review' }, 409);
  const timestamp = now();
  await getDatabase(c).statement(`
    UPDATE rules SET review_status = 'reviewed', pending_review_by = NULL,
      reviewed_by = ?, reviewed_by_nickname = ?, reviewed_at = ?
    WHERE id = ? AND review_status = 'pending'
  `).bind(user.id, reviewer.nickname, timestamp, rule.id).run();
  const gameSlug = await getDatabase(c).statement('SELECT slug FROM games WHERE id = ?')
    .bind(rule.game_id).first<{ slug: string }>();
  const cache = (caches as any).default;
  if (gameSlug) c.executionCtx.waitUntil(Promise.all([
    cache.delete(new Request(new URL(`/api/games/${gameSlug.slug}`, c.req.url))),
    cache.delete(new Request(new URL('/api/home', c.req.url))),
  ]));
  return c.json({ ok: true, reviewStatus: 'reviewed', reviewedByNickname: reviewer.nickname, reviewedAt: timestamp });
});

rulesRoutes.get('/api/rules/:id/revisions', requireUser, async (c) => {
  const user = c.get('user')!;
  const rule = await getDatabase(c).statement('SELECT created_by FROM rules WHERE id = ?')
    .bind(c.req.param('id')).first<{ created_by: string | null }>();
  if (!rule) return c.json({ error: 'rule_not_found' }, 404);
  const canViewAnyRule = user.roles.some((role) => role === 'editor' || role === 'admin');
  if (!canViewAnyRule && rule.created_by !== user.id) return c.json({ error: 'forbidden' }, 403);
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
  if (!canEditContributionRule(current as {
    created_by: string | null;
    pending_review_by?: string | null;
    review_status: 'not_required' | 'pending' | 'reviewed';
    status: string;
  }, user)) {
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
