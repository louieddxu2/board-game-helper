import { DRIVE_SNAPSHOT_KEY } from '../../../shared/driveSnapshots';
import { createInMemoryDrive, type InMemoryDriveFixture, type StoredDriveFile } from '../backupTestFixture';
import type { FetchLike } from '../types';

/**
 * `drop`: the request never reaches Drive. `lost-response`: Drive applies it, but the browser
 * never sees the answer (tab closed, connection reset). The HTTP modes are server refusals.
 */
export type FaultMode = 'drop' | 'lost-response' | 'http-500' | 'http-403';
/** A request picked by position, or by its role in a backup whatever its position. */
export type FaultTarget = number | 'lookup' | 'folder' | 'table' | 'manifest' | 'trash';
export interface Fault { at: FaultTarget; mode: FaultMode }
export type RequestKind = 'list' | 'create-folder' | 'upload' | 'download' | 'get' | 'trash' | 'patch' | 'other';
export interface ObservedRequest { index: number; kind: RequestKind; name?: string; query?: string; upload?: string }

export interface DriveObserver {
  /** A request from the device under test is about to reach Drive (or be dropped). */
  beforeRequest?(request: ObservedRequest): void | Promise<void>;
  /** Any actor's upload was stored. */
  uploaded?(file: StoredDriveFile): void;
  /** Any actor is about to move this file to the trash. */
  trashing?(file: StoredDriveFile): void;
}

const FOLDER = 'application/vnd.google-apps.folder';

/** The multipart metadata precedes the file content, so its head names the kind of upload. */
const uploadKind = async (body: unknown) => {
  if (!(body instanceof Blob)) return undefined;
  const head = await new Promise<string>(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => resolve('');
    reader.readAsText(body.slice(0, 1024));
  });
  return head.match(/"backupKind":"([a-z]+)"/)?.[1];
};

export const INDEX_LOOKUP = "key='backupKind' and value='manifest'";

const classify = (url: string, init?: RequestInit): Omit<ObservedRequest, 'index'> => {
  const method = init?.method ?? 'GET';
  const path = new URL(url).pathname;
  if (url.includes('/upload/drive/v3/files')) return { kind: 'upload' };
  if (url.includes('alt=media')) return { kind: 'download' };
  if (path.endsWith('/files') && method === 'POST') return { kind: 'create-folder', name: (JSON.parse(String(init?.body ?? '{}')) as { name?: string }).name };
  if (path.endsWith('/files') && method === 'GET') return { kind: 'list', query: new URL(url).searchParams.get('q') ?? '' };
  if (method === 'PATCH') return { kind: (JSON.parse(String(init?.body ?? '{}')) as { trashed?: boolean }).trashed ? 'trash' : 'patch' };
  if (method === 'GET') return { kind: 'get' };
  return { kind: 'other' };
};

export interface FaultyDrive {
  /** The fetch the device under test uses; subject to the armed fault. */
  fetch: FetchLike;
  /** Unobstructed access for other actors and for the auditor. */
  reliableFetch: FetchLike;
  fixture: InMemoryDriveFixture;
  observer: DriveObserver;
  /** Arm at most one fault for the requests of the next operation and restart its request index. */
  beginOperation(fault?: Fault): void;
  requestCount(): number;
  faultTriggered(): boolean;
  idle(): boolean;
  snapshotRoot(): StoredDriveFile | undefined;
  /** Restorable v3 snapshots in the documented order: revision, then modified and created time. */
  liveSnapshots(): StoredDriveFile[];
  /** Snapshot folders whose upload never published an index. */
  orphanSnapshotFolders(): StoredDriveFile[];
}

export const createFaultyDrive = (): FaultyDrive => {
  let sequence = 0;
  let fault: Fault | undefined;
  let triggered = false;
  let index = 0;
  let inFlight = 0;
  const observer: DriveObserver = {};
  const fixture = createInMemoryDrive({
    // Every stored change gets a distinct, increasing server timestamp.
    now: () => Date.now() + (sequence += 1),
    onUpload: file => observer.uploaded?.(file),
    shouldFailTrash: file => { observer.trashing?.(file); return undefined; },
  });
  const live = () => fixture.liveFiles();
  const snapshotRoot = () => live().find(file => file.mimeType === FOLDER && file.appProperties?.backupKey === DRIVE_SNAPSHOT_KEY && file.appProperties.backupKind === 'root');
  const liveSnapshots = () => live()
    .filter(file => file.appProperties?.backupKey === DRIVE_SNAPSHOT_KEY && file.appProperties.backupKind === 'manifest')
    .sort((left, right) => Number(right.appProperties?.snapshotRevision ?? 0) - Number(left.appProperties?.snapshotRevision ?? 0)
      || (right.modifiedTime ?? '').localeCompare(left.modifiedTime ?? '')
      || (right.createdTime ?? '').localeCompare(left.createdTime ?? ''));

  const matches = (target: FaultTarget, request: ObservedRequest) => typeof target === 'number' ? target === request.index
    : target === 'lookup' ? request.kind === 'list' && Boolean(request.query?.includes(INDEX_LOOKUP))
      : target === 'folder' ? request.kind === 'create-folder' && Boolean(request.name?.startsWith('備份-'))
        : target === 'trash' ? request.kind === 'trash' : request.kind === 'upload' && request.upload === target;

  const fetch: FetchLike = async (input, init) => {
    const url = String(input);
    const request: ObservedRequest = { index, ...classify(url, init) };
    index += 1;
    inFlight += 1;
    try {
      if (request.kind === 'upload') request.upload = await uploadKind(init?.body);
      await observer.beforeRequest?.(request);
      const active = fault && !triggered && matches(fault.at, request) ? fault : undefined;
      if (active) triggered = true;
      if (active?.mode === 'drop') throw new TypeError('Failed to fetch');
      if (active?.mode === 'http-500') return new Response(JSON.stringify({ error: { message: 'Backend Error' } }), { status: 500 });
      if (active?.mode === 'http-403') return new Response(JSON.stringify({ error: { message: 'The user has exceeded their Drive storage quota' } }), { status: 403 });
      const response = await fixture.fetchImpl(input, init);
      if (active?.mode === 'lost-response') throw new TypeError('Failed to fetch');
      return response;
    } finally { inFlight -= 1; }
  };

  return {
    fetch,
    reliableFetch: fixture.fetchImpl,
    fixture,
    observer,
    beginOperation(next) { fault = next; triggered = false; index = 0; },
    requestCount: () => index,
    faultTriggered: () => triggered,
    idle: () => inFlight === 0,
    snapshotRoot,
    liveSnapshots,
    orphanSnapshotFolders: () => {
      const root = snapshotRoot()?.id;
      const published = new Set(liveSnapshots().map(file => file.parents?.[0]));
      return live().filter(file => file.mimeType === FOLDER && file.appProperties?.backupKind === 'snapshot' && file.parents?.[0] === root && !published.has(file.id));
    },
  };
};
