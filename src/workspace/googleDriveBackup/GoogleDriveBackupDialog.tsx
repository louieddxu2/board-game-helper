import type { ReactNode } from 'react';
import { WorkspaceIcon, WorkspaceModal } from '../workspaceShared';
import type { DriveFile } from './types';
import type { WorkspaceDriveBackupRecord, WorkspaceDriveBackupStatus } from './useWorkspaceGoogleDriveBackup';

type BusyState = 'connecting' | 'backing-up' | 'finding' | 'restoring' | null;

const formatTime = (value: number | string | null | undefined) => {
  if (!value) return '—';
  const date = typeof value === 'number' ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-TW', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
};

const busyLabel = (busy: BusyState) => busy === 'connecting' ? '正在連結…' : busy === 'backing-up' ? '正在備份…' : busy === 'finding' ? '正在尋找…' : busy === 'restoring' ? '正在載入…' : '';

const statusLabel = (status: WorkspaceDriveBackupStatus) => status === 'offline' ? '目前離線' : status === 'disconnected' ? '已主動斷線' : status === 'dirty' ? '有未備份變更' : status === 'saved' ? '已完成備份' : '尚未備份';
const statusDetail = ({ status, authorized, record }: Pick<GoogleDriveBackupDialogProps, 'status' | 'authorized' | 'record'>) => {
  if (status === 'disconnected') return '自動備份已暫停，請重新連結';
  if (status === 'offline') return '恢復連線後才能同步';
  if (!authorized) return record.lastBackupAt ? '曾經備份過，尚未連結此工作階段' : '需要先連結 Google Drive';
  if (!record.lastBackupAt) return '尚未建立雲端備份';
  return `${record.folderCount} 個資料夾 · ${record.tableCount} 張表格`;
};

export interface GoogleDriveBackupDialogProps {
  status: WorkspaceDriveBackupStatus;
  busy: BusyState;
  message: string;
  error: string;
  record: WorkspaceDriveBackupRecord;
  remoteFile: DriveFile | null;
  authorized: boolean;
  onClose(): void;
  onConnect(): void;
  onBackup(): void;
  onFindRemote(): void;
  onRestore(): void;
  onDisconnect(): void;
}

const ActionButton = ({ children, onClick, disabled, variant = 'secondary' }: { children: ReactNode; onClick(): void; disabled?: boolean; variant?: 'primary' | 'secondary' }) => (
  <button type="button" className={`workspace-dialog-button ${variant}`} onClick={onClick} disabled={disabled}>{children}</button>
);

export const GoogleDriveBackupDialog = ({ status, busy, message, error, record, remoteFile, authorized, onClose, onConnect, onBackup, onFindRemote, onRestore, onDisconnect }: GoogleDriveBackupDialogProps) => {
  const isBusy = Boolean(busy);
  const canUseDrive = authorized && status !== 'offline' && status !== 'disconnected';
  const showConnect = !authorized || status === 'disconnected';
  const primaryAction = remoteFile
    ? <ActionButton onClick={onRestore} disabled={isBusy || !canUseDrive} variant="primary"><WorkspaceIcon name="check" size={18} />使用此備份</ActionButton>
    : status === 'dirty' || status === 'never'
      ? <ActionButton onClick={onBackup} disabled={isBusy || !canUseDrive} variant="primary"><WorkspaceIcon name="upload" size={18} />立即備份</ActionButton>
      : <ActionButton onClick={onFindRemote} disabled={isBusy || !canUseDrive} variant="primary"><WorkspaceIcon name="download" size={18} />尋找雲端備份</ActionButton>;
  return <WorkspaceModal title="Google Drive 備份" onClose={onClose} className="workspace-google-drive-dialog">
    <div className="workspace-google-drive-status">
      <WorkspaceIcon name="download" size={22} />
      <div><strong>{statusLabel(status)}</strong><small>{statusDetail({ status, authorized, record })}</small></div>
    </div>
    {busy && <p className="workspace-dialog-message" role="status">{busyLabel(busy)}</p>}
    {message && <p className="workspace-google-drive-message" role="status">{message}</p>}
    {error && <p className="workspace-google-drive-error" role="alert">{error}</p>}
    {record.lastBackupAt && <dl className="workspace-google-drive-meta"><div><dt>上次備份</dt><dd>{formatTime(record.lastBackupAt)}</dd></div><div><dt>雲端結構</dt><dd>{record.folderCount} 個資料夾 · {record.tableCount} 張表格</dd></div></dl>}
    {remoteFile && <dl className="workspace-google-drive-meta workspace-google-drive-remote"><div><dt>雲端備份</dt><dd>已找到</dd></div><div><dt>雲端修改</dt><dd>{formatTime(remoteFile.modifiedTime)}</dd></div></dl>}
    <div className="workspace-google-drive-actions">
      {showConnect ? <ActionButton onClick={onConnect} disabled={isBusy || status === 'offline'} variant="primary"><WorkspaceIcon name="external" size={18} />連結 Google Drive</ActionButton> : primaryAction}
      {canUseDrive && !remoteFile && status !== 'saved' && <ActionButton onClick={onFindRemote} disabled={isBusy}><WorkspaceIcon name="download" size={18} />尋找雲端備份</ActionButton>}
      {canUseDrive && (remoteFile || status === 'saved') && <ActionButton onClick={onBackup} disabled={isBusy}><WorkspaceIcon name="upload" size={18} />立即備份</ActionButton>}
    </div>
    {authorized && <button type="button" className="workspace-google-drive-disconnect" onClick={onDisconnect} disabled={isBusy}>主動解除授權</button>}
  </WorkspaceModal>;
};
