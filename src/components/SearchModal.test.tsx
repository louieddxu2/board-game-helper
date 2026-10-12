// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useState } from 'react';
import { SearchModal } from './SearchModal';

const mocks = vi.hoisted(() => ({
  recentGames: vi.fn(),
  search: vi.fn(),
}));

vi.mock('../lib/localDb', () => ({ localDb: { recentGames: mocks.recentGames } }));
vi.mock('../lib/api', () => ({ api: { search: mocks.search } }));
vi.mock('../context/SessionContext', () => ({ useSession: () => ({ canEdit: false }) }));

const recentOne = { id: 'recent-1', slug: 'first-game', displayName: '第一款遊戲', englishName: 'First Game' };
const recentTwo = { id: 'recent-2', slug: 'second-game', displayName: '第二款遊戲', englishName: 'Second Game' };
const searchGame = { id: 'search-1', slug: 'search-game', displayName: '搜尋結果遊戲', englishName: 'Search Result', aliases: [], ruleCount: 1, updatedAt: 1 };
type SearchResponse = { games: typeof searchGame[]; rules: never[] };
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.search}{location.hash}</output>;
};

const Harness = ({ initialOpen = true }: { initialOpen?: boolean }) => {
  const [open, setOpen] = useState(initialOpen);
  return <>
    <button type="button" onClick={() => setOpen(true)}>開啟搜尋</button>
    <SearchModal open={open} onClose={() => setOpen(false)} />
    <LocationProbe />
  </>;
};

describe('SearchModal recent games and inline search', () => {
  beforeEach(() => {
    mocks.recentGames.mockReset().mockResolvedValue([recentOne]);
    mocks.search.mockReset().mockImplementation(async (_query: string, onUpdated?: (response: SearchResponse) => void) => {
      const response: SearchResponse = { games: [searchGame], rules: [] };
      onUpdated?.(response);
      return response;
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo);
    else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
  });

  test('opens with recent games and keeps the empty state out of the listbox contract', async () => {
    render(<MemoryRouter><Harness /></MemoryRouter>);

    const recent = await screen.findByRole('button', { name: /第一款遊戲.*First Game/ });
    expect(recent).toBeInTheDocument();
    expect(screen.getByText('近期瀏覽')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(mocks.recentGames).toHaveBeenCalledTimes(1);
  });

  test('refreshes recent games on every opening, traps focus, and restores the opener', async () => {
    mocks.recentGames
      .mockReset()
      .mockResolvedValueOnce([recentOne])
      .mockResolvedValueOnce([recentTwo]);

    render(<MemoryRouter><Harness initialOpen={false} /></MemoryRouter>);
    const opener = screen.getByRole('button', { name: '開啟搜尋' });
    opener.focus();
    fireEvent.click(opener);

    const input = await screen.findByRole('combobox');
    await waitFor(() => expect(input).toHaveFocus());
    const closeButton = screen.getByRole('button', { name: '關閉搜尋' });
    const lastFocusable = screen.getByRole('button', { name: /第一款遊戲.*First Game/ });

    closeButton.focus();
    fireEvent.keyDown(closeButton, { key: 'Tab', shiftKey: true });
    expect(lastFocusable).toHaveFocus();
    fireEvent.keyDown(lastFocusable, { key: 'Tab' });
    expect(closeButton).toHaveFocus();

    fireEvent.click(closeButton);
    await waitFor(() => expect(opener).toHaveFocus());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(opener);
    expect(await screen.findByRole('button', { name: /第二款遊戲.*Second Game/ })).toBeInTheDocument();
    expect(mocks.recentGames).toHaveBeenCalledTimes(2);
  });

  test('opens a recent game through its slug and closes the modal', async () => {
    render(<MemoryRouter><Harness /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /第一款遊戲.*First Game/ }));

    expect(await screen.findByTestId('location')).toHaveTextContent('/games/first-game');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('switches the same inline panel immediately and ignores a pending response after clearing', async () => {
    let resolveSearch!: (response: SearchResponse) => void;
    const pending = new Promise<SearchResponse>((resolve) => { resolveSearch = resolve; });
    mocks.search.mockImplementation((_query: string, _onUpdated?: (response: SearchResponse) => void) => pending);

    render(<MemoryRouter><Harness /></MemoryRouter>);
    await screen.findByRole('button', { name: /第一款遊戲.*First Game/ });
    const input = screen.getByRole('combobox');
    const results = document.querySelector('.search-results-inline');
    expect(results).toBeInTheDocument();

    fireEvent.change(input, { target: { value: '甲' } });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /第一款遊戲.*First Game/ })).not.toBeInTheDocument();
    expect(document.querySelector('.search-results-portal')).not.toBeInTheDocument();
    expect(document.querySelector('.search-results-inline')).toBe(results);

    await waitFor(() => expect(mocks.search).toHaveBeenCalledWith('甲', expect.any(Function)));
    fireEvent.change(input, { target: { value: '   ' } });
    expect(input).toHaveValue('   ');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /第一款遊戲.*First Game/ })).toBeInTheDocument();
    expect(document.querySelector('.search-results-inline')).toBe(results);

    await act(async () => {
      resolveSearch({ games: [searchGame], rules: [] });
      await pending;
    });
    expect(screen.queryByRole('option', { name: /搜尋結果遊戲/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /第一款遊戲.*First Game/ })).toBeInTheDocument();
  });

  test('resets inline scrolling when switching between recents and search', async () => {
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, writable: true, value: scrollTo });

    render(<MemoryRouter><Harness /></MemoryRouter>);
    await screen.findByRole('button', { name: /第一款遊戲.*First Game/ });
    const input = screen.getByRole('combobox');
    const results = document.querySelector('.search-results-inline');
    expect(results).toBeInTheDocument();
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' }));
    scrollTo.mockClear();

    fireEvent.change(input, { target: { value: '甲' } });
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' }));
    expect(document.querySelector('.search-results-inline')).toBe(results);
    scrollTo.mockClear();

    fireEvent.click(screen.getByRole('button', { name: '清除搜尋' }));
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' }));
    expect(document.querySelector('.search-results-inline')).toBe(results);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  test('uses Escape to hide search results before closing the modal', async () => {
    render(<MemoryRouter><Harness /></MemoryRouter>);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '甲' } });
    expect(await screen.findByRole('option', { name: /搜尋結果遊戲/ })).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('甲');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('does not select an old result when Enter is pressed while a new query is pending', async () => {
    render(<MemoryRouter><Harness /></MemoryRouter>);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '甲' } });
    await screen.findByRole('option', { name: /搜尋結果遊戲/ });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.change(input, { target: { value: '乙' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('location').textContent).toBe('/');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(input).not.toHaveAttribute('aria-activedescendant');
  });
});
