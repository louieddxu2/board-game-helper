import { describe, expect, test } from 'vitest';
import { app } from './index';

describe('retired Workspace backup API', () => {
  test('serves the public client configuration without sessions or D1, even with old login credentials', async () => {
    const env = new Proxy({}, { get(_target, key) {
      if (key === 'GOOGLE_DRIVE_CLIENT_ID') return 'public-client';
      throw new Error('Workspace configuration must not touch D1 or website sessions');
    } });
    const response = await app.request('https://rules.test/api/workspace-config', {
      headers: { Cookie: 'session=old-session', Authorization: 'Bearer not-a-website-token' },
    }, env as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ googleDriveClientId: 'public-client' });
  });
  for (const method of ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS']) {
    test.each(['/api/workspace-backup', '/api/workspace-backup/state', '/api/workspace', '/api/workspace/future-project', '/api/workspace-new-feature'])
      (`${method} %s never enters site database/session middleware`, async path => {
        const env = new Proxy({}, { get() { throw new Error('The whole Workspace namespace must be database-independent'); } });
        const response = await app.request(`https://rules.test${path}`, { method,
          headers: { Cookie: 'session=old-session', Authorization: 'Bearer google-token' } }, env as never);
        expect(response.status).toBe(410);
        expect(response.headers.get('x-d1-rows-read')).toBeNull();
        expect(response.headers.get('x-d1-rows-written')).toBeNull();
      });
  }
  test.each(['POST', 'PATCH', 'DELETE', 'OPTIONS'])('does not allow %s configuration requests to fall through to D1', async method => {
    const env = new Proxy({}, { get() { throw new Error('Only the public read configuration is allowed'); } });
    const response = await app.request('https://rules.test/api/workspace-config', { method }, env as never);
    expect(response.status).toBe(410);
  });
  test.each(['/state', '/begin', '/operations/old/commit', '/cleanup'])('rejects %s without reading a database or accepting a Google token', async path => {
    const env = new Proxy({}, { get() { throw new Error('Retired backup API must not touch any server dependency'); } });
    const response = await app.request(`https://rules.test/api/workspace-backup${path}`, {
      method: path === '/state' ? 'GET' : 'POST', headers: { Authorization: 'Bearer old-client-token' },
    }, env as never);
    expect(response.status).toBe(410);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'backup_client_update_required' });
  });
});
