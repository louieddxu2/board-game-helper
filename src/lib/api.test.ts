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

  test('stores the editor rule set once while presenting only published rules on the game page', async () => {
    const publishedRule = { id: 'rule-public', gameId: 'game-1', statement: 'Public', status: 'published' as const, sourceLinks: [], tags: [] };
    const hiddenRule = { id: 'rule-hidden', gameId: 'game-1', statement: 'Hidden', status: 'hidden' as const, sourceLinks: [], tags: [] };
    const game = { id: 'game-1', slug: 'emberleaf', displayName: 'Emberleaf', aliases: [], rules: [publishedRule, hiddenRule], ruleCount: 2, publishedRuleCount: 1, totalRuleCount: 2, updatedAt: 1 };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ game, rulesComplete: true }),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(localDb, 'getCachedGame').mockResolvedValue(undefined);
    const cacheGame = vi.spyOn(localDb, 'cacheGame').mockResolvedValue(undefined);

    const publicResult = await api.game('emberleaf');

    expect(publicResult.game.rules).toEqual([publishedRule]);
    expect(publicResult.game.ruleCount).toBe(1);
    expect(cacheGame).toHaveBeenCalledWith(game, true);
  });

  test('requires a complete local rule set for the editor catalog', async () => {
    const getCachedGame = vi.spyOn(localDb, 'getCachedGame').mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ game: { id: 'game-1', slug: 'emberleaf', displayName: 'Emberleaf', aliases: [], rules: [], ruleCount: 0, updatedAt: 1 }, rulesComplete: false }),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(localDb, 'cacheGame').mockResolvedValue(undefined);

    await expect(api.game('emberleaf', false, true)).rejects.toMatchObject({ code: 'forbidden', status: 403 });

    expect(getCachedGame).toHaveBeenCalledWith('emberleaf', true);
  });
});
