import { Hono } from 'hono';
import { z } from 'zod';
import { type FlowStage, type UserRole } from '../../src/shared/types';
import { requireRole, type AppContext, type AppVariables } from '../auth';
import type { RouteEnv } from '../env';
import { getDatabase, type DatabaseStatement } from '../data/database';
import { createId, hashEmail, maskEmail, normalizeText, now, slugify } from '../utils';
import { resolveRuleTags, setNoCache, ruleSelect, toRule, cleanTagNames, tagWriteStatements, toGame, RuleRow, GameRow } from './shared';

const adminRoutes = new Hono<{ Bindings: RouteEnv; Variables: AppVariables }>();

adminRoutes.get('/api/export/public', requireRole('admin'), async (c) => {
  const metadata = await getDatabase(c).statement(`
    SELECT
      (SELECT COUNT(*) FROM games WHERE merged_into_game_id IS NULL) AS game_count,
      (SELECT COUNT(*) FROM rules WHERE status = 'published') AS rule_count,
      (SELECT COUNT(*) FROM tags WHERE status = 'active') AS tag_count,
      COALESCE((SELECT MAX(updated_at) FROM games WHERE merged_into_game_id IS NULL), 0) AS games_updated_at,
      COALESCE((SELECT MAX(updated_at) FROM rules WHERE status = 'published'), 0) AS rules_updated_at,
      COALESCE((SELECT MAX(updated_at) FROM tags WHERE status = 'active'), 0) AS tags_updated_at
  `).first<{
    game_count: number;
    rule_count: number;
    tag_count: number;
    games_updated_at: number;
    rules_updated_at: number;
    tags_updated_at: number;
  }>();
  const values = metadata ?? {
    game_count: 0, rule_count: 0, tag_count: 0,
    games_updated_at: 0, rules_updated_at: 0, tags_updated_at: 0,
  };
  const updatedAt = Math.max(values.games_updated_at, values.rules_updated_at, values.tags_updated_at);
  const datasetVersion = `v1-${updatedAt}-${values.game_count}-${values.rule_count}-${values.tag_count}`;
  const etag = `W/"${datasetVersion}"`;
  c.header('ETag', etag);
  setNoCache(c);
  c.header('Content-Disposition', 'attachment; filename="wrong-board-game-rules-public-v1.json"');
  if (c.req.header('If-None-Match') === etag) return c.body(null, 304);

  const [gamesResult, aliasesResult, rulesResult] = await Promise.all([
    getDatabase(c).statement(`
      SELECT g.id, g.slug, g.display_name, g.english_name, g.updated_at,
        COUNT(r.id) AS rule_count
      FROM games g
      LEFT JOIN rules r ON r.game_id = g.id AND r.status = 'published'
      WHERE g.merged_into_game_id IS NULL
      GROUP BY g.id
      ORDER BY g.display_name, g.id
    `).all<GameRow>(),
    getDatabase(c).statement(`
      SELECT a.game_id, a.alias
      FROM game_aliases a JOIN games g ON g.id = a.game_id
      WHERE g.merged_into_game_id IS NULL
      ORDER BY a.game_id, a.alias
    `).all<{ game_id: string; alias: string }>(),
    getDatabase(c).statement(`${ruleSelect}
      JOIN games g ON g.id = r.game_id
      WHERE r.status = 'published' AND g.merged_into_game_id IS NULL
      ORDER BY r.game_id, r.created_at, r.id
    `).all<RuleRow>(),
  ]);
  const aliasesByGame = new Map<string, string[]>();
  for (const alias of aliasesResult.results ?? []) {
    const aliases = aliasesByGame.get(alias.game_id) ?? [];
    aliases.push(alias.alias);
    aliasesByGame.set(alias.game_id, aliases);
  }
  const tagMap = await resolveRuleTags(getDatabase(c), rulesResult.results ?? []);
  const rulesByGame = new Map<string, any[]>();
  for (const row of rulesResult.results ?? []) {
    const rules = rulesByGame.get(row.game_id) ?? [];
    rules.push(toRule(row, tagMap));
    rulesByGame.set(row.game_id, rules);
  }
  return c.json({
    schemaVersion: 1,
    datasetVersion,
    updatedAt,
    counts: {
      games: values.game_count,
      rules: values.rule_count,
      tags: values.tag_count,
    },
    games: (gamesResult.results ?? []).map((game) => ({
      ...toGame(game),
      aliases: aliasesByGame.get(game.id) ?? [],
      rules: rulesByGame.get(game.id) ?? [],
    })),
  });
});

