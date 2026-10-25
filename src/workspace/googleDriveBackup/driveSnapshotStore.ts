import { z } from 'zod';
import { DRIVE_SNAPSHOT_KEY, DRIVE_SNAPSHOT_MAX_FILES, type DriveSnapshotOperation } from '../../shared/driveSnapshots';
import { FOLDER_MIME, GoogleDriveApi } from './googleDriveApi';
import { SnapshotCoordinatorError } from './snapshotErrors';
import { assertSnapshotRoot, inspectSnapshotFiles, snapshotChildren } from './snapshotFiles';
import { readSnapshotManifest } from './snapshotRestore';
import { blobBytes } from '../spreadsheetCodec';
import type { DriveFile } from './types';

const JSON_MIME = 'application/json';
const id = z.string().min(1).max(200);
const operationSchema = z.object({
  id, expectedRevision: z.number().int().nonnegative(), sourceRevision: z.string(), legacyStamp: z.string(),
  folderId: id, fileIds: z.array(id).min(2).max(DRIVE_SNAPSHOT_MAX_FILES),
  status: z.enum(['uploading', 'committed', 'deleting', 'deleted']), expiresAt: z.number().finite(),
  revision: z.number().int().nonnegative().nullable(), committedAt: z.number().finite().nullable(), sourceUpdatedAt: z.number().finite(),
  inventory: z.array(z.object({ id, size: z.string(), md5Checksum: z.string(), modifiedTime: z.string() })).max(DRIVE_SNAPSHOT_MAX_FILES),
});
const recordSchema = z.object({ schema: z.literal(1), rootId: id, parents: z.array(id).max(DRIVE_SNAPSHOT_MAX_FILES),
  legacyHead: id.optional(), abandoned: z.boolean().optional(), operation: operationSchema })
  .refine(record => new Set(record.operation.fileIds).size === record.operation.fileIds.length
    && new Set(record.operation.inventory.map(file => file.id)).size === record.operation.inventory.length
    && record.operation.inventory.every(file => record.operation.fileIds.includes(file.id)), 'Invalid allocated IDs')
  .refine(record => record.operation.status !== 'committed'
    || (record.operation.inventory.length === record.operation.fileIds.length
      && record.operation.inventory.every((file, index) => file.id === record.operation.fileIds[index])), 'Incomplete receipt');
export interface SnapshotRecord {
  schema: 1;
  rootId: string;
  parents: string[];
  legacyHead?: string;
  abandoned?: boolean;
  operation: DriveSnapshotOperation;
  file?: DriveFile;
  /** Pre-existing v3 snapshots are verified directly and are never auto-deleted. */
  legacy?: boolean;
}

export const snapshotTags = (kind: string, snapshotId?: string) => ({ backupKey: DRIVE_SNAPSHOT_KEY, backupKind: kind,
  schemaVersion: '4', ...(snapshotId ? { snapshotId } : {}) });

/** JSON receipts live beside snapshot folders. Each snapshot folder retains its original XLSX layout. */
export class DriveSnapshotStore {
  private readonly cache = new Map<string, { signature: string; text: string }>();
  constructor(readonly api: GoogleDriveApi) {}

  async roots(rootId?: string) {
    const found = await this.api.findFilesByAppProperty({ key: 'backupKey', value: DRIVE_SNAPSHOT_KEY, mimeType: FOLDER_MIME });
    const roots = found.filter(file => file.appProperties?.backupKind === 'root');
    if (rootId && !roots.some(file => file.id === rootId)) roots.push(await this.api.getFile(rootId));
    const verified: DriveFile[] = [];
    for (const file of roots) verified.push(assertSnapshotRoot(await this.api.getFile(file.id)));
    return verified.sort((a, b) => (a.createdTime ?? '').localeCompare(b.createdTime ?? '') || a.id.localeCompare(b.id));
  }

  private async text(file: DriveFile) {
    const signature = `${file.modifiedTime}:${file.md5Checksum}:${file.size}`;
    const cached = this.cache.get(file.id);
    if (cached?.signature === signature) return cached.text;
    const blob = await this.api.downloadBlob(file.id);
    if (blob.size > 4_000_000) throw new SnapshotCoordinatorError('backup_snapshot_invalid', 422);
    const text = new TextDecoder().decode(await blobBytes(blob));
    this.cache.set(file.id, { signature, text });
    if (this.cache.size > 128) this.cache.delete(this.cache.keys().next().value!);
    return text;
  }

