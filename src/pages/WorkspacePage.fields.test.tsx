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
describe('WorkspacePage.fields', () => {
it('edits the first column through the same property settings as other columns', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('columnheader', { name: '物件' }));

    expect(screen.getByRole('button', { name: '選單' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '其他' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '其他' }));
    expect(screen.getByRole('button', { name: '連結' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '時間(含日期)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '刪除屬性' })).not.toBeInTheDocument();
  });

it('opens display settings from one left-side button into the right panel', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('columnheader', { name: '名稱' }));

    const rail = document.querySelector('.workspace-column-config-rail');
    const panel = document.querySelector('.workspace-column-config-panel');
    expect(rail?.querySelector('.workspace-alignment-field')).toBeInTheDocument();
    expect(rail?.querySelector('.workspace-overflow-field')).toBeInTheDocument();
    expect(panel?.querySelector('.workspace-input-subtype-options')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '自動換行' }));
    expect(panel?.querySelector('.workspace-overflow-panel')).toBeInTheDocument();
    expect(within(panel as HTMLElement).getByRole('button', { name: '推擠寬度' })).toBeInTheDocument();
    expect(within(panel as HTMLElement).getByRole('button', { name: '超過省略' })).toBeInTheDocument();
    fireEvent.click(document.querySelector('.workspace-column-dialog-overlay')!);

    await user.click(await screen.findByRole('columnheader', { name: '類型' }));
    expect(document.querySelector('.workspace-column-config-panel .workspace-option-list')).toBeInTheDocument();
  });

it('edits and renders a link with a preferred display name and external action', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('columnheader', { name: '名稱' }));
    await user.click(screen.getByRole('button', { name: '其他' }));
    await user.click(screen.getByRole('button', { name: '連結' }));
    fireEvent.click(document.querySelector('.workspace-column-dialog-overlay')!);

    await user.click(screen.getByRole('cell', { name: '花火，名稱：空白' }));
    await user.type(screen.getByRole('textbox', { name: '連結' }), 'example.com/game');
    await user.type(screen.getByRole('textbox', { name: '顯示名稱' }), '遊戲頁面');
    fireEvent.click(document.querySelector('.workspace-link-dialog-overlay')!);

    expect(screen.getByText('遊戲頁面')).toBeInTheDocument();
    const externalLink = screen.getByRole('link', { name: '外連' });
    expect(externalLink).toHaveAttribute('href', 'https://example.com/game');
    expect(externalLink).not.toHaveTextContent('外連');
    expect(externalLink).not.toHaveClass('is-push-width');

    await user.click(await screen.findByRole('columnheader', { name: '名稱' }));
    await user.click(screen.getByRole('button', { name: '超過省略' }));
    await user.click(screen.getByRole('button', { name: '推擠寬度' }));
    fireEvent.click(document.querySelector('.workspace-column-dialog-overlay')!);
    expect(screen.getByRole('link', { name: '外連' })).toHaveClass('is-push-width');
  });

it('immediately renders an external action when ordinary cell text is a URL', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('cell', { name: '花火，名稱：空白' }));
    await user.type(screen.getByRole('textbox', { name: '名稱輸入' }), 'example.com/game');
    fireEvent.click(document.querySelector('.workspace-value-dialog-overlay')!);

    expect(screen.getByRole('link', { name: '外連' })).toHaveAttribute('href', 'https://example.com/game');
  });

it('suggests current distinct values when changing a property to a fixed list', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('cell', { name: '花火，名稱：空白' }));
    await user.type(screen.getByRole('textbox', { name: '名稱輸入' }), '合作');
    fireEvent.click(document.querySelector('.workspace-value-dialog-overlay')!);
    await user.click(screen.getByRole('columnheader', { name: '名稱' }));
    await user.click(screen.getByRole('button', { name: '選單' }));
    await user.click(screen.getByRole('button', { name: '固定列表' }));

    expect(screen.getByRole('textbox', { name: '固定選項 1' })).toHaveValue('合作');
  });

it('opens the compact date-time wheel editor and displays zero-padded values', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('columnheader', { name: '名稱' }));
    await user.click(screen.getByRole('button', { name: '其他' }));
    await user.click(screen.getByRole('button', { name: '時間(含日期)' }));
    fireEvent.click(document.querySelector('.workspace-column-dialog-overlay')!);

    await user.click(screen.getByRole('cell', { name: '花火，名稱：空白' }));
    expect(screen.getByRole('group', { name: '名稱日期時間' })).toBeInTheDocument();
    const today = new Date();
    expect(within(screen.getByRole('listbox', { name: '年' })).getByRole('option', { selected: true })).toHaveTextContent(String(today.getFullYear()));
    expect(within(screen.getByRole('listbox', { name: '月' })).getByRole('option', { selected: true })).toHaveTextContent(String(today.getMonth() + 1));
    expect(within(screen.getByRole('listbox', { name: '日' })).getByRole('option', { selected: true })).toHaveTextContent(String(today.getDate()));
    expect(document.querySelector('.workspace-datetime-footer')?.lastElementChild).toHaveClass('workspace-datetime-current');
    const minuteWheel = screen.getByRole('listbox', { name: '分' });
    const currentMinute = within(minuteWheel).getByRole('option', { selected: true }).textContent;
    fireEvent.wheel(minuteWheel, { deltaY: -30 });
    expect(within(minuteWheel).getByRole('option', { selected: true })).not.toHaveTextContent(currentMinute ?? '');
    fireEvent.click(document.querySelector('.workspace-value-dialog-overlay')!);

    expect(screen.getByText(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/)).toBeInTheDocument();
  });

