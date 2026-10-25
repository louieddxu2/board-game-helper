import { DRIVE_SNAPSHOT_KEY, DRIVE_SNAPSHOT_LEASE_MS, DRIVE_SNAPSHOT_LIMIT, DRIVE_SNAPSHOT_ORPHAN_GRACE_MS, summarizeDriveSnapshot,
  type BeginDriveSnapshot, type DriveSnapshotState } from '../../shared/driveSnapshots';
import { GoogleDriveApi, GoogleDriveApiError } from './googleDriveApi';
import { DriveSnapshotStore, snapshotTags, type SnapshotRecord } from './driveSnapshotStore';
import { SnapshotCoordinatorError } from './snapshotErrors';
import { assertSnapshotRoot, assertSnapshotUnchanged, inspectSnapshotFiles, snapshotChildren, snapshotLegacyStamp } from './snapshotFiles';
import { snapshotRevisionDigest } from './snapshotJournal';
import type { SnapshotCoordinator } from './snapshotCoordinator';
import type { GoogleDriveApiOptions } from './types';

const newest = (a: SnapshotRecord, b: SnapshotRecord) => (b.operation.revision ?? 0) - (a.operation.revision ?? 0)
  || (b.operation.committedAt ?? 0) - (a.operation.committedAt ?? 0)
  || b.operation.id.localeCompare(a.operation.id);
const headsOf = (records: SnapshotRecord[]) => {
  const complete = records.filter(record => record.operation.status === 'committed');
  const old = complete.filter(record => record.legacy).sort(newest);
  const modern = complete.filter(record => !record.legacy);
  const parents = new Set(complete.flatMap(record => record.parents));
  const unadopted = old[0] && !modern.some(record => record.legacyHead === old[0].operation.id) ? old.slice(0, 1) : [];
  return [...modern, ...unadopted].filter(record => !parents.has(record.operation.id)).sort(newest);
};
const revisionOf = async (records: SnapshotRecord[]) => {
  const ids = headsOf(records).map(record => record.operation.id).sort();
  return ids.length ? Number.parseInt((await snapshotRevisionDigest(JSON.stringify(ids))).slice(0, 13), 16) : 0;
};

