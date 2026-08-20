import { describe, expect, it, vi } from 'vitest';
import { importWorkspaceBackupManifestXlsx, importWorkspaceXlsx } from '../spreadsheet';
import { BackupNotFoundError, createGoogleDriveFolderBackup, createGoogleDriveSingleFileBackup, createGoogleIdentityTokenProvider, GoogleDriveApi } from './index';
import { createNode, createTable } from '../model';
import type { WorkspaceData } from '../types';

const jsonResponse = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const blobFromBytes = (bytes?: Uint8Array) => new Blob([bytes ? bytes.slice().buffer as ArrayBuffer : new ArrayBuffer(0)]);

const createBackup = (fetchImpl: typeof fetch, folderPath: readonly string[] = ['Test App', 'Backups']) => createGoogleDriveSingleFileBackup({
  tokenProvider: { getAccessToken: vi.fn(async () => 'test-token') },
  folderPath,
  backupKey: 'main-workspace',
  fileName: 'workspace.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  fetchImpl,
});

describe('Google Drive single-file backup boundary', () => {
  it('creates one folder path and uploads the first workbook', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ files: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'folder-app', name: 'Test App', mimeType: 'application/vnd.google-apps.folder' }))
      .mockResolvedValueOnce(jsonResponse({ files: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'folder-backups', name: 'Backups', mimeType: 'application/vnd.google-apps.folder' }))
      .mockResolvedValueOnce(jsonResponse({ files: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'file-1', name: 'workspace.xlsx', appProperties: { backupKey: 'main-workspace' } }));

    const receipt = await createBackup(fetchImpl as typeof fetch).backup('xlsx', { sourceUpdatedAt: 123 });
    expect(receipt.file.id).toBe('file-1');
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    const upload = fetchImpl.mock.calls[5];
    expect(upload[1]?.method).toBe('POST');
    expect(new Headers(upload[1]?.headers).get('content-type')).toContain('multipart/related');
    expect(upload[1]?.body).toBeInstanceOf(Uint8Array);
  });

  it('updates the tagged workbook instead of creating a duplicate', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ files: [{ id: 'file-1', name: 'old.xlsx', appProperties: { backupKey: 'main-workspace' } }] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'file-1', name: 'workspace.xlsx' }));
    const backup = createBackup(fetchImpl as typeof fetch, []);
    await backup.backup('first');
    fetchImpl.mockReset()
      .mockResolvedValueOnce(jsonResponse({ files: [{ id: 'file-1', name: 'old.xlsx', appProperties: { backupKey: 'main-workspace' } }] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'file-1', name: 'workspace.xlsx' }));

    await backup.backup('second');
    expect(fetchImpl.mock.calls[1][1]?.method).toBe('PATCH');
    expect(String(fetchImpl.mock.calls[1][0])).toContain('/files/file-1');
  });

  it('restores a tagged workbook as a Blob', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ files: [{ id: 'file-1', name: 'workspace.xlsx', appProperties: { backupKey: 'main-workspace' } }] }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
    const restored = await createBackup(fetchImpl as typeof fetch, []).restore();
    expect(restored).toBeInstanceOf(Blob);
    expect(String(fetchImpl.mock.calls[1][0])).toContain('alt=media');
  });

  it('reports a missing backup without changing local state', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({ files: [] }));
    await expect(createBackup(fetchImpl as typeof fetch, []).restore()).rejects.toBeInstanceOf(BackupNotFoundError);
  });
});

