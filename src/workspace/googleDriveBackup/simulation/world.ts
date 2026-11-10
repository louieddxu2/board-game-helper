import { act, renderHook } from '@testing-library/react';
import { vi } from 'vitest';
import type { WorkspaceData } from '../../types';
import { workspaceBackupTableSummary } from '../../workspaceBackupSource';
import type { StoredDriveFile } from '../backupTestFixture';
import { createGoogleDriveFolderBackup } from '../folderBackup';
import { createGoogleDriveSnapshotBackup } from '../snapshotBackup';
import { useWorkspaceGoogleDriveBackup, type WorkspaceDriveBackupRecord } from '../useWorkspaceGoogleDriveBackup';
import { createFaultyDrive, INDEX_LOOKUP, type ObservedRequest } from './faultyDrive';
import { createInvariantChecks, type OperationContext, type Truth } from './invariants';
import { deviceName, type Operation } from './operations';
import { contentFingerprint, createDevice, editDevice, resetModelCounter, sameRevisions, wipeDevice, type SimulatedDevice } from './workspaceModel';

export const RECORD_KEY = 'board-game-helper-google-drive-backup';
export const AUTO_KEY = 'board-game-helper-google-drive-auto-backup';
const PENDING_PREFIX = 'board-game-helper-drive-snapshot-pending:';
const DISCONNECT_KEY = 'board-game-helper-google-drive-manual-disconnect';
const FOLDER_PATH = ['BoardGameHelper', '動態表格備份'] as const;
const START = Date.parse('2026-11-01T00:00:00Z');
const MAX_PUMPS = 1200;

export class InvariantViolation extends Error {
  constructor(readonly code: string, readonly detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'InvariantViolation';
  }
}

export interface WorldOptions {
  devices?: number;
  /** Seed Drive with a v2 backup made by an older app version. */
  legacy?: boolean;
  /** Leave Drive without any backup folders, as before anyone's very first connection. */
  freshDrive?: boolean;
  /** Violation codes recorded as observations instead of failing the run. */
  tolerate?: readonly string[];
}

export interface WorldStats {
  operations: number; faultsTriggered: number; backupsSucceeded: number; backupsRefused: number;
  automaticBackups: number; restores: number; snapshotsPublished: number; snapshotsRetired: number;
  conflictsShown: number; safetyStops: number; orphanFolders: number;
}

const tokenProvider = { getAccessToken: async () => 'simulated-token' };
const memoryStorage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
};

