import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { SessionUser, UserRole } from '../src/shared/types';
import type { Env, RouteEnv } from './env';
import { getDatabase, type Database } from './data/database';
import { createId, hashEmail, legacyHashEmail, maskEmail, normalizeEmail, now, sha256Hex } from './utils';
import { requireAttributeReplayAfterChange } from './data/attributeVoteWeights';

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const SESSION_COOKIE = 'wbr_session';
const SESSION_DAYS = 30;

export interface AppVariables {
  user?: SessionUser;
  d1Metrics?: any;
  database?: Database;
}

export type AppContext = Context<{ Bindings: RouteEnv; Variables: AppVariables }>;

export const isPublicReadRequest = (method: string, requestUrl: string): boolean => {
  if (method !== 'GET') return false;
  const url = new URL(requestUrl);
  const path = url.pathname;
  const isPublicGameDetail = /^\/api\/games\/[^/]+$/.test(path)
    && url.searchParams.get('includePrivate') !== '1';
  return ['/api/health', '/api/home', '/api/search', '/api/tags', '/api/tags/changes', '/api/game-catalog', '/api/game-catalog/changes', '/api/attributes/vote-subjects', '/api/attributes/activities', '/api/attributes/table', '/api/attributes/table/changes', '/api/games/search', '/api/games/resolve'].includes(path)
    || isPublicGameDetail;
};

export const googleAudiences = (env: Pick<Env, 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_IDS'>): string[] => Array.from(new Set([
  env.GOOGLE_CLIENT_ID,
  ...(env.GOOGLE_CLIENT_IDS ?? '').split(','),
].map((value) => value?.trim()).filter((value): value is string => Boolean(value))));

const rolesForUser = async (db: Database, userId: string): Promise<UserRole[]> => {
  const rows = await db.statement(`
    SELECT role FROM user_roles
    WHERE user_id = ? AND revoked_at IS NULL
  `).bind(userId).all<{ role: UserRole }>();
  return (rows.results ?? []).map((row) => row.role);
};

const userById = async (db: Database, userId: string): Promise<SessionUser | undefined> => {
  const row = await db.statement(`
    SELECT id, masked_email, nickname, show_nickname FROM users WHERE id = ?
  `).bind(userId).first<{ id: string; masked_email: string | null; nickname: string | null; show_nickname: number }>();
  if (!row) return undefined;
  return {
    id: row.id,
    maskedEmail: row.masked_email ?? undefined,
    nickname: row.nickname ?? undefined,
    showNickname: Boolean(row.show_nickname),
    roles: await rolesForUser(db, row.id),
  };
};

const sessionUser = async (db: Database, token: string): Promise<SessionUser | undefined> => {
  const tokenHash = await sha256Hex(token);
  const row = await db.statement(`
    SELECT u.id, u.masked_email, u.nickname, u.show_nickname, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id_hash = ?
  `).bind(tokenHash).first<{
    id: string;
    masked_email: string | null;
    nickname: string | null;
    show_nickname: number;
    expires_at: number;
  }>();
  if (!row) return undefined;
  if (row.expires_at <= now()) {
    await db.statement('DELETE FROM sessions WHERE id_hash = ?').bind(tokenHash).run();
    return undefined;
  }
  const roles = await rolesForUser(db, row.id);
  return {
    id: row.id,
    maskedEmail: row.masked_email ?? undefined,
    nickname: row.nickname ?? undefined,
    showNickname: Boolean(row.show_nickname),
    roles,
  };
};

export const sessionMiddleware: MiddlewareHandler<{
  Bindings: RouteEnv;
  Variables: AppVariables;
}> = async (c, next) => {
  const isPublicRead = isPublicReadRequest(c.req.method, c.req.url);
  if (isPublicRead) { await next(); return; }
  const token = getCookie(c, SESSION_COOKIE);
  if (token) c.set('user', await sessionUser(getDatabase(c), token));
  await next();
};

// Sessions live only in the site's own cookie.
const saveSession = async (c: AppContext, userId: string): Promise<void> => {
  const token = `${createId('session')}.${crypto.randomUUID()}`;
  const timestamp = now();
  const ttlMs = SESSION_DAYS * 24 * 60 * 60 * 1000;
  await getDatabase(c).statement(`
    INSERT INTO sessions (id_hash, user_id, created_at, expires_at, last_seen_at, session_kind, client_origin)
    VALUES (?, ?, ?, ?, ?, 'web', NULL)
  `).bind(await sha256Hex(token), userId, timestamp, timestamp + ttlMs, timestamp).run();
  const isLocalhost = ['localhost', '127.0.0.1'].includes(new URL(c.req.url).hostname);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: !isLocalhost,
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor(ttlMs / 1000),
  });
};