export const createDriveSnapshotCoordinator = (options: GoogleDriveApiOptions): SnapshotCoordinator => {
  const api = new GoogleDriveApi(options);
  const store = new DriveSnapshotStore(api);
  const readAll = async (root?: string) => {
    const roots = await store.roots(root);
    const [records, legacyStamp] = await Promise.all([store.records(roots), snapshotLegacyStamp(api, roots)]);
    return { roots, records, legacyStamp };
  };
  const find = (id: string) => store.find(id);
  const requireRecord = async (id: string) => {
    const record = await find(id);
    if (!record) throw new SnapshotCoordinatorError('backup_snapshot_unavailable', 404);
    return record;
  };
  const state = async (root?: string): Promise<DriveSnapshotState> => {
    const { roots, records, legacyStamp } = await readAll(root);
    const heads = headsOf(records);
    if (!heads.length && records.some(record => record.operation.status === 'committed')) {
      throw new SnapshotCoordinatorError('backup_snapshot_invalid', 422);
    }
    const versions = records.filter(record => record.operation.status === 'committed').sort(newest);
    // A fork is never silently discarded merely to pick a latest timestamp.
    const ordered = [...heads, ...versions.filter(record => !heads.includes(record))];
    return { accountKey: roots[0] ? `drive:${roots[0].id}` : 'drive:unlinked', rootId: roots[0]?.id ?? null,
      revision: await revisionOf(records), legacyStamp, forkCount: heads.length,
      legacyChanged: heads.some(record => !record.legacy && record.operation.legacyStamp !== legacyStamp),
      versions: ordered.map(record => summarizeDriveSnapshot(record.operation)) };
  };
  const active = (record: SnapshotRecord) => {
    if (record.operation.status !== 'uploading' || record.operation.expiresAt <= api.serverNow()) {
      throw new SnapshotCoordinatorError('backup_operation_expired', 409);
    }
  };
  const leases = async (record: SnapshotRecord) => (await snapshotChildren(api, record.rootId)).filter(file =>
    file.appProperties?.backupKey === DRIVE_SNAPSHOT_KEY && file.appProperties.backupKind === 'restore-lease'
    && file.appProperties.snapshotId === record.operation.id && Number(file.appProperties.expiresAt) > api.serverNow()
    && Boolean(file.appProperties.leaseId) && file.ownedByMe === true && file.mimeType === 'application/json'
    && file.parents?.length === 1 && file.parents[0] === record.rootId);

  return {
    state,
    async operation(id) { return (await find(id))?.operation ?? null; },
    async begin(input: BeginDriveSnapshot) {
      if (input.fileCount < 2) throw new SnapshotCoordinatorError('backup_snapshot_empty', 422);
      const { roots, records, legacyStamp } = await readAll(input.rootId);
      assertSnapshotRoot(roots.find(root => root.id === input.rootId)!);
      const existing = records.find(record => record.operation.id === input.id);
      if (existing) {
        const op = existing.operation;
        if (op.sourceRevision !== input.sourceRevision || existing.rootId !== input.rootId || op.expectedRevision !== input.expectedRevision
          || op.legacyStamp !== input.legacyStamp || op.fileIds.length !== input.fileCount || op.sourceUpdatedAt !== input.sourceUpdatedAt
          || !['uploading', 'committed'].includes(op.status)) {
          throw new SnapshotCoordinatorError('backup_snapshot_invalid', 422);
        }
        return existing.operation;
      }
      if (input.expectedRevision !== await revisionOf(records)) throw new SnapshotCoordinatorError('backup_revision_conflict', 409);
      if (input.legacyStamp !== legacyStamp) throw new SnapshotCoordinatorError('backup_legacy_changed', 409);
      const heads = headsOf(records);
      if (heads.length > 1 && !input.allowLegacyChange) throw new SnapshotCoordinatorError('backup_revision_conflict', 409);
      const [receiptId, folderId, ...fileIds] = await api.generateIds(input.fileCount + 2);
      const legacyHead = records.filter(record => record.legacy).sort(newest)[0]?.operation.id;
      const record: SnapshotRecord = { schema: 1, rootId: input.rootId, parents: heads.map(record => record.operation.id), legacyHead, operation: {
        id: input.id, expectedRevision: input.expectedRevision, sourceRevision: input.sourceRevision, legacyStamp,
        folderId, fileIds, status: 'uploading', expiresAt: api.serverNow() + DRIVE_SNAPSHOT_LEASE_MS,
        revision: null, committedAt: null, sourceUpdatedAt: input.sourceUpdatedAt, inventory: [] } };
      const saved = await store.write(record, receiptId);
      saved.operation.expiresAt = api.serverNow() + DRIVE_SNAPSHOT_LEASE_MS;
      await api.updateFileMetadata(saved.file!.id, { appProperties: { expiresAt: String(saved.operation.expiresAt) } });
      return saved.operation;
    },
    async renew(id) {
      const record = await requireRecord(id); active(record);
      // Renewal updates only expiry metadata, never the committed receipt body or deletion marker.
      await api.updateFileMetadata(record.file!.id, { appProperties: { expiresAt: String(Math.max(record.operation.expiresAt, api.serverNow() + DRIVE_SNAPSHOT_LEASE_MS)) } });
    },
    async commit(id) {
      const record = await requireRecord(id);
      if (record.operation.status === 'committed') return record.operation;
      active(record);
      const current = await readAll();
      if (record.operation.expectedRevision !== await revisionOf(current.records)) throw new SnapshotCoordinatorError('backup_revision_conflict', 409);
      if (record.operation.legacyStamp !== current.legacyStamp) throw new SnapshotCoordinatorError('backup_legacy_changed', 409);
      record.operation.inventory = await inspectSnapshotFiles(api, record.rootId, record.operation);
      active(await requireRecord(id));
      record.operation.status = 'committed';
      record.operation.revision = 1 + Math.max(0, ...current.records.map(item => item.operation.revision ?? 0));
      record.operation.committedAt = api.serverNow();
      const committed = await store.write(record);
      if (committed.operation.status !== 'committed') throw new SnapshotCoordinatorError('backup_operation_expired', 409);
      // Independent siblings can both finish during this final write. Keep both and report the fork.
      const after = await readAll();
      if (headsOf(after.records).length > 1) throw new SnapshotCoordinatorError('backup_revision_conflict', 409);
      return committed.operation;
    },
    async restore(id, leaseId, action) {
      let record = await requireRecord(id);
      const candidates = await snapshotChildren(api, record.rootId);
      const lease = candidates.find(file => file.appProperties?.backupKey === DRIVE_SNAPSHOT_KEY && file.appProperties.backupKind === 'restore-lease'
        && file.appProperties.snapshotId === id && file.appProperties.leaseId === leaseId
        && file.ownedByMe === true && file.mimeType === 'application/json' && file.parents?.length === 1 && file.parents[0] === record.rootId);
      if (action === 'release') {
        if (lease) await api.trashFile(lease.id);
        return record.operation;
      }
      if (record.operation.status !== 'committed') throw new SnapshotCoordinatorError('backup_snapshot_unavailable', 409);
      if (action === 'acquire') {
        await api.uploadFile({ fileId: lease?.id, parentId: record.rootId, name: `還原-${leaseId}.json`, mimeType: 'application/json', body: '{}',
          appProperties: { ...snapshotTags('restore-lease', id), leaseId, expiresAt: String(api.serverNow() + DRIVE_SNAPSHOT_LEASE_MS) } });
        record = await requireRecord(id);
        if (record.operation.status !== 'committed') throw new SnapshotCoordinatorError('backup_snapshot_unavailable', 409);
      } else if (!lease || Number(lease.appProperties?.expiresAt) <= api.serverNow()) {
        throw new SnapshotCoordinatorError('backup_snapshot_unavailable', 409);
      }
      assertSnapshotUnchanged(await inspectSnapshotFiles(api, record.rootId, record.operation), record.operation.inventory);
      return record.operation;
    },
    async cleanup() {
      const { records } = await readAll();
      if (headsOf(records).length > 1 || records.some(record => record.operation.status === 'uploading'
        && record.operation.expiresAt > api.serverNow())) return { cleaned: false };
      const committed = records.filter(record => record.operation.status === 'committed').sort(newest);
      const retained = new Set([...headsOf(records), ...committed].map(record => record.operation.id).filter((id, index, ids) => ids.indexOf(id) === index).slice(0, DRIVE_SNAPSHOT_LIMIT));
      const record = records.find(item => !item.legacy && !retained.has(item.operation.id)
        && (item.operation.status === 'deleting' || item.operation.status === 'committed'
          || (item.operation.status === 'uploading' && item.operation.expiresAt + DRIVE_SNAPSHOT_ORPHAN_GRACE_MS < api.serverNow())));
      if (!record || (await leases(record)).length) return { cleaned: false };
      if (record.operation.status === 'uploading') {
        record.abandoned = true;
        record.operation.status = 'deleting';
        await store.write(record);
      } else if (record.operation.status === 'committed') {
        assertSnapshotUnchanged(await inspectSnapshotFiles(api, record.rootId, record.operation), record.operation.inventory);
        record.operation.status = 'deleting';
        await store.write(record);
      }
      // Mark unavailable before checking again, so new restores cannot start while removing files.
      if ((await leases(record)).length) return { cleaned: false };
      if (record.abandoned) {
        // Re-list on every pass; the original inventory cannot include an upload still in flight.
        const files = await snapshotChildren(api, record.operation.folderId);
        record.operation.inventory = files.filter(file => record.operation.fileIds.includes(file.id)).map(file => {
          if (file.ownedByMe !== true || file.mimeType !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            || file.parents?.length !== 1 || file.parents[0] !== record.operation.folderId
            || file.appProperties?.backupKey !== DRIVE_SNAPSHOT_KEY || file.appProperties.snapshotId !== record.operation.id
            || file.appProperties.backupKind !== (record.operation.fileIds[0] === file.id ? 'manifest' : 'table')
            || !file.size || !file.md5Checksum || !file.modifiedTime) throw new SnapshotCoordinatorError('backup_snapshot_changed', 409);
          return { id: file.id, size: file.size, md5Checksum: file.md5Checksum, modifiedTime: file.modifiedTime };
        });
      }
      const removable: string[] = [];
      for (const signature of record.operation.inventory) {
        let file;
        try { file = await api.getFile(signature.id); }
        catch (error) { if (error instanceof GoogleDriveApiError && error.status === 404) continue; throw error; }
        if (file.trashed || file.parents?.[0] !== record.operation.folderId) continue;
        if (file.ownedByMe !== true || file.mimeType !== 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          || file.parents?.length !== 1 || file.appProperties?.snapshotId !== record.operation.id || file.appProperties.backupKey !== DRIVE_SNAPSHOT_KEY
          || file.appProperties.backupKind !== (record.operation.fileIds[0] === file.id ? 'manifest' : 'table')
          || file.size !== signature.size || file.md5Checksum !== signature.md5Checksum || file.modifiedTime !== signature.modifiedTime) {
          throw new SnapshotCoordinatorError('backup_snapshot_changed', 409);
        }
        removable.push(file.id);
      }
      // Validate before deleting anything, then bound work. Manually added files and folders are preserved.
      for (const id of removable.slice(0, 20)) await api.trashFile(id);
      if (removable.length > 20) return { cleaned: true };
      if (record.abandoned) {
        record.operation.status = 'deleted'; record.operation.inventory = [];
        await store.write(record);
      } else if (record.file) await api.trashFile(record.file.id);
      return { cleaned: true };
    },
  };
};
