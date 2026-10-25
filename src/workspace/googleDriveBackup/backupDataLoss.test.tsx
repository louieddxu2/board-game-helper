import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createNode, createTable, emptyWorkspace } from '../model';
import { workspaceStructureChangeRevision, workspaceTableChangeRevision } from '../changeRevisions';
import type { WorkspaceData } from '../types';
import { GOOGLE_DRIVE_AUTO_BACKUP_INTERVAL_MS, useWorkspaceGoogleDriveBackup } from './useWorkspaceGoogleDriveBackup';

const cloud = vi.hoisted(() => ({ find: vi.fn(), list: vi.fn(), backup: vi.fn(), restore: vi.fn() }));
vi.mock('./index', async importOriginal => ({
  ...await importOriginal<typeof import('./index')>(),
  createGoogleIdentityTokenProvider: () => ({ isAuthorized: true, signIn: async () => 'token' }),
  createGoogleDriveSnapshotBackup: () => ({ findRemoteFile: cloud.find, listRemoteBackups: cloud.list,
    backup: cloud.backup, restore: cloud.restore }),
  createGoogleDriveSingleFileBackup: () => ({ findRemoteFile: async () => null }),
}));

const recordKey = 'board-game-helper-google-drive-backup';
const autoKey = 'board-game-helper-google-drive-auto-backup';
const remote = { id: 'last-good-manifest', name: 'manifest.xlsx', modifiedTime: '2026-10-25T01:00:00Z' };
const now = new Date('2026-10-25T02:00:00Z');
const populated = (): WorkspaceData => {
  const table = { ...createTable('收藏'), id: 'original-table', changeRevision: 'edited' };
  return { ...emptyWorkspace(), structureRevision: 'edited-structure', tables: [table],
    nodes: [createNode('table', table.name, null, 0, table.id)] };
};
const saveBaseline = (storageIdentity: string | undefined = 'original-db') => {
  window.localStorage.setItem(recordKey, JSON.stringify({ ...remote, fileId: remote.id, fileName: remote.name,
    remoteModifiedTime: remote.modifiedTime, lastBackupAt: now.getTime() - GOOGLE_DRIVE_AUTO_BACKUP_INTERVAL_MS - 1,
    storageIdentity, structureRevision: 'previous-structure', tableBackups: {} }));
};
const render = (data: WorkspaceData, loadStorageIdentity = async () => 'original-db') => renderHook(({ value }) =>
  useWorkspaceGoogleDriveBackup({ data: value, loadStorageIdentity, loadGoogleClientId: async () => 'client',
    onRestored: vi.fn(), setNotice: vi.fn() }), { initialProps: { value: data } });

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  window.localStorage.clear(); window.localStorage.setItem(autoKey, 'true');
  Object.values(cloud).forEach(mock => mock.mockReset());
  cloud.find.mockResolvedValue(remote); cloud.list.mockResolvedValue([remote]);
  cloud.backup.mockImplementation(async (data: WorkspaceData) => ({ file: remote,
    manifest: { tables: data.tables.map(table => ({ id: table.id, updatedAt: table.updatedAt,
      changeRevision: workspaceTableChangeRevision(table), driveFileId: `drive-${table.id}` })),
    folders: [], structureRevision: workspaceStructureChangeRevision(data) } }));
});
afterEach(() => { vi.useRealTimers(); window.localStorage.clear(); });