it('can display only the date without discarding the stored time', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('columnheader', { name: '名稱' }));
    await user.click(screen.getByRole('button', { name: '其他' }));
    await user.click(screen.getByRole('button', { name: '時間(含日期)' }));
    await user.click(screen.getByRole('checkbox', { name: '只顯示年月日' }));
    fireEvent.click(document.querySelector('.workspace-column-dialog-overlay')!);

    await user.click(screen.getByRole('cell', { name: '花火，名稱：空白' }));
    expect(screen.getByRole('group', { name: '名稱日期' })).toBeInTheDocument();
    expect(screen.queryByRole('listbox', { name: '時' })).not.toBeInTheDocument();
    expect(screen.queryByRole('listbox', { name: '分' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '今天' }));

    expect(screen.getByText(/^\d{4}\/\d{2}\/\d{2}$/)).toBeInTheDocument();
    await waitFor(() => expect(vi.mocked(saveWorkspace)).toHaveBeenCalled());
    const latest = vi.mocked(saveWorkspace).mock.calls.at(-1)?.[0];
    const column = latest?.tables[0].columns[0];
    expect(column?.dateOnly).toBe(true);
    expect(latest?.tables[0].rows[0].values[column!.id]).toMatch(/T/);
  });

it('keeps a blank date empty when the editor is closed without interaction', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('columnheader', { name: '名稱' }));
    await user.click(screen.getByRole('button', { name: '其他' }));
    await user.click(screen.getByRole('button', { name: '時間(含日期)' }));
    fireEvent.click(document.querySelector('.workspace-column-dialog-overlay')!);

    await user.click(screen.getByRole('cell', { name: '花火，名稱：空白' }));
    expect(screen.getByRole('button', { name: '現在' })).toBeInTheDocument();
    fireEvent.click(document.querySelector('.workspace-value-dialog-overlay')!);

    expect(screen.getByRole('cell', { name: '花火，名稱：空白' })).toBeInTheDocument();
  });

it('commits the current date-time immediately from the 現在 action', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('columnheader', { name: '名稱' }));
    await user.click(screen.getByRole('button', { name: '其他' }));
    await user.click(screen.getByRole('button', { name: '時間(含日期)' }));
    fireEvent.click(document.querySelector('.workspace-column-dialog-overlay')!);

    await user.click(screen.getByRole('cell', { name: '花火，名稱：空白' }));
    await user.click(screen.getByRole('button', { name: '現在' }));

    expect(screen.queryByRole('group', { name: '名稱日期時間' })).not.toBeInTheDocument();
    expect(screen.getByText(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/)).toBeInTheDocument();
  });

it('accepts a directly entered year from the selected year value', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('columnheader', { name: '名稱' }));
    await user.click(screen.getByRole('button', { name: '其他' }));
    await user.click(screen.getByRole('button', { name: '時間(含日期)' }));
    fireEvent.click(document.querySelector('.workspace-column-dialog-overlay')!);
    await user.click(screen.getByRole('cell', { name: '花火，名稱：空白' }));

    const yearWheel = screen.getByRole('listbox', { name: '年' });
    await user.click(within(yearWheel).getByRole('option', { selected: true }));
    const yearInput = screen.getByRole('spinbutton', { name: '輸入年份' });
    await user.clear(yearInput);
    await user.type(yearInput, '1999{enter}');

    expect(within(yearWheel).getByRole('option', { selected: true })).toHaveTextContent('1999');
  });

it('clears an existing date-time value from the compact editor', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('columnheader', { name: '名稱' }));
    await user.click(screen.getByRole('button', { name: '其他' }));
    await user.click(screen.getByRole('button', { name: '時間(含日期)' }));
    fireEvent.click(document.querySelector('.workspace-column-dialog-overlay')!);

    await user.click(screen.getByRole('cell', { name: '花火，名稱：空白' }));
    expect(screen.queryByText('依裝置時區')).not.toBeInTheDocument();
    await user.click(document.querySelector('.workspace-datetime-clear')!);

    expect(screen.queryByRole('dialog', { name: '名稱' })).not.toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '花火，名稱：空白' })).toBeInTheDocument();
  });

