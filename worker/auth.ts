import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { SessionUser, UserRole } from '../src/shared/types';
import type { Env, RouteEnv } from './env';
import { getDatabase, type Database } from './data/database';
import { createId, normalizeEmail, now, sha256Hex } from './utils';

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const SESSION_COOKIE = 'wbr_session';
const SESSION_DAYS = 30;
const INTEGRATION_SESSION_MINUTES = 60;

export interface AppVariables {
  user?: SessionUser;
  d1Metrics?: any;
  database?: Database;
}

export type AppContext = Context<{ Bindings: RouteEnv; Variables: AppVariables }>;

export interface IntegrationSession {
  accessToken: string;
  expiresAt: number;
  user: SessionUser;
}

export const isPublicReadRequest = (method: string, requestUrl: string): boolean => {
  if (method !== 'GET') return false;
  const url = new URL(requestUrl);
  const path = url.pathname;
  const isPublicGameDetail = /^\/api\/games\/[^/]+$/.test(path)
    && url.searchParams.get('includePrivate') !== '1';
  return ['/api/health', '/api/home', '/api/search', '/api/tags', '/api/game-catalog', '/api/games/search', '/api/games/resolve', '/api/export/public'].includes(path)
    || isPublicGameDetail;
};

const googleAudiences = (env: Pick<Env, 'GOOGLE_CLIENT_ID' | 'GOOGLE_CLIENT_IDS'>): string[] => Array.from(new Set([
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
    SELECT id, email, display_name, nickname, show_nickname, avatar_url FROM users WHERE id = ?
  `).bind(userId).first<{ id: string; email: string; display_name: string | null; nickname: string | null; show_nickname: number; avatar_url: string | null }>();
  if (!row) return undefined;
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name ?? undefined,
    nickname: row.nickname ?? undefined,
    showNickname: Boolean(row.show_nickname),
    avatarUrl: row.avatar_url ?? undefined,
    roles: await rolesForUser(db, row.id),
  };
};

const sessionUser = async (db: Database, token: string): Promise<SessionUser | undefined> => {
  const tokenHash = await sha256Hex(token);
  const row = await db.statement(`
    SELECT u.id, u.email, u.display_name, u.nickname, u.show_nickname, u.avatar_url, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id_hash = ?
  `).bind(tokenHash).first<{
    id: string;
    email: string;
    display_name: string | null;
    nickname: string | null;
    show_nickname: number;
    avatar_url: string | null;
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
    email: row.email,
    displayName: row.display_name ?? undefined,
    nickname: row.nickname ?? undefined,
    showNickname: Boolean(row.show_nickname),
    avatarUrl: row.avatar_url ?? undefined,
    roles,
  };
};

export const sessionMiddleware: MiddlewareHandler<{
  Bindings: RouteEnv;
  Variables: AppVariables;
}> = async (c, next) => {
  const isPublicRead = isPublicReadRequest(c.req.method, c.req.url);
  if (isPublicRead) { await next(); return; }
  const authorization = c.req.header('Authorization');
  const bearer = authorization?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
  const token = bearer ?? getCookie(c, SESSION_COOKIE);
  if (token) c.set('user', await sessionUser(getDatabase(c), token));
  await next();
};

const saveSession = async (c: AppContext, userId: string, options: {
  kind: 'web' | 'integration';
  ttlMs: number;
  setCookie?: boolean;
  clientOrigin?: string;
}): Promise<{ accessToken: string; expiresAt: number }> => {
  const token = `${createId('session')}.${crypto.randomUUID()}`;
  const timestamp = now();
  const expiresAt = timestamp + options.ttlMs;
  await getDatabase(c).statement(`
    INSERT INTO sessions (id_hash, user_id, created_at, expires_at, last_seen_at, session_kind, client_origin)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(await sha256Hex(token), userId, timestamp, expiresAt, timestamp, options.kind, options.clientOrigin ?? null).run();
  if (options.setCookie) {
    const isLocalhost = ['localhost', '127.0.0.1'].includes(new URL(c.req.url).hostname);
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure: !isLocalhost,
      sameSite: 'Lax',
      path: '/',
      maxAge: Math.floor(options.ttlMs / 1000),
    });
  }
  return { accessToken: token, expiresAt };
};

