import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { importWorkspaceXlsx } from '../spreadsheet';
import type { WorkspaceData } from '../types';
import { createGoogleDriveFolderBackup, createGoogleDriveSingleFileBackup, createGoogleIdentityTokenProvider, DRIVE_BACKUP_FORK_COUNT_PROPERTY, DRIVE_MANIFEST_FILE_NAME, GOOGLE_DRIVE_MANUAL_DISCONNECT_STORAGE_KEY, workspaceStructureBackupFingerprint, workspaceTableBackupFingerprint, type DriveFile, type GoogleDriveFolderBackup, type GoogleDriveSingleFileBackup, type GoogleIdentityTokenProvider, type RemoteBackupConflictError } from './index';

const STORAGE_KEY = 'board-game-helper-google-drive-backup';
const BACKUP_KEY = 'dynamic-sheet-primary-workspace-v1';
const FOLDER_BACKUP_KEY = 'dynamic-sheet-primary-workspace-v2';
const WORKSPACE_BACKUP_FOLDER_PATH = ['BoardGameHelper', '動態表格備份'] as const;
const BACKUP_FILE_NAME = '玩錯動態表格-備份.xlsx';
const BACKUP_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const AUTO_BACKUP_STORAGE_KEY = 'board-game-helper-google-drive-auto-backup';
export const GOOGLE_DRIVE_AUTO_BACKUP_INTERVAL_MS = 30 * 60 * 1000;
const AUTO_BACKUP_DEBOUNCE_MS = 1500;

export interface WorkspaceDriveBackupRecord {
  fileId: string | null;
  fileName: string | null;
  lastBackupAt: number | null;
  sourceUpdatedAt: number | null;
  remoteModifiedTime: string | null;
  tableCount: number;
  folderCount: number;
  structureFingerprint: string | null;
  tableBackups: Record<string, WorkspaceDriveTableBackupRecord>;
}

export interface WorkspaceDriveTableBackupRecord {
  lastBackupAt: number;
  sourceUpdatedAt: number;
  contentFingerprint: string;
  driveFileId: string | null;
}

type BusyState = 'connecting' | 'backing-up' | 'finding' | 'restoring' | null;
export type WorkspaceDriveBackupStatus = 'offline' | 'never' | 'dirty' | 'saved' | 'disconnected';

const emptyRecord = (): WorkspaceDriveBackupRecord => ({ fileId: null, fileName: null, lastBackupAt: null, sourceUpdatedAt: null, remoteModifiedTime: null, tableCount: 0, folderCount: 0, structureFingerprint: null, tableBackups: {} });

const loadRecord = (): WorkspaceDriveBackupRecord => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!parsed || typeof parsed !== 'object') return emptyRecord();
    const value = parsed as Partial<WorkspaceDriveBackupRecord>;
    return {
      fileId: typeof value.fileId === 'string' ? value.fileId : null,
      fileName: typeof value.fileName === 'string' ? value.fileName : null,
      lastBackupAt: typeof value.lastBackupAt === 'number' ? value.lastBackupAt : null,
      sourceUpdatedAt: typeof value.sourceUpdatedAt === 'number' ? value.sourceUpdatedAt : null,
      remoteModifiedTime: typeof value.remoteModifiedTime === 'string' ? value.remoteModifiedTime : null,
      tableCount: typeof value.tableCount === 'number' ? value.tableCount : 0,
      folderCount: typeof value.folderCount === 'number' ? value.folderCount : 0,
      structureFingerprint: typeof value.structureFingerprint === 'string' ? value.structureFingerprint : null,
      tableBackups: value.tableBackups && typeof value.tableBackups === 'object' ? value.tableBackups : {},
    };
  } catch {
    return emptyRecord();
  }
};

const saveRecord = (record: WorkspaceDriveBackupRecord) => {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record)); } catch { /* Storage is optional. */ }
};

const workspaceUpdatedAt = (data?: WorkspaceData) => data ? Math.max(data.updatedAt ?? 0, ...data.tables.map((table) => table.updatedAt)) : 0;

