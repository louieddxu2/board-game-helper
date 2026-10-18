import { describe, expect, test, vi } from 'vitest';
import { createSnapshotCoordinator } from './snapshotCoordinator';
import type { FetchLike } from './types';

const coordinatorResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json' },
});

describe('snapshot coordinator transport contract', () => {
  test('uses GET for state and keeps the Drive bearer token out of the URL and body', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => coordinatorResponse({ revision: 4, versions: [] }));
    const tokenProvider = { getAccessToken: vi.fn(async () => 'secret-drive-token') };
    const coordinator = createSnapshotCoordinator({ tokenProvider, fetchImpl, baseUrl: '/api/workspace-backup' });

    await expect(coordinator.state('root id')).resolves.toEqual({ revision: 4, versions: [] });
    expect(fetchImpl).toHaveBeenCalledWith('/api/workspace-backup/state?rootId=root%20id', expect.objectContaining({
      method: 'GET', credentials: 'omit', cache: 'no-store',
      headers: { Authorization: 'Bearer secret-drive-token' },
    }));
    expect(String(fetchImpl.mock.calls[0][0])).not.toContain('secret-drive-token');
    expect(fetchImpl.mock.calls[0][1]?.body).toBeUndefined();
  });

  test('sends JSON for begin and commit operations with the right endpoint', async () => {
    const responses = [
      coordinatorResponse({ id: 'op-1', status: 'uploading' }),
      coordinatorResponse({ id: 'op-1', status: 'committed', revision: 1 }),
    ];
    const fetchImpl = vi.fn<FetchLike>(async () => responses.shift()!);
    const coordinator = createSnapshotCoordinator({ tokenProvider: { getAccessToken: async () => 'token' }, fetchImpl });
    const input = { id: 'op-1', rootId: 'root', expectedRevision: 0, sourceRevision: 'a'.repeat(64), legacyStamp: 'b'.repeat(64), fileCount: 2, sourceUpdatedAt: 1 };

    await coordinator.begin(input);
    await coordinator.commit('op-1');
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual(['/api/workspace-backup/begin', '/api/workspace-backup/operations/op-1/commit']);
    expect(fetchImpl.mock.calls[0][1]?.method).toBe('POST');
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual(input);
    expect(fetchImpl.mock.calls[1][1]?.body).toBe('{}');
  });

  test('refreshes the token exactly once after a 401 and returns the retry response', async () => {
    const fetchImpl = vi.fn<FetchLike>()
      .mockResolvedValueOnce(coordinatorResponse({ error: 'backup_auth_required' }, 401))
      .mockResolvedValueOnce(coordinatorResponse({ revision: 2, versions: [] }));
    const getAccessToken = vi.fn(async ({ forceRefresh }: { forceRefresh?: boolean } = {}) => forceRefresh ? 'fresh-token' : 'stale-token');
    const coordinator = createSnapshotCoordinator({ tokenProvider: { getAccessToken }, fetchImpl });

    await expect(coordinator.state()).resolves.toMatchObject({ revision: 2 });
    expect(getAccessToken).toHaveBeenNthCalledWith(1, { forceRefresh: false });
    expect(getAccessToken).toHaveBeenNthCalledWith(2, { forceRefresh: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test('turns a missing operation into null while preserving other errors', async () => {
    const fetchImpl = vi.fn<FetchLike>()
      .mockResolvedValueOnce(coordinatorResponse({ error: 'backup_operation_not_found' }, 404))
      .mockResolvedValueOnce(coordinatorResponse({ error: 'provider diagnostic with token secret' }, 503));
    const coordinator = createSnapshotCoordinator({ tokenProvider: { getAccessToken: async () => 'token' }, fetchImpl });

    await expect(coordinator.operation('missing')).resolves.toBeNull();
    await expect(coordinator.operation('unavailable')).rejects.toMatchObject({
      code: 'backup_service_unavailable', status: 503,
    });
  });

  test('does not expose an unrecognised server error message to callers', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => coordinatorResponse({ error: 'raw SQL, token and table content' }, 500));
    const coordinator = createSnapshotCoordinator({ tokenProvider: { getAccessToken: async () => 'token' }, fetchImpl });

    await expect(coordinator.state()).rejects.toMatchObject({ code: 'backup_service_unavailable', status: 500 });
  });
});