describe('backup protection after browser data deletion', () => {
  test.each(['original-db', 'recreated-db'])('never uploads a zero-table workspace with storage identity %s', async identity => {
    saveBaseline();
    const hook = render(emptyWorkspace(), async () => identity);
    await act(async () => { await hook.result.current.connect(); });
    expect(hook.result.current.backupSafety).toBe('empty');
    expect(hook.result.current.dialogOpen).toBe(true);
    expect(hook.result.current.remoteFile?.id).toBe(remote.id);
    await act(async () => { await vi.advanceTimersByTimeAsync(GOOGLE_DRIVE_AUTO_BACKUP_INTERVAL_MS + 2_000); });
    await act(async () => { expect(await hook.result.current.backup()).toBe(false); });
    await act(async () => { expect(await hook.result.current.backup({ force: true })).toBe(false); });
    expect(cloud.backup).not.toHaveBeenCalled();
    expect(hook.result.current.record.fileId).toBe(remote.id);
  });

  test('cleared settings still produce a warning and enabling automatic backup cannot bypass it', async () => {
    window.localStorage.clear();
    const hook = render(emptyWorkspace(), async () => 'recreated-db');
    await act(async () => { await hook.result.current.connect(); });
    expect(hook.result.current.backupSafety).toBe('empty');
    expect(hook.result.current.dialogOpen).toBe(true);
    act(() => hook.result.current.setAutoBackupEnabled(true));
    await act(async () => { await vi.advanceTimersByTimeAsync(GOOGLE_DRIVE_AUTO_BACKUP_INTERVAL_MS + 2_000); });
    expect(cloud.backup).not.toHaveBeenCalled();
  });

  test('closing, reopening and reconnecting do not approve data that appears after the empty warning', async () => {
    saveBaseline();
    const hook = render(emptyWorkspace());
    await act(async () => { await hook.result.current.connect(); });
    act(() => hook.result.current.close());
    hook.rerender({ value: populated() });
    act(() => hook.result.current.open());
    await act(async () => { await hook.result.current.connect(); });
    act(() => { hook.result.current.setAutoBackupEnabled(false); hook.result.current.setAutoBackupEnabled(true); });
    act(() => window.dispatchEvent(new Event('online')));
    await act(async () => { await vi.advanceTimersByTimeAsync(GOOGLE_DRIVE_AUTO_BACKUP_INTERVAL_MS + 2_000); });
    expect(hook.result.current.backupSafety).toBe('unconfirmed');
    expect(cloud.backup).not.toHaveBeenCalled();
    await act(async () => { expect(await hook.result.current.backup()).toBe(false); });
    await act(async () => { expect(await hook.result.current.backup({ force: true })).toBe(true); });
    expect(hook.result.current.backupSafety).toBeUndefined();
    expect(cloud.backup).toHaveBeenCalledTimes(1);
  });

  test.each(['recreated-db', 'legacy'])('requires explicit overwrite for %s even when the cloud receipt matches', async scenario => {
    if (scenario === 'legacy') saveBaseline(undefined); else saveBaseline();
    // Omit the identity exactly as a pre-upgrade record would.
    if (scenario === 'legacy') {
      const value = JSON.parse(window.localStorage.getItem(recordKey)!);
      delete value.storageIdentity; window.localStorage.setItem(recordKey, JSON.stringify(value));
    }
    const identity = scenario === 'legacy' ? 'original-db' : 'recreated-db';
    const hook = render(populated(), async () => identity);
    await act(async () => { await hook.result.current.connect(); });
    expect(hook.result.current.remoteConflict).toBe(true);
    await act(async () => { await hook.result.current.findRemote(); });
    expect(hook.result.current.remoteConflict).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    await act(async () => { expect(await hook.result.current.backup()).toBe(false); });
    await act(async () => { expect(await hook.result.current.backup({ automatic: true, force: true })).toBe(false); });
    expect(cloud.backup).not.toHaveBeenCalled();
    await act(async () => { expect(await hook.result.current.backup({ force: true })).toBe(true); });
    expect(cloud.backup).toHaveBeenCalledTimes(1);
    expect(JSON.parse(window.localStorage.getItem(recordKey)!).storageIdentity).toBe(identity);
  });

  test('detects loss between connection and a scheduled upload', async () => {
    saveBaseline();
    let identity = 'original-db';
    const hook = render(populated(), async () => identity);
    await act(async () => { await hook.result.current.connect(); });
    expect(hook.result.current.remoteConflict).toBe(false);
    identity = 'recreated-db';
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
    expect(hook.result.current.remoteConflict).toBe(true);
    expect(cloud.backup).not.toHaveBeenCalled();
  });

  test('still backs up ordinary edits in the same database automatically', async () => {
    saveBaseline(); const hook = render(populated());
    await act(async () => { await hook.result.current.connect(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
    expect(cloud.backup).toHaveBeenCalledTimes(1);
    expect(hook.result.current.record.storageIdentity).toBe('original-db');
  });

  test('does not adopt existing cloud contents when all local backup settings were cleared', async () => {
    const hook = render(populated(), async () => 'recreated-db');
    await act(async () => { await hook.result.current.connect(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(hook.result.current.remoteConflict).toBe(true);
    expect(cloud.backup).not.toHaveBeenCalled();
  });

  test('a surviving pending journal cannot bypass the missing local receipt identity', async () => {
    cloud.find.mockResolvedValue({ ...remote, appProperties: { pendingLocalCommit: 'true' } });
    const hook = render(populated(), async () => 'recreated-db');
    await act(async () => { await hook.result.current.connect(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(hook.result.current.remoteConflict).toBe(true);
    await act(async () => { expect(await hook.result.current.backup()).toBe(false); });
    expect(cloud.backup).not.toHaveBeenCalled();
  });

  test('fails closed when the database identity cannot be read', async () => {
    saveBaseline();
    const hook = render(populated(), async () => { throw new Error('storage unavailable'); });
    await act(async () => { expect(await hook.result.current.backup()).toBe(false); });
    expect(hook.result.current.error).toBe('storage unavailable');
    expect(cloud.backup).not.toHaveBeenCalled();
  });

  test('keeps uploads paused after downloading a restore into its confirmation preview', async () => {
    saveBaseline(); cloud.restore.mockResolvedValue(populated());
    const data = populated();
    const hook = renderHook(() => {
      const [preview, setPreview] = useState(false);
      const backup = useWorkspaceGoogleDriveBackup({ data, loadStorageIdentity: async () => 'original-db',
        loadGoogleClientId: async () => 'client', backupBlockedReason: preview ? '請先確認或取消匯入預覽' : undefined,
        onRestored: () => setPreview(true), setNotice: vi.fn() });
      return { ...backup, finishPreview: () => setPreview(false) };
    });
    await act(async () => { await hook.result.current.connect(); });
    await act(async () => { await hook.result.current.findRemote(); });
    await act(async () => { await hook.result.current.restore(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(cloud.backup).not.toHaveBeenCalled();
    await act(async () => { expect(await hook.result.current.backup({ force: true })).toBe(false); });
    expect(cloud.backup).not.toHaveBeenCalled();
    act(() => hook.result.current.finishPreview());
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
    expect(cloud.backup).toHaveBeenCalledTimes(1);
  });
});
