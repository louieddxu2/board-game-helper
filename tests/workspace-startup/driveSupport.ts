import { expect, type Page } from '@playwright/test';
import type { InMemoryDriveFixture } from '../../src/workspace/googleDriveBackup/backupTestFixture';

export const connectFakeDrive = async (page: Page, fixture: InMemoryDriveFixture) => {
  // Seed IndexedDB on the same origin without entering any website route or session provider.
  await page.route('**/__workspace-storage-seed', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Workspace storage fixture</title>' }));
  await page.addInitScript(() => {
    (window as any).google = { accounts: { oauth2: {
      initTokenClient: () => {
        const client = { callback: (_response: unknown) => undefined, requestAccessToken: () => client.callback({ access_token: 'test-token', expires_in: 3600 }) };
        return client;
      },
      revoke: (_token: string, done: () => void) => done(),
    } } };
  });
  await page.route('**/api/**', route => {
    expect(new URL(route.request().url()).pathname, 'Workspace must not request website sessions or database APIs').toBe('/api/workspace-config');
    return route.fulfill({ json: { googleDriveClientId: 'test-client' } });
  });
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS' };
  await page.route('https://www.googleapis.com/**', async route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') { await route.fulfill({ status: 200, headers }); return; }
    try {
      const response = await fixture.fetchImpl(request.url(), { method: request.method(), headers: request.headers(), body: request.postDataBuffer() ?? undefined });
      await route.fulfill({ status: response.status, headers: { ...Object.fromEntries(response.headers), ...headers }, body: Buffer.from(await response.arrayBuffer()) });
    } catch (error) { await route.fulfill({ status: 500, headers, json: { error: { message: error instanceof Error ? error.message : '測試失敗' } } }); }
  });
};
