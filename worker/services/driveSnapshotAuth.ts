import type { RouteEnv } from '../env';
import { sha256Hex } from '../utils';
import { DRIVE_FILE_SCOPE, SnapshotProtocolError } from '../../src/shared/driveSnapshots';

interface VerifiedDriveToken { subject: string; accountKey: string; expiresAt: number }
const verifiedTokens = new Map<string, VerifiedDriveToken>();

/** Same POST/Bearer tokeninfo protocol used by Google's OAuth2Client.getTokenInfo.
 * Only a digest and verified identity are cached, for at most one minute. */
export const verifyDriveSnapshotToken = async (
  authorization: string | undefined, env: Pick<RouteEnv, 'GOOGLE_DRIVE_CLIENT_ID'>,
  fetchImpl: typeof fetch = fetch, now = Date.now(),
) => {
  const token = authorization?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
  if (!token || token.length > 8192) throw new SnapshotProtocolError('backup_auth_required', 401);
  const client = env.GOOGLE_DRIVE_CLIENT_ID?.trim();
  if (!client) throw new SnapshotProtocolError('backup_auth_not_configured', 503);
  const key = await sha256Hex(`${client}:${token}`);
  const cached = verifiedTokens.get(key);
  if (cached && cached.expiresAt > now) return { ...cached, token };
  let response: Response;
  try {
    response = await fetchImpl('https://oauth2.googleapis.com/tokeninfo', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch { throw new SnapshotProtocolError('backup_auth_unavailable', 503); }
  if (!response.ok) {
    const unavailable = response.status >= 500 || response.status === 429;
    throw new SnapshotProtocolError(unavailable ? 'backup_auth_unavailable' : 'backup_auth_required', unavailable ? 503 : 401);
  }
  const info = await response.json() as { sub?: unknown; user_id?: unknown; aud?: unknown; azp?: unknown; scope?: unknown; exp?: unknown; expires_in?: unknown };
  const expiresAt = info.exp != null ? Number(info.exp) * 1000 : now + Number(info.expires_in) * 1000;
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    throw new SnapshotProtocolError('backup_auth_required', 401);
  }
  if (info.aud !== client || (info.azp != null && info.azp !== client) || typeof info.scope !== 'string'
    || !info.scope.split(/\s+/).includes(DRIVE_FILE_SCOPE)) throw new SnapshotProtocolError('backup_auth_invalid', 403);
  // Drive-only tokens need not contain identity claims; refreshing the same grant cannot fix that.
  const subject = info.sub ?? info.user_id;
  if (typeof subject !== 'string' || !subject || subject.length > 255) throw new SnapshotProtocolError('backup_identity_required', 403);
  if (info.sub != null && info.user_id != null && info.sub !== info.user_id) throw new SnapshotProtocolError('backup_auth_invalid', 403);
  const verified = { subject, accountKey: await sha256Hex(subject), expiresAt: Math.min(expiresAt, now + 60_000) };
  if (verifiedTokens.size >= 128) verifiedTokens.delete(verifiedTokens.keys().next().value!);
  verifiedTokens.set(key, verified);
  return { ...verified, token };
};
