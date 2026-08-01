import { afterEach, describe, expect, test, vi } from 'vitest';
import { clearSearchCache } from '../components/GameSearch';
import { api } from './api';
import { localDb } from './localDb';
import { flushPendingSubmissions } from './pendingSync';

vi.mock('../components/GameSearch', () => ({ clearSearchCache: vi.fn() }));

const payload = (id: string, statement: string) => ({ gameId: 'game-1', idempotencyKey: id, rules: [{ statement }] });

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(clearSearchCache).mockClear();
});

describe('offline submission synchronization', () => {
  test('only flushes the active account records and keeps failed records', async () => {
    vi.spyOn(localDb, 'getPending').mockResolvedValue([
      { id: 'ok-key-1', userId: 'user-1', payload: payload('ok-key-1', 'ok'), createdAt: 1 },
      { id: 'fail-key', userId: 'user-1', payload: payload('fail-key', 'fail'), createdAt: 2 },
    ]);
    vi.spyOn(api, 'submit')
      .mockResolvedValueOnce({ submissionId: 'submission-1', gameId: 'game-1', gameSlug: 'game-1', gameCreated: false, reused: false })
      .mockRejectedValueOnce(new Error('offline'));
    const remove = vi.spyOn(localDb, 'removePending').mockResolvedValue(undefined);
    vi.spyOn(localDb, 'getDraft').mockResolvedValue(undefined);
    const invalidateGame = vi.spyOn(localDb, 'invalidateGame').mockResolvedValue(undefined);
    const invalidateHome = vi.spyOn(localDb, 'invalidateHome').mockResolvedValue(undefined);

    await expect(flushPendingSubmissions('user-1')).resolves.toBe(1);

    expect(localDb.getPending).toHaveBeenCalledWith('user-1');
    expect(api.submit).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledWith('ok-key-1');
    expect(invalidateGame).toHaveBeenCalledWith('game-1');
    expect(invalidateHome).toHaveBeenCalledOnce();
    expect(clearSearchCache).toHaveBeenCalledOnce();
  });

  test('deduplicates simultaneous flushes for one account', async () => {
    let release!: () => void;
    vi.spyOn(localDb, 'getPending').mockImplementation(() => new Promise((resolve) => { release = () => resolve([]); }));
    const first = flushPendingSubmissions('user-1');
    const second = flushPendingSubmissions('user-1');
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([0, 0]);
    expect(localDb.getPending).toHaveBeenCalledOnce();
  });
});
