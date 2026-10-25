import { afterEach, describe, expect, test, vi } from 'vitest';
import { DRIVE_FILE_SCOPE, DRIVE_SNAPSHOT_SCOPES, DRIVE_SNAPSHOT_KEY } from '../../shared/driveSnapshots';
import { createGoogleIdentityTokenProvider, GOOGLE_DRIVE_MANUAL_DISCONNECT_STORAGE_KEY } from './googleIdentityTokenProvider';
import { createSnapshotCoordinator } from './snapshotCoordinator';
import { createInMemoryDrive } from './backupTestFixture';
import { FOLDER_MIME } from './googleDriveApi';
import type { GoogleIdentityWindow, GoogleTokenClient } from './types';

const CLIENT = 'drive-connection-test.apps.googleusercontent.com';
const ROOT = 'connection-root';
type OAuth = NonNullable<NonNullable<NonNullable<GoogleIdentityWindow['google']>['accounts']>['oauth2']>;
type TokenConfig = Parameters<OAuth['initTokenClient']>[0];

const connection = (scopes?: string) => {
  const drive = createInMemoryDrive();
  drive.addFile({ id: ROOT, name: '新版快照', mimeType: FOLDER_MIME, parents: ['root'], appProperties: { backupKey: DRIVE_SNAPSHOT_KEY, backupKind: 'root', schemaVersion: '4' } });
  let config: TokenConfig; let popupError: string | undefined; let failFirst401 = false; let always403 = false; let attempts = 0;
  const grants = new Map<string, { scope: string; sub?: string }>(); const requests: Array<{ url: string; token: string }> = [];
  const tokenClient: GoogleTokenClient = { callback: () => undefined, requestAccessToken: vi.fn(() => {
    if (popupError) { config.error_callback?.({ type: popupError }); return; }
    const token = `connection-${crypto.randomUUID()}`; const scope = config.scope.split(/\s+/).filter(Boolean).join(' ');
    grants.set(token, { scope, ...(scope.split(/\s+/).includes('openid') ? { sub: 'connection-owner' } : {}) });
    tokenClient.callback({ access_token: token, expires_in: 3600 });
  }) };
  const initTokenClient = vi.fn((input: TokenConfig) => { config = input; return tokenClient; });
  const windowRef: GoogleIdentityWindow = { localStorage: window.localStorage, google: { accounts: { oauth2: { initTokenClient, revoke: (_token, done) => done() } } } };
  const provider = createGoogleIdentityTokenProvider({ clientId: CLIENT, scopes, windowRef, documentRef: { body: { appendChild: vi.fn() }, getElementById: () => null, createElement: vi.fn() } });
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const token = new Headers(init?.headers).get('Authorization')?.replace(/^Bearer /, '') ?? ''; const url = String(input);
    requests.push({ url, token }); attempts += 1;
    if (always403 || (failFirst401 && attempts === 1)) return new Response(JSON.stringify({ error: { message: 'denied' } }), { status: always403 ? 403 : 401 });
    if (!grants.has(token)) return new Response(JSON.stringify({ error: { message: 'unknown token' } }), { status: 401 });
    return drive.fetchImpl(input, init);
  };
  return { drive, provider, coordinator: createSnapshotCoordinator({ tokenProvider: provider, fetchImpl }), tokenClient, initTokenClient, requests, grants,
    setPopupError: (value?: string) => { popupError = value; }, setFailFirst401: () => { failFirst401 = true; }, setAlways403: () => { always403 = true; } };
};

describe('Google Drive GIS to direct Drive authorization', () => {
  afterEach(() => { window.localStorage.clear(); vi.unstubAllGlobals(); });

  test('requests openid plus drive.file and sends the bearer only to Drive', async () => {
    const flow = connection(); await flow.provider.signIn();
    await expect(flow.coordinator.state()).resolves.toMatchObject({ revision: 0, rootId: ROOT, accountKey: `drive:${ROOT}` });
    expect(flow.initTokenClient.mock.calls[0][0].scope.split(/\s+/).sort()).toEqual(DRIVE_SNAPSHOT_SCOPES.split(/\s+/).sort());
    expect(flow.tokenClient.requestAccessToken).toHaveBeenCalledTimes(1);
    expect(flow.requests.every(request => request.url.startsWith('https://www.googleapis.com/drive/') || request.url.startsWith('https://www.googleapis.com/upload/drive/'))).toBe(true);
  });

  test('accepts a real drive.file-only grant without fabricating an identity or tokeninfo request', async () => {
    const flow = connection(DRIVE_FILE_SCOPE); await flow.provider.signIn();
    const state = await flow.coordinator.state();
    const token = flow.requests[0].token;
    expect(state.accountKey).toBe(`drive:${ROOT}`); expect(flow.grants.get(token)).not.toHaveProperty('sub');
    expect(flow.initTokenClient.mock.calls[0][0].scope).toBe(DRIVE_FILE_SCOPE);
    expect(flow.requests.every(request => !request.url.includes('tokeninfo'))).toBe(true);
  });

  test('refreshes exactly once after a Drive 401', async () => {
    const flow = connection(); flow.setFailFirst401();
    await expect(flow.coordinator.state()).resolves.toMatchObject({ rootId: ROOT });
    expect(flow.tokenClient.requestAccessToken).toHaveBeenCalledTimes(2);
    expect(flow.requests.length).toBeGreaterThanOrEqual(2); expect(flow.requests[0].url).toBe(flow.requests[1].url); expect(flow.requests[0].token).not.toBe(flow.requests[1].token);
  });

  test('does not enter a popup loop after a Drive 403; a later explicit retry remains possible', async () => {
    const flow = connection(); flow.setAlways403(); await flow.provider.signIn();
    await expect(flow.coordinator.state()).rejects.toMatchObject({ status: 403 });
    await expect(flow.coordinator.state()).rejects.toMatchObject({ status: 403 });
    expect(flow.tokenClient.requestAccessToken).toHaveBeenCalledTimes(1);
    const retry = connection(); retry.setPopupError('popup_closed');
    await expect(retry.provider.signIn()).rejects.toThrow('已取消'); retry.setPopupError(); await retry.provider.signIn();
    await expect(retry.coordinator.state()).resolves.toMatchObject({ rootId: ROOT });
    expect(retry.tokenClient.requestAccessToken).toHaveBeenCalledTimes(2);
  });

  test('persists a manual disconnect only until the next explicit sign-in', async () => {
    const flow = connection(); await flow.provider.signIn(); await flow.provider.signOut();
    expect(window.localStorage.getItem(GOOGLE_DRIVE_MANUAL_DISCONNECT_STORAGE_KEY)).toBe('true');
    await expect(flow.provider.getAccessToken()).rejects.toThrow('主動斷線'); await flow.provider.signIn();
    expect(window.localStorage.getItem(GOOGLE_DRIVE_MANUAL_DISCONNECT_STORAGE_KEY)).toBeNull();
    expect(flow.tokenClient.requestAccessToken).toHaveBeenCalledTimes(2);
  });
});
