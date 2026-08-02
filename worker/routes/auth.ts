import { Hono } from 'hono';
import { z } from 'zod';
import { FLOW_STAGES, type FlowStage, type GameDetail, type GameSummary, type HomePayload, type HomeIDPayload, type ReviewBatch, type ReviewContent as SharedReviewContent, type ReviewProposal, type RuleCard, type UserRole } from '../../src/shared/types';
import { requireRole, requireUser, type AppContext, type AppVariables, exchangeGoogleCredential, signInAsLocalAdmin, signInWithGoogle, signOut } from '../auth';
import type { RouteEnv } from '../env';
import { getDatabase, type DatabaseStatement } from '../data/database';
import { assertMutationOrigin, cleanOptional, createId, isValidNickname, normalizeEmail, normalizeNickname, normalizeText, now, sha256Hex, slugify, trustedOrigins } from '../utils';
import { normalizedReviewContent, REVIEW_FORMAT, REVIEW_SCHEMA_VERSION, reviewContentHash, reviewContentSchema, reviewFileSchema, sameReviewContent, type ReviewContent, type ReviewFile } from '../review';
import { parseReviewCsv, serializeReviewCsv } from '../review-csv';
import { setNoCache, ruleSelect, homeRuleSelect, toRule, cleanTagNames, tagWriteStatements, toGame, reviewContentFromRow, reviewRuleSelect , RuleRow, GameRow, ReviewRuleRow } from './shared';
import { deleteAccount, queryAccountDeletionSummary } from '../data/accountDeletion';

const authRoutes = new Hono<{ Bindings: RouteEnv; Variables: AppVariables }>();

const nicknameSchema = z.object({
  nickname: z.string().trim().min(1).max(12),
  showNickname: z.boolean().optional(),
}).refine(
  (value) => isValidNickname(value.nickname),
  { message: 'invalid_nickname', path: ['nickname'] },
);

authRoutes.get('/api/session', (c) => c.json({
  user: c.get('user') ?? null,
  googleClientId: c.env.GOOGLE_CLIENT_ID ?? null,
  localDevLogin: ['localhost', '127.0.0.1'].includes(new URL(c.req.url).hostname),
}));

authRoutes.get('/api/account', requireUser, async (c) => {
  const user = c.get('user')!;
  const canEdit = user.roles.some((role) => role === 'editor' || role === 'admin');
  const count = await getDatabase(c).statement(`
    SELECT COUNT(*) total
    FROM rules
    WHERE created_by = ?${canEdit ? '' : " AND review_status = 'reviewed'"}
  `).bind(user.id).first<{ total: number }>();
  setNoCache(c);
  return c.json({ user, createdRuleCount: count?.total ?? 0 });
});

authRoutes.get('/api/account/created-rules', requireUser, async (c) => {
  const user = c.get('user')!;
  const canEdit = user.roles.some((role) => role === 'editor' || role === 'admin');
  const result = await getDatabase(c).statement(`
    SELECT r.id, g.display_name game_name, g.slug game_slug, r.statement,
      r.status, r.created_at, r.updated_at
    FROM rules r
    JOIN games g ON g.id = r.game_id
    WHERE r.created_by = ?${canEdit ? '' : " AND r.review_status = 'reviewed'"}
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT 20
  `).bind(user.id).all<{
    id: string; game_name: string; game_slug: string; statement: string;
    status: 'draft' | 'published' | 'hidden'; created_at: number; updated_at: number;
  }>();
  setNoCache(c);
  return c.json({ rules: (result.results ?? []).map((row) => ({
    id: row.id,
    gameName: row.game_name,
    gameSlug: row.game_slug,
    statement: row.statement,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })) });
});

