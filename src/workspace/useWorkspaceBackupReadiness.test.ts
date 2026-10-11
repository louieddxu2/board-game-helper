import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceBackupReadiness } from './useWorkspaceBackupReadiness';
import type { WorkspaceReadiness } from './useReadyWorkspaceActions';

vi.mock('./backgroundWork', () => ({ afterWorkspacePaint: (work: () => void) => { work(); return () => undefined; } }));
afterEach(cleanup);
const fixture = () => {
  let finish!: () => void;
  const loading = new Promise<void>(resolve => { finish = resolve; });
  const readiness: WorkspaceReadiness = { isReady: () => false, ensure: vi.fn(() => loading), onError: vi.fn() };
  const drive = { backup: vi.fn(async () => true), autoBackupEnabled: false, authorized: true, online: true, manuallyDisconnected: false, remoteConflict: false, busy: null };
  return { drive, readiness, finish, loading };
};

describe('Drive backup readiness', () => {
  it('waits for complete data, uses the latest upload callback, and rejects repeated clicks while loading', async () => {
    const { drive, readiness, finish, loading } = fixture();
    const { result, rerender } = renderHook(current => useWorkspaceBackupReadiness(current, readiness, vi.fn()), { initialProps: drive });
    expect(readiness.ensure).not.toHaveBeenCalled();
    const upload = result.current({ force: true });
    expect(await result.current()).toBe(false);
    expect(readiness.ensure).toHaveBeenCalledExactlyOnceWith('all');
    expect(drive.backup).not.toHaveBeenCalled();
    const latest = { ...drive, backup: vi.fn(async () => true) };
    rerender(latest);
    await act(async () => { finish(); await loading; expect(await upload).toBe(true); });
    expect(latest.backup).toHaveBeenCalledExactlyOnceWith({ force: true });
    expect(drive.backup).not.toHaveBeenCalled();
  });

  it.each(['enabled', 'disabled', 'offline', 'disconnected', 'conflict'] as const)('prepares full data only for a usable enabled automatic backup (%s)', mode => {
    const { drive, readiness } = fixture();
    const current = { ...drive, autoBackupEnabled: mode !== 'disabled', online: mode !== 'offline', manuallyDisconnected: mode === 'disconnected', remoteConflict: mode === 'conflict' };
    renderHook(() => useWorkspaceBackupReadiness(current, readiness, vi.fn()));
    if (mode === 'enabled') expect(readiness.ensure).toHaveBeenCalledExactlyOnceWith('all');
    else expect(readiness.ensure).not.toHaveBeenCalled();
    expect(current.backup).not.toHaveBeenCalled();
  });

  it('does not upload after the workspace unmounts during loading', async () => {
    const { drive, readiness, finish, loading } = fixture();
    const { result, unmount } = renderHook(() => useWorkspaceBackupReadiness(drive, readiness, vi.fn()));
    const upload = result.current();
    unmount();
    await act(async () => { finish(); await loading; expect(await upload).toBe(false); });
    expect(drive.backup).not.toHaveBeenCalled();
  });
});
