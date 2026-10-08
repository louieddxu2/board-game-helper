import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveWorkspace } from '../workspace/db';
import { WorkspacePage } from './WorkspacePage';
vi.mock('../workspace/db', () => {
  const loadWorkspace = async () => ({
    version: 1,
    activeNodeId: 'node-table',
    nodes: [
      { id: 'node-table', type: 'table', name: '測試表格', parentId: null, order: 0, tableId: 'table-1' },
      { id: 'folder-1', type: 'folder', name: '收藏資料夾', parentId: null, order: 1 },
    ],
    tables: [{
      id: 'table-1', name: '測試表格', rowHeaderName: '物件', updatedAt: 0,
      columns: [
        { id: 'column-text', name: '名稱', inputType: 'text', options: [] },
        { id: 'column-number', name: '數量', inputType: 'number', options: [] },
        { id: 'column-select', name: '類型', inputType: 'select', options: ['合作', '競爭'] },
        { id: 'column-dynamic', name: '標籤', inputType: 'dynamic-select', options: [] },
      ],
      rows: [{ id: 'row-1', name: '花火', values: { 'column-text': null, 'column-number': 2, 'column-select': '合作', 'column-dynamic': null } }],
    }],
  });
  return {
  loadWorkspace,
  loadWorkspaceInitial: async () => ({ data: await loadWorkspace(), complete: true, storageVersion: 4 }),
  assertWorkspaceStorageCurrent: vi.fn(async () => undefined),
  saveWorkspace: vi.fn(async () => undefined),
  loadWorkspaceHistories: vi.fn(async () => new Map()),
  maintainWorkspaceRowPages: vi.fn(async () => undefined),
};
});

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(saveWorkspace).mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});


const longPress = async (target: Element) => {
    const dispatchPointer = (type: string) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 20, clientY: 20 });
      Object.defineProperties(event, { pointerId: { value: 17 }, pointerType: { value: 'mouse' } });
      fireEvent(target, event);
    };
    dispatchPointer('pointerdown');
    await new Promise((resolve) => window.setTimeout(resolve, 450));
    dispatchPointer('pointerup');
    fireEvent.click(target);
  };

const longPressWithoutSyntheticClick = async (target: Element) => {
    const dispatchPointer = (type: string) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 20, clientY: 20 });
      Object.defineProperties(event, { pointerId: { value: 19 }, pointerType: { value: 'touch' } });
      fireEvent(target, event);
    };
    dispatchPointer('pointerdown');
    await new Promise((resolve) => window.setTimeout(resolve, 450));
    dispatchPointer('pointerup');
  };
describe('WorkspacePage.bulk', () => {
it('batch-adds a multi-select option using aggregate counts and undoes it as one action', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByRole('cell', { name: '花火，類型：合作' })).toBeInTheDocument());

    await user.click(screen.getByRole('columnheader', { name: '類型' }));
    await user.click(screen.getByRole('checkbox', { name: '多選' }));
    fireEvent.click(document.querySelector('.workspace-column-dialog-overlay')!);

    await user.click(screen.getByRole('button', { name: '編輯' }));
    await user.click(screen.getByRole('button', { name: '新增物件' }));
    await user.click(screen.getByRole('cell', { name: '物件 2，類型：空白' }));
    await user.click(screen.getByRole('option', { name: '競爭' }));
    fireEvent.click(document.querySelector('.workspace-selection-dialog-overlay')!);

    await longPress(screen.getByRole('cell', { name: '花火，類型：合作' }));
    await user.click(screen.getByRole('cell', { name: '物件 2，類型：競爭' }));
    await user.click(screen.getByRole('button', { name: '開啟 類型 批次輸入' }));

    const cooperation = screen.getByRole('button', { name: '寫入 合作 至全部格子' });
    await user.click(cooperation);
    expect(cooperation.closest('.workspace-bulk-multi-row')).toHaveClass('is-add');
    expect(cooperation.closest('.workspace-bulk-multi-row')).toHaveTextContent('2/2');
    await user.click(screen.getByRole('button', { name: '確認' }));

    expect(screen.getByRole('cell', { name: '物件 2，類型：競爭、合作' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '編輯' }));
    await user.click(screen.getByRole('button', { name: '復原' }));
    expect(screen.getByRole('cell', { name: '物件 2，類型：競爭' })).toBeInTheDocument();
  });

