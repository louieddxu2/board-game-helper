import { useEffect, useRef } from 'react';
import { afterWorkspacePaint } from './backgroundWork';
import type { useWorkspaceGoogleDriveBackup } from './googleDriveBackup/useWorkspaceGoogleDriveBackup';
import { useReadyWorkspaceActions, type WorkspaceReadiness } from './useReadyWorkspaceActions';

type DriveBackup = Pick<ReturnType<typeof useWorkspaceGoogleDriveBackup>, 'backup' | 'autoBackupEnabled' | 'authorized' | 'online' | 'manuallyDisconnected' | 'remoteConflict' | 'busy'>;

/** Full data is required by uploads and enabled automatic backup, not by opening the dialog. */
export const useWorkspaceBackupReadiness = (drive: DriveBackup, readiness: WorkspaceReadiness, setNotice: (message: string) => void) => {
  const actions = useReadyWorkspaceActions({ backup: drive.backup }, { backup: 'all' }, readiness);
  const pending = useRef(false);
  const ready = readiness.isReady('all');
  const automatic = drive.autoBackupEnabled && drive.authorized && drive.online && !drive.manuallyDisconnected && !drive.remoteConflict && !drive.busy;
  useEffect(() => {
    if (ready || !automatic) return;
    return afterWorkspacePaint(() => {
      void readiness.ensure('all').catch(readiness.onError);
    }, true);
  }, [automatic, ready, readiness]);

  return async (...args: Parameters<DriveBackup['backup']>): Promise<boolean> => {
    if (pending.current) return false;
    pending.current = true;
    if (!readiness.isReady('all')) setNotice('正在讀取備份所需的資料…');
    try { return Boolean(await actions.backup(...args)); }
    finally { pending.current = false; }
  };
};
