import { afterEach, expect, test, vi } from 'vitest';
import { api } from './api';
import { localDb } from './localDb';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

test('cancels a stalled game read within ten seconds and permits one new attempt', async () => {
  vi.useFakeTimers();
  vi.spyOn(localDb, 'getCachedGame').mockResolvedValue(undefined);
  vi.spyOn(localDb, 'getLatestGame').mockResolvedValue(undefined);
  vi.spyOn(localDb, 'cacheGame').mockResolvedValue(undefined);
  const game = { id: 'timeout-game', slug: 'timeout-game', displayName: 'Timeout game', aliases: [], rules: [], ruleCount: 0, updatedAt: 1 };
  const fetchMock = vi.fn().mockImplementationOnce((_path, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')), { once: true });
  })).mockResolvedValueOnce({ ok: true, headers: new Headers(), json: async () => ({ game }) });
  vi.stubGlobal('fetch', fetchMock);
  const pending = expect(api.game('timeout-game')).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(10_000);
  await pending;
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  expect((await api.game('timeout-game')).game.id).toBe('timeout-game');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
