import { DRIVE_SNAPSHOT_KEY } from '../../../shared/driveSnapshots';
import type { StoredDriveFile } from '../backupTestFixture';
import type { GoogleDriveFolderBackup } from '../folderBackup';
import type { WorkspaceDriveBackupRecord } from '../useWorkspaceGoogleDriveBackup';
import type { FaultyDrive } from './faultyDrive';
import type { Operation } from './operations';
import { contentFingerprint, type SimulatedDevice } from './workspaceModel';

/** What a published snapshot must restore to, and who published it. */
export interface Truth { fingerprint: string; tables: number; by: string; identity: string }

/** The device's situation when a user action began. */
export interface OperationContext {
  operation: Exclude<Operation, { kind: 'external' | 'drive-trash' }>;
  device: SimulatedDevice;
  record: WorkspaceDriveBackupRecord;
  persistedFileId: string | null;
  fingerprint: string;
  tables: number;
  identity: string;
  autoEnabled: boolean;
  manuallyDisconnected: boolean;
  /** Newest cloud version when this action last listed Drive. */
  latestSeen?: string | null;
  uploadFingerprint?: string;
  uploadTables?: number;
  uploadChecked?: boolean;
  published: string[];
}

export interface DeviceOutcome {
  status: string; remoteConflict: boolean; backupSafety?: string; error: string; record: WorkspaceDriveBackupRecord;
  ok?: boolean; currentFingerprint: string; busy: unknown;
}

const RECORD_KEY = 'board-game-helper-google-drive-backup';
const JOURNAL_PREFIX = 'board-game-helper-drive-snapshot-pending:';
const FOLDER = 'application/vnd.google-apps.folder';
const RETAINED = 3;
const describeFile = (file: StoredDriveFile) => JSON.stringify([file.name, file.mimeType, file.parents, file.appProperties, file.md5Checksum, file.trashed ?? false]);

