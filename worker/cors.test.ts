import { describe, expect, test } from 'vitest';
import app from './index';
import type { Env } from './env';

const env = {
  APP_ORIGIN: 'https://rules.example.com',
  TRUSTED_APP_ORIGINS: 'https://dev.example.com',
  PUBLIC_RATE_LIMITER: { limit: async () => ({ success: true }) },
} as unknown as Env;

// Only the site's own configured origins get CORS; other sites cannot read or write the API from a browser.
describe('CORS', () => {
  test('allows preflight only from configured app origins', async () => {
    const response = await app.request('https://rules.example.com/api/submissions', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://dev.example.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    }, env);

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://dev.example.com');
    expect(response.headers.get('Access-Control-Allow-Headers')).not.toContain('Authorization');
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

  test('does not open public reads to unrelated sites', async () => {
    const preflight = await app.request('https://rules.example.com/api/health', {
      method: 'OPTIONS',
      headers: { Origin: 'https://reader.example', 'Access-Control-Request-Method': 'GET' },
    }, env);
    expect(preflight.status).toBe(403);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBeNull();

    const read = await app.request('https://rules.example.com/api/health', { headers: { Origin: 'https://reader.example' } }, env);
    expect(read.headers.get('Access-Control-Allow-Origin')).toBeNull();
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
