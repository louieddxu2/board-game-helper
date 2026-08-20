export type DriveBody = string | Blob | ArrayBuffer | ArrayBufferView;

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface AccessTokenProvider {
  getAccessToken(options?: { prompt?: string; forceRefresh?: boolean }): Promise<string>;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
  parents?: string[];
  createdTime?: string;
  modifiedTime?: string;
  appProperties?: Record<string, string>;
}

export interface GoogleDriveApiOptions {
  tokenProvider: AccessTokenProvider;
  fetchImpl?: FetchLike;
  driveBaseUrl?: string;
  uploadBaseUrl?: string;
}

export interface SingleFileBackupOptions {
  tokenProvider: AccessTokenProvider;
  folderPath: readonly string[];
  backupKey: string;
  fileName: string;
  mimeType: string;
  appProperties?: Record<string, string>;
  fetchImpl?: FetchLike;
  driveBaseUrl?: string;
  uploadBaseUrl?: string;
}

export interface BackupMetadata {
  sourceUpdatedAt?: number | string;
  appProperties?: Record<string, string>;
}

export interface BackupReceipt {
  file: DriveFile;
  backupKey: string;
  parentId: string;
  sourceUpdatedAt?: number | string;
}

export interface GoogleIdentityTokenProviderOptions {
  clientId: string;
  scopes?: string;
  scriptUrl?: string;
  scriptId?: string;
  scriptTimeoutMs?: number;
  windowRef?: GoogleIdentityWindow;
  documentRef?: GoogleIdentityDocument;
}

export interface GoogleIdentityWindow {
  localStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  google?: {
    accounts?: {
      oauth2?: {
        initTokenClient(options: {
          client_id: string;
          scope: string;
          callback: (response: GoogleTokenResponse) => void;
        }): GoogleTokenClient;
        revoke(token: string, callback: () => void): void;
      };
    };
  };
}

export interface GoogleIdentityDocument {
  body: { appendChild(node: unknown): void };
  getElementById(id: string): GoogleIdentityScript | null;
  createElement(tagName: string): GoogleIdentityScript;
}

export interface GoogleIdentityScript {
  id: string;
  src: string;
  async: boolean;
  defer: boolean;
  onload: (() => void) | null;
  onerror: (() => void) | null;
}

export interface GoogleTokenClient {
  callback: (response: GoogleTokenResponse) => void;
  requestAccessToken(options: { prompt: string }): void;
}

export interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}
