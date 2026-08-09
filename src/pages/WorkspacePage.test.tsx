import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspacePage } from './WorkspacePage';

vi.mock('../workspace/db', () => ({
  loadWorkspace: async () => ({
    version: 1,
    activeNodeId: 'node-table',
    nodes: [{ id: 'node-table', type: 'table', name: '測試表格', parentId: null, order: 0, tableId: 'table-1' }],
    tables: [{
      id: 'table-1', name: '測試表格', rowHeaderName: '項目', updatedAt: 0,
      columns: [
        { id: 'column-text', name: '名稱', inputType: 'text', options: [] },
        { id: 'column-number', name: '數量', inputType: 'number', options: [] },
        { id: 'column-select', name: '類型', inputType: 'select', options: ['合作', '競爭'] },
        { id: 'column-dynamic', name: '標籤', inputType: 'dynamic-select', options: [] },
      ],
      rows: [{ id: 'row-1', name: '花火', values: { 'column-text': null, 'column-number': 2, 'column-select': '合作', 'column-dynamic': null } }],
    }],
  }),
  saveWorkspace: vi.fn(async () => undefined),
}));

afterEach(() => cleanup());

describe('WorkspacePage', () => {
  it('uses native text and number controls when cells enter edit mode', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByRole('heading', { name: '動態表格' })).toBeInTheDocument());

    await user.click(screen.getAllByText('點按輸入')[0]);
    expect(screen.getByRole('textbox')).toHaveAttribute('inputmode', 'text');

    await user.keyboard('{Escape}');
    await user.click(screen.getByText('2'));
    expect(screen.getByRole('spinbutton')).toHaveAttribute('inputmode', 'decimal');
  });

  it('opens the fixed selection list immediately and saves a choice', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByText('合作')).toBeInTheDocument());

    await user.click(screen.getAllByText('合作')[0]);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '競爭' })).toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: '競爭' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('競爭')).toBeInTheDocument();
  });

  it('preserves line breaks in fixed list options', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByRole('button', { name: '名稱' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '名稱' }));
    await user.click(screen.getByRole('button', { name: '固定列表' }));
    const option = screen.getByRole('textbox', { name: '固定選項 1' });
    await user.type(option, '第一行');
    await user.keyboard('{Enter}');
    await user.type(option, '第二行');
    await user.click(screen.getByRole('button', { name: '儲存', exact: true }));

    await user.click(screen.getAllByText('點按輸入')[0]);
    expect(screen.getByRole('option', { name: /第一行/ })).toBeInTheDocument();
  });

  it('opens the dynamic selection search and commits a new value from text submission', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getAllByText('點按輸入')).toHaveLength(2));

    await user.click(screen.getAllByText('點按輸入')[1]);
    const search = screen.getByRole('textbox', { name: '搜尋或新增選項' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.type(search, '新標籤');
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('新標籤')).toBeInTheDocument();
  });

  it('keeps item names and the item axis separate from attribute columns', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByRole('button', { name: '編輯項目 花火' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '編輯項目 花火' }));
    const itemName = screen.getByRole('textbox', { name: '項目名稱' });
    await user.clear(itemName);
    await user.type(itemName, '收藏清單第一項');
    await user.click(screen.getByRole('button', { name: '確定' }));
    expect(screen.getByRole('button', { name: '編輯項目 收藏清單第一項' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '項目' }));
    const axisName = screen.getByRole('textbox', { name: '項目軸名稱' });
    await user.clear(axisName);
    await user.type(axisName, '桌遊收藏');
    await user.click(screen.getByRole('button', { name: '確定' }));
    expect(screen.getByRole('button', { name: '桌遊收藏' })).toBeInTheDocument();
  });
});