export const createWorld = async (options: WorldOptions = {}) => {
  resetModelCounter();
  vi.setSystemTime(START);
  window.localStorage.clear();
  const drive = createFaultyDrive();
  vi.stubGlobal('fetch', drive.fetch);
  const devices = Array.from({ length: options.devices ?? 2 }, (_, index) => {
    const device = createDevice(deviceName(index));
    device.localStorage.set(AUTO_KEY, 'true');
    return device;
  });
  const stats: WorldStats = { operations: 0, faultsTriggered: 0, backupsSucceeded: 0, backupsRefused: 0, automaticBackups: 0,
    restores: 0, snapshotsPublished: 0, snapshotsRetired: 0, conflictsShown: 0, safetyStops: 0, orphanFolders: 0 };
  const observations = new Map<string, string>();
  const pendingViolations: InvariantViolation[] = [];
  const violate = (code: string, detail: string) => {
    if (options.tolerate?.includes(code)) { if (!observations.has(code)) observations.set(code, detail); return; }
    pendingViolations.push(new InvariantViolation(code, detail));
  };
  /** Timers are faked, so work outside the device under test still needs the clock to move. */
  const drain = async <Result>(work: Promise<Result>): Promise<Result> => {
    let done = false;
    void work.then(() => { done = true; }, () => { done = true; });
    for (let turns = 0; !done && turns < 20_000; turns += 1) await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    return work;
  };

  const truth = new Map<string, Truth>();
  const checks = createInvariantChecks({ drive, truth, violate, stats });

  // Another device: a real backup service with its own data, never disturbed by injected faults.
  const outsider = createDevice('外部裝置');
  const snapshotService = () => createGoogleDriveSnapshotBackup({ tokenProvider, folderPath: FOLDER_PATH, backupKey: 'dynamic-sheet-primary-workspace-v2',
    retainedVersions: 3, fetchImpl: drive.reliableFetch, storage: memoryStorage() });
  const outsiderService = snapshotService();
  let uploader: Truth | undefined;
  const publishFromOutsider = async () => {
    editDevice(outsider, 'cell', stats.operations);
    const previous = uploader;
    uploader = { fingerprint: contentFingerprint(outsider.data), tables: outsider.data.tables.length, by: outsider.name, identity: outsider.storageIdentity };
    try {
      await outsiderService.backup(outsider.data);
      await outsiderService.maintain?.();
    } finally { uploader = previous; }
  };

  if (options.legacy) {
    const legacyDevice = createDevice('舊版裝置');
    const legacy = createGoogleDriveFolderBackup({ tokenProvider, folderPath: FOLDER_PATH, backupKey: 'dynamic-sheet-primary-workspace-v2', fetchImpl: drive.reliableFetch });
    const receipt = await drain(legacy.backup(legacyDevice.data));
    checks.registerLegacy(receipt.file.id, contentFingerprint(legacyDevice.data));
    const root = await drain(outsiderService.ensureFolder());
    drive.fixture.addFile({ id: 'user-note-in-root', name: '我自己放的筆記.txt', parents: [root], body: new TextEncoder().encode('note') });
  }
  if (!options.freshDrive) await drain(outsiderService.ensureFolder());
  drive.fixture.addFile({ id: 'user-photo', name: '家庭照片.jpg', parents: ['root'], body: new TextEncoder().encode('photo') });
  checks.protectExistingFiles();

  let active = -1;
  let hook: ReturnType<typeof mount> | undefined;
  let context: OperationContext | undefined;
  let restored: WorkspaceData[] = [];
  let pumps = 0;

  const mount = (device: SimulatedDevice) => renderHook(({ value }) => useWorkspaceGoogleDriveBackup({
    data: value,
    loadGoogleClientId: async () => 'simulated-client',
    loadStorageIdentity: async () => device.storageIdentity,
    isCurrentData: snapshot => sameRevisions(device.data, snapshot),
    // Like IndexedDB: rows are read live, and `verify` refuses a source that changed meanwhile.
    prepareBackup: async snapshot => ({
      tables: snapshot.tables.map(workspaceBackupTableSummary),
      readTable: async id => {
        const table = device.data.tables.find(item => item.id === id);
        if (!table) throw new Error(`Missing table: ${id}`);
        return table;
      },
      verify: async () => { if (!sameRevisions(device.data, snapshot)) throw new Error('本機資料在備份期間已有變更，請稍後再試'); },
    }),
    onRestored: data => { restored.push(data); },
    setNotice: () => undefined,
  }), { initialProps: { value: device.data } });

  const unmount = () => {
    if (!hook) return;
    hook.unmount();
    const device = devices[active];
    device.localStorage.clear();
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)!;
      device.localStorage.set(key, window.localStorage.getItem(key)!);
    }
    hook = undefined;
    active = -1;
  };
  const use = (index: number) => {
    if (active === index && hook) return hook;
    unmount();
    window.localStorage.clear();
    for (const [key, value] of devices[index].localStorage) window.localStorage.setItem(key, value);
    active = index;
    return (hook = mount(devices[index]));
  };
  const rerender = (index: number) => { if (active === index) hook?.rerender({ value: devices[index].data }); };

  const pump = async () => { pumps += 1; await act(async () => { await vi.advanceTimersByTimeAsync(1); }); };
  /** Run until the action, the hook and every background Drive request have finished. */
  const settle = async (start?: () => Promise<unknown> | void) => {
    let done = !start;
    if (start) await act(async () => { void Promise.resolve(start()).then(() => { done = true; }, () => { done = true; }); await vi.advanceTimersByTimeAsync(0); });
    for (let quiet = 0; quiet < 4 && pumps < MAX_PUMPS;) {
      await pump();
      quiet = done && drive.idle() && !hook?.result.current.busy ? quiet + 1 : 0;
    }
  };

  drive.observer.beforeRequest = async (request: ObservedRequest) => {
    if (!context) return;
    const { operation, device } = context;
    if (operation.editAt === request.index) { editDevice(device, 'cell', request.index); rerender(devices.indexOf(device)); }
    if (operation.externalAt === request.index) await publishFromOutsider();
    // Only the index lookup tells the device which cloud version is newest.
    if (request.kind === 'list' && request.query?.includes(INDEX_LOOKUP)) context.latestSeen = checks.latestRemoteId();
    if (request.kind === 'create-folder' && request.name?.startsWith('備份-')) {
      context.uploadFingerprint = contentFingerprint(device.data);
      context.uploadTables = device.data.tables.length;
      checks.uploadStarting(context);
    }
  };
  drive.observer.uploaded = (file: StoredDriveFile) => {
    if (file.appProperties?.backupKind !== 'manifest' || !file.parents?.length) return;
    const source = uploader ?? (context?.uploadFingerprint !== undefined ? {
      fingerprint: context.uploadFingerprint, tables: context.uploadTables ?? 0, by: context.device.name, identity: context.device.storageIdentity,
    } : undefined);
    if (!source) { violate('UNATTRIBUTED_SNAPSHOT', `索引 ${file.id} 不是由任何備份動作發布`); return; }
    truth.set(file.id, source);
    stats.snapshotsPublished += 1;
    if (!uploader && context) context.published.push(file.id);
    if (!drive.fixture.liveFiles().some(item => item.id === file.id)) violate('BACKUP_PUBLISHED_INTO_TRASH', `${source.by} 的新備份 ${file.id} 被放進已在垃圾桶的資料夾，卻當成發布成功`);
    if (!source.tables) violate('EMPTY_SNAPSHOT_PUBLISHED', `${source.by} 發布了沒有任何表格的備份 ${file.id}`);
  };
  drive.observer.trashing = file => checks.trashing(file);

  const snapshotState = () => {
    const current = hook!.result.current;
    return { status: current.status, remoteConflict: current.remoteConflict, backupSafety: current.backupSafety, error: current.error,
      authorized: current.authorized, record: current.record as WorkspaceDriveBackupRecord, autoBackupEnabled: current.autoBackupEnabled };
  };

  const run = async (operation: Operation): Promise<{ ok?: boolean; state?: ReturnType<typeof snapshotState> }> => {
    stats.operations += 1;
    pumps = 0;
    if (process.env.BACKUP_SIM_DEBUG) process.stderr.write(`op ${stats.operations} ${JSON.stringify(operation)}\n`);
    vi.setSystemTime(Date.now() + 60_000);
    let ok: boolean | undefined;
    if (operation.kind === 'external') {
      drive.beginOperation();
      await drain(publishFromOutsider());
    } else if (operation.kind === 'drive-trash') {
      // The user tidies up in the Drive web UI; no app code runs.
      const target = operation.target === 'snapshot-root' ? drive.snapshotRoot() : drive.fixture.get(drive.liveSnapshots()[0]?.parents?.[0] ?? '');
      if (target) target.trashed = true;
      checks.userTrashedFiles();
    } else if (operation.kind === 'edit') {
      editDevice(devices[operation.device], operation.edit, operation.pick);
      await act(async () => { rerender(operation.device); });
      if (active === operation.device) await settle();
    } else if (operation.kind === 'wipe') {
      if (active === operation.device) unmount();
      wipeDevice(devices[operation.device], operation.keepLocalStorage);
    } else if (operation.kind === 'reload') {
      if (active === operation.device) unmount();
    } else {
      const device = devices[operation.device];
      const current = use(operation.device);
      const before = current.result.current;
      context = { operation, device, record: before.record, persistedFileId: checks.persistedFileId(), fingerprint: contentFingerprint(device.data),
        tables: device.data.tables.length, identity: device.storageIdentity, autoEnabled: before.autoBackupEnabled,
        manuallyDisconnected: window.localStorage.getItem(DISCONNECT_KEY) === 'true', published: [] };
      drive.beginOperation(operation.fault);
      const writeItem = Storage.prototype.setItem;
      const quota = operation.storageFull ? vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
        if (key === RECORD_KEY || key.startsWith(PENDING_PREFIX)) throw new DOMException('Quota exceeded', 'QuotaExceededError');
        writeItem.call(this, key, value);
      }) : undefined;
      try {
        if (operation.kind === 'connect') await settle(() => current.result.current.connect());
        if (operation.kind === 'auto') await act(async () => { current.result.current.setAutoBackupEnabled(operation.enabled); });
        if (operation.kind === 'backup') await settle(() => current.result.current.backup({ force: operation.force }).then(result => { ok = result; }));
        if (operation.kind === 'wait') {
          await act(async () => { await vi.advanceTimersByTimeAsync(operation.minutes * 60_000); });
          await settle();
        }
        if (operation.kind === 'restore') {
          await settle(() => current.result.current.findRemote());
          const versions = current.result.current.remoteVersions;
          const selected = versions.length ? versions[operation.version % versions.length] : current.result.current.remoteFile;
          if (selected) {
            if (versions.length) await act(async () => { current.result.current.selectRemoteVersion(selected.id); });
            restored = [];
            await settle(() => current.result.current.restore());
            checks.restoreFinished(context, selected.id, restored.map(contentFingerprint));
            if (restored.length === 1 && operation.decision === 'replace') {
              device.data = restored[0];
              await act(async () => { rerender(operation.device); });
              await settle();
            }
          }
        }
      } finally { quota?.mockRestore(); }
      if (drive.faultTriggered()) stats.faultsTriggered += 1;
      const after = snapshotState();
      if (pumps >= MAX_PUMPS) violate('ACTION_NEVER_SETTLED', `「${operation.kind}」沒有結束（busy=${String(current.result.current.busy)}）`);
      checks.afterDeviceOperation(context, { ...after, ok, currentFingerprint: contentFingerprint(device.data), busy: current.result.current.busy });
      context = undefined;
    }
    // A fresh service each time: the auditor must not depend on anything a long session cached.
    await drain(checks.afterEveryOperation(snapshotService()));
    if (pendingViolations.length) throw pendingViolations[0];
    return { ok, ...(hook ? { state: snapshotState() } : {}) };
  };

  /** With the network healthy again, every device must be able to get its data safely to Drive. */
  const finish = async () => {
    const fail = (code: string, index: number, state?: ReturnType<typeof snapshotState>) => {
      violate(code, `${deviceName(index)}：${state?.error || '(沒有錯誤訊息)'}；status=${state?.status} conflict=${state?.remoteConflict} safety=${state?.backupSafety}`);
      if (pendingViolations.length) throw pendingViolations[0];
    };
    for (let index = 0; index < devices.length; index += 1) {
      await run({ kind: 'reload', device: index });
      let { state } = await run({ kind: 'connect', device: index });
      if (!devices[index].data.tables.length) {
        if (state?.backupSafety !== 'empty') fail('EMPTY_DEVICE_NOT_STOPPED', index, state);
        if (!drive.liveSnapshots().length) continue;
        await run({ kind: 'restore', device: index, version: 0, decision: 'replace' });
        if (!devices[index].data.tables.length) fail('RECOVERY_RESTORE_FAILED', index, snapshotState());
        ({ state } = await run({ kind: 'connect', device: index }));
      }
      let manual = await run({ kind: 'backup', device: index, force: Boolean(state?.remoteConflict || state?.backupSafety) });
      // A refusal that asks the user to choose is answered the way the dialog offers: keep this device's data.
      if (!manual.ok && (manual.state?.remoteConflict || manual.state?.backupSafety)) manual = await run({ kind: 'backup', device: index, force: true });
      if (!manual.ok || manual.state?.status !== 'saved') fail('RECOVERY_BACKUP_FAILED', index, manual.state);
      await run({ kind: 'reload', device: index });
      ({ state } = await run({ kind: 'connect', device: index }));
      if (state?.remoteConflict || state?.backupSafety) fail('OWN_BACKUP_SHOWN_AS_CONFLICT_AFTER_RELOAD', index, state);
      await run({ kind: 'auto', device: index, enabled: true });
      await run({ kind: 'edit', device: index, edit: 'cell', pick: 0 });
      const published = stats.snapshotsPublished;
      const waited = await run({ kind: 'wait', device: index, minutes: 31 });
      if (stats.snapshotsPublished === published || waited.state?.status !== 'saved') fail('AUTOMATIC_BACKUP_STALLED', index, waited.state);
    }
    stats.orphanFolders = drive.orphanSnapshotFolders().length;
    return { stats, observations };
  };

  return {
    run,
    finish,
    stats,
    observations,
    drive,
    devices,
    state: () => hook ? snapshotState() : undefined,
    dispose() { unmount(); vi.unstubAllGlobals(); window.localStorage.clear(); },
  };
};

export type World = Awaited<ReturnType<typeof createWorld>>;
