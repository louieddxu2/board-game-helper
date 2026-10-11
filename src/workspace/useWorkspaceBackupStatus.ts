import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useCallback, useRef, useState } from 'react';
import { assertWorkspaceStorageCurrent, loadWorkspaceBackupSummaries, prepareWorkspaceBackup } from './db';
import { workspaceStructureChangeRevision, workspaceTableChangeRevision } from './changeRevisions';
import { useWorkspaceGoogleDriveBackup } from './googleDriveBackup/useWorkspaceGoogleDriveBackup';
import type { WorkspaceData } from './types';
import type { WorkspaceDialogController } from './useWorkspaceDialogs';

const workspaceLastExportStorageKey = 'board-game-helper-workspace-last-export';

const workspaceBackupReminderMs = 7 * 24 * 60 * 60 * 1000;

interface WorkspaceBackupStatusOptions {
  setStorageConflict: Dispatch<SetStateAction<boolean>>;
  dataRef: RefObject<WorkspaceData | undefined>;
  mountedRef: RefObject<boolean>;
  data: WorkspaceData | undefined;
  drawerOpen: boolean;
  storageConflict: boolean;
  saveState: "saved" | "saving" | "error";
  setNotice: Dispatch<SetStateAction<string>>;
  dialogs: Pick<WorkspaceDialogController, 'set' | 'close'>;
}

export const useWorkspaceBackupStatus = ({ setStorageConflict, dataRef, mountedRef, data, drawerOpen, storageConflict, saveState, setNotice, dialogs }: WorkspaceBackupStatusOptions) => {
  const { set: setDialog } = dialogs;
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

  const isCurrentWorkspaceData = useCallback((snapshot: WorkspaceData) => {
    const current = dataRef.current;
    return mountedRef.current && Boolean(current && workspaceStructureChangeRevision(current) === workspaceStructureChangeRevision(snapshot)
      && snapshot.tables.every(table => {
        const live = current.tables.find(item => item.id === table.id);
        return live && workspaceTableChangeRevision(live) === workspaceTableChangeRevision(table);
      }));
  }, []);
  const loadTableSummaries = useCallback((snapshot: WorkspaceData) => loadWorkspaceBackupSummaries(snapshot, { isCurrent: () => isCurrentWorkspaceData(snapshot) }), []);
  const prepareBackup = useCallback((snapshot: WorkspaceData) => prepareWorkspaceBackup(snapshot, { isCurrent: () => isCurrentWorkspaceData(snapshot) }), []);

  const driveBackup = useWorkspaceGoogleDriveBackup({
    data,
    loadTableSummaries,
    prepareBackup,
    inspectChanges: drawerOpen,
    backupBlockedReason: storageConflict ? '本機資料已由另一個分頁更新，請先確認未儲存內容再重新開啟' : saveState !== 'saved' ? '本機資料尚未完成儲存，請稍後再備份' : undefined,
    verifyCurrentData: assertWorkspaceStorageCurrent,
    isCurrentData: isCurrentWorkspaceData,
    onStorageConflict: noteStorageConflict,
    loadGoogleClientId: loadGoogleDriveClientId,
    onRestored: (next) => setDialog('workspaceImport', next),
    setNotice,
  });

  return { markExported, driveBackup, backupNeedsAttention, lastExportAt };
};
