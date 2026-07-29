import { describe, expect, test } from 'vitest';
import app from './index';
import type { Env } from './env';

const env = {
  APP_ORIGIN: 'https://rules.example.com',
  TRUSTED_APP_ORIGINS: 'https://score.example.com',
} as Env;

describe('integration CORS', () => {
  test('allows preflight only from configured app origins', async () => {
    const response = await app.request('https://rules.example.com/api/submissions', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://score.example.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    }, env);

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://score.example.com');
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
    expect(response.headers.get('Access-Control-Max-Age')).toBe('86400');
  });

  test('does not expose the administrator snapshot to unrelated origins', async () => {
    const response = await app.request('https://rules.example.com/api/export/public', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://reader.example',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'if-none-match',
      },
    }, env);

    expect(response.status).toBe(403);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  test('rejects preflight from unrelated sites', async () => {
    const response = await app.request('https://rules.example.com/api/submissions', {
      method: 'OPTIONS',
      headers: { Origin: 'https://attacker.example' },
    }, env);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'forbidden_origin' });
  });
});