it('accepts the first real cell tap after a long press that produces no synthetic click', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByRole('cell', { name: '花火，名稱：空白' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '編輯' }));
    await user.click(screen.getByRole('button', { name: '新增物件' }));

    const first = screen.getByRole('cell', { name: '花火，名稱：空白' });
    const second = screen.getByRole('cell', { name: '物件 2，名稱：空白' });
    await longPressWithoutSyntheticClick(first);
    expect(screen.getByRole('toolbar', { name: '批次編輯 名稱' })).toHaveTextContent('已選 1 格');

    await user.click(second);
    expect(screen.getByRole('toolbar', { name: '批次編輯 名稱' })).toHaveTextContent('已選 2 格');
  });

it('keeps batch selections while searching different content', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByRole('cell', { name: '花火，名稱：空白' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '編輯' }));
    await user.click(screen.getByRole('button', { name: '新增物件' }));
    await longPress(screen.getByRole('cell', { name: '花火，名稱：空白' }));
    expect(screen.getByRole('table')).toHaveStyle({ '--workspace-table-body-offset': '0px' });

    await user.click(screen.getByRole('button', { name: '搜尋並繼續批次選取' }));
    const search = screen.getByRole('searchbox', { name: '搜尋後繼續選取' });
    const viewport = document.querySelector('.workspace-table-viewport') as HTMLDivElement;
    viewport.scrollTop = 180;
    await user.type(search, '物件 2');
    expect(viewport.scrollTop).toBe(0);
    expect(screen.getByRole('table')).toHaveStyle({ '--workspace-table-body-offset': 'calc(var(--workspace-toolbar-row-height) * 2)' });
    await user.click(screen.getByRole('cell', { name: '物件 2，名稱：空白' }));
    expect(screen.getByRole('toolbar', { name: '批次編輯 名稱' })).toHaveTextContent('已選 2 格');

    await user.clear(search);
    await user.type(search, '花火');
    expect(screen.getByRole('cell', { name: '花火，名稱：空白' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('已選 2 · 顯示 1 / 2 項')).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: '搜尋後繼續選取' }).parentElement).toHaveTextContent('1 / 2');
  });

it('reveals the first object from the top pull only after batch selection has begun', async () => {
    render(<WorkspacePage />);
    const firstCell = await screen.findByRole('cell', { name: '花火，名稱：空白' });
    await longPressWithoutSyntheticClick(firstCell);
    const table = screen.getByRole('table');
    expect(table).toHaveStyle({ '--workspace-table-body-offset': '0px' });

    const viewport = document.querySelector('.workspace-table-viewport') as HTMLDivElement;
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
      scrollWidth: { configurable: true, value: 800 },
      scrollHeight: { configurable: true, value: 600 },
      scrollLeft: { configurable: true, writable: true, value: 0 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
    const dispatchPointer = (element: Element, type: string, y: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: 120, clientY: y });
      Object.defineProperties(event, { pointerId: { value: 48 }, pointerType: { value: 'touch' } });
      fireEvent(element, event);
    };

    dispatchPointer(firstCell, 'pointerdown', 100);
    dispatchPointer(viewport, 'pointermove', 220);
    expect(table).toHaveStyle({ '--workspace-table-body-offset': 'calc(var(--workspace-toolbar-row-height) * 1)' });
    dispatchPointer(viewport, 'pointerup', 220);
  });

it('pastes a rectangular range from the last selected cell and undoes it as one action', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    const firstCell = await screen.findByRole('cell', { name: '花火，名稱：空白' });
    await user.click(firstCell);
    fireEvent.click(document.querySelector('.workspace-value-dialog-overlay')!);
    await user.click(screen.getByRole('button', { name: '編輯' }));
    await user.click(screen.getByRole('button', { name: '貼上多格' }));
    expect(screen.getByText('起點：花火／名稱')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '貼上試算表內容' }), { target: { value: '甲\t5\n乙\t6' } });
    await user.click(screen.getByRole('button', { name: '貼上 2 × 2' }));

    expect(screen.getByRole('cell', { name: '花火，名稱：甲' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '物件 2，數量：6' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '復原' }));
    expect(screen.getByRole('cell', { name: '花火，名稱：空白' })).toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: /物件 2，/ })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('已復原：貼上 2 × 2 格');
  });

