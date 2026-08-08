import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WorkspacePage } from './WorkspacePage';

vi.mock('../workspace/db', () => ({
  loadWorkspace: async () => ({
    version: 1,
    activeNodeId: 'node-table',
    nodes: [{ id: 'node-table', type: 'table', name: '測試表格', parentId: null, order: 0, tableId: 'table-1' }],
    tables: [{
      id: 'table-1', name: '測試表格', updatedAt: 0,
      columns: [
        { id: 'column-text', name: '名稱', inputType: 'text', options: [] },
        { id: 'column-number', name: '數量', inputType: 'number', options: [] },
      ],
      rows: [{ id: 'row-1', values: { 'column-text': null, 'column-number': 2 } }],
    }],
  }),
  saveWorkspace: vi.fn(async () => undefined),
}));

describe('WorkspacePage', () => {
  it('uses native text and number controls when cells enter edit mode', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByRole('heading', { name: '動態表格' })).toBeInTheDocument());

    await user.click(screen.getByText('點按輸入'));
    expect(screen.getByRole('textbox')).toHaveAttribute('inputmode', 'text');

    await user.keyboard('{Escape}');
    await user.click(screen.getByText('2'));
    expect(screen.getByRole('spinbutton')).toHaveAttribute('inputmode', 'decimal');
  });
});