describe('Google Drive folder backup boundary', () => {
  it('stores a manifest and each table below the matching local folder', async () => {
    const files = new Map<string, { id: string; name: string; mimeType: string; parents: string[]; appProperties?: Record<string, string>; body?: Uint8Array }>();
    let nextId = 1;
    const indexOfBytes = (source: Uint8Array, needle: Uint8Array, from = 0) => {
      outer: for (let index = from; index <= source.length - needle.length; index += 1) {
        for (let offset = 0; offset < needle.length; offset += 1) if (source[index + offset] !== needle[offset]) continue outer;
        return index;
      }
      return -1;
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('alt=media')) {
        const id = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
        return { ok: true, status: 200, blob: async () => blobFromBytes(files.get(id)?.body) } as unknown as Response;
      }
      if (url.includes('/upload/drive/v3/files')) {
        const requestBody = init?.body as Uint8Array;
        const text = new TextDecoder().decode(requestBody);
        const metadataMatch = text.match(/Content-Type: application\/json; charset=UTF-8\r\n\r\n(\{[\s\S]*?\})\r\n--/);
        const metadata = JSON.parse(metadataMatch?.[1] ?? '{}') as { id?: string; name: string; mimeType: string; parents?: string[]; appProperties?: Record<string, string> };
        const boundary = new Headers(init?.headers).get('content-type')?.match(/boundary=([^;]+)/)?.[1] ?? '';
        const encoder = new TextEncoder();
        const bodyHeader = encoder.encode(`Content-Type: ${metadata.mimeType}\r\n\r\n`);
        const bodyStart = indexOfBytes(requestBody, bodyHeader);
        const bodyDelimiter = encoder.encode(`\r\n--${boundary}`);
        const bodyEnd = bodyStart < 0 ? -1 : indexOfBytes(requestBody, bodyDelimiter, bodyStart + bodyHeader.length);
        const bodyMatch = bodyStart < 0 || bodyEnd < 0 ? undefined : requestBody.slice(bodyStart + bodyHeader.length, bodyEnd);
        const idMatch = new URL(url).pathname.match(/\/files\/([^/]+)$/);
        const id = idMatch ? decodeURIComponent(idMatch[1]) : `file-${nextId++}`;
        files.set(id, { id, name: metadata.name, mimeType: metadata.mimeType, parents: metadata.parents ?? files.get(id)?.parents ?? [], appProperties: metadata.appProperties, body: bodyMatch });
        return jsonResponse(files.get(id));
      }
      if (url.endsWith('/files') && method === 'POST') {
        const value = JSON.parse(String(init?.body ?? '{}')) as { name: string; mimeType: string; parents?: string[]; appProperties?: Record<string, string> };
        const id = `folder-${nextId++}`;
        files.set(id, { id, name: value.name, mimeType: value.mimeType, parents: value.parents ?? [], appProperties: value.appProperties });
        return jsonResponse(files.get(id));
      }
      if (url.includes('/drive/v3/files/') && method === 'PATCH') {
        const id = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
        const file = files.get(id);
        if (!file) return jsonResponse({ error: { message: 'missing file' } }, 404);
        const body = JSON.parse(String(init?.body ?? '{}')) as { name?: string; appProperties?: Record<string, string>; trashed?: boolean };
        const params = new URL(url).searchParams;
        if (body.name !== undefined) file.name = body.name;
        if (body.appProperties) file.appProperties = body.appProperties;
        if (body.trashed !== undefined) file.appProperties = { ...file.appProperties, trashed: String(body.trashed) };
        const addParent = params.get('addParents');
        const removeParent = params.get('removeParents');
        if (removeParent) file.parents = file.parents.filter((parent) => parent !== removeParent);
        if (addParent && !file.parents.includes(addParent)) file.parents.push(addParent);
        return jsonResponse(file);
      }
      if (url.includes('/files?')) {
        const query = decodeURIComponent(new URL(url).searchParams.get('q') ?? '');
        const property = query.match(/key='([^']+)' and value='([^']+)'/);
        const name = query.match(/name = '([^']+)'/);
        const parent = query.match(/'([^']+)' in parents/);
        const found = [...files.values()].filter((file) => (!property || file.appProperties?.[property[1]] === property[2]) && (!name || file.name === name[1]) && (!parent || file.parents.includes(parent[1])));
        return jsonResponse({ files: found });
      }
      throw new Error(`Unexpected Drive request: ${method} ${url}`);
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const table = createTable('收藏表');
    const folder = createNode('folder', '桌遊', null, 0);
    const tableNode = createNode('table', table.name, folder.id, 0, table.id);
    const data: WorkspaceData = { version: 1, nodes: [folder, tableNode], tables: [table], activeNodeId: tableNode.id };
    const backup = createGoogleDriveFolderBackup({ tokenProvider: { getAccessToken: vi.fn(async () => 'token') }, folderPath: ['App', 'Backups'], backupKey: 'workspace-v2', fetchImpl });

    const receipt = await backup.backup(data, { sourceUpdatedAt: 42 });
    expect(receipt.manifest.folders).toHaveLength(1);
    expect(receipt.manifest.tables).toHaveLength(1);
    expect(receipt.file.name).toBe('manifest.xlsx');
    expect(receipt.file.mimeType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const manifest = await importWorkspaceBackupManifestXlsx(blobFromBytes(files.get(receipt.file.id)?.body));
    expect(manifest.nodes).toEqual(data.nodes);
    expect(manifest.folders[0].driveFolderId).toBe(receipt.manifest.folders[0].driveFolderId);
    expect(manifest.tables[0].driveFileId).toBe(receipt.manifest.tables[0].driveFileId);
    const tableFile = [...files.values()].find((file) => file.appProperties?.backupKind === 'table');
    expect(tableFile?.parents).toContain(receipt.manifest.folders[0].driveFolderId);
    expect(tableFile?.name).toBe('收藏表.xlsx');
    const importedTable = await importWorkspaceXlsx(blobFromBytes(tableFile?.body), { preserveIds: true });
    expect(importedTable.table?.id).toBe(table.id);
    expect(importedTable.table?.name).toBe(table.name);

    const restored = await backup.restore();
    expect(restored.nodes).toEqual(data.nodes);
    expect(restored.tables[0].name).toBe('收藏表');

    const uploadCount = fetchMock.mock.calls.filter(([input]) => String(input).includes('/upload/drive/v3/files')).length;
    await backup.backup(data, { sourceUpdatedAt: 42 });
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/upload/drive/v3/files')).length).toBe(uploadCount);

    const renamedData: WorkspaceData = { ...data, nodes: data.nodes.map((node) => node.type === 'folder' ? { ...node, name: '桌遊收藏' } : node), updatedAt: 43 };
    await backup.backup(renamedData, { sourceUpdatedAt: 43 });
    expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/upload/drive/v3/files')).length).toBe(uploadCount + 1);
    expect(files.get(receipt.manifest.folders[0].driveFolderId)?.name).toBe('桌遊收藏');
  });
});

