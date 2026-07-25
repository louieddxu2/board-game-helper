import { Hono } from 'hono';
import { z } from 'zod';
import { FLOW_STAGES, type FlowStage, type GameDetail, type GameSummary, type HomePayload, type HomeIDPayload, type ReviewBatch, type ReviewContent as SharedReviewContent, type ReviewProposal, type RuleCard, type UserRole } from '../../src/shared/types';
import { requireRole, type AppContext, type AppVariables, exchangeGoogleCredential, signInAsLocalAdmin, signInWithGoogle, signOut } from '../auth';
import type { Env, D1Result, D1PreparedStatement } from '../env';
import { assertMutationOrigin, cleanOptional, createId, normalizeEmail, normalizeText, now, sha256Hex, slugify, trustedOrigins } from '../utils';
import { normalizedReviewContent, REVIEW_FORMAT, REVIEW_SCHEMA_VERSION, reviewContentHash, reviewContentSchema, reviewFileSchema, sameReviewContent, type ReviewContent, type ReviewFile } from '../review';
import { parseReviewCsv, serializeReviewCsv } from '../review-csv';
import { setNoCache, ruleSelect, homeRuleSelect, toRule, cleanTagNames, tagWriteStatements, toGame, reviewContentFromRow, reviewRuleSelect , RuleRow, GameRow, ReviewRuleRow } from './shared';

const authRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

authRoutes.get('/api/session', (c) => c.json({
  user: c.get('user') ?? null,
  googleClientId: c.env.GOOGLE_CLIENT_ID ?? null,
  localDevLogin: ['localhost', '127.0.0.1'].includes(new URL(c.req.url).hostname),
}));

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
