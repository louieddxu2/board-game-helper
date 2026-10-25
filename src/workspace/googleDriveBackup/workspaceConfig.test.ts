import { afterEach, expect, test, vi } from 'vitest';
import { app } from '../../../worker/index';
import { loadWorkspaceGoogleDriveClientId } from './workspaceConfig';

afterEach(() => vi.unstubAllGlobals());

test('the actual Workspace configuration request succeeds with no D1 binding or website session', async () => {
  const env = { GOOGLE_DRIVE_CLIENT_ID: 'configured-drive-client' } as never;
  const bridge = vi.fn<typeof fetch>(async (input, init) => {
    expect(String(input)).toBe('/api/workspace-config');
    expect(init?.credentials).toBe('omit');
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
    return app.request(`https://rules.test${input}`, init, env);
  });
  vi.stubGlobal('fetch', bridge);
  await expect(loadWorkspaceGoogleDriveClientId()).resolves.toBe('configured-drive-client');
  expect(bridge).toHaveBeenCalledTimes(1);
});

test('a failed configuration request does not prevent a later retry', async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockResolvedValueOnce(Response.json({ googleDriveClientId: 'retry-client' }));
  vi.stubGlobal('fetch', fetchImpl);
  await expect(loadWorkspaceGoogleDriveClientId()).rejects.toThrow('無法讀取');
  await expect(loadWorkspaceGoogleDriveClientId()).resolves.toBe('retry-client');
});