export interface UseWorkspaceGoogleDriveBackupOptions {
  data?: WorkspaceData;
  loadGoogleClientId(): Promise<string | null>;
  onRestored(data: WorkspaceData): void;
  setNotice(message: string): void;
}

export const useWorkspaceGoogleDriveBackup = ({ data, loadGoogleClientId, onRestored, setNotice }: UseWorkspaceGoogleDriveBackupOptions) => {
  const [record, setRecord] = useState<WorkspaceDriveBackupRecord>(loadRecord);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState<BusyState>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [remoteFile, setRemoteFile] = useState<DriveFile | null>(null);
  const [remoteConflict, setRemoteConflict] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [authorized, setAuthorized] = useState(false);
  const [autoBackupEnabled, setAutoBackupEnabledState] = useState(() => window.localStorage.getItem(AUTO_BACKUP_STORAGE_KEY) === 'true');
  const [manuallyDisconnected, setManuallyDisconnected] = useState(() => window.localStorage.getItem(GOOGLE_DRIVE_MANUAL_DISCONNECT_STORAGE_KEY) === 'true');
  const [autoRetryAt, setAutoRetryAt] = useState(0);
  const authRef = useRef<GoogleIdentityTokenProvider | undefined>(undefined);
  const backupRef = useRef<GoogleDriveFolderBackup | undefined>(undefined);
  const legacyBackupRef = useRef<GoogleDriveSingleFileBackup | undefined>(undefined);
  const clientIdLoadedRef = useRef(false);
  const clientIdRef = useRef<string | null>(null);
  const structureFingerprint = data ? workspaceStructureBackupFingerprint(data) : '';
  const dirtyTables = useMemo(() => data?.tables.filter((table) => record.tableBackups[table.id]?.contentFingerprint !== workspaceTableBackupFingerprint(table)) ?? [], [data, record.tableBackups]);
  const structureDirty = data ? (record.structureFingerprint !== structureFingerprint
    || Object.keys(record.tableBackups).some((id) => !data.tables.some((table) => table.id === id))) : false;

  const remoteMatchesRecord = useCallback((file: DriveFile | null) => {
    if (!file) return record.fileId === null;
    if (Number(file.appProperties?.[DRIVE_BACKUP_FORK_COUNT_PROPERTY] ?? 1) > 1) return false;
    if (file.id !== record.fileId) return false;
    return !record.remoteModifiedTime || !file.modifiedTime || file.modifiedTime === record.remoteModifiedTime;
  }, [record.fileId, record.remoteModifiedTime]);
  const folderRemoteMatchesRecord = useCallback((file: DriveFile | null) => {
    if (!file && record.fileId && record.fileName !== DRIVE_MANIFEST_FILE_NAME) return true;
    return remoteMatchesRecord(file);
  }, [record.fileId, record.fileName, remoteMatchesRecord]);

  useEffect(() => {
    const onOnline = () => { setOnline(true); setAutoRetryAt(0); };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, []);

  const ensureBackup = useCallback(async () => {
    if (!clientIdLoadedRef.current) {
      clientIdRef.current = await loadGoogleClientId();
      clientIdLoadedRef.current = true;
    }
    const clientId = clientIdRef.current?.trim();
    if (!clientId) throw new Error('Google Drive 尚未設定，請先完成 Google Cloud 設定');
    if (!authRef.current) {
      authRef.current = createGoogleIdentityTokenProvider({ clientId, scopes: 'https://www.googleapis.com/auth/drive.file' });
    }
    if (!backupRef.current) {
      backupRef.current = createGoogleDriveFolderBackup({
        tokenProvider: authRef.current,
        folderPath: WORKSPACE_BACKUP_FOLDER_PATH,
        backupKey: FOLDER_BACKUP_KEY,
        appProperties: { workspaceFormat: 'dynamic-sheet-v1', schemaVersion: '1' },
      });
    }
    if (!legacyBackupRef.current) {
      legacyBackupRef.current = createGoogleDriveSingleFileBackup({
        tokenProvider: authRef.current,
        folderPath: WORKSPACE_BACKUP_FOLDER_PATH,
        backupKey: BACKUP_KEY,
        fileName: BACKUP_FILE_NAME,
        mimeType: BACKUP_MIME_TYPE,
        appProperties: { workspaceFormat: 'dynamic-sheet-v1', schemaVersion: '1' },
      });
    }
    return { auth: authRef.current, backup: backupRef.current, legacyBackup: legacyBackupRef.current };
  }, [loadGoogleClientId]);

  const close = useCallback(() => {
    if (busy) return;
    setDialogOpen(false);
    setError('');
  }, [busy]);

  const connect = useCallback(async () => {
    setBusy('connecting'); setError(''); setMessage('');
    try {
      const { auth, backup: service, legacyBackup } = await ensureBackup();
      await auth.signIn();
      const file = await service.findRemoteFile() ?? await legacyBackup.findRemoteFile();
      const conflict = !remoteMatchesRecord(file);
      setAuthorized(auth.isAuthorized);
      setManuallyDisconnected(false);
      window.localStorage.removeItem(GOOGLE_DRIVE_MANUAL_DISCONNECT_STORAGE_KEY);
      setAutoRetryAt(0);
      setRemoteFile(conflict ? file : null);
      setRemoteConflict(conflict);
      setMessage(conflict ? '雲端備份與此裝置的紀錄不同，請選擇使用雲端版本或以本機資料覆蓋' : '已連結 Google Drive');
    } catch (cause) {
      setAuthorized(authRef.current?.isAuthorized ?? false);
      setError(cause instanceof Error ? cause.message : 'Google Drive 連結失敗');
    } finally { setBusy(null); }
  }, [ensureBackup, remoteMatchesRecord]);

  const open = useCallback(() => {
    setDialogOpen(true);
    setMessage('');
    setError('');
    if (online && !busy && (!authorized || manuallyDisconnected)) void connect();
  }, [authorized, busy, connect, manuallyDisconnected, online]);

  const backup = useCallback(async ({ automatic = false, force = false, tableIds }: { automatic?: boolean; force?: boolean; tableIds?: string[] } = {}) => {
    if (!data) return false;
    if (automatic && (!autoBackupEnabled || manuallyDisconnected)) return false;
    if (automatic && !authorized) return false;
    if (manuallyDisconnected) { setError('Google Drive 已由使用者主動斷線，請先重新連結'); return false; }
    if (!online) { setError('目前離線，恢復連線後才能備份'); if (automatic) setAutoRetryAt(Date.now() + GOOGLE_DRIVE_AUTO_BACKUP_INTERVAL_MS); return false; }
    setBusy('backing-up'); setError(''); setMessage('');
    try {
      const { backup: service } = await ensureBackup();
      if (!force) {
        const currentRemote = await service.findRemoteFile();
        if (!folderRemoteMatchesRecord(currentRemote)) {
          setRemoteFile(currentRemote);
          setRemoteConflict(true);
          setError('雲端備份已在其他裝置變更，請先載入雲端版本或明確選擇覆蓋');
          return false;
        }
      }
      const sourceUpdatedAt = workspaceUpdatedAt(data) || Date.now();
      const selectedTableIds = tableIds ?? data.tables.map((table) => table.id);
      const receipt = await service.backup(data, {
        sourceUpdatedAt,
        appProperties: { exportedAt: new Date().toISOString() },
      }, {
        complete: !automatic,
        tableIds: selectedTableIds,
        ...(force ? {} : {
          expectedRemoteFileId: record.fileName === DRIVE_MANIFEST_FILE_NAME ? record.fileId : null,
          expectedRemoteModifiedTime: record.fileName === DRIVE_MANIFEST_FILE_NAME ? record.remoteModifiedTime : null,
        }),
      });
      const completedAt = Date.now();
      const refs = new Map(receipt.manifest.tables.map((table) => [table.id, table]));
      const nextTableBackups = { ...record.tableBackups };
      for (const table of data.tables) {
        if (!selectedTableIds.includes(table.id)) continue;
        nextTableBackups[table.id] = {
          lastBackupAt: completedAt,
          sourceUpdatedAt: table.updatedAt,
          contentFingerprint: workspaceTableBackupFingerprint(table),
          driveFileId: refs.get(table.id)?.driveFileId ?? null,
        };
      }
      const currentTableIds = new Set(data.tables.map((table) => table.id));
      for (const id of Object.keys(nextTableBackups)) if (!currentTableIds.has(id)) delete nextTableBackups[id];
      const nextRecord: WorkspaceDriveBackupRecord = {
        fileId: receipt.file.id,
        fileName: receipt.file.name,
        lastBackupAt: completedAt,
        sourceUpdatedAt,
        remoteModifiedTime: receipt.file.modifiedTime ?? null,
        tableCount: receipt.manifest.tables.length,
        folderCount: receipt.manifest.folders.length,
        structureFingerprint,
        tableBackups: nextTableBackups,
      };
      setAuthorized(true);
      setRemoteConflict(false); setRemoteFile(null);
      setRecord(nextRecord); saveRecord(nextRecord); setMessage(automatic ? '已自動備份變更' : '已備份整個資料庫'); setNotice('已備份到 Google Drive');
      setAutoRetryAt(0);
      return true;
    } catch (cause) {
      const conflictFile = cause && typeof cause === 'object' && 'remoteFile' in cause ? (cause as RemoteBackupConflictError).remoteFile : undefined;
      if (conflictFile !== undefined) { setRemoteFile(conflictFile); setRemoteConflict(true); }
      setAuthorized(authRef.current?.isAuthorized ?? false);
      setError(cause instanceof Error ? cause.message : 'Google Drive 備份失敗');
      if (automatic) setAutoRetryAt(Date.now() + GOOGLE_DRIVE_AUTO_BACKUP_INTERVAL_MS);
      return false;
    } finally { setBusy(null); }
  }, [autoBackupEnabled, authorized, data, ensureBackup, folderRemoteMatchesRecord, manuallyDisconnected, online, record.fileId, record.fileName, record.remoteModifiedTime, record.tableBackups, setNotice, structureFingerprint]);

  const findRemote = useCallback(async () => {
    if (manuallyDisconnected) { setError('Google Drive 已由使用者主動斷線，請先重新連結'); return; }
    if (!online) { setError('目前離線，恢復連線後才能讀取雲端備份'); return; }
    setBusy('finding'); setError(''); setMessage('');
    try {
      const { backup: service, legacyBackup } = await ensureBackup();
      const file = await service.findRemoteFile() ?? await legacyBackup.findRemoteFile();
      setAuthorized(authRef.current?.isAuthorized ?? true);
      if (!file) { setRemoteFile(null); setError('找不到雲端備份檔'); return; }
      setRemoteFile(file); setRemoteConflict(!remoteMatchesRecord(file)); setMessage('已找到雲端備份，請確認後還原');
    } catch (cause) {
      setAuthorized(authRef.current?.isAuthorized ?? false);
      setError(cause instanceof Error ? cause.message : '讀取 Google Drive 備份失敗');
    } finally { setBusy(null); }
  }, [ensureBackup, manuallyDisconnected, online, remoteMatchesRecord]);

  const restore = useCallback(async () => {
    if (manuallyDisconnected) { setError('Google Drive 已由使用者主動斷線，請先重新連結'); return; }
    if (!online) { setError('目前離線，恢復連線後才能還原'); return; }
    setBusy('restoring'); setError(''); setMessage('');
    try {
      const { backup: service, legacyBackup } = await ensureBackup();
      const remoteFolderFile = await service.findRemoteFile();
      const restoredData = remoteFolderFile
        ? await service.restore()
        : await legacyBackup.restore().then(async (blob) => {
          const imported = await importWorkspaceXlsx(blob);
          if (!imported.data) throw new Error('雲端檔案不是完整的 Workspace 備份');
          return imported.data;
        });
      setAuthorized(authRef.current?.isAuthorized ?? true);
      setRemoteConflict(false); setDialogOpen(false); setRemoteFile(null); onRestored(restoredData); setNotice('已載入雲端備份，請選擇合併或取代');
    } catch (cause) {
      setAuthorized(authRef.current?.isAuthorized ?? false);
      setError(cause instanceof Error ? cause.message : 'Google Drive 還原失敗');
    } finally { setBusy(null); }
  }, [ensureBackup, manuallyDisconnected, onRestored, online, setNotice]);

  const disconnect = useCallback(async () => {
    if (!authRef.current) {
      setManuallyDisconnected(true);
      window.localStorage.setItem(GOOGLE_DRIVE_MANUAL_DISCONNECT_STORAGE_KEY, 'true');
      return;
    }
    setBusy('connecting'); setError('');
    try { await authRef.current.signOut(); setAuthorized(false); setManuallyDisconnected(true); setAutoRetryAt(0); setMessage('已解除授權；自動備份不會自行重新連結'); }
    catch { setError('解除 Google Drive 授權失敗'); }
    finally { setBusy(null); }
  }, []);

  const setAutoBackupEnabled = useCallback((enabled: boolean) => {
    setAutoBackupEnabledState(enabled);
    window.localStorage.setItem(AUTO_BACKUP_STORAGE_KEY, String(enabled));
    if (!enabled) setAutoRetryAt(0);
  }, []);

  const status = useMemo<WorkspaceDriveBackupStatus>(() => {
    if (manuallyDisconnected) return 'disconnected';
    if (!online) return 'offline' as const;
    if (!record.lastBackupAt) return 'never' as const;
    if (structureDirty || dirtyTables.length > 0) return 'dirty' as const;
    return 'saved' as const;
  }, [dirtyTables.length, manuallyDisconnected, online, record.lastBackupAt, structureDirty]);

  const hasPendingBackup = status === 'never' || status === 'dirty';
  useEffect(() => {
    if (!autoBackupEnabled || !hasPendingBackup || !online || manuallyDisconnected || busy || !authorized || remoteConflict) return;
    const now = Date.now();
    const lastTableBackupAt = (tableId: string) => record.tableBackups[tableId]?.lastBackupAt
      ?? (record.structureFingerprint === null ? record.lastBackupAt ?? 0 : 0);
    const eligibleTableIds = dirtyTables
      .filter((table) => now >= lastTableBackupAt(table.id) + GOOGLE_DRIVE_AUTO_BACKUP_INTERVAL_MS)
      .map((table) => table.id);
    const nextTableAt = dirtyTables.length
      ? Math.min(...dirtyTables.map((table) => lastTableBackupAt(table.id) + GOOGLE_DRIVE_AUTO_BACKUP_INTERVAL_MS))
      : Number.POSITIVE_INFINITY;
    const nextAllowedAt = Math.max(autoRetryAt, structureDirty || eligibleTableIds.length > 0 ? now : nextTableAt);
    const delay = Math.max(AUTO_BACKUP_DEBOUNCE_MS, nextAllowedAt - now);
    const timer = window.setTimeout(() => { void backup({ automatic: true, tableIds: eligibleTableIds }); }, delay);
    return () => window.clearTimeout(timer);
  }, [autoBackupEnabled, autoRetryAt, authorized, backup, busy, dirtyTables, hasPendingBackup, manuallyDisconnected, online, record.lastBackupAt, record.tableBackups, remoteConflict, structureDirty]);

  return {
    dialogOpen,
    open,
    close,
    connect,
    backup,
    findRemote,
    restore,
    disconnect,
    autoBackupEnabled,
    setAutoBackupEnabled,
    manuallyDisconnected,
    busy,
    message,
    error,
    remoteFile,
    remoteConflict,
    authorized,
    record,
    status,
    online,
  };
};
