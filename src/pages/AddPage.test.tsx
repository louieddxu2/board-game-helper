// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { AddPage } from './AddPage';
import { RULE_DRAFT_IMPORT_FORMAT, RULE_DRAFT_IMPORT_SCHEMA_VERSION } from '../lib/ruleDraftImport';

const mocks = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(public code: string, public status: number) { super(code); }
  }
  return {
    ApiError,
    useSession: vi.fn(),
    showToast: vi.fn(),
    contributions: vi.fn(),
    getDraft: vi.fn(),
    recentGames: vi.fn(),
    saveDraft: vi.fn(),
    game: vi.fn(),
    submit: vi.fn(),
    addPending: vi.fn(),
    removePending: vi.fn(),
    clearDraft: vi.fn(),
    invalidateHome: vi.fn(),
    invalidateGame: vi.fn(),
    confirm: vi.fn(),
  };
});

vi.mock('../context/SessionContext', () => ({ useSession: mocks.useSession }));
vi.mock('../context/ConfirmContext', () => ({ useConfirm: () => ({ confirm: mocks.confirm }) }));
vi.mock('../context/ToastContext', () => ({ useToast: () => ({ showToast: mocks.showToast }) }));
vi.mock('../components/GameSearch', () => ({
  clearSearchCache: vi.fn(),
  GameSearch: ({ onSelect, includeGamesWithoutPublishedRules }: { onSelect(game: { id: string; slug: string; displayName: string; ruleCount: number; updatedAt: number }): void; includeGamesWithoutPublishedRules?: boolean }) => <button type="button" data-includes-zero-rule-games={String(Boolean(includeGamesWithoutPublishedRules))} onClick={() => onSelect({ id: 'game-1', slug: 'known-game', displayName: '既有遊戲', ruleCount: 0, updatedAt: 1 })}>選擇既有遊戲</button>,
}));
vi.mock('../components/EditionInput', () => ({ EditionInput: () => null }));
vi.mock('../components/PlayerCountInput', () => ({ PlayerCountInput: () => null }));
vi.mock('../components/TagInput', () => ({ TagInput: () => null }));
vi.mock('../components/RuleCategoryInput', () => ({ RuleCategoryInput: () => null }));
vi.mock('../lib/api', () => ({
  ApiError: mocks.ApiError,
  api: { contributions: mocks.contributions, game: mocks.game, submit: mocks.submit },
}));
vi.mock('../lib/localDb', () => ({
  localDb: {
    getDraft: mocks.getDraft, recentGames: mocks.recentGames, saveDraft: mocks.saveDraft,
    addPending: mocks.addPending, removePending: mocks.removePending, clearDraft: mocks.clearDraft, invalidateHome: mocks.invalidateHome, invalidateGame: mocks.invalidateGame,
  },
}));

const renderReady = async (ui: Parameters<typeof render>[0]) => {
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(ui); });
  return view;
};

