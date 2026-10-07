import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useCallback, useRef, useState } from 'react';
import { assertWorkspaceStorageCurrent } from './db';
import { useWorkspaceGoogleDriveBackup } from './googleDriveBackup/useWorkspaceGoogleDriveBackup';
import type { WorkspaceData } from './types';

const workspaceLastExportStorageKey = 'board-game-helper-workspace-last-export';

const workspaceBackupReminderMs = 7 * 24 * 60 * 60 * 1000;

interface WorkspaceBackupStatusOptions {
  setStorageConflict: Dispatch<SetStateAction<boolean>>;
  dataRef: RefObject<WorkspaceData | undefined>;
  allTablesReady: boolean;
  data: WorkspaceData | undefined;
  drawerOpen: boolean;
  storageConflict: boolean;
  saveState: "saved" | "saving" | "error";
  setWorkspaceImport: Dispatch<SetStateAction<WorkspaceData | undefined>>;
  setNotice: Dispatch<SetStateAction<string>>;
}

export const useWorkspaceBackupStatus = ({ setStorageConflict, dataRef, allTablesReady, data, drawerOpen, storageConflict, saveState, setWorkspaceImport, setNotice }: WorkspaceBackupStatusOptions) => {
  const [lastExportAt, setLastExportAt] = useState<number>(() => Number(window.localStorage.getItem(workspaceLastExportStorageKey)) || 0);

  const [googleDriveClientId, setGoogleDriveClientId] = useState<string | null | undefined>(undefined);

  const googleDriveClientIdPromiseRef = useRef<Promise<string | null> | undefined>(undefined);

  const loadGoogleDriveClientId = useCallback(async () => {
    if (googleDriveClientId !== undefined) return googleDriveClientId;
    if (!googleDriveClientIdPromiseRef.current) {
      googleDriveClientIdPromiseRef.current = import('../lib/api').then(({ api }) => api.session()).then((session) => {
        const clientId = session.googleDriveClientId ?? null;
        setGoogleDriveClientId(clientId);
        return clientId;
      }).catch(() => {
        setGoogleDriveClientId(null);
        return null;
      }).finally(() => { googleDriveClientIdPromiseRef.current = undefined; });
    }
    return googleDriveClientIdPromiseRef.current;
  }, [googleDriveClientId]);

  const markExported = useCallback(() => {
    const now = Date.now();
    setLastExportAt(now);
    window.localStorage.setItem(workspaceLastExportStorageKey, String(now));
  }, []);

  const backupNeedsAttention = !lastExportAt || Date.now() - lastExportAt > workspaceBackupReminderMs;

  const noteStorageConflict = useCallback(() => setStorageConflict(true), []);

  const isCurrentWorkspaceData = useCallback((snapshot: WorkspaceData) => dataRef.current === snapshot, []);

  const driveBackup = useWorkspaceGoogleDriveBackup({
    data: allTablesReady ? data : undefined,
    inspectChanges: drawerOpen,
    backupBlockedReason: storageConflict ? '本機資料已由另一個分頁更新，請先確認未儲存內容再重新開啟' : saveState !== 'saved' ? '本機資料尚未完成儲存，請稍後再備份' : undefined,
    verifyCurrentData: assertWorkspaceStorageCurrent,
    isCurrentData: isCurrentWorkspaceData,
    onStorageConflict: noteStorageConflict,
    loadGoogleClientId: loadGoogleDriveClientId,
    onRestored: (next) => setWorkspaceImport(next),
    setNotice,
  });

  return { markExported, driveBackup, backupNeedsAttention, lastExportAt };
};
