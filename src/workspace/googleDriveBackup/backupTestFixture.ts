import type { DriveFile, FetchLike } from './types';

export interface StoredDriveFile extends DriveFile {
  body?: Uint8Array;
  trashed?: boolean;
}

export interface MultipartUploadRequest {
  id?: string;
  metadata: {
    name: string;
    mimeType: string;
    parents?: string[];
    appProperties?: Record<string, string>;
  };
  body: Uint8Array;
}

export interface DriveFixtureOptions {
  now?: () => number;
  onUpload?(file: StoredDriveFile, request: MultipartUploadRequest): void | Promise<void>;
  shouldFailUpload?(request: MultipartUploadRequest): string | undefined;
  onList?(query: string, files: StoredDriveFile[]): void | Promise<void>;
  onDownload?(file: StoredDriveFile): void | Promise<void>;
  shouldFailTrash?(file: StoredDriveFile): string | undefined;
}

export interface InMemoryDriveFixture {
  fetchImpl: FetchLike;
  files: Map<string, StoredDriveFile>;
  calls: {
    uploads: MultipartUploadRequest[];
    downloads: string[];
    lists: string[];
    trash: string[];
  };
  addFile(file: Omit<StoredDriveFile, 'createdTime' | 'modifiedTime'> & Partial<Pick<StoredDriveFile, 'createdTime' | 'modifiedTime'>>): StoredDriveFile;
  get(id: string): StoredDriveFile | undefined;
  liveFiles(): StoredDriveFile[];
  setBody(id: string, body: Uint8Array): void;
}

const asBytes = async (body: BodyInit | null | undefined): Promise<Uint8Array> => {
  if (body && typeof body === 'object' && typeof (body as { arrayBuffer?: unknown }).arrayBuffer === 'function') {
    return new Uint8Array(await (body as Blob).arrayBuffer());
  }
  if (body && typeof body === 'object' && typeof FileReader !== 'undefined') {
    return new Uint8Array(await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(body as Blob);
    }));
  }
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  return new Uint8Array();
};

const findBytes = (source: Uint8Array, needle: Uint8Array, from = 0) => {
  outer: for (let index = from; index <= source.length - needle.length; index += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (source[index + offset] !== needle[offset]) continue outer;
    }
    return index;
  }
  return -1;
};

const publicFile = (file: StoredDriveFile): DriveFile => ({
  id: file.id,
  name: file.name,
  ...(file.mimeType ? { mimeType: file.mimeType } : {}),
  ...(file.parents ? { parents: [...file.parents] } : {}),
  ...(file.createdTime ? { createdTime: file.createdTime } : {}),
  ...(file.modifiedTime ? { modifiedTime: file.modifiedTime } : {}),
  ...(file.appProperties ? { appProperties: { ...file.appProperties } } : {}),
});

const responseJson = (value: unknown, now: () => number, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json', Date: new Date(now()).toUTCString() },
});

const responseError = (message: string, now: () => number, status = 500) => responseJson({ error: { message } }, now, status);

const queryValue = (query: string, expression: RegExp) => query.match(expression)?.[1];

const parseMultipart = async (init: RequestInit | undefined): Promise<MultipartUploadRequest> => {
  const body = await asBytes(init?.body as BodyInit | null | undefined);
  const contentType = new Headers(init?.headers).get('content-type') ?? '';
  const boundary = contentType.match(/boundary=([^;]+)/i)?.[1] ?? '';
  const metadataHeader = new TextEncoder().encode('Content-Type: application/json; charset=UTF-8\r\n\r\n');
  const metadataStart = findBytes(body, metadataHeader);
  const metadataEnd = metadataStart < 0
    ? -1
    : findBytes(body, new TextEncoder().encode(`\r\n--${boundary}`), metadataStart + metadataHeader.length);
  const metadata: MultipartUploadRequest['metadata'] = metadataStart < 0 || metadataEnd < 0
    ? { name: '', mimeType: 'application/octet-stream' }
    : JSON.parse(new TextDecoder().decode(body.slice(metadataStart + metadataHeader.length, metadataEnd))) as MultipartUploadRequest['metadata'];
  const bodyHeader = new TextEncoder().encode(`Content-Type: ${metadata.mimeType}\r\n\r\n`);
  const payloadStart = findBytes(body, bodyHeader, Math.max(0, metadataEnd));
  const payloadEnd = payloadStart < 0
    ? body.length
    : findBytes(body, new TextEncoder().encode(`\r\n--${boundary}`), payloadStart + bodyHeader.length);
  return { metadata, body: payloadStart < 0 ? new Uint8Array() : body.slice(payloadStart + bodyHeader.length, payloadEnd < 0 ? body.length : payloadEnd) };
};

export const blobFromBytes = (bytes?: Uint8Array) => new Blob([bytes ? bytes.slice().buffer as ArrayBuffer : new ArrayBuffer(0)]);
export const bytesFromBlob = (blob: Blob) => asBytes(blob);

