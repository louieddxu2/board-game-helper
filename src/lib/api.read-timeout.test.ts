import { afterEach, expect, test, vi } from 'vitest';
import { api } from './api';
import { localDb } from './localDb';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const stalledRead = (_path: string, init: RequestInit) => new Promise((_resolve, reject) => {
  init.signal!.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')), { once: true });
});

test('a stalled home read expires after ten seconds without an automatic retry', async () => {
  vi.useFakeTimers();
  vi.spyOn(localDb, 'getCachedHome').mockResolvedValue(undefined);
  vi.spyOn(localDb, 'getLatestHome').mockResolvedValue(undefined);
  vi.spyOn(localDb, 'cacheHome').mockResolvedValue('home');
  const home = { generatedAt: 1, featured: [], popularGames: [] };
  const fetchMock = vi.fn().mockImplementationOnce(stalledRead).mockResolvedValueOnce({ ok: true, headers: new Headers(), json: async () => home });
  vi.stubGlobal('fetch', fetchMock);
  const pending = expect(api.home()).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(10_000); await pending;
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(await api.home()).toEqual(home);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('one catalog synchronization deadline includes the snapshot and its delta read', async () => {
  vi.useFakeTimers();
  vi.spyOn(localDb, 'getSynchronizedGameCatalog').mockResolvedValue(undefined);
  vi.spyOn(localDb, 'getLatestGameCatalog').mockResolvedValue(undefined);
  vi.spyOn(localDb, 'cacheGameCatalog').mockResolvedValue(undefined);
  const catalog = { generation: 1, throughVersion: 0, generatedAt: 1, games: [] };
  const fetchMock = vi.fn().mockImplementationOnce((_path: string, init: RequestInit) => new Promise(resolve => {
    setTimeout(() => resolve({ ok: true, headers: new Headers(), json: async () => catalog }), 7000);
    expect(init.signal).toBeDefined();
  })).mockImplementationOnce(stalledRead);
  vi.stubGlobal('fetch', fetchMock);
  const pending = expect(api.searchGames('船廠')).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(7000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(3000); await pending;
  expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('does not treat an aborted response body as a successfully loaded home', async () => {
  vi.useFakeTimers();
  vi.spyOn(localDb, 'getCachedHome').mockResolvedValue(undefined);
  vi.spyOn(localDb, 'getLatestHome').mockResolvedValue(undefined);
  const cache = vi.spyOn(localDb, 'cacheHome').mockResolvedValue('home');
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_path: string, init: RequestInit) => ({
    ok: true, headers: new Headers(), json: () => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('Timed out', 'AbortError')), { once: true });
    }),
  })));
  const pending = expect(api.home()).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(10_000); await pending;
  expect(cache).not.toHaveBeenCalled();
});
