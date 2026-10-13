import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoogleDriveBackupDialog } from './GoogleDriveBackupDialog';
import type { GoogleDriveBackupDialogProps } from './GoogleDriveBackupDialog';

afterEach(() => cleanup());

const createProps = (overrides: Partial<GoogleDriveBackupDialogProps> = {}): GoogleDriveBackupDialogProps => ({
  status: 'never',
  busy: null,
  message: '',
  error: '',
  record: { fileId: null, fileName: null, lastBackupAt: null, sourceUpdatedAt: null, remoteModifiedTime: null, tableCount: 0, folderCount: 0, structureRevision: null, tableBackups: {} },
  remoteFile: null,
  authorized: false,
  onClose: vi.fn(),
  onConnect: vi.fn(),
  onBackup: vi.fn(),
  onFindRemote: vi.fn(),
  onRestore: vi.fn(),
  remoteConflict: false,
  onOverwrite: vi.fn(),
  onDisconnect: vi.fn(),
  ...overrides,
});

describe('GoogleDriveBackupDialog', () => {
  it('announces the current table and processed count without claiming upload-byte progress', () => {
    const props = createProps({ status: 'dirty', authorized: true, busy: 'backing-up', progress: { phase: 'uploading-table', name: '收藏表', completedTables: 1, totalTables: 3 } });
    const view = render(<GoogleDriveBackupDialog {...props} />);
    expect(screen.getByText('備份進行中')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('正在上傳表格：收藏表');
    expect(screen.getByRole('status')).toHaveTextContent('已處理 1 / 3 張表格');
    expect(screen.getByRole('progressbar', { name: '表格備份進度' })).toHaveAttribute('value', '1');
    expect(screen.getByRole('progressbar')).toHaveAttribute('max', '3');
    expect(screen.getByRole('button', { name: '立即備份' })).toBeDisabled();
    view.rerender(<GoogleDriveBackupDialog {...props} progress={{ phase: 'confirming', completedTables: 3, totalTables: 3 }} />);
    expect(screen.getByRole('status')).toHaveTextContent('正在確認雲端備份');
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('value');
    expect(screen.queryByText('已完成備份')).not.toBeInTheDocument();
    view.rerender(<GoogleDriveBackupDialog {...props} busy={null} progress={undefined} status="saved" message="已備份整個資料庫" />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByText('已完成備份')).toBeInTheDocument();
    expect(screen.queryByText('已備份整個資料庫')).not.toBeInTheDocument();
  });

  it('keeps preparation and an empty-workspace finalization indeterminate', () => {
    const props = createProps({ busy: 'backing-up', progress: { phase: 'reading-directory' } });
    const view = render(<GoogleDriveBackupDialog {...props} />);
    expect(screen.getByRole('status')).toHaveTextContent('正在讀取表格目錄');
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('value');
    view.rerender(<GoogleDriveBackupDialog {...props} progress={{ phase: 'saving-index', totalTables: 0, completedTables: 0 }} />);
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('value');
    expect(screen.getByRole('progressbar')).toHaveAttribute('max', '1');
    expect(screen.getByRole('status')).toHaveTextContent('正在完成備份');
  });

  it('shows only the connection action before the first link', () => {
    render(<GoogleDriveBackupDialog {...createProps()} />);

    expect(screen.getByRole('dialog', { name: 'Google Drive 備份' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '連結 Google Drive' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '立即備份' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '選擇備份還原' })).not.toBeInTheDocument();
  });

  it('makes backup primary when local changes are waiting', () => {
    render(<GoogleDriveBackupDialog {...createProps({ status: 'dirty', authorized: true })} />);

    expect(screen.getByRole('button', { name: '立即備份' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '選擇備份還原' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '連結 Google Drive' })).not.toBeInTheDocument();
  });

  it('makes remote restore primary without exposing the internal file name', () => {
    render(<GoogleDriveBackupDialog {...createProps({
      status: 'saved',
      authorized: true,
      remoteFile: { id: 'remote-1', name: 'manifest.xlsx', modifiedTime: '2026-08-21T10:00:00.000Z' },
    })} />);

    expect(screen.getByRole('button', { name: '還原此備份' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '立即備份' })).toBeInTheDocument();
    expect(screen.queryByText('已找到')).not.toBeInTheDocument();
    expect(screen.queryByText('雲端修改')).not.toBeInTheDocument();
    expect(screen.queryByText('manifest.xlsx')).not.toBeInTheDocument();
  });

  it('shows a concise manual disconnect state without offering background actions', () => {
    render(<GoogleDriveBackupDialog {...createProps({ status: 'disconnected' })} />);

    expect(screen.getByText('已主動斷線')).toBeInTheDocument();
    expect(screen.queryByText('自動備份已暫停，請重新連結')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '連結 Google Drive' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '立即備份' })).not.toBeInTheDocument();
  });

  it('requires an explicit overwrite choice when the remote backup changed elsewhere', () => {
    render(<GoogleDriveBackupDialog {...createProps({
      status: 'dirty',
      authorized: true,
      remoteConflict: true,
      remoteFile: { id: 'remote-new', name: 'manifest.xlsx', modifiedTime: '2026-08-21T11:00:00.000Z' },
    })} />);

    expect(screen.getByRole('button', { name: '還原此備份' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '以本機資料覆蓋雲端' })).toBeInTheDocument();
    expect(screen.getByText('雲端版本不同')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '立即備份' })).not.toBeInTheDocument();
  });
});
