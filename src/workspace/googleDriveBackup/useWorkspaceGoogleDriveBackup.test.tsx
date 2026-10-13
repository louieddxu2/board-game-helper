import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNode, createTable } from '../model';
import { workspaceBackupTableSummary, type WorkspaceBackupSource } from '../workspaceBackupSource';
import type { WorkspaceData } from '../types';
import { workspaceStructureChangeRevision, workspaceTableChangeRevision } from '../changeRevisions';
import { GOOGLE_DRIVE_AUTO_BACKUP_INTERVAL_MS, useWorkspaceGoogleDriveBackup } from './useWorkspaceGoogleDriveBackup';
import type { FolderBackupRunOptions } from './folderBackup';

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(async () => 'token'),
  signOut: vi.fn(async () => undefined),
  findRemoteFile: vi.fn(),
  listRemoteBackups: vi.fn(),
  backup: vi.fn(),
  restore: vi.fn(),
  legacyFind: vi.fn(),
  legacyRestore: vi.fn(),
}));

vi.mock('./index', async () => {
  const actual = await vi.importActual<typeof import('./index')>('./index');
  return {
    ...actual,
    createGoogleIdentityTokenProvider: vi.fn(() => ({ isAuthorized: true, signIn: mocks.signIn, signOut: mocks.signOut, getAccessToken: vi.fn(async () => 'token') })),
    createGoogleDriveFolderBackup: vi.fn(() => ({
      findRemoteFile: mocks.findRemoteFile,
      listRemoteBackups: mocks.listRemoteBackups,
      backup: mocks.backup,
      restore: mocks.restore,
    })),
    createGoogleDriveSingleFileBackup: vi.fn(() => ({ findRemoteFile: mocks.legacyFind, restore: mocks.legacyRestore })),
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
  mocks.legacyFind.mockResolvedValue(null);
  mocks.listRemoteBackups.mockImplementation(async () => { const file = await mocks.findRemoteFile(); return file ? [file] : []; });
  mocks.backup.mockImplementation(async (data: WorkspaceData) => {
    const receipt = receiptFor(data);
    mocks.findRemoteFile.mockResolvedValue(receipt.file);
    return receipt;
  });
});

afterEach(() => vi.useRealTimers());

describe('workspace Google Drive automatic backup scheduling', () => {
  it.each(['manual', 'overwrite', 'automatic'] as const)('shows live progress for %s backup and clears it only after completion', async mode => {
    window.localStorage.setItem(autoBackupKey, 'true');
    const data = createData();
    let finish!: (value: ReturnType<typeof receiptFor>) => void;
    const upload = new Promise<ReturnType<typeof receiptFor>>(resolve => { finish = resolve; });
    mocks.backup.mockImplementationOnce(async (_data: WorkspaceData, _metadata: unknown, options: FolderBackupRunOptions) => {
      options.onProgress?.({ phase: 'uploading-table', name: data.tables[1].name, completedTables: 1, totalTables: 2 });
      return upload;
    });
    const { result } = renderBackup(data);
    await act(async () => { await result.current.connect(); });
    let pending!: Promise<boolean>;
    await act(async () => { pending = result.current.backup({ automatic: mode === 'automatic', force: mode === 'overwrite' }); });
    expect(result.current.busy).toBe('backing-up');
    expect(result.current.progress).toEqual({ phase: 'uploading-table', name: data.tables[1].name, completedTables: 1, totalTables: 2 });
    expect(result.current.record.lastBackupAt).toBeNull();
    await act(async () => { finish(receiptFor(data)); expect(await pending).toBe(true); });
    expect(result.current.progress).toBeUndefined();
    expect(result.current.busy).toBeNull();
    expect(result.current.record.lastBackupAt).toBe(now.getTime());
  });

  it('clears a failed progress display and starts preparation afresh on retry', async () => {
    const data = createData();
    mocks.backup.mockImplementationOnce(async (_data: WorkspaceData, _metadata: unknown, options: FolderBackupRunOptions) => {
      options.onProgress?.({ phase: 'uploading-table', name: data.tables[0].name, completedTables: 0, totalTables: 2 });
      throw new Error('upload failed');
    });
    let finishPrepare!: (source: WorkspaceBackupSource) => void;
    const prepareBackup = vi.fn().mockResolvedValueOnce({ tables: data.tables.map(workspaceBackupTableSummary), readTable: vi.fn(), verify: vi.fn() }).mockImplementationOnce(() => new Promise(resolve => { finishPrepare = resolve; }));
    const { result } = renderHook(() => useWorkspaceGoogleDriveBackup({ data, prepareBackup, loadGoogleClientId: async () => 'client-id', onRestored: vi.fn(), setNotice: vi.fn() }));
    await act(async () => { expect(await result.current.backup()).toBe(false); });
    expect(result.current.progress).toBeUndefined();
    expect(result.current.error).toBe('upload failed');
    let retry!: Promise<boolean>;
    await act(async () => { retry = result.current.backup(); });
    expect(result.current.progress).toEqual({ phase: 'reading-directory' });
    expect(result.current.error).toBe('');
    await act(async () => { finishPrepare({ tables: data.tables.map(workspaceBackupTableSummary), readTable: vi.fn(), verify: vi.fn() }); expect(await retry).toBe(true); });
    expect(result.current.progress).toBeUndefined();
  });

  it('backs up unloaded tables without expanding the screen data and records their actual uploaded revisions', async () => {
    const original = createData();
    const partial = { ...original, nodes: original.tables.map((table, index) => createNode('table', table.name, null, index, table.id)), tables: [original.tables[0]] };
    const source: WorkspaceBackupSource = { tables: original.tables.map(workspaceBackupTableSummary), readTable: vi.fn(), verify: vi.fn() };
    const prepareBackup = vi.fn(async () => source);
    mocks.backup.mockImplementationOnce(async (data: WorkspaceData) => { expect(data).toBe(partial); return receiptFor(original); });
    const { result } = renderHook(() => useWorkspaceGoogleDriveBackup({ data: partial, prepareBackup, loadTableSummaries: async () => source.tables, loadGoogleClientId: async () => 'client-id', onRestored: vi.fn(), setNotice: vi.fn() }));
    await act(async () => { expect(await result.current.backup()).toBe(true); });
    expect(prepareBackup).toHaveBeenCalledExactlyOnceWith(partial);
    expect(mocks.backup.mock.calls[0][2]).toMatchObject({ source, tableIds: original.tables.map(table => table.id) });
    expect(result.current.record.tableCount).toBe(2);
    expect(result.current.record.tableBackups[original.tables[1].id].changeRevision).toBe(original.tables[1].changeRevision);
    expect(partial.tables).toHaveLength(1);
    expect(result.current.status).toBe('saved');
  });

  it('includes an unloaded changed table in automatic selection and skips its unchanged neighbor', async () => {
    window.localStorage.setItem(autoBackupKey, 'true');
    const original = createData();
    const receipt = receiptFor(original);
    window.localStorage.setItem(recordKey, JSON.stringify({ fileId: receipt.file.id, fileName: receipt.file.name, lastBackupAt: now.getTime() - GOOGLE_DRIVE_AUTO_BACKUP_INTERVAL_MS, remoteModifiedTime: receipt.file.modifiedTime, structureRevision: original.structureRevision, tableBackups: Object.fromEntries(original.tables.map(table => [table.id, { changeRevision: table.changeRevision, lastBackupAt: now.getTime() - GOOGLE_DRIVE_AUTO_BACKUP_INTERVAL_MS, driveFileId: `drive-${table.id}` }])) }));
    mocks.findRemoteFile.mockResolvedValue(receipt.file);
    const changed = { ...original.tables[1], changeRevision: 'unopened-edit' };
    const partial = { ...original, nodes: original.tables.map((table, index) => createNode('table', table.name, null, index, table.id)), tables: [original.tables[0]] };
    const source: WorkspaceBackupSource = { tables: [original.tables[0], changed].map(workspaceBackupTableSummary), readTable: vi.fn(), verify: vi.fn() };
    const loadTableSummaries = vi.fn(async () => source.tables);
    mocks.backup.mockResolvedValueOnce(receiptFor({ ...original, tables: [original.tables[0], changed] }));
    const { result } = renderHook(() => useWorkspaceGoogleDriveBackup({ data: partial, prepareBackup: async () => source, loadTableSummaries, loadGoogleClientId: async () => 'client-id', onRestored: vi.fn(), setNotice: vi.fn() }));
    await act(async () => { await result.current.connect(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
    expect(mocks.backup).toHaveBeenCalledTimes(1);
    expect(mocks.backup.mock.calls[0][2]).toMatchObject({ complete: false, source, tableIds: [changed.id] });
    expect(result.current.record.tableBackups[changed.id].changeRevision).toBe('unopened-edit');
    expect(partial.tables).toHaveLength(1);
  });

  it('rejects duplicate manual clicks while preparing the table source', async () => {
    let finish!: (source: WorkspaceBackupSource) => void;
    const prepareBackup = vi.fn(() => new Promise<WorkspaceBackupSource>(resolve => { finish = resolve; }));
    const data = createData();
    const { result } = renderHook(() => useWorkspaceGoogleDriveBackup({ data, prepareBackup, loadGoogleClientId: async () => 'client-id', onRestored: vi.fn(), setNotice: vi.fn() }));
    let upload!: Promise<boolean>;
    await act(async () => { upload = result.current.backup({ force: true }); });
    await act(async () => { expect(await result.current.backup()).toBe(false); });
    expect(prepareBackup).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ tables: data.tables.map(workspaceBackupTableSummary), readTable: vi.fn(), verify: vi.fn() }); expect(await upload).toBe(true); });
    expect(mocks.backup).toHaveBeenCalledTimes(1);
  });

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

  it.each(['new device', 'previously backed up device'])('blocks automatic overwrite when a %s connects after another device backed up', async device => {
    window.localStorage.setItem(autoBackupKey, 'true');
    if (device === 'previously backed up device') window.localStorage.setItem(recordKey, JSON.stringify({
      fileId: 'manifest-old', fileName: 'manifest.xlsx', lastBackupAt: now.getTime() - GOOGLE_DRIVE_AUTO_BACKUP_INTERVAL_MS - 1,
      remoteModifiedTime: '2026-08-21T09:00:00.000Z',
    }));
    mocks.findRemoteFile.mockResolvedValue({ id: 'manifest-remote', name: 'manifest.xlsx', modifiedTime: '2026-08-21T09:30:00.000Z' });
    const { result } = renderBackup();

    await act(async () => { await result.current.connect(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });

    expect(result.current.remoteConflict).toBe(true);
    expect(result.current.remoteFile?.id).toBe('manifest-remote');
    expect(mocks.backup).not.toHaveBeenCalled();
  });

  it('stops a scheduled automatic backup when another device backs up after connection', async () => {
    window.localStorage.setItem(autoBackupKey, 'true');
    const original = { id: 'manifest-original', name: 'manifest.xlsx', modifiedTime: '2026-08-21T09:00:00Z' };
    const phone = { ...original, id: 'manifest-phone', modifiedTime: '2026-08-21T10:00:00Z' };
    window.localStorage.setItem(recordKey, JSON.stringify({
      fileId: original.id, fileName: original.name, remoteModifiedTime: original.modifiedTime,
      lastBackupAt: now.getTime() - GOOGLE_DRIVE_AUTO_BACKUP_INTERVAL_MS - 1,
    }));
    mocks.findRemoteFile.mockResolvedValue(original);
    const { result } = renderBackup();
    await act(async () => { await result.current.connect(); });
    expect(result.current.remoteConflict).toBe(false);
    mocks.findRemoteFile.mockResolvedValue(phone);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
    expect(result.current.remoteConflict).toBe(true);
    expect(result.current.remoteFile?.id).toBe(phone.id);
    expect(mocks.backup).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(GOOGLE_DRIVE_AUTO_BACKUP_INTERVAL_MS); });
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


it('loads the chosen historical backup into the import preview instead of a newer remote head', async () => {
  const data = createData(), onRestored = vi.fn();
  const newest = { id: 'version-new', name: 'manifest.xlsx', modifiedTime: '2026-08-21T11:00:00Z' };
  const older = { id: 'version-old', name: 'manifest.xlsx', modifiedTime: '2026-08-21T10:00:00Z' };
  mocks.listRemoteBackups.mockResolvedValue([newest, older]);
  mocks.restore.mockResolvedValue(data);
  const { result } = renderHook(() => useWorkspaceGoogleDriveBackup({ data, inspectChanges: false, loadGoogleClientId: async () => 'client-id', onRestored, setNotice: vi.fn() }));
  await act(async () => { await result.current.findRemote(); });
  act(() => result.current.selectRemoteVersion(older.id));
  mocks.findRemoteFile.mockResolvedValue({ ...newest, id: 'even-newer' });
  await act(async () => { await result.current.restore(); });
  expect(mocks.restore).toHaveBeenCalledExactlyOnceWith(older);
  expect(onRestored).toHaveBeenCalledExactlyOnceWith(data);
  expect(result.current.message).not.toContain('已取代');
});

it('does not treat selecting a historical version as a conflicting remote update', async () => {
  const data = createData(), receipt = receiptFor(data);
  const older = { ...receipt.file, id: 'older', modifiedTime: '2026-08-21T09:00:00Z' };
  const { result } = renderBackup(data);
  await act(async () => { await result.current.backup(); });
  mocks.listRemoteBackups.mockResolvedValue([receipt.file, older]);
  await act(async () => { await result.current.findRemote(); });
  expect(result.current.remoteConflict).toBe(false);
  act(() => result.current.selectRemoteVersion(older.id));
  expect(result.current.remoteFile).toEqual(older);
  expect(result.current.remoteConflict).toBe(false);
});

it('keeps a selected legacy backup in the legacy restore flow even when a newer folder backup appears', async () => {
  const data = createData(), onRestored = vi.fn();
  const legacy = { id: 'legacy-file', name: 'old.xlsx', modifiedTime: '2026-08-21T10:00:00Z' };
  mocks.listRemoteBackups.mockResolvedValue([]);
  mocks.legacyFind.mockResolvedValue(legacy);
  mocks.legacyRestore.mockRejectedValue(new Error('所選備份已有變更'));
  const { result } = renderHook(() => useWorkspaceGoogleDriveBackup({ data, inspectChanges: false, loadGoogleClientId: async () => 'client-id', onRestored, setNotice: vi.fn() }));
  await act(async () => { await result.current.findRemote(); });
  mocks.findRemoteFile.mockResolvedValue({ id: 'new-folder-backup', name: 'manifest.xlsx' });
  await act(async () => { await result.current.restore(); });
  expect(mocks.legacyRestore).toHaveBeenCalledExactlyOnceWith(legacy);
  expect(mocks.restore).not.toHaveBeenCalled();
  expect(onRestored).not.toHaveBeenCalled();
  expect(result.current.error).toBe('所選備份已有變更');
});

it('records a completed backup while preserving its cleanup warning for the user', async () => {
  const data = createData();
  mocks.backup.mockResolvedValue({ ...receiptFor(data), cleanupWarning: '備份已完成，但舊版本清理失敗' });
  const { result } = renderBackup(data);
  await act(async () => { await result.current.backup(); });
  expect(result.current.record.fileId).toBe('manifest-new');
  expect(result.current.message).toContain('清理失敗');
});