export const createInvariantChecks = ({ drive, truth, violate, stats }: {
  drive: FaultyDrive;
  truth: Map<string, Truth>;
  violate(code: string, detail: string): void;
  stats: { backupsSucceeded: number; backupsRefused: number; automaticBackups: number; restores: number; snapshotsRetired: number; conflictsShown: number; safetyStops: number };
}) => {
  const legacy = new Map<string, string>();
  const protectedFiles = new Map<string, string>();
  const immutable = new Map<string, string>();
  const audited = new Set<string>();
  const live = (id: string) => drive.fixture.liveFiles().some(file => file.id === id);
  const latestRemoteId = () => drive.liveSnapshots()[0]?.id ?? [...legacy.keys()].find(live) ?? null;
  /** Whether the upload journal kept in localStorage still names this snapshot. */
  const journalNames = (snapshotId?: string) => {
    if (!snapshotId) return false;
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)!;
      if (!key.startsWith(JOURNAL_PREFIX)) continue;
      try {
        const saved = JSON.parse(window.localStorage.getItem(key) ?? 'null') as { id?: string; previous?: string } | null;
        if (saved?.id === snapshotId || saved?.previous === snapshotId) return true;
      } catch { /* An unreadable journal names nothing. */ }
    }
    return false;
  };
  /**
   * The newest version is this same device and IndexedDB's own upload, published after the version its
   * record names: the reply was lost. An older own version left on top by a trashed one does not count.
   */
  const ownUnconfirmed = (latest: string | null, recorded: string | null, name: string, identity: string) => {
    const publisher = latest ? truth.get(latest) : undefined;
    if (!latest || publisher?.by !== name || publisher.identity !== identity) return false;
    const order = [...truth.keys()];
    return order.indexOf(latest) > (recorded ? order.indexOf(recorded) : -1);
  };

  return {
    latestRemoteId,
    registerLegacy(id: string, fingerprint: string) { legacy.set(id, fingerprint); },
    /** Everything in Drive before the simulation starts belongs to the user or to an older app version. */
    protectExistingFiles() { for (const file of drive.fixture.files.values()) protectedFiles.set(file.id, describeFile(file)); },
    /** The user's own tidying in Drive is not the app's doing. */
    userTrashedFiles() { for (const id of [...protectedFiles.keys()]) if (!live(id)) protectedFiles.delete(id); },
    persistedFileId: (): string | null => {
      try { return (JSON.parse(window.localStorage.getItem(RECORD_KEY) ?? 'null') as { fileId?: string } | null)?.fileId ?? null; } catch { return null; }
    },

    /** Called when the device under test creates a snapshot folder, before any table leaves it. */
    uploadStarting(context: OperationContext) {
      if (context.uploadChecked) return;
      context.uploadChecked = true;
      const { operation, device } = context;
      const who = device.name;
      if (operation.kind !== 'backup' && operation.kind !== 'wait') {
        violate('UPLOAD_WITHOUT_REQUEST', `${who} 在「${operation.kind}」動作中開始上傳`);
        return;
      }
      if (!context.tables) violate('UPLOAD_FROM_EMPTY_DEVICE', `${who} 本機沒有表格卻開始上傳`);
      const automatic = operation.kind === 'wait';
      if (automatic) stats.automaticBackups += 1;
      if (automatic && (!context.autoEnabled || context.manuallyDisconnected)) violate('AUTOMATIC_UPLOAD_WITHOUT_OPT_IN', `${who} 未開啟自動備份卻自動上傳`);
      if (operation.kind === 'backup' && operation.force) return;
      const latest = context.latestSeen === undefined ? latestRemoteId() : context.latestSeen;
      // A newest version this same device and IndexedDB published, whose reply was lost, is not unseen.
      if (latest !== context.record.fileId && !ownUnconfirmed(latest, context.record.fileId, who, context.identity)) {
        violate('UPLOAD_OVER_UNSEEN_VERSION', `${who} 未經確認就蓋過它沒看過的雲端版本（雲端最新 ${latest}，本機紀錄 ${context.record.fileId}）`);
      }
      if (latest && context.record.storageIdentity !== context.identity) {
        violate('UPLOAD_FROM_UNCONFIRMED_SOURCE', `${who} 的 IndexedDB 已不是上次備份的那一份，卻未經確認就上傳`);
      }
    },

    /** Only obsolete app-managed snapshot folders may ever be moved to the trash. */
    trashing(file: StoredDriveFile) {
      const root = drive.snapshotRoot()?.id;
      if (file.mimeType !== FOLDER || file.appProperties?.backupKey !== DRIVE_SNAPSHOT_KEY || file.appProperties.backupKind !== 'snapshot' || !root || file.parents?.[0] !== root) {
        violate('TRASHED_UNMANAGED_FILE', `清理動作想丟掉不屬於快照的檔案：${file.name}（${file.id}）`);
        return;
      }
      const rank = drive.liveSnapshots().findIndex(manifest => manifest.parents?.[0] === file.id);
      if (rank >= 0 && rank < RETAINED) violate('TRASHED_RETAINED_VERSION', `清理動作丟掉了最新 ${RETAINED} 份之內的第 ${rank + 1} 份備份`);
      stats.snapshotsRetired += 1;
    },

    restoreFinished(context: OperationContext, selectedId: string, restoredFingerprints: string[]) {
      if (restoredFingerprints.length > 1) violate('RESTORE_DELIVERED_TWICE', '一次還原交付了多份資料');
      if (!restoredFingerprints.length) return;
      stats.restores += 1;
      const expected = truth.get(selectedId)?.fingerprint ?? legacy.get(selectedId);
      if (expected === undefined) violate('RESTORED_UNKNOWN_VERSION', `還原了來源不明的版本 ${selectedId}`);
      else if (expected !== restoredFingerprints[0]) violate('RESTORE_CONTENT_MISMATCH', `${context.device.name} 選擇版本 ${selectedId}，拿到的內容卻不是該版本`);
    },

    afterDeviceOperation(context: OperationContext, outcome: DeviceOutcome) {
      const { operation, device, record: before } = context;
      const after = outcome.record;
      const uploads = operation.kind === 'backup' || operation.kind === 'wait';
      if (outcome.remoteConflict) stats.conflictsShown += 1;
      if (outcome.backupSafety) stats.safetyStops += 1;
      if (operation.kind === 'backup') { if (outcome.ok) stats.backupsSucceeded += 1; else stats.backupsRefused += 1; }
      if (after.fileId !== before.fileId) {
        const published = after.fileId ? truth.get(after.fileId) : undefined;
        if (!uploads) violate('RECORD_CHANGED_WITHOUT_BACKUP', `${device.name} 的備份紀錄在「${operation.kind}」中被改寫`);
        else if (!after.fileId || !published) violate('RECORD_POINTS_TO_MISSING_BACKUP', `${device.name} 的紀錄指向不存在的備份 ${after.fileId}`);
        else if (!live(after.fileId)) violate('BACKUP_PUBLISHED_INTO_TRASH', `${device.name} 顯示備份成功，但新備份 ${after.fileId} 其實在垃圾桶裡`);
        else if (published.fingerprint !== context.uploadFingerprint) violate('RECORD_FOR_DIFFERENT_CONTENT', `${device.name} 的紀錄指向內容不同的備份`);
      } else if (JSON.stringify(after) !== JSON.stringify(before)) {
        violate('RECORD_CHANGED_WITHOUT_BACKUP', `${device.name} 的備份紀錄內容被改寫但沒有新備份`);
      }
      if (operation.kind === 'backup' && outcome.ok && after.fileId === before.fileId) violate('SUCCESS_WITHOUT_BACKUP', `${device.name} 回報備份成功，但紀錄沒有新版本`);
      if (operation.kind === 'backup' && outcome.ok === false && context.published.length && !drive.faultTriggered() && operation.editAt === undefined) {
        violate('FAILURE_AFTER_PUBLISHING', `${device.name} 回報備份失敗，但其實已發布 ${context.published[0]}`);
      }
      const persisted = this.persistedFileId();
      // A refused localStorage write may leave the older record on disk, never an invented one.
      if (persisted !== after.fileId && persisted !== context.persistedFileId) {
        violate('PERSISTED_RECORD_DIVERGED', `${device.name} 畫面上的紀錄是 ${after.fileId}，localStorage 卻是 ${persisted}`);
      }
      // "Saved" is a promise to the user that the cloud holds exactly what is on screen.
      if (outcome.status === 'saved') {
        const recorded = after.fileId ? truth.get(after.fileId) : undefined;
        if (!recorded || recorded.fingerprint !== outcome.currentFingerprint) violate('SAVED_STATUS_FOR_UNSAVED_DATA', `${device.name} 顯示「已備份」，但紀錄中的雲端版本內容與本機不同`);
      }
      // A device must not be told another device changed the cloud when the newest version is its own.
      if (operation.kind === 'backup' && !operation.force && outcome.ok === false && outcome.remoteConflict && !outcome.backupSafety
        && !drive.faultTriggered() && operation.externalAt === undefined) {
        const newest = drive.liveSnapshots()[0];
        const publisher = newest ? truth.get(newest.id) : undefined;
        // Only a device whose upload journal survived can know; without it the refusal is the safe answer.
        if (publisher && journalNames(newest.appProperties?.snapshotId) && ownUnconfirmed(newest.id, before.fileId, device.name, device.storageIdentity)) {
          violate('OWN_UPLOAD_REPORTED_AS_OTHER_DEVICE', `${device.name} 自己上次成功送出的備份 ${newest.id} 被當成「其他裝置的變更」，之後的備份都被擋下`);
        }
      }
    },

    /** Drive-wide properties that must hold no matter who acted. */
    async afterEveryOperation(auditor: Pick<GoogleDriveFolderBackup, 'restore'>) {
      for (const [id, expected] of protectedFiles) {
        const file = drive.fixture.get(id);
        if (!file || !live(id) || describeFile(file) !== expected) violate('USER_OR_LEGACY_FILE_TOUCHED', `非本版快照的檔案被更動或丟棄：${file?.name ?? id}`);
      }
      for (const file of drive.fixture.files.values()) {
        const kind = file.appProperties?.backupKind;
        if (file.appProperties?.backupKey !== DRIVE_SNAPSHOT_KEY || (kind !== 'table' && kind !== 'manifest') || protectedFiles.has(file.id)) continue;
        const description = JSON.stringify([file.name, file.parents, file.appProperties, file.md5Checksum]);
        const known = immutable.get(file.id);
        if (known === undefined) immutable.set(file.id, description);
        else if (known !== description) violate('PUBLISHED_FILE_MODIFIED', `已上傳的快照檔案被改寫：${file.name}（${file.id}）`);
      }
      for (const manifest of drive.liveSnapshots()) {
        if (audited.has(manifest.id)) continue;
        audited.add(manifest.id);
        const expected = truth.get(manifest.id);
        if (!expected) { violate('UNATTRIBUTED_SNAPSHOT', `Drive 上出現來源不明的索引 ${manifest.id}`); continue; }
        try {
          const data = await auditor.restore({ id: manifest.id, name: manifest.name, modifiedTime: manifest.modifiedTime, parents: manifest.parents, appProperties: manifest.appProperties });
          if (contentFingerprint(data) !== expected.fingerprint) violate('SNAPSHOT_CONTENT_MISMATCH', `${expected.by} 發布的備份 ${manifest.id} 還原後與當時的本機資料不同`);
        } catch (cause) {
          violate('SNAPSHOT_NOT_RESTORABLE', `${expected.by} 發布的備份 ${manifest.id} 無法還原：${cause instanceof Error ? cause.message : String(cause)}`);
        }
      }
    },
  };
};
