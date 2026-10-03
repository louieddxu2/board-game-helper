import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTable } from '../model';
import type { WorkspaceData } from '../types';
import { workspaceStructureChangeRevision, workspaceTableChangeRevision } from '../changeRevisions';
import { GOOGLE_DRIVE_AUTO_BACKUP_INTERVAL_MS, useWorkspaceGoogleDriveBackup } from './useWorkspaceGoogleDriveBackup';

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(async () => 'token'),
  signOut: vi.fn(async () => undefined),
  findRemoteFile: vi.fn(),
  backup: vi.fn(),
  restore: vi.fn(),
}));

vi.mock('./index', async () => {
  const actual = await vi.importActual<typeof import('./index')>('./index');
  return {
    ...actual,
    createGoogleIdentityTokenProvider: vi.fn(() => ({ isAuthorized: true, signIn: mocks.signIn, signOut: mocks.signOut, getAccessToken: vi.fn(async () => 'token') })),
    createGoogleDriveFolderBackup: vi.fn(() => ({
      findRemoteFile: mocks.findRemoteFile,
      backup: mocks.backup,
      restore: mocks.restore,
    })),
    createGoogleDriveSingleFileBackup: vi.fn(() => ({ findRemoteFile: vi.fn(async () => null), restore: vi.fn() })),
  };
});

const recordKey = 'board-game-helper-google-drive-backup';
const autoBackupKey = 'board-game-helper-google-drive-auto-backup';
const now = new Date('2026-08-21T10:00:00.000Z');

const createData = (updatedAt = now.getTime()): WorkspaceData => {
  const first = { ...createTable('表格 A'), updatedAt, changeRevision: 'table-revision-a' };
  const second = { ...createTable('表格 B'), updatedAt, changeRevision: 'table-revision-b' };
  return { version: 1, nodes: [], tables: [first, second], activeNodeId: null, updatedAt, structureRevision: 'structure-revision-a' };
};

const renderBackup = (data = createData(), inspectChanges = true) => renderHook(({ value, inspect }: { value: WorkspaceData; inspect?: boolean }) => useWorkspaceGoogleDriveBackup({
  data: value,
  inspectChanges: inspect,
  loadGoogleClientId: vi.fn(async () => 'client-id'),
  onRestored: vi.fn(),
  setNotice: vi.fn(),
}), { initialProps: { value: data, inspect: inspectChanges } });

const receiptFor = (data: WorkspaceData) => ({
  file: { id: 'manifest-new', name: 'manifest.xlsx', modifiedTime: '2026-08-21T10:00:02.000Z' },
  manifest: {
    tables: data.tables.map((table) => ({ id: table.id, updatedAt: table.updatedAt, changeRevision: workspaceTableChangeRevision(table), driveFileId: `drive-${table.id}`, nodeId: '', folderId: null, name: table.name, fileName: `${table.name}.xlsx` })),
    folders: [],
    structureRevision: workspaceStructureChangeRevision(data),
  },
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  window.localStorage.clear();
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.signIn.mockResolvedValue('token');
  mocks.signOut.mockResolvedValue(undefined);
  mocks.findRemoteFile.mockResolvedValue(null);
  mocks.backup.mockImplementation(async (data: WorkspaceData) => {
    const receipt = receiptFor(data);
    mocks.findRemoteFile.mockResolvedValue(receipt.file);
    return receipt;
  });
});

afterEach(() => vi.useRealTimers());

