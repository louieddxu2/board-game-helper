import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspacePage } from './WorkspacePage';

vi.mock('../workspace/backgroundWork', () => ({ afterWorkspacePaint: (work: () => void) => { work(); return () => undefined; } }));
vi.mock('../workspace/db', () => {
  const full = () => ({
    version: 1, activeNodeId: 'node-1', bottomNavigationTableIds: ['table-1', 'table-2'],
    nodes: [1, 2].map(id => ({ id: `node-${id}`, type: 'table', name: `表格 ${id}`, parentId: null, order: id, tableId: `table-${id}` })),
    tables: [1, 2].map(id => ({
      id: `table-${id}`, name: `表格 ${id}`, rowHeaderName: '物件', updatedAt: 0,
      columns: [{ id: 'column', name: '名稱', inputType: 'text', options: [] }],
      rows: [{ id: `row-${id}`, name: `物件 ${id}`, values: { column: '原值' } }],
    })),
  });
  // Only the active table loads up front, so switching tables waits on an async read like a real device.
  const loadWorkspace = async (options?: { tableIds?: readonly string[] }) => {
    const data = full();
    return options?.tableIds ? { ...data, tables: data.tables.filter(table => options.tableIds!.includes(table.id)) } : data;
  };
  return {
    loadWorkspace,
    loadWorkspaceInitial: async () => ({ data: { ...full(), tables: [full().tables[0]] }, complete: false, progressive: true, storageVersion: 4 }),
    loadWorkspaceTableWindow: vi.fn(async () => undefined),
    assertWorkspaceStorageCurrent: vi.fn(async () => undefined),
    saveWorkspace: vi.fn(async () => undefined),
    loadWorkspaceHistoryHead: vi.fn(async (tableId: string) => ({ tableId, past: [], future: [] })),
    maintainWorkspaceRowPages: vi.fn(async () => undefined),
  };
});

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

it.each(['bottom navigation'] as const)('keeps a table search visible but unfocused after leaving through the %s and returning', async (route) => {
  render(<WorkspacePage />);
  await screen.findByRole('cell', { name: '物件 1，名稱：原值' });
  fireEvent.click(screen.getByRole('button', { name: '搜尋' }));
  fireEvent.change(screen.getByRole('searchbox', { name: '搜尋此表' }), { target: { value: '物件' } });
  const open = (name: string) => {
    if (route === 'bottom navigation') { fireEvent.click(screen.getByRole('button', { name: `開啟表格 ${name}` })); return; }
    fireEvent.click(screen.getByRole('button', { name: '開啟目錄' }));
    fireEvent.click(within(screen.getByRole('complementary', { name: 'Workspace 目錄' })).getByText(name));
  };
  open('表格 2');
  await screen.findByRole('cell', { name: '物件 2，名稱：原值' });
  expect(screen.queryByRole('searchbox', { name: '搜尋此表' })).not.toBeInTheDocument();
  open('表格 1');
  await screen.findByRole('cell', { name: '物件 1，名稱：原值' });
  const search = screen.getByRole('searchbox', { name: '搜尋此表' });
  expect(search).toHaveValue('物件');
  expect(search).not.toHaveFocus();
});