it('previews proportional number allocation before the toolbar confirmation', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByRole('cell', { name: '花火，數量：2' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '編輯' }));
    await user.click(screen.getByRole('button', { name: '新增物件' }));
    const first = screen.getByRole('cell', { name: '花火，數量：2' });
    const second = screen.getByRole('cell', { name: '物件 2，數量：空白' });
    await longPress(first);
    await user.click(second);
    await user.click(screen.getByRole('button', { name: '開啟 數量 批次輸入' }));
    await user.clear(screen.getByRole('spinbutton', { name: '數量批次輸入' }));
    await user.type(screen.getByRole('spinbutton', { name: '數量批次輸入' }), '10');
    await user.click(screen.getByRole('tab', { name: '比例分配' }));
    const ratioInput = screen.getByRole('spinbutton', { name: '物件 2比例' }) as HTMLInputElement;
    const selectContents = vi.spyOn(ratioInput, 'select');
    await user.click(ratioInput);
    expect(selectContents).toHaveBeenCalled();
    await user.clear(ratioInput);
    await user.type(ratioInput, '3');
    expect(screen.getByRole('status', { name: '花火分配結果' })).toHaveTextContent('3');
    expect(screen.getByRole('status', { name: '物件 2分配結果' })).toHaveTextContent('7');
    expect(screen.queryByRole('button', { name: '套用預覽' })).not.toBeInTheDocument();
    fireEvent.click(document.querySelector('.workspace-value-dialog-overlay')!);
    expect(first).toHaveTextContent('2');
    await user.click(screen.getByRole('button', { name: '開啟 數量 批次輸入' }));
    const reopenedTotal = screen.getByRole('spinbutton', { name: '數量批次輸入' });
    await user.clear(reopenedTotal);
    await user.type(reopenedTotal, '10');
    await user.click(screen.getByRole('tab', { name: '比例分配' }));
    const reopenedRatio = screen.getByRole('spinbutton', { name: '物件 2比例' });
    await user.clear(reopenedRatio);
    await user.type(reopenedRatio, '3');
    await user.click(screen.getByRole('button', { name: '確認' }));
    expect(screen.getByRole('cell', { name: '花火，數量：3' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '物件 2，數量：7' })).toBeInTheDocument();
  });

it('updates selected number totals and averages across every selected cell', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    const first = await screen.findByRole('cell', { name: '花火，數量：2' });
    await user.click(screen.getByRole('button', { name: '編輯' }));
    await user.click(screen.getByRole('button', { name: '新增物件' }));
    await user.click(screen.getByRole('button', { name: '新增物件' }));
    await user.click(screen.getByRole('cell', { name: '物件 2，數量：空白' }));
    await user.type(screen.getByRole('spinbutton', { name: '數量輸入' }), '4.5');
    fireEvent.click(document.querySelector('.workspace-value-dialog-overlay')!);

    await longPress(first);
    const toolbar = screen.getByRole('toolbar', { name: '批次編輯 數量' });
    const statsButton = within(toolbar).getByRole('button', { name: '目前顯示總和 2，點按切換平均' });
    const batchButton = within(toolbar).getByRole('button', { name: '開啟 數量 批次輸入' });
    expect(batchButton).toHaveTextContent(/^批次$/);
    expect(within(statsButton).getByText('總和')).toHaveClass('is-active');
    expect(within(statsButton).getByText('平均')).not.toHaveClass('is-active');

    await user.click(screen.getByRole('cell', { name: '物件 2，數量：4.5' }));
    expect(statsButton).toHaveAccessibleName('目前顯示總和 6.5，點按切換平均');
    await user.click(statsButton);
    expect(statsButton).toHaveAccessibleName('目前顯示平均 3.25，點按切換總和');
    expect(within(statsButton).getByText('平均')).toHaveClass('is-active');
    await user.click(screen.getByRole('cell', { name: '物件 3，數量：空白' }));
    expect(toolbar).toHaveTextContent('已選 3 格');
    expect(statsButton).toHaveAccessibleName('目前顯示平均 2.17，點按切換總和');

    await user.click(statsButton);
    expect(statsButton).toHaveAccessibleName('目前顯示總和 6.5，點按切換平均');
    expect(within(statsButton).getByText('總和')).toHaveClass('is-active');
    await user.click(first);
    expect(statsButton).toHaveAccessibleName('目前顯示總和 4.5，點按切換平均');
    await user.click(statsButton);
    expect(statsButton).toHaveAccessibleName('目前顯示平均 2.25，點按切換總和');
    await user.click(screen.getByRole('cell', { name: '物件 2，數量：4.5' }));
    expect(statsButton).toHaveAccessibleName('目前顯示平均 0，點按切換總和');
  });