describe('workspace Google Drive automatic backup scheduling', () => {
  it('blocks manual and automatic uploads until local data is saved', async () => {
    window.localStorage.setItem(autoBackupKey, 'true');
    const { result } = renderHook(() => useWorkspaceGoogleDriveBackup({
      data: createData(),
      backupBlockedReason: '本機資料尚未完成儲存',
      loadGoogleClientId: async () => 'client-id',
      onRestored: vi.fn(),
      setNotice: vi.fn(),
    }));
    await act(async () => { await result.current.connect(); });
    await act(async () => { expect(await result.current.backup()).toBe(false); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(result.current.error).toBe('本機資料尚未完成儲存');
    expect(mocks.backup).not.toHaveBeenCalled();
  });

  it('checks local storage freshness before an upload and reports another-tab edits', async () => {
    const verifyCurrentData = vi.fn(async () => {
      const error = new Error('stale');
      error.name = 'WorkspaceStorageConflictError';
      throw error;
    });
    const onStorageConflict = vi.fn();
    const { result } = renderHook(() => useWorkspaceGoogleDriveBackup({
      data: createData(),
      verifyCurrentData,
      onStorageConflict,
      loadGoogleClientId: async () => 'client-id',
      onRestored: vi.fn(),
      setNotice: vi.fn(),
    }));
    await act(async () => { await result.current.connect(); });
    await act(async () => { expect(await result.current.backup()).toBe(false); });
    expect(verifyCurrentData).toHaveBeenCalledTimes(1);
    expect(onStorageConflict).toHaveBeenCalledTimes(1);
    expect(mocks.backup).not.toHaveBeenCalled();
  });

  it('does not upload an obsolete snapshot after a newer local edit', async () => {
    const { result } = renderHook(() => useWorkspaceGoogleDriveBackup({
      data: createData(),
      isCurrentData: () => false,
      loadGoogleClientId: async () => 'client-id',
      onRestored: vi.fn(),
      setNotice: vi.fn(),
    }));
    await act(async () => { await result.current.connect(); });
    await act(async () => { expect(await result.current.backup()).toBe(false); });
    expect(result.current.error).toContain('備份準備期間已有變更');
    expect(mocks.backup).not.toHaveBeenCalled();
  });

  it('defers revision inspection until the backup drawer opens', () => {
    const savedData = createData();
    const currentData = {
      ...savedData,
      tables: savedData.tables.map((table, index) => index === 0 ? { ...table, name: '尚未備份的新名稱', updatedAt: table.updatedAt + 1, changeRevision: 'table-revision-a-new' } : table),
    };
    window.localStorage.setItem(recordKey, JSON.stringify({
      fileId: 'manifest-saved', fileName: 'manifest.xlsx', lastBackupAt: now.getTime(), sourceUpdatedAt: savedData.updatedAt,
      remoteModifiedTime: '2026-08-21T09:59:00.000Z', tableCount: savedData.tables.length, folderCount: 0,
      structureRevision: workspaceStructureChangeRevision(savedData),
      tableBackups: Object.fromEntries(savedData.tables.map((table) => [table.id, {
        lastBackupAt: now.getTime(), sourceUpdatedAt: table.updatedAt,
        changeRevision: workspaceTableChangeRevision(table), driveFileId: `drive-${table.id}`,
      }])),
    }));

    const hook = renderBackup(currentData, false);
    expect(hook.result.current.status).toBe('checking');

    hook.rerender({ value: currentData, inspect: true });
    expect(hook.result.current.status).toBe('dirty');
  });

  it('checks revisions without traversing table rows or cell values', () => {
    const source = createData();
    const trappedTable = { ...source.tables[0] };
    Object.defineProperty(trappedTable, 'rows', {
      configurable: true,
      enumerable: true,
      get() { throw new Error('backup inspection must not read table rows'); },
    });
    const data = { ...source, tables: [trappedTable, source.tables[1]] };
    window.localStorage.setItem(recordKey, JSON.stringify({
      fileId: 'manifest-saved', fileName: 'manifest.xlsx', lastBackupAt: now.getTime(), sourceUpdatedAt: data.updatedAt,
      remoteModifiedTime: '2026-08-21T09:59:00.000Z', tableCount: data.tables.length, folderCount: 0,
      structureRevision: workspaceStructureChangeRevision(data),
      tableBackups: Object.fromEntries(data.tables.map((table) => [table.id, {
        lastBackupAt: now.getTime(), sourceUpdatedAt: table.updatedAt,
        changeRevision: workspaceTableChangeRevision(table), driveFileId: `drive-${table.id}`,
      }])),
    }));

    const hook = renderBackup(data);

    expect(hook.result.current.status).toBe('saved');
  });

  it('drops legacy fingerprint fields when it rewrites the local backup record', async () => {
    const data = createData();
    window.localStorage.setItem(recordKey, JSON.stringify({
      fileId: null, fileName: null, lastBackupAt: now.getTime(), sourceUpdatedAt: data.updatedAt,
      remoteModifiedTime: null, tableCount: data.tables.length, folderCount: 0,
      structureFingerprint: 'legacy-structure',
      tableBackups: Object.fromEntries(data.tables.map((table) => [table.id, {
        lastBackupAt: now.getTime(), sourceUpdatedAt: table.updatedAt,
        contentFingerprint: 'legacy-content', driveFileId: `drive-${table.id}`,
      }])),
    }));
    const hook = renderBackup(data);

    await act(async () => { await hook.result.current.connect(); });
    await act(async () => { expect(await hook.result.current.backup()).toBe(true); });

    const stored = JSON.parse(window.localStorage.getItem(recordKey) ?? '{}') as Record<string, unknown>;
    expect(stored).not.toHaveProperty('structureFingerprint');
    expect(stored).toHaveProperty('structureRevision');
    for (const backup of Object.values((stored.tableBackups ?? {}) as Record<string, Record<string, unknown>>)) {
      expect(backup).not.toHaveProperty('contentFingerprint');
      expect(backup).toHaveProperty('changeRevision');
    }
  });

  it('starts connecting as soon as the drawer entry opens the backup dialog', async () => {
    const { result } = renderBackup();

    act(() => result.current.open());
    expect(result.current.dialogOpen).toBe(true);
    await act(async () => { await Promise.resolve(); });
    expect(mocks.signIn).toHaveBeenCalledTimes(1);
  });

  it('waits for the full debounce before the first automatic upload', async () => {
    window.localStorage.setItem(autoBackupKey, 'true');
    const { result } = renderBackup();
    await act(async () => { await result.current.connect(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_499); });
    expect(mocks.backup).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(mocks.backup).toHaveBeenCalledTimes(1);
  });

  it('waits for one explicit reconnect after a page reload, then resumes automatic backup', async () => {
    window.localStorage.setItem(autoBackupKey, 'true');
    window.localStorage.setItem(recordKey, JSON.stringify({
      fileId: 'manifest-old', fileName: 'manifest.xlsx', lastBackupAt: now.getTime() - GOOGLE_DRIVE_AUTO_BACKUP_INTERVAL_MS - 1,
      sourceUpdatedAt: now.getTime() - 10_000, remoteModifiedTime: '2026-08-21T09:00:00.000Z', tableCount: 2, folderCount: 0,
    }));
    mocks.findRemoteFile.mockResolvedValue({ id: 'manifest-old', name: 'manifest.xlsx', modifiedTime: '2026-08-21T09:00:00.000Z' });
    const { result } = renderBackup();

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.findRemoteFile).not.toHaveBeenCalled();
    expect(mocks.backup).not.toHaveBeenCalled();

    await act(async () => { await result.current.connect(); });
    expect(mocks.signIn).toHaveBeenCalledWith();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
    expect(mocks.backup).toHaveBeenCalledTimes(1);
  });

  it('detects an existing remote snapshot on connect and blocks automatic overwrite', async () => {
    window.localStorage.setItem(autoBackupKey, 'true');
    mocks.findRemoteFile.mockResolvedValue({ id: 'manifest-remote', name: 'manifest.xlsx', modifiedTime: '2026-08-21T09:30:00.000Z' });
    const { result } = renderBackup();

    await act(async () => { await result.current.connect(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });

    expect(result.current.remoteConflict).toBe(true);
    expect(result.current.remoteFile?.id).toBe('manifest-remote');
    expect(mocks.backup).not.toHaveBeenCalled();
  });

  it('treats concurrent manifest branches as a conflict even when one head matches this device', async () => {
    const data = createData();
    window.localStorage.setItem(recordKey, JSON.stringify({
      fileId: 'manifest-current', fileName: 'manifest.xlsx', lastBackupAt: now.getTime(), sourceUpdatedAt: now.getTime(),
      remoteModifiedTime: '2026-08-21T09:59:00.000Z', tableCount: 2, folderCount: 0,
      structureRevision: workspaceStructureChangeRevision(data), tableBackups: {},
    }));
    mocks.findRemoteFile.mockResolvedValue({
      id: 'manifest-current', name: 'manifest.xlsx', modifiedTime: '2026-08-21T09:59:00.000Z', appProperties: { backupForkCount: '2' },
    });
    const { result } = renderBackup(data);
    await act(async () => { await result.current.connect(); });
    expect(result.current.remoteConflict).toBe(true);
  });

  it('checks the remote version before upload and requires force to replace it', async () => {
    const data = createData();
    window.localStorage.setItem(recordKey, JSON.stringify({
      fileId: 'manifest-old', fileName: 'manifest.xlsx', lastBackupAt: now.getTime() - 60_000,
      sourceUpdatedAt: now.getTime() - 10_000, remoteModifiedTime: '2026-08-21T09:00:00.000Z', tableCount: 2, folderCount: 0,
      structureRevision: workspaceStructureChangeRevision(data), tableBackups: {},
    }));
    mocks.findRemoteFile.mockResolvedValue({ id: 'manifest-old', name: 'manifest.xlsx', modifiedTime: '2026-08-21T09:30:00.000Z' });
    const { result } = renderBackup(data);
    await act(async () => { await result.current.connect(); });

    await act(async () => { expect(await result.current.backup()).toBe(false); });
    expect(mocks.backup).not.toHaveBeenCalled();
    expect(result.current.remoteConflict).toBe(true);

    await act(async () => { expect(await result.current.backup({ force: true })).toBe(true); });
    expect(mocks.backup).toHaveBeenCalledTimes(1);
  });

  it('throttles each Excel independently while manual backup remains complete', async () => {
    window.localStorage.setItem(autoBackupKey, 'true');
    const data = createData();
    const [first, second] = data.tables;
    window.localStorage.setItem(recordKey, JSON.stringify({
      fileId: 'manifest-current', fileName: 'manifest.xlsx', lastBackupAt: now.getTime(), sourceUpdatedAt: now.getTime() - 10_000,
      remoteModifiedTime: '2026-08-21T09:59:00.000Z', tableCount: 2, folderCount: 0,
      structureRevision: workspaceStructureChangeRevision(data),
      tableBackups: {
        [first.id]: { lastBackupAt: now.getTime(), sourceUpdatedAt: first.updatedAt - 1, changeRevision: 'old-a', driveFileId: 'drive-a' },
        [second.id]: { lastBackupAt: now.getTime() - GOOGLE_DRIVE_AUTO_BACKUP_INTERVAL_MS - 1, sourceUpdatedAt: second.updatedAt - 1, changeRevision: 'old-b', driveFileId: 'drive-b' },
      },
    }));
    mocks.findRemoteFile.mockResolvedValue({ id: 'manifest-current', name: 'manifest.xlsx', modifiedTime: '2026-08-21T09:59:00.000Z' });
    const { result } = renderBackup(data);
    await act(async () => { await result.current.connect(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });

    expect(mocks.backup).toHaveBeenCalledTimes(1);
    expect(mocks.backup.mock.calls[0][2]).toMatchObject({ complete: false, tableIds: [second.id] });

    mocks.backup.mockClear();
    await act(async () => { await result.current.backup(); });
    expect(mocks.backup.mock.calls[0][2]).toMatchObject({ complete: true, tableIds: [first.id, second.id] });
  });

  it('resumes a pending automatic backup after connectivity returns', async () => {
    window.localStorage.setItem(autoBackupKey, 'true');
    const { result } = renderBackup();
    await act(async () => { await result.current.connect(); });
    act(() => window.dispatchEvent(new Event('offline')));
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(mocks.backup).not.toHaveBeenCalled();

    act(() => window.dispatchEvent(new Event('online')));
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
    expect(mocks.backup).toHaveBeenCalledTimes(1);
  });

  it('retries an automatic failure after the retry interval', async () => {
    window.localStorage.setItem(autoBackupKey, 'true');
    mocks.backup.mockRejectedValueOnce(new Error('temporary failure'));
    const { result } = renderBackup();
    await act(async () => { await result.current.connect(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
    expect(mocks.backup).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(GOOGLE_DRIVE_AUTO_BACKUP_INTERVAL_MS + 1_500); });
    expect(mocks.backup).toHaveBeenCalledTimes(2);
  });

  it('keeps edits made during an upload pending for that Excel next window', async () => {
    window.localStorage.setItem(autoBackupKey, 'true');
    let resolveUpload!: (value: ReturnType<typeof receiptFor>) => void;
    const pendingUpload = new Promise<ReturnType<typeof receiptFor>>((resolve) => { resolveUpload = resolve; });
    let uploadedData: WorkspaceData | undefined;
    mocks.backup.mockImplementationOnce(async (value: WorkspaceData) => {
      uploadedData = value;
      mocks.findRemoteFile.mockResolvedValue(receiptFor(value).file);
      return pendingUpload;
    });
    const original = createData();
    const hook = renderBackup(original);
    await act(async () => { await hook.result.current.connect(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });

    const edited = { ...original, tables: original.tables.map((table, index) => index === 0 ? { ...table, name: '上傳期間的新名稱', updatedAt: table.updatedAt + 1, changeRevision: 'table-revision-a-during-upload' } : table), updatedAt: original.updatedAt! + 1 };
    hook.rerender({ value: edited, inspect: true });
    await act(async () => { resolveUpload(receiptFor(uploadedData!)); await pendingUpload; });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(hook.result.current.busy).toBeNull();
    expect(hook.result.current.status).toBe('dirty');

    await act(async () => { await vi.advanceTimersByTimeAsync(GOOGLE_DRIVE_AUTO_BACKUP_INTERVAL_MS + 1_500); });
    expect(mocks.backup).toHaveBeenCalledTimes(2);
  });

  it('does not schedule again after an explicit disconnect', async () => {
    window.localStorage.setItem(autoBackupKey, 'true');
    const { result } = renderBackup();
    await act(async () => { await result.current.connect(); });
    await act(async () => { await result.current.disconnect(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(GOOGLE_DRIVE_AUTO_BACKUP_INTERVAL_MS + 2_000); });
    expect(mocks.backup).not.toHaveBeenCalled();
  });
});
