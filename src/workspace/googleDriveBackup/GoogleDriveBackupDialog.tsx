import type { ReactNode } from 'react';
import { WorkspaceIcon, WorkspaceModal } from '../workspaceShared';
import type { DriveFile } from './types';
import type { WorkspaceDriveBackupRecord, WorkspaceDriveBackupStatus } from './useWorkspaceGoogleDriveBackup';
import { workspaceBackupProgressCount, workspaceBackupProgressLabel, workspaceBackupProgressValue, type WorkspaceBackupProgress } from './backupProgress';
import { workspaceBackupSafetyMessage, type WorkspaceBackupSafety } from './backupSafety';

type BusyState = 'connecting' | 'backing-up' | 'finding' | 'restoring' | null;

const formatTime = (value: number | string | null | undefined) => {
  if (!value) return '—';
  const date = new Date(typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('zh-TW', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
};

const busyLabel = (busy: BusyState) => busy === 'connecting' ? '正在連結…' : busy === 'backing-up' ? '正在備份…' : busy === 'finding' ? '正在尋找…' : busy === 'restoring' ? '正在載入…' : '';

const statusLabel = (status: WorkspaceDriveBackupStatus) => status === 'checking' ? '正在檢查備份變更' : status === 'offline' ? '目前離線' : status === 'disconnected' ? '已主動斷線' : status === 'dirty' ? '有未備份變更' : status === 'saved' ? '已完成備份' : '尚未備份';
const remoteConflictMessage = '雲端備份與此裝置的紀錄不同，請選擇使用雲端版本或以本機資料覆蓋';
const versionLabel = (file: DriveFile, index: number) => file.appProperties?.backupKey && file.appProperties.backupKey !== 'dynamic-sheet-primary-workspace-v3'
  ? '舊備份' : index === 0 ? '最新' : `歷史 ${index + 1}`;

const routineMessages = new Set([
  '已連結 Google Drive',
  '已備份整個資料庫',
  '已自動備份變更',
  '已找到雲端備份，請確認後還原',
  '已解除授權；自動備份不會自行重新連結',
  remoteConflictMessage,
]);

export interface GoogleDriveBackupDialogProps {
  status: WorkspaceDriveBackupStatus;
  busy: BusyState;
  progress?: WorkspaceBackupProgress;
  message: string;
  error: string;
  record: WorkspaceDriveBackupRecord;
  remoteFile: DriveFile | null;
  remoteVersions?: DriveFile[];
  onSelectVersion?(fileId: string): void;
  remoteConflict: boolean;
  backupSafety?: WorkspaceBackupSafety;
  authorized: boolean;
  onClose(): void;
  onConnect(): void;
  onBackup(): void;
  onFindRemote(): void;
  onRestore(): void;
  onOverwrite(): void;
  onDisconnect(): void;
}

const ActionButton = ({ children, onClick, disabled, variant = 'secondary' }: { children: ReactNode; onClick(): void; disabled?: boolean; variant?: 'primary' | 'secondary' | 'danger' }) => (
  <button type="button" className={`workspace-dialog-button ${variant}`} onClick={onClick} disabled={disabled}>{children}</button>
);

export const GoogleDriveBackupDialog = ({ status, busy, progress, message, error, record, remoteFile, remoteVersions = [], onSelectVersion, remoteConflict, backupSafety, authorized, onClose, onConnect, onBackup, onFindRemote, onRestore, onOverwrite, onDisconnect }: GoogleDriveBackupDialogProps) => {
  const isBusy = Boolean(busy);
  const backupProgress = busy === 'backing-up' || (!busy && !error && progress?.phase === 'complete') ? progress : undefined;
  const progressCount = backupProgress ? workspaceBackupProgressCount(backupProgress) : '';
  const progressValue = backupProgress ? workspaceBackupProgressValue(backupProgress) : undefined;
  const showMessage = Boolean(!backupSafety && message && !routineMessages.has(message));
  const canUseDrive = authorized && status !== 'offline' && status !== 'disconnected';
  const canUpload = canUseDrive && backupSafety !== 'empty';
  const currentStatus = backupSafety ? '自動備份已暫停' : busy === 'backing-up' ? '備份進行中' : remoteConflict && canUseDrive ? '雲端版本不同' : statusLabel(status);
  const showConnect = !authorized || status === 'disconnected';
  const primaryAction = remoteFile
    ? <ActionButton onClick={onRestore} disabled={isBusy || !canUseDrive} variant="primary"><WorkspaceIcon name="check" size={18} />還原此備份</ActionButton>
    : backupSafety === 'empty'
      ? <ActionButton onClick={onFindRemote} disabled={isBusy || !canUseDrive} variant="primary"><WorkspaceIcon name="download" size={18} />選擇備份還原</ActionButton>
    : status === 'dirty' || status === 'never'
      ? <ActionButton onClick={onBackup} disabled={isBusy || !canUseDrive} variant="primary"><WorkspaceIcon name="upload" size={18} />立即備份</ActionButton>
      : <ActionButton onClick={onFindRemote} disabled={isBusy || !canUseDrive} variant="primary"><WorkspaceIcon name="download" size={18} />選擇備份還原</ActionButton>;
  return <WorkspaceModal owner="google-drive" title="Google Drive 備份" onRequestClose={onClose} className="workspace-google-drive-dialog">
    <div className="workspace-google-drive-status">
      <WorkspaceIcon name="download" size={22} />
      <div><strong>{currentStatus}</strong></div>
    </div>
    {backupProgress ? <div className="workspace-google-drive-progress" role="status" aria-atomic="true">
      <strong>{workspaceBackupProgressLabel(backupProgress)}</strong>
      <progress aria-label="整體備份進度" aria-valuetext={`${workspaceBackupProgressLabel(backupProgress)} · ${progressCount}`} max={100} value={progressValue} />
      {progressCount && <small>{progressCount}</small>}
    </div> : busy && <p className="workspace-dialog-message" role="status">{busyLabel(busy)}</p>}
    {showMessage && <p className="workspace-google-drive-message" role="status">{message}</p>}
    {backupSafety && <p className="workspace-google-drive-message" role="alert">{workspaceBackupSafetyMessage(backupSafety)}</p>}
    {error && <p className="workspace-google-drive-error" role="alert">{error}</p>}
    {record.lastBackupAt && <dl className="workspace-google-drive-meta"><div><dt>上次備份</dt><dd>{formatTime(record.lastBackupAt)}</dd></div></dl>}
    {remoteVersions.length > 1 && <label className="workspace-form-field">備份版本<select aria-label="選擇備份版本" value={remoteFile?.id ?? ''} disabled={isBusy} onChange={event => onSelectVersion?.(event.target.value)}>{remoteVersions.map((file, index) => <option key={file.id} value={file.id}>{versionLabel(file, index)} · {formatTime(file.appProperties?.backedUpAt ?? file.modifiedTime ?? file.createdTime)}</option>)}</select></label>}
    <div className="workspace-google-drive-actions">
      {showConnect ? <ActionButton onClick={onConnect} disabled={isBusy || status === 'offline'} variant="primary"><WorkspaceIcon name="external" size={18} />連結 Google Drive</ActionButton> : primaryAction}
      {canUpload && remoteFile && (remoteConflict || backupSafety) && <ActionButton onClick={onOverwrite} disabled={isBusy} variant="danger"><WorkspaceIcon name="upload" size={18} />以本機資料覆蓋雲端</ActionButton>}
      {canUseDrive && !remoteFile && status !== 'saved' && backupSafety !== 'empty' && <ActionButton onClick={onFindRemote} disabled={isBusy}><WorkspaceIcon name="download" size={18} />選擇備份還原</ActionButton>}
      {canUseDrive && remoteFile && !remoteVersions.length && <ActionButton onClick={onFindRemote} disabled={isBusy}>選擇其他備份</ActionButton>}
      {canUpload && !backupSafety && ((!remoteFile && status === 'saved') || (remoteFile && !remoteConflict)) && <ActionButton onClick={onBackup} disabled={isBusy}><WorkspaceIcon name="upload" size={18} />立即備份</ActionButton>}
    </div>
    {authorized && <button type="button" className="workspace-google-drive-disconnect" onClick={onDisconnect} disabled={isBusy}>解除連結</button>}
  </WorkspaceModal>;
};
