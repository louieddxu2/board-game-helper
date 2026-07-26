import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from './api';
import { localDb } from './localDb';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('api game refresh', () => {
  test('uses a unique no-store URL for every fresh read', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ game: { id: 'game-1', rules: [] } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('crypto', { randomUUID: vi.fn()
      .mockReturnValueOnce('refresh-one')
      .mockReturnValueOnce('refresh-two') });

    await api.game('emberleaf', true);
    await api.game('emberleaf', true);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/games/emberleaf?fresh=refresh-one',
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/games/emberleaf?fresh=refresh-two',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  test('uses the local game cache before making a network request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const cachedGame = { id: 'game-1', slug: 'emberleaf', displayName: 'Emberleaf', aliases: [], rules: [], ruleCount: 0, updatedAt: 1 };
    vi.spyOn(localDb, 'getCachedGame').mockResolvedValue({ key: 'game:emberleaf', data: cachedGame, cachedAt: Date.now() });

    const result = await api.game('emberleaf');

    expect(result.game).toEqual(cachedGame);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('writes a freshly fetched game through the API cache boundary', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ game: { id: 'game-1', slug: 'emberleaf', displayName: 'Emberleaf', aliases: [], rules: [], ruleCount: 0, updatedAt: 1 } }),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(localDb, 'getCachedGame').mockResolvedValue(undefined);
    const cacheGame = vi.spyOn(localDb, 'cacheGame').mockResolvedValue(undefined);

    await api.game('emberleaf');

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(cacheGame).toHaveBeenCalledOnce();
  });
});