const upsertGoogleUser = async (c: AppContext, profile: {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}): Promise<string> => {
  const timestamp = now();
  const emailNormalized = normalizeEmail(profile.email);
  const existing = await getDatabase(c).statement('SELECT id, google_sub FROM users WHERE google_sub = ? OR email_normalized = ?')
    .bind(profile.sub, emailNormalized)
    .first<{ id: string; google_sub: string }>();
  if (existing && existing.google_sub !== profile.sub) {
    throw new Error('google_identity_conflict');
  }
  const userId = existing?.id ?? createId('usr');
  await getDatabase(c).statement(`
    INSERT INTO users (
      id, google_sub, email, email_normalized, email_verified,
      display_name, avatar_url, created_at, last_login_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      google_sub = excluded.google_sub,
      email = excluded.email,
      email_normalized = excluded.email_normalized,
      email_verified = excluded.email_verified,
      display_name = excluded.display_name,
      avatar_url = excluded.avatar_url,
      last_login_at = excluded.last_login_at
  `).bind(
    userId, profile.sub, profile.email, emailNormalized, profile.emailVerified ? 1 : 0,
    profile.name ?? null, profile.picture ?? null, timestamp, timestamp,
  ).run();

  if (normalizeEmail(c.env.BOOTSTRAP_ADMIN_EMAIL ?? '') === emailNormalized) {
    const existingAdmin = await getDatabase(c).statement(
      `SELECT 1 FROM user_roles WHERE role = 'admin' AND revoked_at IS NULL LIMIT 1`
    ).first();
    if (!existingAdmin) {
      await getDatabase(c).statement(`
        INSERT INTO user_roles (user_id, role, granted_by, granted_at, revoked_at)
        VALUES (?, 'admin', ?, ?, NULL)
        ON CONFLICT(user_id, role) DO NOTHING
      `).bind(userId, userId, timestamp).run();
    }
  }

  const invites = await getDatabase(c).statement(`
    SELECT id, role FROM editor_invitations
    WHERE email_normalized = ? AND claimed_at IS NULL AND revoked_at IS NULL
  `).bind(emailNormalized).all<{ id: string; role: UserRole }>();
  for (const invite of invites.results ?? []) {
    await getDatabase(c).batch([
      getDatabase(c).statement(`
        INSERT INTO user_roles (user_id, role, granted_by, granted_at, revoked_at)
        SELECT ?, role, invited_by, ?, NULL FROM editor_invitations WHERE id = ?
        ON CONFLICT(user_id, role) DO NOTHING
      `).bind(userId, timestamp, invite.id),
      getDatabase(c).statement(`
        UPDATE editor_invitations SET claimed_by = ?, claimed_at = ? WHERE id = ?
      `).bind(userId, timestamp, invite.id),
    ]);
  }
  return userId;
};

const authenticateGoogleCredential = async (c: AppContext, credential: string): Promise<{ userId: string; user: SessionUser }> => {
  const audiences = googleAudiences(c.env);
  if (!audiences.length) throw new Error('google_auth_not_configured');
  const verified = await jwtVerify(credential, GOOGLE_JWKS, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: audiences,
  });
  const payload = verified.payload;
  if (!payload.sub || typeof payload.email !== 'string' || payload.email_verified !== true) {
    throw new Error('invalid_google_identity');
  }
  const userId = await upsertGoogleUser(c, {
    sub: payload.sub,
    email: payload.email,
    emailVerified: true,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    picture: typeof payload.picture === 'string' ? payload.picture : undefined,
  });
  const user = await userById(getDatabase(c), userId);
  if (!user) throw new Error('session_creation_failed');
  return { userId, user };
};

export const signInWithGoogle = async (c: AppContext, credential: string): Promise<SessionUser> => {
  const { userId, user } = await authenticateGoogleCredential(c, credential);
  await saveSession(c, userId, {
    kind: 'web', ttlMs: SESSION_DAYS * 24 * 60 * 60 * 1000, setCookie: true,
  });
  return user;
};

export const exchangeGoogleCredential = async (c: AppContext, credential: string): Promise<IntegrationSession> => {
  const { userId, user } = await authenticateGoogleCredential(c, credential);
  const session = await saveSession(c, userId, {
    kind: 'integration',
    ttlMs: INTEGRATION_SESSION_MINUTES * 60 * 1000,
    clientOrigin: c.req.header('Origin'),
  });
  return { ...session, user };
};

export const signInAsLocalAdmin = async (c: AppContext): Promise<SessionUser> => {
  const url = new URL(c.req.url);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('not_found');
  const email = normalizeEmail(c.env.BOOTSTRAP_ADMIN_EMAIL ?? 'admin@localhost');
  const userId = await upsertGoogleUser(c, {
    sub: `local:${email}`,
    email,
    emailVerified: true,
    name: '本機管理員',
  });
  await saveSession(c, userId, {
    kind: 'web', ttlMs: SESSION_DAYS * 24 * 60 * 60 * 1000, setCookie: true,
  });
  return {
    id: userId,
    email,
    displayName: '本機管理員',
    roles: await rolesForUser(getDatabase(c), userId),
  };
};

export const signOut = async (c: AppContext): Promise<void> => {
  const bearer = c.req.header('Authorization')?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
  const token = bearer ?? getCookie(c, SESSION_COOKIE);
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
