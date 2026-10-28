import { describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import { isPublicReadRequest, signInAsLocalAdmin } from './auth';
import type { AppVariables } from './auth';
import type { Database, DatabaseStatement } from './data/database';
import type { RouteEnv } from './env';

describe('public read authentication boundary', () => {
  test('keeps ordinary game details on the public fast path', () => {
    expect(isPublicReadRequest('GET', 'https://rules.example/api/games/emberleaf')).toBe(true);
  });

  test('keeps the weekly catalog snapshot and version changes on the public fast path', () => {
    expect(isPublicReadRequest('GET', 'https://rules.example/api/game-catalog')).toBe(true);
    expect(isPublicReadRequest('GET', 'https://rules.example/api/game-catalog/changes?after=12')).toBe(true);
  });

  test('authenticates explicit editor game detail requests', () => {
    expect(isPublicReadRequest('GET', 'https://rules.example/api/games/game-1?includePrivate=1')).toBe(false);
  });

  test('requires an authenticated administrator for the full dataset export', () => {
    expect(isPublicReadRequest('GET', 'https://rules.example/api/export/public')).toBe(false);
  });

  test('does not classify mutations as public reads', () => {
    expect(isPublicReadRequest('POST', 'https://rules.example/api/games/game-1')).toBe(false);
  });

  test('marks bootstrap admin role grants for attribute replay in the same batch', async () => {
    const calls: string[] = [];
    const batches: DatabaseStatement[][] = [];
    const database: Database = {
      statement(sql: string): DatabaseStatement {
        calls.push(sql);
        return {
          bind() { return this; },
          first: async <T>() => {
            if (sql.includes('SELECT id, google_sub FROM users')) return null;
            if (sql.includes("SELECT 1 FROM user_roles WHERE role = 'admin'")) return null;
            if (sql.includes('SELECT u.id, u.masked_email')) return {
              id: 'usr-bootstrap', masked_email: null, display_name: '本機管理員', nickname: null,
              show_nickname: 0, avatar_url: null,
            } as T;
            return null;
          },
          all: async <T>() => sql.includes('SELECT role FROM user_roles')
            ? { results: [{ role: 'admin' }] as T[] }
            : { results: [] as T[] },
          run: async () => ({ success: true, results: [], meta: { changes: 1 } }),
        };
      },
      batch: async (statements) => { batches.push(statements); return statements.map(() => ({ success: true, meta: { changes: 1 } })); },
    };
    const app = new Hono<{ Bindings: RouteEnv; Variables: AppVariables }>();
    app.get('/test', async (c) => {
      c.set('database', database);
      return c.json(await signInAsLocalAdmin(c));
    });

    const response = await app.request('http://localhost/test', {}, {
      BOOTSTRAP_ADMIN_EMAIL: 'admin@example.test',
      EMAIL_HASH_SECRET: 'test-email-hmac-secret-at-least-32-characters',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ roles: ['admin'] });
    expect(batches).toHaveLength(1);
    const roleIndex = calls.findIndex((sql) => sql.includes('INSERT INTO user_roles'));
    const replayIndex = calls.findIndex((sql) => sql.includes('UPDATE attribute_replay_status'));
    expect(replayIndex).toBe(roleIndex + 1);
    expect(calls[replayIndex]).toMatch(/changes\(\)\s*>\s*0/);
  });
});