it('switches number batch modes with tabs', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByRole('cell', { name: '花火，數量：2' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '編輯' }));
    await user.click(screen.getByRole('button', { name: '新增物件' }));
    await longPress(screen.getByRole('cell', { name: '花火，數量：2' }));
    await user.click(screen.getByRole('cell', { name: '物件 2，數量：空白' }));

    expect(screen.queryByRole('tab', { name: '比例分配' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '開啟 數量 批次輸入' }));
    const dialog = screen.getByRole('dialog');
    const allTab = within(dialog).getByRole('tab', { name: '全部輸入' });
    const ratioTab = within(dialog).getByRole('tab', { name: '比例分配' });
    expect(within(dialog).getByRole('tablist', { name: '批次輸入方式' })).toBeInTheDocument();
    expect(allTab).toHaveAttribute('aria-selected', 'true');
    expect(ratioTab).toHaveAttribute('aria-selected', 'false');
    expect(within(dialog).getByRole('tabpanel', { name: '全部輸入' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('spinbutton', { name: '花火比例' })).not.toBeInTheDocument();

    await user.click(ratioTab);
    expect(ratioTab).toHaveAttribute('aria-selected', 'true');
    expect(within(dialog).getByRole('tabpanel', { name: '比例分配' })).toBeInTheDocument();
    expect(within(dialog).getByRole('spinbutton', { name: '花火比例' })).toBeInTheDocument();
    expect(within(dialog).getByText('近似取整')).toBeInTheDocument();
    expect(within(dialog).queryByText('結果')).not.toBeInTheDocument();
    expect(within(dialog).getAllByText('→').length).toBeGreaterThan(0);
    await user.click(allTab);
    expect(allTab).toHaveAttribute('aria-selected', 'true');
    expect(within(dialog).queryByRole('spinbutton', { name: '花火比例' })).not.toBeInTheDocument();
    await user.keyboard('{ArrowRight}');
    expect(ratioTab).toHaveFocus();
    expect(ratioTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

it('keeps the batch number while switching between all input and proportional distribution', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByRole('cell', { name: '花火，數量：2' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '編輯' }));
    await user.click(screen.getByRole('button', { name: '新增物件' }));
    await longPress(screen.getByRole('cell', { name: '花火，數量：2' }));
    await user.click(screen.getByRole('cell', { name: '物件 2，數量：空白' }));

    await user.click(screen.getByRole('button', { name: '開啟 數量 批次輸入' }));
    const sharedInput = screen.getByRole('spinbutton', { name: '數量批次輸入' });
    await user.clear(sharedInput);
    await user.type(sharedInput, '12');
    await user.click(screen.getByRole('tab', { name: '比例分配' }));
    expect(sharedInput).toHaveValue(12);
    await user.clear(sharedInput);
    await user.type(sharedInput, '20');
    expect(sharedInput).toHaveValue(20);
    await user.click(screen.getByRole('tab', { name: '全部輸入' }));
    expect(sharedInput).toHaveValue(20);
    await user.click(screen.getByRole('button', { name: '確認' }));
    expect(screen.getByRole('cell', { name: '花火，數量：20' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '物件 2，數量：20' })).toBeInTheDocument();
  });

it('does not apply a batch value when its dialog is dismissed', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByRole('cell', { name: '花火，數量：2' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '編輯' }));
    await user.click(screen.getByRole('button', { name: '新增物件' }));
    const first = screen.getByRole('cell', { name: '花火，數量：2' });
    const second = screen.getByRole('cell', { name: '物件 2，數量：空白' });
    await longPress(first);
    await user.click(second);
    await user.click(screen.getByRole('button', { name: '開啟 數量 批次輸入' }));
    await user.clear(screen.getByRole('spinbutton', { name: '數量批次輸入' }));
    await user.type(screen.getByRole('spinbutton', { name: '數量批次輸入' }), '10');
    await user.click(screen.getByRole('tab', { name: '比例分配' }));
    fireEvent.click(document.querySelector('.workspace-value-dialog-overlay')!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: '批次編輯 數量' })).toBeInTheDocument();
    expect(first).toHaveTextContent('2');
    expect(second).toHaveAccessibleName('物件 2，數量：空白');
  });