authRoutes.get('/api/account/modified-rules', requireRole('editor'), async (c) => {
  const user = c.get('user')!;
  const result = await getDatabase(c).statement(`
    SELECT rr.id, rr.rule_id, g.display_name game_name, g.slug game_slug,
      r.statement current_statement, rr.previous_json, rr.reason,
      rr.created_at edited_at,
      CASE WHEN u.show_nickname = 1 THEN u.nickname END edited_by_name
    FROM rule_revisions rr
    JOIN rules r ON r.id = rr.rule_id
    JOIN games g ON g.id = r.game_id
    LEFT JOIN users u ON u.id = rr.edited_by
    WHERE r.created_by = ? AND rr.edited_by <> ?
    ORDER BY rr.created_at DESC, rr.id DESC
    LIMIT 100
  `).bind(user.id, user.id).all<{
    id: string; rule_id: string; game_name: string; game_slug: string;
    current_statement: string; previous_json: string; reason: string | null;
    edited_at: number; edited_by_name: string | null;
  }>();
  setNoCache(c);
  return c.json({ revisions: (result.results ?? []).map((row) => {
    let previousStatement: string | undefined;
    try {
      const previous = JSON.parse(row.previous_json) as { statement?: unknown };
      if (typeof previous.statement === 'string') previousStatement = previous.statement;
    } catch { /* keep the activity item usable even if an old snapshot is malformed */ }
    return {
      id: row.id,
      ruleId: row.rule_id,
      gameName: row.game_name,
      gameSlug: row.game_slug,
      currentStatement: row.current_statement,
      previousStatement,
      editedByName: row.edited_by_name ?? undefined,
      reason: row.reason ?? '修改',
      editedAt: row.edited_at,
    };
  }) });
});

authRoutes.patch('/api/account/nickname', requireRole('editor'), async (c) => {
  const parsed = nicknameSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: 'invalid_nickname' }, 400);
  const user = c.get('user')!;
  const nickname = parsed.data.nickname.normalize('NFKC').trim();
  const nicknameNormalized = normalizeNickname(nickname);
  if (parsed.data.showNickname && !nickname) return c.json({ error: 'nickname_required' }, 400);
  const existing = await getDatabase(c).statement(
    'SELECT id FROM users WHERE nickname_normalized = ? AND id <> ?',
  ).bind(nicknameNormalized, user.id).first<{ id: string }>();
  if (existing) return c.json({ error: 'nickname_taken' }, 409);
  try {
    await getDatabase(c).statement(
      'UPDATE users SET nickname = ?, nickname_normalized = ?, show_nickname = ? WHERE id = ?',
    ).bind(nickname, nicknameNormalized, parsed.data.showNickname ? 1 : 0, user.id).run();
  } catch (error) {
    if (String(error).toLowerCase().includes('unique')) return c.json({ error: 'nickname_taken' }, 409);
    throw error;
  }
  return c.json({ user: { ...user, nickname, showNickname: Boolean(parsed.data.showNickname) } });
});

authRoutes.get('/api/account/deletion-summary', requireUser, async (c) => {
  setNoCache(c);
  return c.json(await queryAccountDeletionSummary(getDatabase(c), c.get('user')!.id));
});

const accountDeletionSchema = z.object({
  confirmation: z.literal('刪除帳號'),
  deleteOwnUnmodifiedRules: z.boolean(),
});

authRoutes.delete('/api/account', requireUser, async (c) => {
  const parsed = accountDeletionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'invalid_account_deletion' }, 400);
  try {
    const result = await deleteAccount(
      getDatabase(c), c.get('user')!.id, parsed.data.deleteOwnUnmodifiedRules,
    );
    await signOut(c);
    setNoCache(c);
    return c.json({ ok: true as const, ...result });
  } catch (error) {
    if (String(error).includes('last_admin_account')) {
      return c.json({ error: 'last_admin_account' }, 409);
    }
    throw error;
  }
});

authRoutes.post('/api/auth/google', async (c) => {
  const body = await c.req.json<{ credential?: unknown }>();
  if (typeof body.credential !== 'string' || body.credential.length > 10_000) {
    return c.json({ error: 'invalid_credential' }, 400);
  }
  const user = await signInWithGoogle(c, body.credential);
  return c.json({ user });
});

authRoutes.post('/api/auth/google/exchange', async (c) => {
  const origin = c.req.header('Origin')?.replace(/\/$/, '');
  if (!origin || !trustedOrigins(c.env, c.req.url).has(origin)) {
    return c.json({ error: 'forbidden_origin' }, 403);
  }
  const body = await c.req.json<{ credential?: unknown }>();
  if (typeof body.credential !== 'string' || body.credential.length > 10_000) {
    return c.json({ error: 'invalid_credential' }, 400);
  }
  const session = await exchangeGoogleCredential(c, body.credential);
  return c.json({ ...session, tokenType: 'Bearer' as const });
});

authRoutes.post('/api/auth/dev', async (c) => {
  const user = await signInAsLocalAdmin(c);
  return c.json({ user });
});

authRoutes.post('/api/logout', async (c) => {
  await signOut(c);
  return c.json({ ok: true });
});


export { authRoutes };
