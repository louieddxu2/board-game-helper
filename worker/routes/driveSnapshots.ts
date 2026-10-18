import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import type { AppVariables } from '../auth';
import type { RouteEnv } from '../env';
import { getDatabase } from '../data/database';
import {
  acquireSnapshotRestore, beginSnapshot, claimSnapshotCleanup, commitSnapshot, continueSnapshotCleanup, finishSnapshotCleanup,
  listSnapshotVersions, noteSnapshotCleanupFailure, pruneSnapshotReceipts, readSnapshotOperation, readSnapshotSet, releaseSnapshotRestore, renewSnapshot,
} from '../data/driveSnapshots';
import { verifyDriveSnapshotToken } from '../services/driveSnapshotAuth';
import { assertSnapshotRoot, assertSnapshotUnchanged, inspectSnapshotFiles, snapshotDriveApi, snapshotLegacyStamp, trashKnownSnapshotFiles, trashSnapshotFolder } from '../services/driveSnapshotFiles';
import { GoogleDriveApiError } from '../../src/workspace/googleDriveBackup/googleDriveApi';
import { DRIVE_SNAPSHOT_API, DRIVE_SNAPSHOT_MAX_FILES, SnapshotProtocolError, type DriveSnapshotState } from '../../src/shared/driveSnapshots';

type Variables = AppVariables & { driveAuth: Awaited<ReturnType<typeof verifyDriveSnapshotToken>> };
const routes = new Hono<{ Bindings: RouteEnv; Variables: Variables }>();
const prefix = DRIVE_SNAPSHOT_API;

routes.onError((error, c) => {
  if (error instanceof SnapshotProtocolError) return c.json({ error: error.code }, error.status as ContentfulStatusCode);
  if (error instanceof GoogleDriveApiError) return c.json({ error: 'backup_drive_unavailable' }, error.status === 401 ? 401 : 503);
  // Provider errors can contain credentials; never pass them to the generic logger.
  return c.json({ error: 'backup_service_unavailable' }, 503);
});
routes.use(`${prefix}/*`, bodyLimit({ maxSize: 16 * 1024, onError: c => c.json({ error: 'backup_request_too_large' }, 413) }));
routes.use(`${prefix}/*`, async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.set('driveAuth', await verifyDriveSnapshotToken(c.req.header('Authorization'), c.env));
  await next();
});

routes.get(`${prefix}/state`, async c => {
  const { subject, accountKey, token } = c.get('driveAuth');
  const db = getDatabase(c);
  const set = await readSnapshotSet(db, subject);
  const suppliedRoot = c.req.query('rootId');
  if (suppliedRoot && !/^[a-zA-Z0-9_-]{8,200}$/.test(suppliedRoot)) throw new SnapshotProtocolError('backup_root_invalid', 422);
  const rootId = set?.root_id ?? suppliedRoot ?? null;
  const rootMetadata = rootId ? await assertSnapshotRoot(snapshotDriveApi(token), rootId) : undefined;
  const legacyStamp = rootId ? await snapshotLegacyStamp(snapshotDriveApi(token), rootId, rootMetadata) : '';
  const state: DriveSnapshotState = { accountKey, rootId, revision: set?.revision ?? 0,
    legacyStamp, legacyChanged: Boolean(set?.legacy_stamp && legacyStamp !== set.legacy_stamp), versions: await listSnapshotVersions(db, subject) };
  return c.json(state);
});

const beginSchema = z.object({
  id: z.uuid(), rootId: z.string().regex(/^[a-zA-Z0-9_-]{8,200}$/), expectedRevision: z.number().int().min(0),
  sourceRevision: z.string().regex(/^[a-f0-9]{64}$/), fileCount: z.number().int().min(1).max(DRIVE_SNAPSHOT_MAX_FILES),
  legacyStamp: z.string().regex(/^[a-f0-9]{64}$/), allowLegacyChange: z.boolean().optional(),
  sourceUpdatedAt: z.number().int().min(0),
});
routes.post(`${prefix}/begin`, async c => {
  const input = beginSchema.safeParse(await c.req.json().catch(() => null));
  if (!input.success) return c.json({ error: 'backup_request_invalid' }, 400);
  const { subject, token } = c.get('driveAuth');
  const db = getDatabase(c);
  const existing = await readSnapshotOperation(db, subject, input.data.id);
  const api = snapshotDriveApi(token);
  const rootMetadata = await assertSnapshotRoot(api, input.data.rootId);
  if (!existing && await snapshotLegacyStamp(api, input.data.rootId, rootMetadata) !== input.data.legacyStamp) throw new SnapshotProtocolError('backup_legacy_changed');
  const ids = existing ? [existing.folderId, ...existing.fileIds] : await api.generateIds(input.data.fileCount + 1);
  return c.json(await beginSnapshot(db, subject, input.data, ids, Date.now()));
});

