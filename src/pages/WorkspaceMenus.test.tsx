import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createColumn, emptyWorkspace } from '../workspace/model';
import type { WorkspaceData } from '../workspace/types';
import { WorkspacePage } from './WorkspacePage';

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(async (_data: unknown, _options?: unknown) => undefined), openDrive: vi.fn() }));
vi.mock('../workspace/backgroundWork', () => ({ afterWorkspacePaint: (work: () => void) => { work(); return () => undefined; } }));
vi.mock('../workspace/db', () => ({
  loadWorkspace: mocks.load,
  loadWorkspaceInitial: async () => ({ data: { ...seed(), tables: [seed().tables[0]] }, complete: false, progressive: true, storageVersion: 8 }),
  saveWorkspace: mocks.save, assertWorkspaceStorageCurrent: vi.fn(),
  loadWorkspaceHistoryHead: vi.fn(async (tableId: string) => ({ tableId, past: [], future: [] })), maintainWorkspaceRowPages: vi.fn(async () => undefined),
}));
vi.mock('../workspace/googleDriveBackup/useWorkspaceGoogleDriveBackup', () => ({ useWorkspaceGoogleDriveBackup: () => ({
  dialogOpen: false, open: mocks.openDrive, close: vi.fn(), backup: vi.fn(),
  autoBackupEnabled: false, authorized: false, online: true, manuallyDisconnected: false, remoteConflict: false, busy: null,
  status: 'never', record: { lastBackupAt: null, folderCount: 0, tableCount: 0 }, setAutoBackupEnabled: vi.fn(),
}) }));
const column = { ...createColumn('名稱'), id: 'column' };
const seed = (): WorkspaceData => ({
  ...emptyWorkspace(), activeNodeId: 'node-1', bottomNavigationTableIds: ['table-2', 'table-3'],
  nodes: [1, 2, 3].map(id => ({ id: `node-${id}`, tableId: `table-${id}`, type: 'table', name: `表格 ${id}`, parentId: null, order: id })),
  tables: [1, 2, 3].map(id => ({ id: `table-${id}`, name: `表格 ${id}`, rowHeaderName: '項目', columns: [column], updatedAt: 1, rows: [{ id: `row-${id}`, name: `物件 ${id}`, values: { column: '原值' } }] })),
});
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  mocks.load.mockImplementation(async (options?: { tableIds?: readonly string[] }) => {
    const full = seed();
    return options?.tableIds ? { ...full, tables: full.tables.filter(table => options.tableIds!.includes(table.id)) } : full;
  });
});
afterEach(cleanup);
const openDrawer = async () => {
  render(<WorkspacePage />);
  await screen.findByRole('cell', { name: '物件 1，名稱：原值' });
  await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(1));
  mocks.load.mockClear();
  fireEvent.click(screen.getByRole('button', { name: '開啟目錄' }));
};

describe('menus in a partially loaded workspace', () => {
  it('opens creation and Drive controls without loading other tables', async () => {
    await openDrawer();
    fireEvent.click(screen.getByRole('button', { name: '新增表格' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '關閉' }));
    fireEvent.click(screen.getByRole('button', { name: '開啟 Google Drive 備份' }));
    expect(mocks.openDrive).toHaveBeenCalledOnce();
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('preserves unloaded pinned tables when saving bottom navigation', async () => {
    await openDrawer();
    fireEvent.click(screen.getByRole('button', { name: '管理底部導覽列' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(within(dialog).getByRole('button', { name: '拖曳調整 表格 2 的順序' }), { key: 'ArrowDown' });
    fireEvent.click(within(dialog).getByRole('button', { name: '關閉' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    const saved = mocks.save.mock.calls.at(-1)![0] as WorkspaceData;
    expect(saved.bottomNavigationTableIds).toEqual(['table-3', 'table-2']);
    expect(saved.tables.map(table => table.id)).toEqual(['table-1']);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('opens an unloaded table menu immediately and reads only that table when confirming a rename', async () => {
    await openDrawer();
    fireEvent.click(screen.getByRole('button', { name: '開啟表格 2操作' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '重新命名' }));
    expect(mocks.load).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: '名稱' }), { target: { value: '改名表格' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '關閉' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(mocks.load).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ tableIds: ['table-2'] }));
    const saved = mocks.save.mock.calls.at(-1)![0] as WorkspaceData;
    expect(saved.tables.map(table => table.id)).toEqual(['table-1', 'table-2']);
    expect(saved.tables[1].name).toBe('改名表格');
    expect(saved.nodes.find(node => node.tableId === 'table-2')?.name).toBe('改名表格');
  });
});