it('sets an ellipsis width limit in full-width characters', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('columnheader', { name: '名稱' }));

    await user.click(screen.getByRole('button', { name: '自動換行' }));
    await user.click(screen.getByRole('button', { name: '超過省略' }));
    await user.type(screen.getByRole('spinbutton', { name: '欄寬上限（全形字數）' }), '6');
    fireEvent.click(document.querySelector('.workspace-column-dialog-overlay')!);

    await waitFor(() => expect(vi.mocked(saveWorkspace)).toHaveBeenCalled());
    const latest = vi.mocked(saveWorkspace).mock.calls.at(-1)?.[0];
    expect(latest?.tables[0].columns[0]).toMatchObject({ overflowMode: 'ellipsis', widthLimitChars: 6 });
  });

it('configures a wrapped line limit and applies overflow ellipsis to multi-select chips', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('columnheader', { name: '類型' }));
    await user.click(screen.getByRole('button', { name: '自動換行' }));
    await user.click(screen.getByRole('checkbox', { name: '行數上限（超過省略）' }));
    const lineLimit = screen.getByRole('spinbutton', { name: '最多顯示行數' });
    await user.clear(lineLimit);
    await user.type(lineLimit, '1');
    fireEvent.click(document.querySelector('.workspace-column-dialog-overlay')!);

    await waitFor(() => expect(vi.mocked(saveWorkspace)).toHaveBeenCalled());
    const savedWrap = vi.mocked(saveWorkspace).mock.calls.at(-1)?.[0];
    expect(savedWrap?.tables[0].columns[2]).toMatchObject({ overflowMode: 'wrap', lineLimit: 1 });

    await user.click(screen.getByRole('columnheader', { name: '類型' }));
    await user.click(screen.getByRole('checkbox', { name: '多選' }));
    await user.click(screen.getByRole('button', { name: '自動換行' }));
    await user.click(screen.getByRole('button', { name: '超過省略' }));
    await user.type(screen.getByRole('spinbutton', { name: '欄寬上限（全形字數）' }), '6');
    fireEvent.click(document.querySelector('.workspace-column-dialog-overlay')!);

    const cell = screen.getByRole('cell', { name: '花火，類型：合作' });
    await user.click(cell);
    await user.click(screen.getByRole('option', { name: '競爭' }));
    fireEvent.click(document.querySelector('.workspace-selection-dialog-overlay')!);

    expect(cell).toHaveClass('workspace-overflow-ellipsis');
    expect(cell.querySelector('.workspace-multi-chip-list')).toHaveClass('workspace-cell-value');
    expect(cell.querySelectorAll('.workspace-multi-chip')).toHaveLength(2);
  });

it('keeps database import in the drawer instead of the current-table settings', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '設定' }));
    expect(screen.queryByRole('button', { name: '匯入整個資料庫' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '設定' }));
    await user.click(screen.getByRole('button', { name: '開啟目錄' }));
    const drawer = screen.getByRole('complementary', { name: 'Workspace 目錄' });
    expect(within(drawer).getByRole('button', { name: '匯入整個資料庫' })).toBeInTheDocument();
  });

it('hides selected columns and edits them from the object arrow panel', async () => {
    const user = userEvent.setup();
    render(<WorkspacePage />);
    await user.click(await screen.findByRole('button', { name: '設定' }));
    await user.click(screen.getByRole('button', { name: '欄位顯示設定' }));

    expect(screen.getByRole('dialog', { name: '欄位顯示設定' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '隱藏 類型' }));
    expect(screen.getByRole('button', { name: '顯示 類型' })).toBeInTheDocument();
    fireEvent.click(document.querySelector('.workspace-column-visibility-dialog-overlay')!);

    expect(screen.queryByRole('columnheader', { name: '類型' })).not.toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: '花火，類型：合作' })).not.toBeInTheDocument();
    const arrow = screen.getByRole('button', { name: '編輯 花火 的隱藏欄位' });
    await user.click(arrow);
    const hiddenDialog = screen.getByRole('dialog', { name: '花火' });
    expect(within(hiddenDialog).getByText('類型')).toBeInTheDocument();
    await user.click(within(hiddenDialog).getByRole('button', { name: '競爭' }));
    fireEvent.click(document.querySelector('.workspace-hidden-fields-dialog-overlay')!);

    const latestSave = vi.mocked(saveWorkspace).mock.calls.at(-1)?.[0];
    expect(latestSave?.tables[0].rows[0].values['column-select']).toBe('競爭');
    expect(screen.queryByRole('cell', { name: '花火，類型：競爭' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '欄位顯示設定' }));
    await user.click(screen.getByRole('button', { name: '顯示 類型' }));
    fireEvent.click(document.querySelector('.workspace-column-visibility-dialog-overlay')!);
    expect(screen.getByRole('cell', { name: '花火，類型：競爭' })).toBeInTheDocument();
  });
});