export const createInMemoryDrive = (options: DriveFixtureOptions = {}): InMemoryDriveFixture => {
  const now = options.now ?? (() => Date.now());
  const files = new Map<string, StoredDriveFile>();
  const calls = { uploads: [] as MultipartUploadRequest[], downloads: [] as string[], lists: [] as string[], trash: [] as string[] };
  let nextId = 1;
  const timestamp = () => new Date(now()).toISOString();

  const addFile = (file: Omit<StoredDriveFile, 'createdTime' | 'modifiedTime'> & Partial<Pick<StoredDriveFile, 'createdTime' | 'modifiedTime'>>) => {
    const stored: StoredDriveFile = {
      ...file,
      createdTime: file.createdTime ?? timestamp(),
      modifiedTime: file.modifiedTime ?? timestamp(),
      parents: file.parents ? [...file.parents] : [],
      appProperties: file.appProperties ? { ...file.appProperties } : undefined,
    };
    files.set(stored.id, stored);
    return stored;
  };

  const fetchImpl: FetchLike = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('/upload/drive/v3/files')) {
      const request = await parseMultipart(init);
      const idMatch = new URL(url).pathname.match(/\/files\/([^/]+)$/);
      const id = idMatch ? decodeURIComponent(idMatch[1]) : `file-${nextId++}`;
      request.id = idMatch ? id : undefined;
      calls.uploads.push(request);
      const failure = options.shouldFailUpload?.(request);
      if (failure) return responseError(failure, now);
      const previous = files.get(id);
      const file = addFile({
        id,
        name: request.metadata.name,
        mimeType: request.metadata.mimeType,
        parents: request.metadata.parents ?? previous?.parents ?? [],
        appProperties: request.metadata.appProperties,
        body: request.body,
        createdTime: previous?.createdTime,
        modifiedTime: timestamp(),
        trashed: false,
      });
      await options.onUpload?.(file, request);
      return responseJson(publicFile(file), now);
    }

    if (url.includes('alt=media')) {
      const id = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
      const file = files.get(id);
      calls.downloads.push(id);
      if (!file || file.trashed) return responseError('missing file', now, 404);
      await options.onDownload?.(file);
      return new Response(file.body ? file.body.slice().buffer as ArrayBuffer : new ArrayBuffer(0), {
        status: 200,
        headers: { Date: new Date(now()).toUTCString() },
      });
    }

    if (url.endsWith('/files') && method === 'POST') {
      const value = JSON.parse(String(init?.body ?? '{}')) as { name: string; mimeType?: string; parents?: string[]; appProperties?: Record<string, string> };
      const file = addFile({ id: `folder-${nextId++}`, name: value.name, mimeType: value.mimeType, parents: value.parents ?? [], appProperties: value.appProperties, trashed: false });
      return responseJson(publicFile(file), now);
    }

    if (url.includes('/drive/v3/files/') && method === 'PATCH') {
      const id = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
      const file = files.get(id);
      if (!file) return responseError('missing file', now, 404);
      const body = JSON.parse(String(init?.body ?? '{}')) as { name?: string; appProperties?: Record<string, string>; trashed?: boolean };
      if (body.trashed === true) {
        calls.trash.push(id);
        const failure = options.shouldFailTrash?.(file);
        if (failure) return responseError(failure, now);
        file.trashed = true;
      }
      if (body.name !== undefined) file.name = body.name;
      if (body.appProperties) file.appProperties = { ...body.appProperties };
      const params = new URL(url).searchParams;
      const addParent = params.get('addParents');
      const removeParent = params.get('removeParents');
      if (removeParent) file.parents = (file.parents ?? []).filter(parent => parent !== removeParent);
      if (addParent && !file.parents?.includes(addParent)) file.parents = [...(file.parents ?? []), addParent];
      file.modifiedTime = timestamp();
      return responseJson(publicFile(file), now);
    }

    if (url.includes('/files?')) {
      const query = new URL(url).searchParams.get('q') ?? '';
      const propertyKey = queryValue(query, /key='([^']+)' and value='/);
      const propertyValue = query.match(/key='[^']+' and value='([^']+)'/)?.[1];
      const name = queryValue(query, /name = '([^']+)'/);
      const parent = queryValue(query, /^'([^']+)' in parents/) ?? queryValue(query, /'([^']+)' in parents/);
      const mimeType = queryValue(query, /mimeType = '([^']+)'/);
      const trashed = query.includes('trashed = true');
      const found = [...files.values()].filter(file => {
        if (Boolean(file.trashed) !== trashed) return false;
        if (propertyKey && file.appProperties?.[propertyKey] !== propertyValue) return false;
        if (name && file.name !== name) return false;
        if (parent && !file.parents?.includes(parent)) return false;
        if (mimeType && file.mimeType !== mimeType) return false;
        return true;
      });
      calls.lists.push(query);
      await options.onList?.(query, found);
      return responseJson({ files: found.map(publicFile) }, now);
    }

    throw new Error(`Unexpected Drive request: ${method} ${url}`);
  };

  return {
    fetchImpl,
    files,
    calls,
    addFile,
    get: id => files.get(id),
    liveFiles: () => [...files.values()].filter(file => !file.trashed),
    setBody: (id, body) => {
      const file = files.get(id);
      if (!file) throw new Error(`missing file ${id}`);
      file.body = body.slice();
    },
  };
};
