// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useState } from 'react';
import { formatGameSearchDisplay, GameSearch } from './GameSearch';

const mocks = vi.hoisted(() => ({ searchGames: vi.fn() }));

vi.mock('../lib/api', () => ({ api: { searchGames: mocks.searchGames } }));
vi.mock('../lib/useDebouncedValue', () => ({ useDebouncedValue: (value: string) => value }));
vi.mock('../context/SessionContext', () => ({ useSession: () => ({ canEdit: false }) }));

const game = {
  id: 'game-1', slug: 'example-game', displayName: '範例遊戲', aliases: [], ruleCount: 2, updatedAt: 1,
};

const Harness = () => {
  const [value, setValue] = useState('');
  return <GameSearch value={value} onChange={setValue} onSelect={vi.fn()} />;
};

describe('GameSearch mobile keyboard behavior', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  beforeEach(() => {
    mocks.searchGames.mockReset();
    mocks.searchGames.mockImplementation(async (_query: string, onUpdated?: (result: { games: typeof game[]; rules: never[] }) => void) => {
      const result = { games: [game], rules: [] as never[] };
      onUpdated?.(result);
      return result;
    });
  });

  test('marks existing games without rules only where they are offered', async () => {
    const empty = { ...game, id: 'game-2', displayName: '範例空遊戲', ruleCount: 0, publishedRuleCount: 0 };
    mocks.searchGames.mockResolvedValue({ games: [game, empty], rules: [] });
    const Offering = () => { const [value, setValue] = useState(''); return <GameSearch value={value} onChange={setValue} onSelect={vi.fn()} includeGamesWithoutPublishedRules />; };
    render(<MemoryRouter><Offering /></MemoryRouter>);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '範例' } });
    expect(await screen.findByRole('option', { name: /範例空遊戲/ })).toHaveTextContent('尚無規則');
    expect(screen.getByRole('option', { name: '範例遊戲' })).not.toHaveTextContent('尚無規則');
  });

  test('reopens results when the user taps the focused input after dismissing the keyboard', async () => {
    render(<MemoryRouter><Harness /></MemoryRouter>);
    const input = screen.getByRole('combobox');

    fireEvent.change(input, { target: { value: '範例' } });
    await screen.findByRole('option', { name: '範例遊戲' });

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    fireEvent.pointerDown(input);
    await waitFor(() => expect(screen.getByRole('listbox')).toBeVisible());
  });

  test('repositions results when the mobile visual viewport changes', async () => {
    const visualViewport = new EventTarget();
    const previousVisualViewport = window.visualViewport;
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: visualViewport });

    try {
      render(<MemoryRouter><Harness /></MemoryRouter>);
      const input = screen.getByRole('combobox');
      let bottom = 34;
      vi.spyOn(input, 'getBoundingClientRect').mockImplementation(() => ({
        top: 10, left: 10, right: 210, bottom, width: 200, height: 24, x: 10, y: 10,
        toJSON: () => ({}),
      }) as DOMRect);

      input.focus();
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '範例' } });
      const listbox = await screen.findByRole('listbox');
      expect(listbox).toHaveStyle({ top: '42px' });

      fireEvent.keyDown(input, { key: 'Escape' });
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      bottom = 54;
      visualViewport.dispatchEvent(new Event('resize'));
      await waitFor(() => expect(screen.getByRole('listbox')).toHaveStyle({ top: '62px' }));
    } finally {
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: previousVisualViewport });
    }
  });

  test('keeps the query and retries a failed search only on the explicit action', async () => {
    mocks.searchGames.mockRejectedValueOnce(new Error('offline'));
    render(<MemoryRouter><Harness /></MemoryRouter>);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '範例' } });
    const retry = await screen.findByRole('button', { name: '重試搜尋' });
    expect(mocks.searchGames).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue('範例');
    fireEvent.click(retry);
    await screen.findByRole('option', { name: '範例遊戲' });
    expect(mocks.searchGames).toHaveBeenCalledTimes(2);
    expect(input).toHaveValue('範例');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('formatGameSearchDisplay', () => {
  test('labels a base game reached through an expansion name', () => {
    expect(formatGameSearchDisplay({ ...game, matchedVariantName: '範例遊戲：擴充' }, '擴充'))
      .toEqual({ primary: '範例遊戲', secondary: '擴充：範例遊戲：擴充' });
  });
});