adminRoutes.get('/api/admin/editors', requireRole('admin'), async (c) => {
  const [users, invites] = await Promise.all([
    getDatabase(c).statement(`
      SELECT u.id, u.masked_email, u.display_name, ur.role, ur.granted_at, ur.revoked_at
      FROM user_roles ur JOIN users u ON u.id = ur.user_id
      ORDER BY ur.revoked_at IS NOT NULL, ur.granted_at DESC
    `).all<{ id: string; masked_email: string | null; display_name: string | null; role: string; granted_at: number; revoked_at: number | null }>(),
    getDatabase(c).statement(`
      SELECT id, masked_email, note, role, invited_at, claimed_at, revoked_at
      FROM editor_invitations
      WHERE claimed_at IS NULL AND revoked_at IS NULL
      ORDER BY invited_at DESC
    `).all<{ id: string; masked_email: string | null; note: string | null; role: string; invited_at: number; claimed_at: number | null; revoked_at: number | null }>(),
  ]);

  return c.json({
    users: (users.results ?? []).map((u) => ({
      id: u.id,
      maskedEmail: u.masked_email ?? '已保護個資',
      displayName: u.display_name,
      role: u.role,
      grantedAt: u.granted_at,
      revokedAt: u.revoked_at,
    })),
    invitations: (invites.results ?? []).map((inv) => ({
      id: inv.id,
      maskedEmail: inv.masked_email ?? '已保護個資',
      note: inv.note ?? undefined,
      role: inv.role,
      invitedAt: inv.invited_at,
    })),
  });
});

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'editor']),
  note: z.string().trim().max(100).optional(),
});