const SwitchGameHarness = () => {
  const navigate = useNavigate();
  return <><button type="button" onClick={() => navigate('/add?game=known-game')}>記錄其他遊戲</button><AddPage /></>;
};
describe('AddPage contribution constraints', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDraft.mockResolvedValue(undefined);
    mocks.recentGames.mockResolvedValue([]);
    mocks.saveDraft.mockResolvedValue(undefined);
    mocks.addPending.mockResolvedValue(undefined);
    mocks.removePending.mockResolvedValue(undefined);
    mocks.clearDraft.mockResolvedValue(undefined);
    mocks.invalidateHome.mockResolvedValue(undefined);
    mocks.invalidateGame.mockResolvedValue(undefined);
    mocks.submit.mockResolvedValue({ gameId: 'game-1', gameSlug: 'known-game', ruleIds: [] });
    mocks.confirm.mockResolvedValue(true);
    mocks.game.mockResolvedValue({ game: { id: 'game-1', slug: 'known-game', displayName: '既有遊戲', aliases: [], rules: [], ruleCount: 0, updatedAt: 1 } });
  });

  test('shows only a login CTA for visitors who are not signed in', async () => {
    mocks.useSession.mockReturnValue({ user: null, canEdit: false, isAdmin: false, loading: false });
    await renderReady(<MemoryRouter initialEntries={['/add?game=shipyard']}><AddPage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: '登入' })).toHaveAttribute('href', '/login?returnTo=%2Fadd%3Fgame%3Dshipyard');
    expect(screen.getByRole('heading', { name: '使用Google帳戶登入後即可填寫' })).toBeInTheDocument();
    expect(screen.getByText('登入後可有限度地建立規則。')).toBeInTheDocument();
    expect(screen.queryByText('新增一條規則')).not.toBeInTheDocument();
  });

  test('does not offer games without published rules for a wrong-rule report', async () => {
    mocks.useSession.mockReturnValue({ user: { id: 'editor-1', roles: ['editor'] }, canEdit: true, isAdmin: false, loading: false });
    await renderReady(<MemoryRouter><AddPage /></MemoryRouter>);

    expect(screen.getByRole('button', { name: '選擇既有遊戲' })).toHaveAttribute('data-includes-zero-rule-games', 'false');
  });

  test('blocks rule entry until a user without game quota selects an existing game', async () => {
    mocks.useSession.mockReturnValue({ user: { id: 'user-1', roles: [] }, canEdit: false, isAdmin: false, loading: false });
    mocks.contributions.mockResolvedValue({ quota: { pendingRules: 3, ruleLimit: 6, remainingRules: 3, pendingGames: 1, gameLimit: 1, remainingGames: 0 }, rules: [], games: [] });
    await renderReady(<MemoryRouter><AddPage /></MemoryRouter>);

    const quota = await screen.findByLabelText('投稿額度');
    expect(screen.getByRole('link', { name: '投稿說明' })).toHaveAttribute('href', '/contributions');
    expect(screen.getByRole('heading', { name: '記錄玩錯的規則' }).parentElement).toContainElement(quota);
    expect(screen.getByText('未審核規則 3 / 6')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /請先選擇一款既有遊戲/ }));
    expect(mocks.showToast).toHaveBeenCalledWith('你目前無法建立新遊戲，請先選擇一款既有遊戲。詳情請查看右上方的投稿說明。', 'info');
    fireEvent.click(screen.getByRole('button', { name: '選擇既有遊戲' }));
    await waitFor(() => expect(screen.getByLabelText('正確規則 *')).toBeInTheDocument());
  });

  test('does not show contribution guidance or quota to editors', async () => {
    mocks.useSession.mockReturnValue({ user: { id: 'editor-1', roles: ['editor'] }, canEdit: true, isAdmin: false, loading: false });
    await renderReady(<MemoryRouter><AddPage /></MemoryRouter>);

    expect(screen.queryByRole('link', { name: '投稿說明' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('投稿額度')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '隱私與資料說明' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByLabelText('玩錯情況')).toBeInTheDocument();
    expect(mocks.contributions).not.toHaveBeenCalled();
  });

  test('returns directly to the homepage instead of the previous page', async () => {
    mocks.useSession.mockReturnValue({ user: { id: 'editor-1', roles: ['editor'] }, canEdit: true, isAdmin: false, loading: false });
    window.history.replaceState({ idx: 2 }, '', '/add');
    await renderReady(
      <MemoryRouter initialEntries={['/games/previous-game', '/add']} initialIndex={1}>
        <Routes>
          <Route path="/add" element={<AddPage />} />
          <Route path="/" element={<p>網站首頁</p>} />
          <Route path="/games/:identifier" element={<p>上一個遊戲頁</p>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(await screen.findByText('網站首頁')).toBeInTheDocument();
  });

  test('discards the draft before navigating and cancels a pending autosave', async () => {
    vi.useFakeTimers();
    mocks.useSession.mockReturnValue({ user: { id: 'editor-1', roles: ['editor'] }, canEdit: true, isAdmin: false, loading: false });
    mocks.confirm.mockResolvedValue('discard');
    let finishClearDraft!: () => void;
    mocks.clearDraft.mockImplementation(() => new Promise<void>((resolve) => { finishClearDraft = resolve; }));
    await renderReady(
      <MemoryRouter initialEntries={['/add']}>
        <Routes>
          <Route path="/add" element={<AddPage />} />
          <Route path="/" element={<p>網站首頁</p>} />
        </Routes>
      </MemoryRouter>,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    fireEvent.change(screen.getByLabelText('正確規則 *'), { target: { value: '已填寫的錯誤規則' } });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    await act(async () => { await Promise.resolve(); });
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ discardLabel: '捨棄草稿' }));
    expect(mocks.clearDraft).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('網站首頁')).not.toBeInTheDocument();

    await act(async () => { await vi.advanceTimersByTimeAsync(251); });
    expect(mocks.saveDraft).not.toHaveBeenCalled();

    await act(async () => {
      finishClearDraft();
      await Promise.resolve();
    });
    expect(screen.getByText('網站首頁')).toBeInTheDocument();
  });

  test('leaves the editor while keeping the draft when the user chooses to leave', async () => {
    mocks.useSession.mockReturnValue({ user: { id: 'editor-1', roles: ['editor'] }, canEdit: true, isAdmin: false, loading: false });
    mocks.confirm.mockResolvedValue(true);
    await renderReady(
      <MemoryRouter initialEntries={['/add']}>
        <Routes>
          <Route path="/add" element={<AddPage />} />
          <Route path="/" element={<p>網站首頁</p>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('正確規則 *'), { target: { value: '保留這份草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(await screen.findByText('網站首頁')).toBeInTheDocument();
    expect(mocks.clearDraft).not.toHaveBeenCalled();
  });

  test('stays in the editor when the user chooses to continue editing', async () => {
    mocks.useSession.mockReturnValue({ user: { id: 'editor-1', roles: ['editor'] }, canEdit: true, isAdmin: false, loading: false });
    mocks.confirm.mockResolvedValue(false);
    await renderReady(
      <MemoryRouter initialEntries={['/add']}>
        <Routes>
          <Route path="/add" element={<AddPage />} />
          <Route path="/" element={<p>網站首頁</p>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('正確規則 *'), { target: { value: '繼續編輯這份草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ cancelLabel: '繼續編輯' })));
    expect(screen.queryByText('網站首頁')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('繼續編輯這份草稿')).toBeInTheDocument();
    expect(mocks.clearDraft).not.toHaveBeenCalled();
  });

  test('stays in the editor and reports an error when discarding the draft fails', async () => {
    mocks.useSession.mockReturnValue({ user: { id: 'editor-1', roles: ['editor'] }, canEdit: true, isAdmin: false, loading: false });
    mocks.confirm.mockResolvedValue('discard');
    mocks.clearDraft.mockRejectedValue(new Error('storage unavailable'));
    await renderReady(
      <MemoryRouter initialEntries={['/add']}>
        <Routes>
          <Route path="/add" element={<AddPage />} />
          <Route path="/" element={<p>網站首頁</p>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('正確規則 *'), { target: { value: '清除失敗仍要保留' } });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('無法清除草稿，請稍後再試。');
    expect(screen.queryByText('網站首頁')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('清除失敗仍要保留')).toBeInTheDocument();
  });

  test('does not overwrite a draft while its initial read is pending', async () => {
    vi.useFakeTimers();
    mocks.useSession.mockReturnValue({ user: { id: 'editor-1' }, canEdit: true, loading: false });
    let finishRead!: (draft: unknown) => void;
    mocks.getDraft.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
    render(<MemoryRouter><AddPage /></MemoryRouter>);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(mocks.saveDraft).not.toHaveBeenCalled();
    await act(async () => {
      finishRead({ id: 'active', gameQuery: '舊遊戲', updatedAt: 1, rules: [{ id: 'old', statement: '不能被空白覆蓋' }] });
    });
    expect(screen.getByDisplayValue('不能被空白覆蓋')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(251); });
    expect(mocks.saveDraft).toHaveBeenLastCalledWith(expect.objectContaining({ gameQuery: '舊遊戲', rules: [expect.objectContaining({ statement: '不能被空白覆蓋' })] }));
  });

  test('previews another game draft and keeps it when switching is declined', async () => {
    mocks.useSession.mockReturnValue({ user: { id: 'editor-1' }, canEdit: true, loading: false });
    mocks.getDraft.mockResolvedValue({ id: 'active', game: { id: 'old-game', slug: 'old-game', displayName: '舊遊戲' }, gameQuery: '舊遊戲', updatedAt: 1, rules: [{ id: 'old', statement: '舊規則內容必須保留' }] });
    mocks.confirm.mockResolvedValue(false);
    await renderReady(<MemoryRouter initialEntries={['/add?game=known-game']}><AddPage /></MemoryRouter>);
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: '已有其他遊戲的草稿', message: expect.stringContaining('舊規則內容必須保留'), cancelLabel: '繼續舊稿', tone: 'danger',
    }));
    expect(screen.getByRole('textbox', { name: '遊戲名稱' })).toHaveValue('舊遊戲');
    expect(screen.getByDisplayValue('舊規則內容必須保留')).toBeInTheDocument();
    expect(mocks.clearDraft).not.toHaveBeenCalled();
  });

  test('does not clear or save either draft until the cross-game decision is made', async () => {
    vi.useFakeTimers();
    mocks.useSession.mockReturnValue({ user: { id: 'editor-1' }, canEdit: true, loading: false });
    mocks.getDraft.mockResolvedValue({ id: 'active', gameQuery: '舊遊戲', updatedAt: 1, rules: [{ id: 'old', statement: '舊稿預覽' }] });
    let finishDecision!: (result: boolean) => void;
    mocks.confirm.mockImplementationOnce(() => new Promise(resolve => { finishDecision = resolve; }));
    render(<MemoryRouter initialEntries={['/add?game=known-game']}><AddPage /></MemoryRouter>);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(mocks.clearDraft).not.toHaveBeenCalled();
    expect(mocks.saveDraft).not.toHaveBeenCalled();
    await act(async () => { finishDecision(true); });
    expect(mocks.clearDraft).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox', { name: '遊戲名稱' })).toHaveValue('既有遊戲');
    expect(screen.getByLabelText('正確規則 *')).toHaveValue('');
    await act(async () => { await vi.advanceTimersByTimeAsync(251); });
    expect(mocks.saveDraft).toHaveBeenLastCalledWith(expect.objectContaining({ game: expect.objectContaining({ id: 'game-1' }), rules: [expect.objectContaining({ statement: '' })] }));
  });

  test('does not ask to discard a draft for the same game identifier', async () => {
    mocks.useSession.mockReturnValue({ user: { id: 'editor-1' }, canEdit: true, loading: false });
    mocks.getDraft.mockResolvedValue({ id: 'active', game: { id: 'game-1', slug: 'known-game', displayName: '既有遊戲' }, gameQuery: '既有遊戲', updatedAt: 1, rules: [{ id: 'old', statement: '同款遊戲繼續寫' }] });
    await renderReady(<MemoryRouter initialEntries={['/add?game=known-game']}><AddPage /></MemoryRouter>);
    expect(screen.getByDisplayValue('同款遊戲繼續寫')).toBeInTheDocument();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  test('keeps the old draft if cross-game deletion fails', async () => {
    mocks.useSession.mockReturnValue({ user: { id: 'editor-1' }, canEdit: true, loading: false });
    mocks.getDraft.mockResolvedValue({ id: 'active', gameQuery: '舊遊戲', updatedAt: 1, rules: [{ id: 'old', statement: '捨棄失敗仍保留' }] });
    mocks.clearDraft.mockRejectedValueOnce(new Error('storage unavailable'));
    await renderReady(<MemoryRouter initialEntries={['/add?game=known-game']}><AddPage /></MemoryRouter>);
    expect(screen.getByDisplayValue('捨棄失敗仍保留')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('無法捨棄舊稿，已保留原內容。');
  });

  test('reports failed autosave and retries the latest content without automatic retries', async () => {
    vi.useFakeTimers();
    mocks.useSession.mockReturnValue({ user: { id: 'editor-1' }, canEdit: true, loading: false });
    mocks.saveDraft.mockRejectedValueOnce(new Error('quota exceeded'));
    await renderReady(<MemoryRouter><AddPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('正確規則 *'), { target: { value: '重試時要儲存這份內容' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(251); });
    expect(screen.getByRole('status')).toHaveTextContent('草稿儲存失敗');
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(mocks.saveDraft).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '重試儲存' }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('status')).toHaveTextContent('草稿已儲存於');
    expect(mocks.saveDraft).toHaveBeenCalledTimes(2);
    expect(mocks.saveDraft).toHaveBeenLastCalledWith(expect.objectContaining({ rules: [expect.objectContaining({ statement: '重試時要儲存這份內容' })] }));
  });

  test('does not write a blank draft when reading storage fails', async () => {
    vi.useFakeTimers();
    mocks.useSession.mockReturnValue({ user: { id: 'editor-1' }, canEdit: true, loading: false });
    mocks.getDraft.mockRejectedValueOnce(new Error('storage unavailable'));
    await renderReady(<MemoryRouter><AddPage /></MemoryRouter>);
    expect(screen.getByRole('alert')).toHaveTextContent('尚未寫入任何新內容');
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(mocks.saveDraft).not.toHaveBeenCalled();
  });

  test('flushes a quick edit before rereading the draft for another game', async () => {
    vi.useFakeTimers();
    mocks.useSession.mockReturnValue({ user: { id: 'editor-1' }, canEdit: true, loading: false });
    let stored: Record<string, unknown> = { id: 'active', gameQuery: '舊遊戲', updatedAt: 1, rules: [{ id: 'old', statement: '先前儲存的文字' }] };
    mocks.getDraft.mockImplementation(async () => stored);
    mocks.saveDraft.mockImplementation(async (value: Record<string, unknown>) => { stored = { ...value, id: 'active' }; });
    mocks.confirm.mockResolvedValue(false);
    await renderReady(<MemoryRouter initialEntries={['/add']}><SwitchGameHarness /></MemoryRouter>);
    await act(async () => {
      fireEvent.change(screen.getByLabelText('正確規則 *'), { target: { value: '剛輸入還沒等自動儲存的文字' } });
      fireEvent.click(screen.getByRole('button', { name: '記錄其他遊戲' }));
    });
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('剛輸入還沒等自動儲存的文字') }));
    expect(screen.getByDisplayValue('剛輸入還沒等自動儲存的文字')).toBeInTheDocument();
  });

  test('does not claim a local backup exists when queueing the submission fails', async () => {
    mocks.useSession.mockReturnValue({ user: { id: 'editor-1' }, canEdit: true, loading: false });
    mocks.addPending.mockRejectedValueOnce(new Error('quota exceeded'));
    await renderReady(<MemoryRouter><AddPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: '選擇既有遊戲' }));
    fireEvent.change(screen.getByLabelText('正確規則 *'), { target: { value: '尚未備份也不能送出的文字' } });
    fireEvent.click(screen.getByRole('button', { name: '送出 1 條規則' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('目前無法儲存本機備份，尚未送出');
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('尚未備份也不能送出的文字')).toBeInTheDocument();
  });

  test('keeps Enter as a newline in the correct-rule textarea', async () => {
    mocks.useSession.mockReturnValue({ user: { id: 'editor-1', roles: ['editor'] }, canEdit: true, isAdmin: false, loading: false });
    const { container } = await renderReady(<MemoryRouter><AddPage /></MemoryRouter>);
    const statementTextarea = container.querySelector('.rule-input-fields textarea') as HTMLTextAreaElement;
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false })) });

    try {
      fireEvent.change(statementTextarea, { target: { value: 'A correct rule' } });
      expect(fireEvent.keyDown(statementTextarea, { key: 'Enter', code: 'Enter', charCode: 13 })).toBe(true);
      expect(container.querySelectorAll('.rule-input')).toHaveLength(1);
    } finally {
      Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia });
    }
  });

  test('imports JSON pasted in the modal', async () => {
    mocks.useSession.mockReturnValue({ user: { id: 'admin-1', roles: ['admin'] }, canEdit: true, isAdmin: true, loading: false });
    await renderReady(<MemoryRouter><AddPage /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: '匯入 JSON' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('JSON'), { target: { value: JSON.stringify({
      format: RULE_DRAFT_IMPORT_FORMAT,
      schemaVersion: RULE_DRAFT_IMPORT_SCHEMA_VERSION,
      game: { displayName: '貼上遊戲' },
      rules: [{ statement: '貼上的規則' }],
    }) } });
    fireEvent.click(within(dialog).getByRole('button', { name: '匯入 JSON' }));

    await waitFor(() => expect(screen.getByDisplayValue('貼上的規則')).toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('persists imported supplementary details when submitting', async () => {
    mocks.useSession.mockReturnValue({ user: { id: 'admin-1', roles: ['admin'] }, canEdit: true, isAdmin: true, loading: false });
    const { container } = await renderReady(<MemoryRouter><AddPage /></MemoryRouter>);

    fireEvent.click(container.querySelector('.rule-draft-import') as HTMLButtonElement);
    const dialog = screen.getByRole('dialog');
    fireEvent.change(screen.getByLabelText('JSON'), { target: { value: JSON.stringify({
      format: RULE_DRAFT_IMPORT_FORMAT,
      schemaVersion: RULE_DRAFT_IMPORT_SCHEMA_VERSION,
      game: { displayName: 'Example Game' },
      rules: [{ statement: 'Imported rule', details: 'Supplementary details', flowStage: 'action' }],
    }) } });
    fireEvent.click(within(dialog).getByRole('button', { name: /JSON/ }));

    await waitFor(() => expect(screen.getByDisplayValue('Supplementary details')).toBeInTheDocument());
    await waitFor(() => expect(mocks.saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      rules: [expect.objectContaining({ details: 'Supplementary details', flowStage: 'action' })],
    })));
    fireEvent.click(container.querySelector('.save-button') as HTMLButtonElement);

    await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith(expect.objectContaining({
      rules: [expect.objectContaining({ details: 'Supplementary details', flowStage: 'action' })],
    })));
  });

  test('keeps the add button clickable but refuses rows beyond the remaining rule quota', async () => {
    mocks.useSession.mockReturnValue({ user: { id: 'user-1', roles: [] }, canEdit: false, isAdmin: false, loading: false });
    mocks.contributions.mockResolvedValue({ quota: { pendingRules: 4, ruleLimit: 6, remainingRules: 2, pendingGames: 0, gameLimit: 1, remainingGames: 1 }, rules: [], games: [] });
    const { container } = await renderReady(<MemoryRouter><AddPage /></MemoryRouter>);

    await screen.findByText('未審核規則 4 / 6');
    fireEvent.click(screen.getByRole('button', { name: '＋新增一條規則' }));
    expect(container.querySelectorAll('.rule-input')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '＋新增一條規則' }));
    expect(container.querySelectorAll('.rule-input')).toHaveLength(2);
    expect(mocks.showToast).toHaveBeenCalledWith('已達本次可新增上限，請查看右上方的投稿說明。', 'info');
  });
});
