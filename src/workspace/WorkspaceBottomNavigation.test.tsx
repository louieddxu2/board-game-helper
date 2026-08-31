import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { reorderBottomNavigationTableIds, WorkspaceBottomNavigation, WorkspaceBottomNavigationDialog, type WorkspaceBottomNavigationItem } from './WorkspaceBottomNavigation';

const items: WorkspaceBottomNavigationItem[] = [
  { tableId: 'table-1', nodeId: 'node-1', name: '桌遊收藏' },
  { tableId: 'table-2', nodeId: 'node-2', name: '購買清單' },
];

describe('WorkspaceBottomNavigation', () => {
  it('opens a pinned table and marks the current table', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<WorkspaceBottomNavigation items={items} activeTableId="table-2" onOpen={onOpen} />);

    expect(screen.getByRole('button', { name: '開啟表格 購買清單' })).toHaveAttribute('aria-current', 'page');
    await user.click(screen.getByRole('button', { name: '開啟表格 桌遊收藏' }));
    expect(onOpen).toHaveBeenCalledWith(items[0]);
  });

  it('adds the current table and cancels navigation without deleting it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<WorkspaceBottomNavigationDialog tables={items} tableIds={['table-1']} currentTableId="table-2" onChange={onChange} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '加入「購買清單」' }));
    expect(onChange).toHaveBeenLastCalledWith(['table-1', 'table-2']);

    rerender(<WorkspaceBottomNavigationDialog tables={items} tableIds={['table-1', 'table-2']} currentTableId="table-2" onChange={onChange} onClose={vi.fn()} />);
    const removeButtons = screen.getAllByRole('button', { name: '取消導覽' });
    await user.click(removeButtons[0]);
    expect(onChange).toHaveBeenLastCalledWith(['table-2']);
    expect(screen.queryByRole('button', { name: /刪除/ })).not.toBeInTheDocument();
  });

  it('reorders ids without changing their identity', () => {
    expect(reorderBottomNavigationTableIds(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(reorderBottomNavigationTableIds(['a', 'b', 'c'], 'a', 'b', true)).toEqual(['b', 'a', 'c']);
  });
});
