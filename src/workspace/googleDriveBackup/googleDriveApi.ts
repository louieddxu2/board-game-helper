import type { DriveBody, DriveFile, FetchLike, GoogleDriveApiOptions } from './types';

export class GoogleDriveApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'GoogleDriveApiError';
    this.status = status;
    this.details = details;
  }
}

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DEFAULT_DRIVE_BASE_URL = 'https://www.googleapis.com/drive/v3';
const DEFAULT_UPLOAD_BASE_URL = 'https://www.googleapis.com/upload/drive/v3';

const getDefaultFetch = (): FetchLike => (input, init) => globalThis.fetch(input, init);
const escapeQueryLiteral = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const toBytes = (body: DriveBody): Promise<Uint8Array> => {
  if (typeof body === 'string') return Promise.resolve(new TextEncoder().encode(body));
  if (body instanceof Blob) {
    if (typeof body.arrayBuffer === 'function') return body.arrayBuffer().then((buffer) => new Uint8Array(buffer));
    return new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = () => reject(reader.error ?? new Error('無法讀取試算表備份內容'));
      reader.readAsArrayBuffer(body);
    });
  }
  if (body instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(body));
  if (ArrayBuffer.isView(body)) return Promise.resolve(new Uint8Array(body.buffer as ArrayBuffer, body.byteOffset, body.byteLength));
  return Promise.reject(new TypeError('不支援的 Google Drive 上傳內容'));
};

export class GoogleDriveApi {
  private readonly tokenProvider;
  private readonly fetchImpl: FetchLike;
  private readonly driveBaseUrl: string;
  private readonly uploadBaseUrl: string;

  constructor(options: GoogleDriveApiOptions) {
    this.tokenProvider = options.tokenProvider;
    this.fetchImpl = options.fetchImpl ?? getDefaultFetch();
    this.driveBaseUrl = (options.driveBaseUrl ?? DEFAULT_DRIVE_BASE_URL).replace(/\/$/, '');
    this.uploadBaseUrl = (options.uploadBaseUrl ?? DEFAULT_UPLOAD_BASE_URL).replace(/\/$/, '');
  }

  private async authorizationHeaders(options: { forceRefresh?: boolean } = {}): Promise<Headers> {
    const headers = new Headers();
    headers.set('Authorization', `Bearer ${await this.tokenProvider.getAccessToken(options)}`);
    return headers;
  }

  private async parseError(response: Response): Promise<unknown> {
    const text = await response.text().catch(() => '');
    if (!text) return undefined;
    try { return JSON.parse(text); } catch { return text; }
  }

  private async requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
    let response = await this.fetchAuthorized(url, init);
    if (response.status === 401) response = await this.fetchAuthorized(url, init, { forceRefresh: true });
    if (!response.ok) {
      const details = await this.parseError(response);
      const message = typeof details === 'object' && details !== null && 'error' in details
        ? String((details as { error?: { message?: string } }).error?.message ?? `Google Drive API 錯誤：${response.status}`)
        : `Google Drive API 錯誤：${response.status}`;
      throw new GoogleDriveApiError(message, response.status, details);
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return text ? JSON.parse(text) as T : undefined as T;
  }

  private async requestBlob(url: string): Promise<Blob> {
    let response = await this.fetchAuthorized(url);
    if (response.status === 401) response = await this.fetchAuthorized(url, undefined, { forceRefresh: true });
    if (!response.ok) throw new GoogleDriveApiError(`Google Drive 下載失敗：${response.status}`, response.status, await this.parseError(response));
    return response.blob();
  }

  private async fetchAuthorized(url: string, init: RequestInit = {}, tokenOptions: { forceRefresh?: boolean } = {}) {
    const headers = await this.authorizationHeaders(tokenOptions);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    return this.fetchImpl(url, { ...init, headers });
  }

  async listFiles(options: { query: string; fields?: string; pageSize?: number }): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken: string | undefined;
    const pageSize = Math.min(Math.max(options.pageSize ?? 1000, 1), 1000);
    do {
      const params = new URLSearchParams({
        q: options.query,
        pageSize: String(pageSize),
        fields: `nextPageToken,files(${options.fields ?? 'id,name,mimeType,parents,createdTime,modifiedTime,appProperties'})`,
      });
      if (pageToken) params.set('pageToken', pageToken);
      const data = await this.requestJson<{ files?: DriveFile[]; nextPageToken?: string }>(`${this.driveBaseUrl}/files?${params.toString()}`);
      files.push(...(data.files ?? []));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return files;
  }

