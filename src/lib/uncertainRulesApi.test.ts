import { beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ mutation: vi.fn(), invalidateGameCatalogSync: vi.fn() }));
vi.mock('./api', () => ({ mutation: mocks.mutation, uncachedRead: vi.fn() }));
vi.mock('./localDb', () => ({ localDb: { invalidateGameCatalogSync: mocks.invalidateGameCatalogSync } }));
const { uncertainRulesApi } = await import('./uncertainRulesApi');

beforeEach(() => { mocks.mutation.mockReset(); mocks.invalidateGameCatalogSync.mockReset().mockResolvedValue(undefined); });

test('a newly created game makes the next search sync the game list', async () => {
  mocks.mutation.mockResolvedValue({ uncertainRules: [{}], gameSlug: 'new', gameCreated: true });
  await uncertainRulesApi.create({ newGame: { displayName: '新' } }, [{ question: '?' }, { question: '!' }]);
  expect(mocks.mutation).toHaveBeenCalledWith('/api/uncertain-rules', { method: 'POST', body: JSON.stringify({ newGame: { displayName: '新' }, rules: [{ question: '?' }, { question: '!' }] }) });
  expect(mocks.invalidateGameCatalogSync).toHaveBeenCalledTimes(1);
});

test('an existing game leaves the game list cache alone', async () => {
  mocks.mutation.mockResolvedValue({ uncertainRules: [{}], gameSlug: 'old', gameCreated: false });
  await uncertainRulesApi.create({ gameId: 'g1' }, [{ question: '?' }]);
  expect(mocks.invalidateGameCatalogSync).not.toHaveBeenCalled();
});
