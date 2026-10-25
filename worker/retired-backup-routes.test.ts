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