  async findFile(options: { name: string; parentId: string; mimeType?: string }): Promise<DriveFile | null> {
    let query = `'${escapeQueryLiteral(options.parentId)}' in parents and name = '${escapeQueryLiteral(options.name)}' and trashed = false`;
    if (options.mimeType) query += ` and mimeType = '${escapeQueryLiteral(options.mimeType)}'`;
    return (await this.listFiles({ query }))[0] ?? null;
  }

  async findFileByAppProperty(options: { key: string; value: string; parentId: string; mimeType?: string }): Promise<DriveFile | null> {
    return (await this.findFilesByAppProperty(options))[0] ?? null;
  }

  async findFilesByAppProperty(options: { key: string; value: string; parentId?: string; mimeType?: string }): Promise<DriveFile[]> {
    let query = `appProperties has { key='${escapeQueryLiteral(options.key)}' and value='${escapeQueryLiteral(options.value)}' } and trashed = false`;
    if (options.parentId) query = `'${escapeQueryLiteral(options.parentId)}' in parents and ${query}`;
    if (options.mimeType) query += ` and mimeType = '${escapeQueryLiteral(options.mimeType)}'`;
    return this.listFiles({ query });
  }

  async createFolder(name: string, parentId = 'root', appProperties?: Record<string, string>): Promise<DriveFile> {
    return this.requestJson<DriveFile>(`${this.driveBaseUrl}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId], ...(appProperties ? { appProperties } : {}) }),
    });
  }

  async ensureFolderPath(folderPath: readonly string[]): Promise<string> {
    let parentId = 'root';
    for (const name of folderPath) {
      if (!name.trim()) throw new Error('Google Drive 資料夾名稱不可為空白');
      const existing = await this.findFile({ name, parentId, mimeType: FOLDER_MIME });
      parentId = (existing ?? await this.createFolder(name, parentId)).id;
    }
    return parentId;
  }

  async uploadFile(options: { fileId?: string; parentId?: string; name: string; mimeType: string; body: DriveBody; appProperties?: Record<string, string> }): Promise<DriveFile> {
    if (!options.fileId && !options.parentId) throw new Error('建立 Google Drive 檔案需要 parentId');
    const bytes = await toBytes(options.body);
    const boundary = `drive-backup-${Math.random().toString(16).slice(2)}`;
    const delimiter = `\r\n--${boundary}\r\n`;
    const encoder = new TextEncoder();
    const prefix = encoder.encode(`${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({
      name: options.name,
      mimeType: options.mimeType,
      ...(options.fileId ? {} : { parents: [options.parentId] }),
      ...(options.appProperties ? { appProperties: options.appProperties } : {}),
    })}${delimiter}Content-Type: ${options.mimeType}\r\n\r\n`);
    const suffix = encoder.encode(`\r\n--${boundary}--`);
    const requestBody = new Uint8Array(prefix.length + bytes.length + suffix.length);
    requestBody.set(prefix, 0); requestBody.set(bytes, prefix.length); requestBody.set(suffix, prefix.length + bytes.length);
    const filePath = options.fileId ? `/files/${encodeURIComponent(options.fileId)}` : '/files';
    const url = `${this.uploadBaseUrl}${filePath}?uploadType=multipart&fields=id,name,mimeType,parents,createdTime,modifiedTime,appProperties`;
    return this.requestJson<DriveFile>(url, {
      method: options.fileId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: requestBody,
    });
  }

  async moveFile(fileId: string, parentId: string, previousParentId?: string): Promise<DriveFile> {
    const params = new URLSearchParams({ fields: 'id,name,mimeType,parents,createdTime,modifiedTime,appProperties', addParents: parentId });
    if (previousParentId && previousParentId !== parentId) params.set('removeParents', previousParentId);
    return this.requestJson<DriveFile>(`${this.driveBaseUrl}/files/${encodeURIComponent(fileId)}?${params.toString()}`, { method: 'PATCH' });
  }

  async updateFileMetadata(fileId: string, metadata: { name?: string; appProperties?: Record<string, string> }): Promise<DriveFile> {
    return this.requestJson<DriveFile>(`${this.driveBaseUrl}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,parents,createdTime,modifiedTime,appProperties`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
    });
  }

  async trashFile(fileId: string): Promise<void> {
    await this.requestJson<void>(`${this.driveBaseUrl}/files/${encodeURIComponent(fileId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
  }

  downloadBlob(fileId: string): Promise<Blob> {
    return this.requestBlob(`${this.driveBaseUrl}/files/${encodeURIComponent(fileId)}?alt=media`);
  }
}

export { FOLDER_MIME };