const upsertGoogleUser = async (c: AppContext, profile: {
  sub: string;
  email: string;
  emailVerified: boolean;
}): Promise<{ userId: string; created: boolean }> => {
  const timestamp = now();
  const emailHash = await hashEmail(profile.email, c.env.EMAIL_HASH_SECRET);
  const legacyEmailHash = await legacyHashEmail(profile.email);
  const maskedEmail = maskEmail(profile.email);
  const existing = await getDatabase(c).statement('SELECT id, google_sub FROM users WHERE google_sub = ? OR email_hash IN (?, ?)')
    .bind(profile.sub, emailHash, legacyEmailHash)
    .first<{ id: string; google_sub: string }>();
  if (existing && existing.google_sub !== profile.sub) {
    throw new Error('google_identity_conflict');
  }
  const userId = existing?.id ?? createId('usr');
  const legacyPlaceholder = `redacted-user:${userId}`;
  await getDatabase(c).statement(`
    INSERT INTO users (
      id, google_sub, email, email_normalized, email_hash, masked_email, email_verified,
      created_at, last_login_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      google_sub = excluded.google_sub,
      email = excluded.email,
      email_normalized = excluded.email_normalized,
      email_hash = excluded.email_hash,
      masked_email = excluded.masked_email,
      email_verified = excluded.email_verified,
      last_login_at = excluded.last_login_at
  `).bind(
    userId, profile.sub, legacyPlaceholder, legacyPlaceholder, emailHash, maskedEmail, profile.emailVerified ? 1 : 0,
    timestamp, timestamp,
  ).run();

  const bootstrapAdminHash = await hashEmail(c.env.BOOTSTRAP_ADMIN_EMAIL ?? '', c.env.EMAIL_HASH_SECRET);
  if (bootstrapAdminHash && bootstrapAdminHash === emailHash) {
    const existingAdmin = await getDatabase(c).statement(
      `SELECT 1 FROM user_roles WHERE role = 'admin' AND revoked_at IS NULL LIMIT 1`
    ).first();
    if (!existingAdmin) {
      await getDatabase(c).batch([getDatabase(c).statement(`
        INSERT INTO user_roles (user_id, role, granted_by, granted_at, revoked_at)
        VALUES (?, 'admin', ?, ?, NULL)
        ON CONFLICT(user_id, role) DO NOTHING
      `).bind(userId, userId, timestamp), requireAttributeReplayAfterChange(getDatabase(c))]);
    }
  }

  const invites = await getDatabase(c).statement(`
    SELECT id, role FROM editor_invitations
    WHERE email_hash IN (?, ?) AND claimed_at IS NULL AND revoked_at IS NULL
  `).bind(emailHash, legacyEmailHash).all<{ id: string; role: UserRole }>();
  for (const invite of invites.results ?? []) {
    await getDatabase(c).batch([
      getDatabase(c).statement(`
        INSERT INTO user_roles (user_id, role, granted_by, granted_at, revoked_at)
        SELECT ?, role, invited_by, ?, NULL FROM editor_invitations WHERE id = ?
        ON CONFLICT(user_id, role) DO NOTHING
      `).bind(userId, timestamp, invite.id),
      requireAttributeReplayAfterChange(getDatabase(c)),
      getDatabase(c).statement(`
        UPDATE editor_invitations
        SET claimed_by = ?, claimed_at = ?, email_hash = NULL, masked_email = NULL
        WHERE id = ?
      `).bind(userId, timestamp, invite.id),
    ]);
  }
  return { userId, created: !existing };
};

export const verifyGoogleIdentity = async (
  credential: string,
  env: Pick<Env, 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_IDS'>,
  verificationKey: JWTVerifyGetKey = GOOGLE_JWKS,
): Promise<{ sub: string; email: string; emailVerified: true }> => {
  const audiences = googleAudiences(env);
  if (!audiences.length) throw new Error('google_auth_not_configured');
  const verified = await jwtVerify(credential, verificationKey, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: audiences,
  });
  const payload = verified.payload;
  if (!payload.sub || typeof payload.email !== 'string' || payload.email_verified !== true) {
    throw new Error('invalid_google_identity');
  }
  return {
    sub: payload.sub,
    email: payload.email,
    emailVerified: true,
  };
};

const authenticateGoogleCredential = async (c: AppContext, credential: string): Promise<{ userId: string; user: SessionUser; firstLogin: boolean }> => {
  const profile = await verifyGoogleIdentity(credential, c.env);
  const { userId, created } = await upsertGoogleUser(c, profile);
  const user = await userById(getDatabase(c), userId);
  if (!user) throw new Error('session_creation_failed');
  return { userId, user, firstLogin: created };
};

export const signInWithGoogle = async (c: AppContext, credential: string): Promise<{ user: SessionUser; firstLogin: boolean }> => {
  const { userId, user, firstLogin } = await authenticateGoogleCredential(c, credential);
  await saveSession(c, userId);
  return { user, firstLogin };
};

export const signInAsLocalAdmin = async (c: AppContext): Promise<SessionUser> => {
  const url = new URL(c.req.url);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('not_found');
  const email = normalizeEmail(c.env.BOOTSTRAP_ADMIN_EMAIL ?? 'admin@localhost');
  const { userId } = await upsertGoogleUser(c, {
    sub: `local:${email}`,
    email,
    emailVerified: true,
  });
  await saveSession(c, userId);
  return {
    id: userId,
    maskedEmail: maskEmail(email),
    roles: await rolesForUser(getDatabase(c), userId),
  };
};

export const signOut = async (c: AppContext): Promise<void> => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await getDatabase(c).statement('DELETE FROM sessions WHERE id_hash = ?').bind(await sha256Hex(token)).run();
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
};

export const requireRole = (role: UserRole): MiddlewareHandler<{
  Bindings: RouteEnv;
  Variables: AppVariables;
}> => async (c, next) => {
  const user = c.get('user');
  const allowed = user?.roles.includes('admin') || user?.roles.includes(role);
  if (!allowed) return c.json({ error: user ? 'forbidden' : 'authentication_required' }, user ? 403 : 401);
  await next();
};

export const requireUser: MiddlewareHandler<{
  Bindings: RouteEnv;
  Variables: AppVariables;
}> = async (c, next) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'authentication_required' }, 401);
  await next();
};
