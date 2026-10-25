import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DRIVE_SNAPSHOT_SCOPES } from '../../shared/driveSnapshots';
import { createInMemoryDrive } from './backupTestFixture';
import { useWorkspaceGoogleDriveBackup } from './useWorkspaceGoogleDriveBackup';
import type { GoogleIdentityWindow, GoogleTokenClient } from './types';

const CLIENT = 'workspace-authorization.integration.apps.googleusercontent.com';
type OAuth = NonNullable<NonNullable<NonNullable<GoogleIdentityWindow['google']>['accounts']>['oauth2']>;
type TokenConfig = Parameters<OAuth['initTokenClient']>[0];

const fixture = () => {
  const drive = createInMemoryDrive(); const grants = new Map<string, { scope: string; sub?: string }>();
  let config: TokenConfig; let deny = false; let first401 = false; let requestCount = 0;
  const tokenClient: GoogleTokenClient = { callback: () => undefined, requestAccessToken: vi.fn(() => {
    const token = `workspace-${crypto.randomUUID()}`; const scope = config.scope.split(/\s+/).filter(Boolean).join(' ');
    grants.set(token, { scope }); tokenClient.callback({ access_token: token, expires_in: 3600 });
  }) };
  const initTokenClient = vi.fn((input: TokenConfig) => { config = input; return tokenClient; });
  vi.stubGlobal('google', { accounts: { oauth2: { initTokenClient, revoke: (_token: string, done: () => void) => done() } } });
  const urls: string[] = [];
  const fetchBridge = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input); urls.push(url); requestCount += 1;
    if (deny) return new Response(JSON.stringify({ error: { message: 'forbidden' } }), { status: 403 });
    if (first401 && requestCount === 1) return new Response(JSON.stringify({ error: { message: 'expired' } }), { status: 401 });
    const token = new Headers(init?.headers).get('Authorization')?.replace(/^Bearer /, '') ?? '';
    if (!grants.has(token)) return new Response(JSON.stringify({ error: { message: 'unknown token' } }), { status: 401 });
    return drive.fetchImpl(input, init);
  });
  vi.stubGlobal('fetch', fetchBridge);
  return { drive, grants, tokenClient, initTokenClient, fetchBridge, urls, setDeny: (value: boolean) => { deny = value; }, setFirst401: () => { first401 = true; } };
};

const connect = async () => {
  const flow = fixture();
  const hook = renderHook(() => useWorkspaceGoogleDriveBackup({ inspectChanges: false, loadGoogleClientId: async () => CLIENT, onRestored: vi.fn(), setNotice: vi.fn() }));
  await act(async () => { await hook.result.current.connect(); });
  return { flow, hook };
};

describe('Workspace frontend-to-Drive authorization contract', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => { window.localStorage.clear(); vi.unstubAllGlobals(); });

  test('connects GIS directly to Drive with the requested scopes and no app-backend call', async () => {
    const { flow, hook } = await connect();
    expect(flow.initTokenClient.mock.calls[0][0].scope.split(/\s+/).sort()).toEqual(DRIVE_SNAPSHOT_SCOPES.split(/\s+/).sort());
    expect(flow.tokenClient.requestAccessToken).toHaveBeenCalledTimes(1); expect(hook.result.current.authorized).toBe(true); expect(hook.result.current.error).toBe('');
    expect(flow.urls.every(url => url.startsWith('https://www.googleapis.com/drive/') || url.startsWith('https://www.googleapis.com/upload/drive/'))).toBe(true);
    hook.unmount();
  });

  test('does not require or fabricate an OpenID identity when Drive accepts the grant', async () => {
    const { flow, hook } = await connect();
    const token = new Headers(flow.fetchBridge.mock.calls[0]?.[1]?.headers).get('Authorization')?.replace(/^Bearer /, '') ?? '';
    expect(flow.grants.get(token)).not.toHaveProperty('sub'); expect(hook.result.current.authorized).toBe(true);
    expect(flow.urls.every(url => !url.includes('tokeninfo'))).toBe(true); hook.unmount();
  });

  test('refreshes once on a Drive 401 and remains connected', async () => {
    const flow = fixture(); flow.setFirst401();
    const hook = renderHook(() => useWorkspaceGoogleDriveBackup({ inspectChanges: false, loadGoogleClientId: async () => CLIENT, onRestored: vi.fn(), setNotice: vi.fn() }));
    await act(async () => { await hook.result.current.connect(); });
    expect(flow.tokenClient.requestAccessToken).toHaveBeenCalledTimes(2); expect(hook.result.current.authorized).toBe(true); expect(hook.result.current.error).toBe(''); hook.unmount();
  });

  test('does not reopen OAuth after a Drive 403, while an explicit retry can recover', async () => {
    const flow = fixture(); flow.setDeny(true); const hook = renderHook(() => useWorkspaceGoogleDriveBackup({ inspectChanges: false, loadGoogleClientId: async () => CLIENT, onRestored: vi.fn(), setNotice: vi.fn() }));
    await act(async () => { await hook.result.current.connect(); });
    expect(flow.tokenClient.requestAccessToken).toHaveBeenCalledTimes(1); expect(hook.result.current.authorized).toBe(false); expect(hook.result.current.busy).toBeNull();
    flow.setDeny(false); await act(async () => { await hook.result.current.connect(); });
    expect(flow.tokenClient.requestAccessToken).toHaveBeenCalledTimes(2); expect(hook.result.current.authorized).toBe(true); expect(hook.result.current.error).toBe(''); hook.unmount();
  });
});
