import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useGameDetail } from './useGameDetail';
import { ApiError } from '../lib/api';

const mocks = vi.hoisted(() => ({ game: vi.fn(), invalidate: vi.fn(), hydrate: vi.fn() }));
vi.mock('../lib/api', async importOriginal => ({ ...await importOriginal<typeof import('../lib/api')>(), api: { game: mocks.game } }));
vi.mock('../lib/localDb', () => ({ localDb: { invalidateGame: mocks.invalidate } }));
vi.mock('../lib/tagHydration', () => ({ hydrateGameTags: mocks.hydrate }));
const game = { id: 'a', slug: 'first', displayName: '第一款', aliases: [], rules: [], ruleCount: 0, updatedAt: 1 };
beforeEach(() => { vi.resetAllMocks(); mocks.invalidate.mockResolvedValue(undefined); mocks.hydrate.mockImplementation(async game => game); });
afterEach(cleanup);

test('shows readable rules even if optional tag lookup stalls', async () => {
  mocks.game.mockResolvedValue({ game });
  mocks.hydrate.mockReturnValue(new Promise(() => undefined));
  const { result } = renderHook(() => useGameDetail('first'));
  await waitFor(() => expect(result.current.game).toEqual(game));
  expect(result.current.loading).toBe(false);
});

test('tag enrichment does not overwrite a vote made while tags were loading', async () => {
  const rule = { id: 'rule-1', gameId: 'a', statement: '規則', status: 'published' as const, tags: [], sourceLinks: [], importanceCount: 0 };
  const withRule = { ...game, rules: [rule] };
  let resolveTags!: (value: unknown) => void;
  mocks.game.mockResolvedValue({ game: withRule });
  mocks.hydrate.mockReturnValue(new Promise(resolve => { resolveTags = resolve; }));
  const { result } = renderHook(() => useGameDetail('first'));
  await waitFor(() => expect(result.current.game?.rules).toHaveLength(1));
  act(() => result.current.setGame(current => current && { ...current, rules: current.rules.map(rule => ({ ...rule, importanceCount: 1 })) }));
  await act(async () => resolveTags({ ...withRule, rules: [{ ...rule, tags: [{ id: 'tag-1', name: '設置' }] }] }));
  expect(result.current.game?.rules[0].importanceCount).toBe(1);
  expect(result.current.game?.rules[0].tags[0].name).toBe('設置');
});

test('distinguishes a missing game from a temporary failure', async () => {
  mocks.game.mockRejectedValueOnce(new ApiError('game_not_found', 404));
  const { result } = renderHook(() => useGameDetail('missing'));
  await waitFor(() => expect(result.current.error).toBe('not-found'));
  expect(result.current.game).toBeUndefined();
  expect(mocks.game).toHaveBeenCalledOnce();
});

test('retries only when requested, through the existing cache boundary', async () => {
  mocks.game.mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce({ game });
  const { result } = renderHook(() => useGameDetail('first'));
  await waitFor(() => expect(result.current.error).toBe('unavailable'));
  expect(mocks.game).toHaveBeenCalledOnce();
  await act(() => result.current.reload());
  expect(result.current.game).toEqual(game);
  expect(result.current.error).toBeUndefined();
  expect(mocks.game).toHaveBeenCalledTimes(2);
  expect(mocks.invalidate).toHaveBeenCalledExactlyOnceWith('first');
});

test('keeps readable content if a refresh fails', async () => {
  mocks.game.mockResolvedValueOnce({ game }).mockRejectedValueOnce(new TypeError('offline'));
  const { result } = renderHook(() => useGameDetail('first'));
  await waitFor(() => expect(result.current.game).toEqual(game));
  await act(() => result.current.reload());
  expect(result.current.game).toEqual(game);
  expect(result.current.error).toBe('unavailable');
});

test('removes previously loaded content if the server confirms it no longer exists', async () => {
  mocks.game.mockResolvedValueOnce({ game }).mockRejectedValueOnce(new ApiError('game_not_found', 404));
  const { result } = renderHook(() => useGameDetail('first'));
  await waitFor(() => expect(result.current.game).toEqual(game));
  await act(() => result.current.reload());
  expect(result.current.game).toBeUndefined();
  expect(result.current.error).toBe('not-found');
});

test('ignores a delayed result from the previous game after navigation', async () => {
  let resolveOld!: (value: { game: typeof game }) => void;
  mocks.game.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; })).mockResolvedValueOnce({ game: { ...game, id: 'b', slug: 'second' } });
  const { result, rerender } = renderHook(({ id }) => useGameDetail(id), { initialProps: { id: 'first' } });
  rerender({ id: 'second' });
  expect(result.current.game).toBeUndefined();
  await waitFor(() => expect(result.current.game?.id).toBe('b'));
  await act(async () => resolveOld({ game }));
  expect(result.current.game?.id).toBe('b');
});