it('uses native text and number controls when cells enter edit mode', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await waitFor(() => expect(screen.getByRole('heading', { name: '動態表格' })).toBeInTheDocument());

    await user.click(screen.getByRole('cell', { name: '花火，名稱：空白' }));
    expect(screen.getByRole('textbox').closest('[role="dialog"]')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveAttribute('inputmode', 'text');
    expect(document.querySelector('.workspace-value-context')).not.toBeInTheDocument();

    await user.keyboard('{Escape}');
    await user.click(screen.getByText('2'));
    expect(screen.getByRole('spinbutton').closest('[role="dialog"]')).toBeInTheDocument();
    expect(screen.getByRole('spinbutton')).toHaveAttribute('inputmode', 'decimal');
    expect(screen.getByRole('spinbutton')).toHaveAttribute('enterkeyhint', 'done');
  });

it('supports vertical numeric adjustments with decimal-point alignment', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    const cell = await screen.findByRole('cell', { name: '花火，數量：2' });

    await user.click(cell);
    expect(document.querySelector('.workspace-value-context')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '增加數值' }));
    const input = screen.getByRole('spinbutton', { name: '數量輸入加法' });
    expect(input).toHaveValue(0);
    expect(document.querySelector('.workspace-value-context')).not.toBeInTheDocument();
    expect(screen.getByRole('status', { name: '數量計算結果' })).toHaveTextContent('→2');
    expect(document.activeElement).toBe(input);
    await user.type(input, '0.25');

    expect(document.querySelector('.workspace-number-editor')).toHaveAttribute('data-mode', 'add');
    expect(screen.getByRole('status', { name: '數量計算結果' })).toHaveTextContent('→2.25');
    expect(screen.getByRole('button', { name: '編輯原始數值 2' })).toHaveTextContent('2');

    fireEvent.click(document.querySelector('.workspace-value-dialog-overlay')!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '花火，數量：2.25' })).toBeInTheDocument();
  });

it('treats an empty adjustment as zero and keeps the original result visible', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    const cell = await screen.findByRole('cell', { name: '花火，數量：2' });

    await user.click(cell);
    await user.click(screen.getByRole('button', { name: '減少數值' }));
    const input = screen.getByRole('spinbutton', { name: '數量輸入減法' });
    await user.clear(input);
    expect(input).toHaveValue(null);
    expect(screen.getByRole('status', { name: '數量計算結果' })).toHaveTextContent('→2');

    fireEvent.click(document.querySelector('.workspace-value-dialog-overlay')!);
    expect(screen.getByRole('cell', { name: '花火，數量：2' })).toBeInTheDocument();
  });

it('returns to direct numeric editing when the original value is clicked', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    const cell = await screen.findByRole('cell', { name: '花火，數量：2' });

    await user.click(cell);
    await user.click(screen.getByRole('button', { name: '增加數值' }));
    await user.type(screen.getByRole('spinbutton', { name: '數量輸入加法' }), '5');
    await user.click(screen.getByRole('button', { name: '編輯原始數值 2' }));

    expect(screen.getByRole('spinbutton', { name: '數量輸入' })).toHaveValue(2);
    expect(screen.queryByRole('status', { name: '數量計算結果' })).not.toBeInTheDocument();
    fireEvent.click(document.querySelector('.workspace-value-dialog-overlay')!);
    expect(screen.getByRole('cell', { name: '花火，數量：2' })).toBeInTheDocument();
  });
});