adminRoutes.post('/api/admin/editors/invite', requireRole('admin'), async (c) => {
  const body = inviteSchema.safeParse(await c.req.json());
  if (!body.success) return c.json({ error: 'invalid_email' }, 400);
  const emailHash = await hashEmail(body.data.email);
  const maskedEmail = maskEmail(body.data.email);
  const note = body.data.note?.trim() || null;
  const timestamp = now();

  const existingUser = await getDatabase(c).statement('SELECT id FROM users WHERE email_hash = ?')
    .bind(emailHash).first<{ id: string }>();
  if (existingUser) {
    await getDatabase(c).statement(`
      INSERT INTO user_roles (user_id, role, granted_by, granted_at, revoked_at)
      VALUES (?, ?, ?, ?, NULL)
      ON CONFLICT(user_id, role) DO UPDATE SET revoked_at = NULL, granted_at = excluded.granted_at, granted_by = excluded.granted_by
    `).bind(existingUser.id, body.data.role, c.get('user')!.id, timestamp).run();
    return c.json({ ok: true, userId: existingUser.id });
  }

  const existingInvite = await getDatabase(c).statement(`
    SELECT id FROM editor_invitations
    WHERE email_hash = ? AND claimed_at IS NULL AND revoked_at IS NULL
  `).bind(emailHash).first<{ id: string }>();
  if (existingInvite) {
    await getDatabase(c).statement(`
      UPDATE editor_invitations
      SET email_hash = ?, masked_email = ?, role = ?, note = ?, invited_by = ?, invited_at = ?
      WHERE id = ?
    `).bind(emailHash, maskedEmail, body.data.role, note, c.get('user')!.id, timestamp, existingInvite.id).run();
    return c.json({ ok: true, invitationId: existingInvite.id });
  }

  const id = createId('invite');
  const legacyPlaceholder = `redacted-invite:${id}`;
  await getDatabase(c).statement(`
    INSERT INTO editor_invitations (id, email_normalized, email_hash, masked_email, note, role, invited_by, invited_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, legacyPlaceholder, emailHash, maskedEmail, note, body.data.role, c.get('user')!.id, timestamp).run();
  return c.json({ ok: true, invitationId: id });
});

adminRoutes.delete('/api/admin/editors/:userId', requireRole('admin'), async (c) => {
  const role = c.req.query('role') as UserRole | undefined;
  if (!role || !['admin', 'editor'].includes(role)) return c.json({ error: 'invalid_role' }, 400);
  await getDatabase(c).statement(`
    UPDATE user_roles SET revoked_at = ? WHERE user_id = ? AND role = ? AND revoked_at IS NULL
  `).bind(now(), c.req.param('userId'), role).run();
  return c.json({ ok: true });
});

adminRoutes.delete('/api/admin/editors/invitations/:invitationId', requireRole('admin'), async (c) => {
  await getDatabase(c).statement(`
    UPDATE editor_invitations SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL
  `).bind(now(), c.req.param('invitationId')).run();
  return c.json({ ok: true });
});

adminRoutes.get('/api/admin/import-rows', requireRole('editor'), async (c) => {
  const status = (c.req.query('status') ?? 'pending').trim();
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 20) || 20));
  const result = await getDatabase(c).statement(`
    SELECT r.id, r.raw_name, r.suggested_display_name, r.suggested_english_name,
      r.raw_statement, r.suggested_statement, r.suggested_common_mistake,
      r.suggested_details, r.suggested_flow_stage, r.suggested_player_count_note,
      r.suggested_edition_note, r.suggested_tags_json, r.status, r.confidence_score,
      r.created_at, g.id matched_game_id, g.display_name matched_game_name, g.slug matched_game_slug
    FROM legacy_import_rows r
    LEFT JOIN games g ON g.id = r.matched_game_id
    WHERE r.status = ?
    ORDER BY r.created_at ASC
    LIMIT ?
  `).bind(status, limit).all<{
    id: string; raw_name: string; suggested_display_name: string;
    suggested_english_name: string | null; raw_statement: string;
    suggested_statement: string; suggested_common_mistake: string | null;
    suggested_details: string | null; suggested_flow_stage: string;
    suggested_player_count_note: string | null; suggested_edition_note: string | null;
    suggested_tags_json: string | null; status: string; confidence_score: number;
    created_at: number; matched_game_id: string | null; matched_game_name: string | null;
    matched_game_slug: string | null;
  }>();

  setNoCache(c);
  return c.json({
    rows: (result.results ?? []).map((row) => ({
      id: row.id,
      rawName: row.raw_name,
      suggestedDisplayName: row.suggested_display_name,
      suggestedEnglishName: row.suggested_english_name ?? undefined,
      rawStatement: row.raw_statement,
      suggestedStatement: row.suggested_statement,
      suggestedCommonMistake: row.suggested_common_mistake ?? undefined,
      suggestedDetails: row.suggested_details ?? undefined,
      suggestedFlowStage: row.suggested_flow_stage as FlowStage,
      suggestedPlayerCountNote: row.suggested_player_count_note ?? undefined,
      suggestedEditionNote: row.suggested_edition_note ?? undefined,
      suggestedTagNames: (() => {
        try { return JSON.parse(row.suggested_tags_json ?? '[]') as string[]; } catch { return []; }
      })(),
      status: row.status,
      confidenceScore: row.confidence_score,
      createdAt: row.created_at,
      matchedGame: row.matched_game_id ? {
        id: row.matched_game_id,
        displayName: row.matched_game_name!,
        slug: row.matched_game_slug!,
      } : undefined,
    })),
  });
});

adminRoutes.post('/api/admin/import-rows/:id/confirm', requireRole('editor'), async (c) => {
  const row = await getDatabase(c).statement(`
    SELECT * FROM legacy_import_rows WHERE id = ?
  `).bind(c.req.param('id')).first<{
    id: string; raw_name: string; suggested_display_name: string;
    suggested_english_name: string | null; raw_statement: string;
    suggested_statement: string; suggested_common_mistake: string | null;
    suggested_details: string | null; suggested_flow_stage: string;
    suggested_player_count_note: string | null; suggested_edition_note: string | null;
    raw_source_label: string | null; raw_source_url: string | null;
    suggested_tags_json: string | null; status: string; matched_game_id: string | null;
  }>();
  if (!row) return c.json({ error: 'import_row_not_found' }, 404);
  if (row.status !== 'pending') return c.json({ error: 'import_row_already_processed' }, 400);

  const timestamp = now();
  const user = c.get('user')!;
  let gameId = row.matched_game_id;
  let gameSlug = '';

  if (!gameId) {
    const existingGame = await getDatabase(c).statement(`
      SELECT g.id, g.slug FROM games g
      LEFT JOIN game_aliases a ON a.game_id = g.id
      WHERE (g.normalized_name = ? OR a.normalized_alias = ?) AND g.merged_into_game_id IS NULL
      LIMIT 1
    `).bind(normalizeText(row.suggested_display_name), normalizeText(row.suggested_display_name)).first<{ id: string; slug: string }>();

    if (existingGame) {
      gameId = existingGame.id;
      gameSlug = existingGame.slug;
    } else {
      gameId = createId('game');
      const baseSlug = slugify(row.suggested_display_name);
      gameSlug = baseSlug;

      const slugExists = await getDatabase(c).statement('SELECT 1 found FROM games WHERE slug = ?').bind(baseSlug).first();
      if (slugExists) gameSlug = `${baseSlug}-${gameId.slice(-6)}`;

      await getDatabase(c).statement(`
        INSERT INTO games (id, slug, display_name, english_name, normalized_name, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(gameId, gameSlug, row.suggested_display_name, row.suggested_english_name || null, normalizeText(row.suggested_display_name), user.id, timestamp, timestamp).run();
    }
  } else {
      const matched = await getDatabase(c).statement('SELECT slug FROM games WHERE id = ?').bind(gameId).first<{ slug: string }>();
    gameSlug = matched?.slug ?? '';
  }

  const submissionId = createId('sub');
  const ruleId = createId('rule');
  const tagNames = (() => {
    try { return JSON.parse(row.suggested_tags_json ?? '[]') as string[]; } catch { return []; }
  })();

  const statements: DatabaseStatement[] = [
    getDatabase(c).statement(`
      INSERT INTO submissions (id, game_id, raw_input, source_label, source_url, submitter_type, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, 'editor', ?, ?)
    `).bind(submissionId, gameId, row.raw_statement, row.raw_source_label || null, row.raw_source_url || null, user.id, timestamp),
    getDatabase(c).statement(`
      INSERT INTO rules (
        id, game_id, submission_id, statement, common_mistake, details,
        flow_stage, edition_notes_json, edition_note, source_label, source_url,
        status, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?)
    `).bind(
      ruleId, gameId, submissionId, row.suggested_statement,
      row.suggested_common_mistake || null, row.suggested_details || null,
      row.suggested_flow_stage,
      JSON.stringify(row.suggested_edition_note ? [row.suggested_edition_note] : []),
      row.suggested_edition_note || null, row.raw_source_label || null, row.raw_source_url || null,
      user.id, timestamp, timestamp,
    ),
    getDatabase(c).statement(`
      UPDATE legacy_import_rows
      SET status = 'processed', matched_game_id = ?, processed_at = ?, processed_by = ?
      WHERE id = ?
    `).bind(gameId, timestamp, user.id, row.id),
  ];

  statements.push(...await tagWriteStatements(c, ruleId, cleanTagNames(tagNames), user.id, timestamp));
  await getDatabase(c).batch(statements);

  return c.json({ ok: true, gameId, gameSlug, ruleId });
});

adminRoutes.post('/api/admin/import-rows/:id/skip', requireRole('editor'), async (c) => {
  const user = c.get('user')!;
  const timestamp = now();
  await getDatabase(c).statement(`
    UPDATE legacy_import_rows
    SET status = 'skipped', processed_at = ?, processed_by = ?
    WHERE id = ? AND status = 'pending'
  `).bind(timestamp, user.id, c.req.param('id')).run();
  return c.json({ ok: true });
});

export default adminRoutes;