routes.get(`${prefix}/operations/:id`, async c => {
  const op = await readSnapshotOperation(getDatabase(c), c.get('driveAuth').subject, c.req.param('id'));
  if (!op) return c.json({ error: 'backup_operation_not_found' }, 404);
  return c.json(op);
});

routes.post(`${prefix}/operations/:id/renew`, async c => {
  await renewSnapshot(getDatabase(c), c.get('driveAuth').subject, c.req.param('id'), Date.now());
  return c.json({ ok: true });
});

routes.post(`${prefix}/operations/:id/commit`, async c => {
  const { subject, token } = c.get('driveAuth');
  const db = getDatabase(c);
  const op = await readSnapshotOperation(db, subject, c.req.param('id'));
  const set = await readSnapshotSet(db, subject);
  if (!op || !set) throw new SnapshotProtocolError('backup_operation_not_found', 404);
  if (op.revision != null) {
    if (op.status !== 'committed') throw new SnapshotProtocolError('backup_snapshot_unavailable');
    return c.json(op);
  }
  const rootMetadata = await assertSnapshotRoot(snapshotDriveApi(token), set.root_id);
  if (await snapshotLegacyStamp(snapshotDriveApi(token), set.root_id, rootMetadata) !== op.legacyStamp) throw new SnapshotProtocolError('backup_legacy_changed');
  const inventory = await inspectSnapshotFiles(snapshotDriveApi(token), set.root_id, op);
  return c.json(await commitSnapshot(db, subject, op.id, inventory, Date.now()));
});

const restoreSchema = z.object({ leaseId: z.uuid(), action: z.enum(['acquire', 'verify', 'release']) });
routes.post(`${prefix}/operations/:id/restore`, async c => {
  const parsed = restoreSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: 'backup_request_invalid' }, 400);
  const { subject, token } = c.get('driveAuth');
  const db = getDatabase(c);
  const id = c.req.param('id');
  const { leaseId, action } = parsed.data;
  if (action === 'release') { await releaseSnapshotRestore(db, subject, id, leaseId); return c.json({ ok: true }); }
  await acquireSnapshotRestore(db, subject, id, leaseId, Date.now());
  const op = await readSnapshotOperation(db, subject, id);
  const set = await readSnapshotSet(db, subject);
  if (!op || !set) throw new SnapshotProtocolError('backup_snapshot_unavailable');
  try { assertSnapshotUnchanged(await inspectSnapshotFiles(snapshotDriveApi(token), set.root_id, op), op.inventory); }
  catch (error) { await releaseSnapshotRestore(db, subject, id, leaseId); throw error; }
  return c.json(op);
});

routes.post(`${prefix}/cleanup`, async c => {
  const { subject, token } = c.get('driveAuth');
  const db = getDatabase(c);
  const set = await readSnapshotSet(db, subject);
  if (!set) return c.json({ cleaned: false });
  await assertSnapshotRoot(snapshotDriveApi(token), set.root_id);
  const op = await claimSnapshotCleanup(db, subject, Date.now());
  if (!op) return c.json({ cleaned: false });
  try {
    if (c.env.GOOGLE_DRIVE_SNAPSHOT_FOLDER_CLEANUP === 'enabled') await trashSnapshotFolder(snapshotDriveApi(token), set.root_id, op);
    else {
      const result = await trashKnownSnapshotFiles(snapshotDriveApi(token), set.root_id, op);
      if (!result.complete) {
        await continueSnapshotCleanup(db, subject, op.id);
        return c.json({ cleaned: result.progress });
      }
    }
  }
  catch (error) {
    const code = error instanceof SnapshotProtocolError ? error.code
      : error instanceof GoogleDriveApiError ? `drive_${error.status}` : 'backup_cleanup_failed';
    await noteSnapshotCleanupFailure(db, subject, op.id, code);
    throw error;
  }
  await finishSnapshotCleanup(db, subject, op.id);
  await pruneSnapshotReceipts(db, subject, Date.now());
  return c.json({ cleaned: true });
});

export { routes as driveSnapshotRoutes };
