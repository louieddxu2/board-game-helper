import { afterEach, describe, expect, test, vi } from 'vitest';
import { DRIVE_FILE_SCOPE, SnapshotProtocolError } from '../../shared/driveSnapshots';
import { verifyDriveSnapshotToken } from '../../../worker/services/driveSnapshotAuth';
import { createGoogleIdentityTokenProvider, GOOGLE_DRIVE_MANUAL_DISCONNECT_STORAGE_KEY } from './googleIdentityTokenProvider';
import { createSnapshotCoordinator } from './snapshotCoordinator';
import type { GoogleIdentityWindow, GoogleTokenClient } from './types';

const CLIENT = 'drive-connection-test.apps.googleusercontent.com';
type OAuth = NonNullable<NonNullable<NonNullable<GoogleIdentityWindow['google']>['accounts']>['oauth2']>;
type TokenConfig = Parameters<OAuth['initTokenClient']>[0];

// Tokeninfo identity depends on the scopes actually requested by the real provider.
// A Drive-only grant deliberately has no identity, rather than fabricating an OpenID response.
const connection = (scopes?: string, windowRef: GoogleIdentityWindow = {}) => {
  let config: TokenConfig;
  let popupError: string | undefined;
  const claims = new Map<string, Record<string, unknown>>();
  const tokenClient: GoogleTokenClient = {
    callback: () => undefined,
    requestAccessToken: vi.fn(() => {
      if (popupError) { config.error_callback?.({ type: popupError }); return; }
      const token = `connection-${crypto.randomUUID()}`;
      claims.set(token, { aud: CLIENT, scope: config.scope, expires_in: 3600,
        ...(config.scope.split(/\s+/).includes('openid') ? { sub: 'connection-owner' } : {}) });
      tokenClient.callback({ access_token: token, expires_in: 3600 });
    }),
  };
  const initTokenClient = vi.fn((input: TokenConfig) => { config = input; return tokenClient; });
  windowRef.google = { accounts: { oauth2: { initTokenClient, revoke: (_token, done) => done() } } };
  const provider = createGoogleIdentityTokenProvider({ clientId: CLIENT, scopes, windowRef,
    documentRef: { body: { appendChild: vi.fn() }, getElementById: () => null, createElement: vi.fn() } });
  const tokeninfo = vi.fn<typeof fetch>(async (_input, init) => {
    const token = new Headers(init?.headers).get('Authorization')?.replace(/^Bearer /, '') ?? '';
    return new Response(JSON.stringify(claims.get(token)), { status: claims.has(token) ? 200 : 401 });
  });
  const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
    try {
      const owner = await verifyDriveSnapshotToken(new Headers(init?.headers).get('Authorization') ?? undefined,
        { GOOGLE_DRIVE_CLIENT_ID: CLIENT }, tokeninfo);
      return new Response(JSON.stringify({ accountKey: owner.accountKey, rootId: null, revision: 0, versions: [] }));
    } catch (error) {
      if (!(error instanceof SnapshotProtocolError)) throw error;
      return new Response(JSON.stringify({ error: error.code }), { status: error.status });
    }
  });
  return { provider, coordinator: createSnapshotCoordinator({ tokenProvider: provider, fetchImpl }), tokenClient,
    initTokenClient, fetchImpl, setPopupError: (value?: string) => { popupError = value; } };
};

describe('Google Drive connection across the authorization boundary', () => {
  afterEach(() => { window.localStorage.clear(); vi.unstubAllGlobals(); });

  test('requests the identity needed by the server and connects with only one authorization popup', async () => {
    const flow = connection();
    await flow.provider.signIn();
    await expect(flow.coordinator.state()).resolves.toMatchObject({ revision: 0, versions: [] });
    expect(flow.initTokenClient.mock.calls[0][0].scope.split(/\s+/).sort()).toEqual([DRIVE_FILE_SCOPE, 'openid'].sort());
    expect(flow.tokenClient.requestAccessToken).toHaveBeenCalledTimes(1);
  });

  test('does not reopen OAuth when a valid Drive-only grant lacks account identity', async () => {
    const flow = connection(DRIVE_FILE_SCOPE);
    await flow.provider.signIn();
    await expect(flow.coordinator.state()).rejects.toMatchObject({ code: 'backup_identity_required', status: 403 });
    await expect(flow.coordinator.state()).rejects.toMatchObject({ code: 'backup_identity_required', status: 403 });
    expect(flow.tokenClient.requestAccessToken).toHaveBeenCalledTimes(1);
    expect(flow.fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('explicit reconnect clears a persisted disconnect and can authenticate again', async () => {
    const flow = connection(undefined, { localStorage: window.localStorage });
    await flow.provider.signIn();
    await flow.provider.signOut();
    expect(window.localStorage.getItem(GOOGLE_DRIVE_MANUAL_DISCONNECT_STORAGE_KEY)).toBe('true');
    await expect(flow.provider.getAccessToken()).rejects.toThrow('主動斷線');
    await flow.provider.signIn();
    await expect(flow.coordinator.state()).resolves.toMatchObject({ revision: 0 });
    expect(window.localStorage.getItem(GOOGLE_DRIVE_MANUAL_DISCONNECT_STORAGE_KEY)).toBeNull();
    expect(flow.tokenClient.requestAccessToken).toHaveBeenCalledTimes(2);
  });

  test.each(['popup_closed', 'popup_failed_to_open'])('releases the pending connection after %s so the next click can retry', async error => {
    const flow = connection();
    flow.setPopupError(error);
    await expect(flow.provider.signIn()).rejects.toThrow(error === 'popup_closed' ? '已取消' : '無法開啟');
    flow.setPopupError();
    await flow.provider.signIn();
    await expect(flow.coordinator.state()).resolves.toMatchObject({ revision: 0 });
    expect(flow.tokenClient.requestAccessToken).toHaveBeenCalledTimes(2);
  });

  test('uses the real browser storage when no window override is supplied', async () => {
    const setup = connection();
    vi.stubGlobal('google', { accounts: { oauth2: {
      initTokenClient: setup.initTokenClient, revoke: (_token: string, done: () => void) => done(),
    } } });
    window.localStorage.setItem(GOOGLE_DRIVE_MANUAL_DISCONNECT_STORAGE_KEY, 'true');
    const provider = createGoogleIdentityTokenProvider({ clientId: CLIENT });
    await expect(provider.getAccessToken()).rejects.toThrow('主動斷線');
    await provider.signIn();
    expect(window.localStorage.getItem(GOOGLE_DRIVE_MANUAL_DISCONNECT_STORAGE_KEY)).toBeNull();
    await provider.signOut();
    expect(window.localStorage.getItem(GOOGLE_DRIVE_MANUAL_DISCONNECT_STORAGE_KEY)).toBe('true');
  });
});
