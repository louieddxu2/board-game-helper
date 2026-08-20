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
  record: { fileId: null, fileName: null, lastBackupAt: null, sourceUpdatedAt: null, remoteModifiedTime: null, tableCount: 0, folderCount: 0 },
  remoteFile: null,
  authorized: false,
  onClose: vi.fn(),
  onConnect: vi.fn(),
  onBackup: vi.fn(),
  onFindRemote: vi.fn(),
  onRestore: vi.fn(),
  onDisconnect: vi.fn(),
  ...overrides,
});

describe('GoogleDriveBackupDialog', () => {
  it('shows only the connection action before the first link', () => {
    render(<GoogleDriveBackupDialog {...createProps()} />);

    expect(screen.getByRole('dialog', { name: 'Google Drive 備份' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '連結 Google Drive' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '立即備份' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '尋找雲端備份' })).not.toBeInTheDocument();
  });

  it('makes backup primary when local changes are waiting', () => {
    render(<GoogleDriveBackupDialog {...createProps({ status: 'dirty', authorized: true })} />);

    expect(screen.getByRole('button', { name: '立即備份' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '尋找雲端備份' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '連結 Google Drive' })).not.toBeInTheDocument();
  });

  it('makes remote restore primary without exposing the internal file name', () => {
    render(<GoogleDriveBackupDialog {...createProps({
      status: 'saved',
      authorized: true,
      remoteFile: { id: 'remote-1', name: 'manifest.xlsx', modifiedTime: '2026-08-21T10:00:00.000Z' },
    })} />);

    expect(screen.getByRole('button', { name: '使用此備份' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '立即備份' })).toBeInTheDocument();
    expect(screen.getByText('已找到')).toBeInTheDocument();
    expect(screen.queryByText('manifest.xlsx')).not.toBeInTheDocument();
  });

  it('explains a manual disconnect without offering background actions', () => {
    render(<GoogleDriveBackupDialog {...createProps({ status: 'disconnected' })} />);

    expect(screen.getByText('自動備份已暫停，請重新連結')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '連結 Google Drive' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '立即備份' })).not.toBeInTheDocument();
  });
});
