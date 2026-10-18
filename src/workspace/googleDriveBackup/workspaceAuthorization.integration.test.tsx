import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { app } from '../../../worker/index';
import { createDriveSnapshotTestDatabase } from '../../../worker/data/driveSnapshotTestFixture';
import { DRIVE_FILE_SCOPE } from '../../shared/driveSnapshots';
import { createInMemoryDrive } from './backupTestFixture';
import { useWorkspaceGoogleDriveBackup } from './useWorkspaceGoogleDriveBackup';
import type { GoogleIdentityWindow, GoogleTokenClient } from './types';

const CLIENT = 'workspace-authorization.integration.apps.googleusercontent.com';
type OAuth = NonNullable<NonNullable<NonNullable<GoogleIdentityWindow['google']>['accounts']>['oauth2']>;
type TokenConfig = Parameters<OAuth['initTokenClient']>[0];

const fixture = (grantIdentity: boolean) => {
  const database = createDriveSnapshotTestDatabase();
  const drive = createInMemoryDrive();
  const grants = new Map<string, { aud: string; scope: string; expires_in: number; sub?: string }>();
  let config: TokenConfig;
  const tokenClient: GoogleTokenClient = {
    callback: () => undefined,
    requestAccessToken: vi.fn(() => {
      const token = crypto.randomUUID();
      const scopes = config.scope.split(/\s+/).filter(scope => grantIdentity || scope !== 'openid');
      grants.set(token, { aud: config.client_id, scope: scopes.join(' '), expires_in: 3600,
        ...(scopes.includes('openid') ? { sub: 'workspace-authorization-owner' } : {}) });
      tokenClient.callback({ access_token: token, expires_in: 3600 });
    }),
  };
  const initTokenClient = vi.fn((input: TokenConfig) => { config = input; return tokenClient; });
  vi.stubGlobal('google', { accounts: { oauth2: { initTokenClient, revoke: (_token: string, done: () => void) => done() } } });
  const environment = { DB: database.raw, APP_ORIGIN: 'https://rules.test', TRUSTED_APP_ORIGINS: '', GOOGLE_DRIVE_CLIENT_ID: CLIENT,
    PUBLIC_RATE_LIMITER: { limit: async () => ({ success: true }) }, WRITE_RATE_LIMITER: { limit: async () => ({ success: true }) } } as never;
  const fetchBridge = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input), 'https://rules.test');
    if (url.hostname === 'rules.test') return app.request(url.toString(), init, environment);
    if (url.hostname === 'oauth2.googleapis.com') {
      const token = new Headers(init?.headers).get('Authorization')?.replace(/^Bearer /, '') ?? '';
      return new Response(JSON.stringify(grants.get(token) ?? {}), { status: grants.has(token) ? 200 : 401 });
    }
    if (url.hostname === 'www.googleapis.com') return drive.fetchImpl(input, init);
    throw new Error(`Unexpected provider: ${url.origin}`);
  });
  vi.stubGlobal('fetch', fetchBridge);
  return { database, tokenClient, initTokenClient, fetchBridge };
};

describe('Workspace frontend-to-Worker authorization contract', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => { window.localStorage.clear(); vi.unstubAllGlobals(); });

  test.each([true, false])('connects with only the identity actually granted by Google (identity granted: %s)', async grantIdentity => {
    const flow = fixture(grantIdentity);
    const hook = renderHook(() => useWorkspaceGoogleDriveBackup({ inspectChanges: false,
      loadGoogleClientId: async () => CLIENT, onRestored: vi.fn(), setNotice: vi.fn() }));
    try {
      await act(async () => { await hook.result.current.connect(); });
      expect(flow.initTokenClient.mock.calls[0][0].scope.split(/\s+/).sort()).toEqual([DRIVE_FILE_SCOPE, 'openid'].sort());
      expect(flow.tokenClient.requestAccessToken).toHaveBeenCalledTimes(1);
      expect(hook.result.current.authorized).toBe(grantIdentity);
      expect(hook.result.current.busy).toBeNull();
      const stateCalls = flow.fetchBridge.mock.calls.filter(([input]) => String(input) === '/api/workspace-backup/state');
      expect(stateCalls).toHaveLength(1);
      if (grantIdentity) expect(hook.result.current.error).toBe('');
      else {
        expect(hook.result.current.error).toContain('重新開啟');
        // Only another explicit user action may open OAuth again.
        await act(async () => { await hook.result.current.connect(); });
        expect(flow.tokenClient.requestAccessToken).toHaveBeenCalledTimes(2);
        expect(hook.result.current.authorized).toBe(false);
        expect(hook.result.current.busy).toBeNull();
      }
    } finally { hook.unmount(); flow.database.sqlite.close(); }
  });
});
