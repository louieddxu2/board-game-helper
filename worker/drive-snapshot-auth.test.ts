// @vitest-environment node
import { describe, expect, test, vi } from 'vitest';
import { verifyDriveSnapshotToken } from './services/driveSnapshotAuth';
import type { FetchLike } from '../src/workspace/googleDriveBackup/types';

const CLIENT = 'drive-snapshot-test.apps.googleusercontent.com';
const NOW = 1_800_000_000_000;

const tokenInfo = (overrides: Record<string, unknown> = {}) => ({
  sub: 'google-drive-owner-1', aud: CLIENT, azp: CLIENT,
  scope: 'openid https://www.googleapis.com/auth/drive.file', exp: NOW / 1000 + 3600,
  ...overrides,
});

const fetchFor = (payload: unknown, status = 200) => vi.fn<FetchLike>(async () => new Response(
  JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } },
));

describe('Drive snapshot bearer-token contract', () => {
  test('verifies audience, authorized party, subject, scope and expiry before deriving the owner key', async () => {
    const fetchImpl = fetchFor(tokenInfo());
    const verified = await verifyDriveSnapshotToken(
      'Bearer drive-token-valid', { GOOGLE_DRIVE_CLIENT_ID: CLIENT }, fetchImpl, NOW,
    );
    expect(verified).toMatchObject({ subject: 'google-drive-owner-1', token: 'drive-token-valid' });
    expect(verified.accountKey).toMatch(/^[a-f0-9]{64}$/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/tokeninfo');
    expect((fetchImpl.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer drive-token-valid',
    });
  });

  test.each([
    ['audience', { aud: 'another-client.apps.googleusercontent.com' }],
    ['authorized party', { azp: 'another-client.apps.googleusercontent.com' }],
    ['subject', { sub: '' }],
    ['scope', { scope: 'openid profile' }],
    ['expiry', { exp: NOW / 1000 - 1 }],
    ['non-numeric expiry', { exp: 'not-a-time' }],
  ])('rejects a token with an invalid %s claim', async (_claim, overrides) => {
    const fetchImpl = fetchFor(tokenInfo(overrides));
    await expect(verifyDriveSnapshotToken(
      `Bearer drive-token-${String(_claim).replaceAll(' ', '-')}`,
      { GOOGLE_DRIVE_CLIENT_ID: CLIENT }, fetchImpl, NOW,
    )).rejects.toMatchObject({ code: 'backup_auth_required', status: 401 });
  });

  test('fails closed for missing or malformed authorization and missing configuration', async () => {
    await expect(verifyDriveSnapshotToken(undefined, { GOOGLE_DRIVE_CLIENT_ID: CLIENT }, fetchFor({}), NOW))
      .rejects.toMatchObject({ code: 'backup_auth_required', status: 401 });
    await expect(verifyDriveSnapshotToken('Basic drive-token', { GOOGLE_DRIVE_CLIENT_ID: CLIENT }, fetchFor({}), NOW))
      .rejects.toMatchObject({ code: 'backup_auth_required', status: 401 });
    await expect(verifyDriveSnapshotToken('Bearer drive-token-no-client', {}, fetchFor({}), NOW))
      .rejects.toMatchObject({ code: 'backup_auth_not_configured', status: 503 });
    await expect(verifyDriveSnapshotToken(`Bearer ${'x'.repeat(8193)}`, { GOOGLE_DRIVE_CLIENT_ID: CLIENT }, fetchFor({}), NOW))
      .rejects.toMatchObject({ code: 'backup_auth_required', status: 401 });
  });

  test('maps provider outages to a retryable protocol error without exposing provider text', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => new Response('provider secret diagnostic', { status: 500 }));
    await expect(verifyDriveSnapshotToken('Bearer drive-token-provider-error', { GOOGLE_DRIVE_CLIENT_ID: CLIENT }, fetchImpl, NOW))
      .rejects.toMatchObject({ code: 'backup_auth_unavailable', status: 503 });
  });

  test('caches only the verified identity outcome for the short window and rechecks after expiry', async () => {
    const fetchImpl = fetchFor(tokenInfo());
    const first = await verifyDriveSnapshotToken('Bearer drive-token-cache', { GOOGLE_DRIVE_CLIENT_ID: CLIENT }, fetchImpl, NOW);
    fetchImpl.mockRejectedValueOnce(new Error('network should not be used while cached'));
    const cached = await verifyDriveSnapshotToken('Bearer drive-token-cache', { GOOGLE_DRIVE_CLIENT_ID: CLIENT }, fetchImpl, NOW + 30_000);
    expect(cached).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    fetchImpl.mockReset();
    fetchImpl.mockImplementation(async () => new Response(JSON.stringify(tokenInfo()), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    await verifyDriveSnapshotToken('Bearer drive-token-cache', { GOOGLE_DRIVE_CLIENT_ID: CLIENT }, fetchImpl, NOW + 61_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
