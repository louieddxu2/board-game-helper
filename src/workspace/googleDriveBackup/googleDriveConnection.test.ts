import { afterEach, describe, expect, test, vi } from 'vitest';
import { createInMemoryDrive } from './backupTestFixture';
import { GoogleDriveApi } from './googleDriveApi';
import { createGoogleIdentityTokenProvider, GOOGLE_DRIVE_MANUAL_DISCONNECT_STORAGE_KEY } from './googleIdentityTokenProvider';
import { DRIVE_FILE_SCOPE, DRIVE_SNAPSHOT_SCOPES, DRIVE_SNAPSHOT_KEY } from '../../shared/driveSnapshots';

const ROOT = 'connection-root';
const CLIENT_ID = 'test-client-id';

const connection = (scope = DRIVE_SNAPSHOT_SCOPES) => {
  const drive = createInMemoryDrive();
  drive.addFile({ id: ROOT, name: '新版快照', mimeType: 'application/vnd.google-apps.folder', parents: ['root'],
    appProperties: { backupKey: DRIVE_SNAPSHOT_KEY, backupKind: 'root' } });
  const requests: Array<{ url: string; token?: string }> = [];
  const grants = new Map<string, Record<string, string>>();
  let tokenCounter = 0; let popupError: string | undefined; let failFirst401 = false; let always403 = false; let attempts = 0;
  let clientConfig: { scope: string; callback: (resp: unknown) => void; error_callback?: (err: { type: string }) => void } | undefined;
  const tokenClient = {
    callback: (_resp: unknown) => undefined,
    requestAccessToken: vi.fn(() => {
      if (popupError) {
        clientConfig?.error_callback?.({ type: popupError });
      } else {
        const token = `bearer-${++tokenCounter}`;
        grants.set(token, { scope: clientConfig?.scope ?? scope });
        tokenClient.callback({ access_token: token, expires_in: 3600 });
      }
    }),
  };
  const initTokenClient = vi.fn((config: typeof clientConfig) => { clientConfig = config; return tokenClient; });
  const windowRef = {
    localStorage: window.localStorage,
    google: { accounts: { oauth2: { initTokenClient, revoke: (_token: string, done: () => void) => done() } } },
  };
  const provider = createGoogleIdentityTokenProvider({
    clientId: CLIENT_ID,
    scopes: scope,
    windowRef: windowRef as unknown as Parameters<typeof createGoogleIdentityTokenProvider>[0]['windowRef'],
    documentRef: { body: { appendChild: vi.fn() }, getElementById: () => null, createElement: vi.fn() } as unknown as Parameters<typeof createGoogleIdentityTokenProvider>[0]['documentRef'],
  });
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const token = new Headers(init?.headers).get('authorization')?.replace(/^Bearer\s+/i, '');
    requests.push({ url, token }); attempts += 1;
    if (always403 || (failFirst401 && attempts === 1)) return new Response(JSON.stringify({ error: { message: 'denied' } }), { status: always403 ? 403 : 401 });
    if (!token || !grants.has(token)) return new Response(JSON.stringify({ error: { message: 'unknown token' } }), { status: 401 });
    return drive.fetchImpl(input, init);
  };
  const api = new GoogleDriveApi({ tokenProvider: provider, fetchImpl });
  return { drive, provider, api, tokenClient, initTokenClient, requests, grants,
    setPopupError: (value?: string) => { popupError = value; }, setFailFirst401: () => { failFirst401 = true; }, setAlways403: () => { always403 = true; } };
};

describe('Google Drive GIS to direct Drive authorization', () => {
  afterEach(() => { window.localStorage.clear(); vi.unstubAllGlobals(); });

  test('requests openid plus drive.file and sends the bearer only to Drive', async () => {
    const flow = connection(); await flow.provider.signIn();
    await expect(flow.api.getFile(ROOT)).resolves.toMatchObject({ id: ROOT });
    expect(flow.initTokenClient.mock.calls[0][0]?.scope.split(/\s+/).sort()).toEqual(DRIVE_SNAPSHOT_SCOPES.split(/\s+/).sort());
    expect(flow.tokenClient.requestAccessToken).toHaveBeenCalledTimes(1);
    expect(flow.requests.every(request => request.url.startsWith('https://www.googleapis.com/drive/') || request.url.startsWith('https://www.googleapis.com/upload/drive/'))).toBe(true);
  });

  test('accepts a real drive.file-only grant without fabricating an identity or tokeninfo request', async () => {
    const flow = connection(DRIVE_FILE_SCOPE); await flow.provider.signIn();
    const file = await flow.api.getFile(ROOT);
    const token = flow.requests[0]?.token;
    expect(file.id).toBe(ROOT); expect(flow.grants.get(token ?? '')).not.toHaveProperty('sub');
    expect(flow.initTokenClient.mock.calls[0][0]?.scope).toBe(DRIVE_FILE_SCOPE);
    expect(flow.requests.every(request => !request.url.includes('tokeninfo'))).toBe(true);
  });

  test('refreshes exactly once after a Drive 401', async () => {
    const flow = connection(); flow.setFailFirst401();
    await expect(flow.api.getFile(ROOT)).resolves.toMatchObject({ id: ROOT });
    expect(flow.tokenClient.requestAccessToken).toHaveBeenCalledTimes(2);
    expect(flow.requests.length).toBeGreaterThanOrEqual(2); expect(flow.requests[0].url).toBe(flow.requests[1].url); expect(flow.requests[0].token).not.toBe(flow.requests[1].token);
  });

  test('does not enter a popup loop after a Drive 403; a later explicit retry remains possible', async () => {
    const flow = connection(); flow.setAlways403(); await flow.provider.signIn();
    await expect(flow.api.getFile(ROOT)).rejects.toMatchObject({ status: 403 });
    await expect(flow.api.getFile(ROOT)).rejects.toMatchObject({ status: 403 });
    expect(flow.tokenClient.requestAccessToken).toHaveBeenCalledTimes(1);
    const retry = connection(); retry.setPopupError('popup_closed');
    await expect(retry.provider.signIn()).rejects.toThrow('已取消'); retry.setPopupError(); await retry.provider.signIn();
    await expect(retry.api.getFile(ROOT)).resolves.toMatchObject({ id: ROOT });
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
