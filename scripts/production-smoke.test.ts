import { describe, expect, test, vi } from 'vitest';
// @ts-expect-error The production smoke runner is intentionally executable plain JavaScript.
import { assertProductionSmoke, productionReleaseConfig } from './production-smoke.mjs';

describe('production core smoke', () => {
  test('reads the release origin and Google client ID', () => {
    expect(productionReleaseConfig('{"vars":{"APP_ORIGIN":"https://example.com/","GOOGLE_CLIENT_ID":"client.apps.googleusercontent.com"}}')).toEqual({
      origin: 'https://example.com',
      googleClientId: 'client.apps.googleusercontent.com',
    });
  });

  test('checks health, session configuration and Google CSP', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: null, googleClientId: 'client', localDevLogin: false }), { status: 200 }))
      .mockResolvedValueOnce(new Response('<!doctype html>', { status: 200, headers: { 'Content-Security-Policy': "script-src 'self' https://accounts.google.com/gsi/client; frame-src https://accounts.google.com/gsi/" } }));
    await expect(assertProductionSmoke({ origin: 'https://example.com', googleClientId: 'client' }, fetchMock)).resolves.toBeUndefined();
  });

  test('fails when production serves a different Google client ID', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ user: null, googleClientId: 'wrong', localDevLogin: false }), { status: 200 }))
      .mockResolvedValueOnce(new Response('<!doctype html>', { status: 200 }));
    await expect(assertProductionSmoke({ origin: 'https://example.com', googleClientId: 'expected' }, fetchMock)).rejects.toThrow('Google Client ID');
  });
});
