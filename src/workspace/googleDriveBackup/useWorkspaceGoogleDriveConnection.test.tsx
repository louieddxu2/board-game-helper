import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useWorkspaceGoogleDriveBackup } from './useWorkspaceGoogleDriveBackup';
import { GoogleDriveApiError } from './googleDriveApi';
import { GOOGLE_DRIVE_MANUAL_DISCONNECT_STORAGE_KEY } from './googleIdentityTokenProvider';

const mocks = vi.hoisted(() => ({ signIn: vi.fn(), signOut: vi.fn(), find: vi.fn(), list: vi.fn(), backup: vi.fn() }));
vi.mock('./index', async () => ({
  ...await vi.importActual<typeof import('./index')>('./index'),
  createGoogleIdentityTokenProvider: () => ({ isAuthorized: true, signIn: mocks.signIn, signOut: mocks.signOut }),
  createGoogleDriveSnapshotBackup: () => ({ findRemoteFile: mocks.find, listRemoteBackups: mocks.list, backup: mocks.backup }),
  createGoogleDriveSingleFileBackup: () => ({ findRemoteFile: async () => null }),
}));

const renderConnection = () => renderHook(() => useWorkspaceGoogleDriveBackup({ inspectChanges: false,
  loadGoogleClientId: async () => 'client', onRestored: vi.fn(), setNotice: vi.fn() }));

describe('Workspace connection recovery', () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.values(mocks).forEach(mock => mock.mockReset());
    mocks.signIn.mockResolvedValue('token');
    mocks.find.mockResolvedValue(null);
    mocks.list.mockResolvedValue([]);
  });
  afterEach(() => window.localStorage.clear());

  test('keeps reconnect available after OAuth succeeds but Drive rejects access', async () => {
    window.localStorage.setItem(GOOGLE_DRIVE_MANUAL_DISCONNECT_STORAGE_KEY, 'true');
    mocks.find.mockRejectedValueOnce(new GoogleDriveApiError('請重新連結 Google Drive', 403));
    const { result } = renderConnection();
    await act(async () => { await result.current.connect(); });
    expect(result.current.authorized).toBe(false);
    expect(result.current.manuallyDisconnected).toBe(false);
    expect(result.current.busy).toBeNull();
    expect(result.current.error).toContain('重新連結');
    expect(window.localStorage.getItem(GOOGLE_DRIVE_MANUAL_DISCONNECT_STORAGE_KEY)).toBeNull();
    await act(async () => { await result.current.connect(); });
    expect(result.current.authorized).toBe(true);
    expect(result.current.error).toBe('');
    expect(mocks.signIn).toHaveBeenCalledTimes(2);
    expect(mocks.backup).not.toHaveBeenCalled();
  });

  test('returns to a reconnectable state when a later cloud read rejects the grant', async () => {
    const { result } = renderConnection();
    await act(async () => { await result.current.connect(); });
    expect(result.current.authorized).toBe(true);
    mocks.list.mockRejectedValueOnce(new GoogleDriveApiError('請重新連結 Google Drive', 403));
    await act(async () => { await result.current.findRemote(); });
    expect(result.current.authorized).toBe(false);
    expect(result.current.busy).toBeNull();
    expect(mocks.signIn).toHaveBeenCalledTimes(1);
    await act(async () => { await result.current.connect(); });
    expect(result.current.authorized).toBe(true);
    expect(mocks.signIn).toHaveBeenCalledTimes(2);
  });
});
