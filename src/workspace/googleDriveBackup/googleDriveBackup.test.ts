import { describe, expect, it, vi } from 'vitest';
import { BackupNotFoundError, createGoogleDriveSingleFileBackup, createGoogleIdentityTokenProvider } from './index';

const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

const createBackup = (fetchImpl: typeof fetch, folderPath: readonly string[] = ['Test App', 'Backups']) => createGoogleDriveSingleFileBackup({
  tokenProvider: { getAccessToken: vi.fn(async () => 'test-token') },
  folderPath,
  backupKey: 'main-workspace',
  fileName: 'workspace.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  fetchImpl,
});

describe('Google Drive single-file backup boundary', () => {
  it('creates one folder path and uploads the first workbook', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ files: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'folder-app', name: 'Test App', mimeType: 'application/vnd.google-apps.folder' }))
      .mockResolvedValueOnce(jsonResponse({ files: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'folder-backups', name: 'Backups', mimeType: 'application/vnd.google-apps.folder' }))
      .mockResolvedValueOnce(jsonResponse({ files: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'file-1', name: 'workspace.xlsx', appProperties: { backupKey: 'main-workspace' } }));

    const receipt = await createBackup(fetchImpl as typeof fetch).backup('xlsx', { sourceUpdatedAt: 123 });
    expect(receipt.file.id).toBe('file-1');
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    const upload = fetchImpl.mock.calls[5];
    expect(upload[1]?.method).toBe('POST');
    expect(new Headers(upload[1]?.headers).get('content-type')).toContain('multipart/related');
    expect(upload[1]?.body).toBeInstanceOf(Uint8Array);
  });

  it('updates the tagged workbook instead of creating a duplicate', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ files: [{ id: 'file-1', name: 'old.xlsx', appProperties: { backupKey: 'main-workspace' } }] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'file-1', name: 'workspace.xlsx' }));
    const backup = createBackup(fetchImpl as typeof fetch, []);
    await backup.backup('first');
    fetchImpl.mockReset()
      .mockResolvedValueOnce(jsonResponse({ files: [{ id: 'file-1', name: 'old.xlsx', appProperties: { backupKey: 'main-workspace' } }] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'file-1', name: 'workspace.xlsx' }));

    await backup.backup('second');
    expect(fetchImpl.mock.calls[1][1]?.method).toBe('PATCH');
    expect(String(fetchImpl.mock.calls[1][0])).toContain('/files/file-1');
  });

  it('restores a tagged workbook as a Blob', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ files: [{ id: 'file-1', name: 'workspace.xlsx', appProperties: { backupKey: 'main-workspace' } }] }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
    const restored = await createBackup(fetchImpl as typeof fetch, []).restore();
    expect(restored).toBeInstanceOf(Blob);
    expect(String(fetchImpl.mock.calls[1][0])).toContain('alt=media');
  });

  it('reports a missing backup without changing local state', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ files: [] }));
    await expect(createBackup(fetchImpl as typeof fetch, []).restore()).rejects.toBeInstanceOf(BackupNotFoundError);
  });
});

describe('Google Identity token provider', () => {
  it('keeps the access token in memory and revokes it on sign out', async () => {
    const revoke = vi.fn((_token: string, done: () => void) => done());
    const tokenClient = {
      callback: (_response: { access_token?: string; expires_in?: number }): void => {},
      requestAccessToken: vi.fn(() => tokenClient.callback({ access_token: 'token-1', expires_in: 3600 })),
    };
    const windowRef = { google: { accounts: { oauth2: {
      initTokenClient: vi.fn((options: { callback: typeof tokenClient.callback }) => { tokenClient.callback = options.callback; return tokenClient; }),
      revoke,
    } } } } as unknown as import('./types').GoogleIdentityWindow;
    const documentRef = { body: { appendChild: vi.fn() }, getElementById: vi.fn(() => null), createElement: vi.fn() };
    const provider = createGoogleIdentityTokenProvider({ clientId: 'public-client-id', windowRef, documentRef });

    expect(await provider.getAccessToken()).toBe('token-1');
    expect(await provider.getAccessToken()).toBe('token-1');
    expect(tokenClient.requestAccessToken).toHaveBeenCalledTimes(1);
    await provider.signOut();
    expect(revoke).toHaveBeenCalledWith('token-1', expect.any(Function));
    expect(provider.isAuthorized).toBe(false);
  });
});