  async read(file: DriveFile, root: string): Promise<SnapshotRecord> {
    if (file.trashed || file.ownedByMe !== true || file.mimeType !== JSON_MIME || file.parents?.length !== 1
      || file.parents[0] !== root || file.appProperties?.backupKey !== DRIVE_SNAPSHOT_KEY || file.appProperties.backupKind !== 'receipt') {
      throw new SnapshotCoordinatorError('backup_snapshot_invalid', 422);
    }
    let value: unknown;
    try { value = JSON.parse(await this.text(file)); }
    catch { throw new SnapshotCoordinatorError('backup_snapshot_invalid', 422); }
    const parsed = recordSchema.safeParse(value);
    if (!parsed.success || parsed.data.rootId !== root || parsed.data.operation.id !== file.appProperties.snapshotId) {
      throw new SnapshotCoordinatorError('backup_snapshot_invalid', 422);
    }
    const record: SnapshotRecord = { ...parsed.data, file };
    if (record.operation.status === 'deleting' && file.appProperties.snapshotDeleting !== 'true') {
      throw new SnapshotCoordinatorError('backup_snapshot_invalid', 422);
    }
    // Deletion is monotonic metadata: a delayed body upload or expiry renewal cannot clear it.
    if (file.appProperties.snapshotDeleting === 'true' && record.operation.status !== 'deleted') record.operation.status = 'deleting';
    if (file.appProperties.snapshotAbandoned === 'true') record.abandoned = true;
    const expiry = Number(file.appProperties.expiresAt);
    if (record.operation.status === 'uploading' && Number.isFinite(expiry) && expiry > 0) record.operation.expiresAt = expiry;
    return record;
  }

  async write(record: SnapshotRecord, createId?: string) {
    const body = JSON.stringify(recordSchema.parse(record));
    const file = await this.api.uploadFile({ fileId: record.file?.id, createId, parentId: record.rootId,
      name: `紀錄-${record.operation.id}.json`, mimeType: JSON_MIME, body, appProperties: { ...snapshotTags('receipt', record.operation.id),
        ...(['deleting', 'deleted'].includes(record.operation.status) ? { snapshotDeleting: 'true' } : {}),
        ...(record.abandoned ? { snapshotAbandoned: 'true' } : {}) } });
    // A newly created receipt has a current Google timestamp even when CORS hides the Date header.
    if (!record.file) this.api.observeCreatedTime(file.createdTime);
    return this.read(await this.api.getFile(file.id), record.rootId);
  }

  async records(roots: DriveFile[]) {
    const records: SnapshotRecord[] = [];
    for (const root of roots) {
      const files = await snapshotChildren(this.api, root.id);
      const receipts = files.filter(file => file.appProperties?.backupKey === DRIVE_SNAPSHOT_KEY && file.appProperties.backupKind === 'receipt');
      for (const file of receipts) {
        const record = await this.read(file, root.id);
        // Keep abandoned IDs recoverable: a previously in-flight upload can finish after cleanup.
        if (record.abandoned && record.operation.status === 'deleted') {
          const contents = await snapshotChildren(this.api, record.operation.folderId);
          if (contents.some(file => record.operation.fileIds.includes(file.id))) record.operation.status = 'deleting';
        }
        records.push(record);
      }
      const known = new Set(records.map(record => record.operation.folderId));
      for (const folder of files.filter(file => file.appProperties?.backupKey === DRIVE_SNAPSHOT_KEY
        && file.appProperties.backupKind === 'snapshot' && !known.has(file.id))) {
        // New candidates always have a receipt before a folder. Missing receipts are not legacy snapshots.
        if (folder.appProperties?.schemaVersion === '4') continue;
        const legacy = await this.legacy(root.id, folder);
        if (legacy) records.push(legacy);
      }
    }
    if (new Set(records.map(record => record.operation.id)).size !== records.length) {
      throw new SnapshotCoordinatorError('backup_snapshot_invalid', 422);
    }
    return records;
  }

  private async legacy(root: string, folder: DriveFile): Promise<SnapshotRecord | null> {
    if (!folder.appProperties?.snapshotId) return null;
    const files = await snapshotChildren(this.api, folder.id);
    const manifest = files.find(file => file.appProperties?.backupKind === 'manifest');
    if (!manifest || files.length < 2) return null;
    const operation: DriveSnapshotOperation = { id: folder.appProperties!.snapshotId, expectedRevision: 0, sourceRevision: '', legacyStamp: '',
      folderId: folder.id, fileIds: [manifest.id, ...files.filter(file => file.id !== manifest.id).map(file => file.id)], status: 'committed',
      expiresAt: 0, revision: 0, committedAt: Date.parse(manifest.createdTime ?? manifest.modifiedTime ?? ''), sourceUpdatedAt: 0, inventory: [] };
    if (!Number.isFinite(operation.committedAt)) return null;
    try {
      operation.inventory = await inspectSnapshotFiles(this.api, root, operation);
      const index = await readSnapshotManifest(this.api, operation);
      if (!index.tables.length) return null;
      operation.sourceUpdatedAt = index.sourceUpdatedAt;
      return { schema: 1, rootId: root, parents: [], operation, legacy: true };
    } catch (error) {
      if (error instanceof SnapshotCoordinatorError) return null;
      // Malformed older indexes remain in Drive; they never become the current complete backup.
      if (error instanceof Error && /備份索引|備份格式|ZIP|zip|xlsx|XLSX/.test(error.message)) return null;
      throw error;
    }
  }
}