describe('Google Identity token provider', () => {
  it('keeps the access token in memory and revokes it on sign out', async () => {
    const revoke = vi.fn((_token: string, done: () => void) => done());
    const tokenClient = {
      callback: (_response: { access_token?: string; expires_in?: number }): void => {},
      requestAccessToken: vi.fn(() => tokenClient.callback({ access_token: 'token-1', expires_in: 3600 })),
    };
    const windowRef = { google: { accounts: { oauth2: {
      initTokenClient: vi.fn((options: { callback: typeof tokenClient.callback }) => { tokenClient.callback = options.callback; return tokenClient; }),
      revoke,
    } } } } as unknown as import('./types').GoogleIdentityWindow;
    const documentRef = { body: { appendChild: vi.fn() }, getElementById: vi.fn(() => null), createElement: vi.fn() };
    const provider = createGoogleIdentityTokenProvider({ clientId: 'public-client-id', windowRef, documentRef });

    expect(await provider.getAccessToken()).toBe('token-1');
    expect(await provider.getAccessToken()).toBe('token-1');
    expect(tokenClient.requestAccessToken).toHaveBeenCalledTimes(1);
    expect(await provider.getAccessToken({ forceRefresh: true })).toBe('token-1');
    expect(tokenClient.requestAccessToken).toHaveBeenCalledTimes(2);
    await provider.signOut();
    expect(revoke).toHaveBeenCalledWith('token-1', expect.any(Function));
    expect(provider.isAuthorized).toBe(false);
    await expect(provider.getAccessToken()).rejects.toThrow('主動斷線');
    await expect(provider.signIn({ prompt: 'consent' })).resolves.toBe('token-1');
  });
});

describe('Google Drive API token recovery', () => {
  it('silently refreshes once after an expired access token response', async () => {
    const getAccessToken = vi.fn()
      .mockResolvedValueOnce('expired-token')
      .mockResolvedValueOnce('fresh-token');
    const api = new GoogleDriveApi({
      tokenProvider: { getAccessToken },
      fetchImpl: vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'expired' } }), { status: 401 }))
        .mockResolvedValueOnce(jsonResponse({ files: [] })),
    });

    await expect(api.listFiles({ query: 'trashed = false' })).resolves.toEqual([]);
    expect(getAccessToken).toHaveBeenNthCalledWith(1, {});
    expect(getAccessToken).toHaveBeenNthCalledWith(2, { forceRefresh: true });
  });
});
