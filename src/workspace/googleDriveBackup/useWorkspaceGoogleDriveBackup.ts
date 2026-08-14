import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { exportWorkspaceXlsx, importWorkspaceXlsx } from '../spreadsheet';
import type { WorkspaceData } from '../types';
import { createGoogleDriveSingleFileBackup, createGoogleIdentityTokenProvider, type DriveFile, type GoogleDriveSingleFileBackup, type GoogleIdentityTokenProvider } from './index';

const STORAGE_KEY = 'board-game-helper-google-drive-backup';
const BACKUP_KEY = 'dynamic-sheet-primary-workspace-v1';
const BACKUP_FILE_NAME = '玩錯動態表格-備份.xlsx';
const BACKUP_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface WorkspaceDriveBackupRecord {
  fileId: string | null;
  fileName: string | null;
  lastBackupAt: number | null;
  sourceUpdatedAt: number | null;
  remoteModifiedTime: string | null;
}

type BusyState = 'connecting' | 'backing-up' | 'finding' | 'restoring' | null;

const emptyRecord = (): WorkspaceDriveBackupRecord => ({ fileId: null, fileName: null, lastBackupAt: null, sourceUpdatedAt: null, remoteModifiedTime: null });

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
    };
  } catch {
    return emptyRecord();
  }
};

const saveRecord = (record: WorkspaceDriveBackupRecord) => {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record)); } catch { /* Storage is optional. */ }
};

const workspaceUpdatedAt = (data?: WorkspaceData) => data ? Math.max(0, ...data.tables.map((table) => table.updatedAt)) : 0;

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
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [authorized, setAuthorized] = useState(false);
  const authRef = useRef<GoogleIdentityTokenProvider | undefined>(undefined);
  const backupRef = useRef<GoogleDriveSingleFileBackup | undefined>(undefined);
  const clientIdLoadedRef = useRef(false);
  const clientIdRef = useRef<string | null>(null);
  const localUpdatedAt = workspaceUpdatedAt(data);

  useEffect(() => {
    const onOnline = () => setOnline(true);
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
      backupRef.current = createGoogleDriveSingleFileBackup({
        tokenProvider: authRef.current,
        folderPath: ['玩錯的桌遊規則', '動態表格備份'],
        backupKey: BACKUP_KEY,
        fileName: BACKUP_FILE_NAME,
        mimeType: BACKUP_MIME_TYPE,
        appProperties: { workspaceFormat: 'dynamic-sheet-v1', schemaVersion: '1' },
      });
    }
    return { auth: authRef.current, backup: backupRef.current };
  }, [loadGoogleClientId]);

  const open = useCallback(() => {
    setDialogOpen(true);
    setMessage('');
    setError('');
    setRemoteFile(null);
  }, []);

  const close = useCallback(() => {
    if (busy) return;
    setDialogOpen(false);
    setRemoteFile(null);
    setError('');
  }, [busy]);

  const connect = useCallback(async () => {
    setBusy('connecting'); setError(''); setMessage('');
    try {
      const { auth } = await ensureBackup();
      await auth.signIn({ prompt: 'consent' });
      setAuthorized(true);
      setMessage('已連結 Google Drive');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Google Drive 連結失敗');
    } finally { setBusy(null); }
  }, [ensureBackup]);

  const backup = useCallback(async () => {
    if (!data) return;
    if (!online) { setError('目前離線，恢復連線後才能備份'); return; }
    setBusy('backing-up'); setError(''); setMessage('');
    try {
      const { backup: service } = await ensureBackup();
      const sourceUpdatedAt = workspaceUpdatedAt(data) || Date.now();
      const receipt = await service.backup(exportWorkspaceXlsx(data), {
        sourceUpdatedAt,
        appProperties: { exportedAt: new Date().toISOString() },
      });
      const nextRecord: WorkspaceDriveBackupRecord = {
        fileId: receipt.file.id,
        fileName: receipt.file.name,
        lastBackupAt: Date.now(),
        sourceUpdatedAt,
        remoteModifiedTime: receipt.file.modifiedTime ?? null,
      };
      setAuthorized(true);
      setRecord(nextRecord); saveRecord(nextRecord); setMessage('已備份整個資料庫'); setNotice('已備份到 Google Drive');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Google Drive 備份失敗');
    } finally { setBusy(null); }
  }, [data, ensureBackup, online, setNotice]);

  const findRemote = useCallback(async () => {
    if (!online) { setError('目前離線，恢復連線後才能讀取雲端備份'); return; }
    setBusy('finding'); setError(''); setMessage('');
    try {
      const { backup: service } = await ensureBackup();
      setAuthorized(true);
      const file = await service.findRemoteFile();
      if (!file) { setRemoteFile(null); setError('找不到雲端備份檔'); return; }
      setRemoteFile(file); setMessage('已找到雲端備份，請確認後還原');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '讀取 Google Drive 備份失敗');
    } finally { setBusy(null); }
  }, [ensureBackup, online]);

  const restore = useCallback(async () => {
    if (!online) { setError('目前離線，恢復連線後才能還原'); return; }
    setBusy('restoring'); setError(''); setMessage('');
    try {
      const { backup: service } = await ensureBackup();
      setAuthorized(true);
      const imported = await importWorkspaceXlsx(await service.restore());
      if (!imported.data) throw new Error('雲端檔案不是完整的 Workspace 備份');
      setDialogOpen(false); setRemoteFile(null); onRestored(imported.data); setNotice('已載入雲端備份，請選擇合併或取代');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Google Drive 還原失敗');
    } finally { setBusy(null); }
  }, [ensureBackup, onRestored, online, setNotice]);

  const disconnect = useCallback(async () => {
    if (!authRef.current) return;
    setBusy('connecting'); setError('');
    try { await authRef.current.signOut(); setAuthorized(false); setMessage('已解除本次工作階段的 Google Drive 授權'); }
    catch { setError('解除 Google Drive 授權失敗'); }
    finally { setBusy(null); }
  }, []);

  const status = useMemo(() => {
    if (!online) return 'offline' as const;
    if (!record.lastBackupAt) return 'never' as const;
    if (localUpdatedAt > (record.sourceUpdatedAt ?? 0)) return 'dirty' as const;
    return 'saved' as const;
  }, [localUpdatedAt, online, record.lastBackupAt, record.sourceUpdatedAt]);

  return {
    dialogOpen,
    open,
    close,
    connect,
    backup,
    findRemote,
    restore,
    disconnect,
    busy,
    message,
    error,
    remoteFile,
    authorized,
    record,
    status,
    online,
  };
};
