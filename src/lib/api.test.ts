import { afterEach, describe, expect, test, vi } from 'vitest';
import { api } from './api';

afterEach(() => {
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
});
