import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const ORIGIN = 'https://board-game-helper.test';
const SHELL_CACHE = 'wrong-rules-shell-__BUILD_ID__';
const PUBLIC_CACHE = 'wrong-rules-public-v6';
const workerSource = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');

type RequestLike = { url: string; method: string; mode?: string };

const requestPath = (request: string | URL | RequestLike) => {
  const value = typeof request === 'string' ? request : 'url' in request ? request.url : request.toString();
  return new URL(value, ORIGIN).pathname + new URL(value, ORIGIN).search;
};

class FakeCache {
  private readonly entries = new Map<string, Response>();

  async match(request: string | URL | RequestLike) {
    const response = this.entries.get(requestPath(request));
    return response?.clone();
  }

  async put(request: string | URL | RequestLike, response: Response) {
    this.entries.set(requestPath(request), response.clone());
  }

  async delete(request: string | URL | RequestLike) {
    return this.entries.delete(requestPath(request));
  }

  paths() {
    return [...this.entries.keys()];
  }
}

class FakeCaches {
  private readonly stores = new Map<string, FakeCache>();

  async open(name: string) {
    let cache = this.stores.get(name);
    if (!cache) {
      cache = new FakeCache();
      this.stores.set(name, cache);
    }
    return cache;
  }

  async match(request: string | URL | RequestLike) {
    for (const cache of this.stores.values()) {
      const response = await cache.match(request);
      if (response) return response;
    }
    return undefined;
  }

  async keys() {
    return [...this.stores.keys()];
  }

  async delete(name: string) {
    return this.stores.delete(name);
  }

  entries(name: string) {
    return this.stores.get(name)?.paths() ?? [];
  }
}

const responseForPath = (path: string, body = `body:${path}`) => {
  const contentType = path.endsWith('.js')
    ? 'text/javascript'
    : path.endsWith('.css')
      ? 'text/css'
      : path.endsWith('.svg')
        ? 'image/svg+xml'
        : path.endsWith('.png')
          ? 'image/png'
          : path.endsWith('.webmanifest')
            ? 'application/manifest+json'
            : 'text/html';
  return new Response(body, { headers: { 'content-type': contentType } });
};

const createWorker = (fetchImpl: (input: unknown) => Promise<Response>, source = workerSource) => {
  const caches = new FakeCaches();
  const listeners = new Map<string, (event: any) => void>();
  const skipWaiting = vi.fn();
  const fetchMock = vi.fn(fetchImpl);
  const context = {
    URL,
    Request,
    Response,
    Headers,
    fetch: fetchMock,
    caches,
    self: {
      location: { origin: ORIGIN },
      skipWaiting,
      clients: { claim: vi.fn() },
      addEventListener(type: string, handler: (event: any) => void) { listeners.set(type, handler); },
    },
    console,
    setTimeout,
    clearTimeout,
    crypto: webcrypto,
  };
  runInNewContext(source, context);

  const runFetch = (request: RequestLike) => {
    let responsePromise: Promise<Response> | undefined;
    listeners.get('fetch')?.({
      request,
      respondWith(value: Promise<Response> | Response) { responsePromise = Promise.resolve(value); },
    });
    return responsePromise;
  };

  const runInstall = () => {
    const waits: Promise<unknown>[] = [];
    listeners.get('install')?.({ waitUntil(value: Promise<unknown>) { waits.push(value); } });
    return Promise.all(waits);
  };

  return { caches, fetchMock, runFetch, runInstall, skipWaiting };
};

const request = (path: string, mode = 'same-origin'): RequestLike => ({ url: `${ORIGIN}${path}`, method: 'GET', mode });

describe('offline service worker shell', () => {
  it('fully consumes and caches every shell response before install completes', async () => {
    const worker = createWorker(async (input) => responseForPath(requestPath(input as RequestLike)));
    await worker.runInstall();
    expect(worker.caches.entries(SHELL_CACHE)).toContain('/');
    expect(worker.caches.entries(SHELL_CACHE)).toContain('/standalone-mode.js');
    expect(worker.caches.entries(SHELL_CACHE)).toHaveLength(6);
    expect(worker.skipWaiting).not.toHaveBeenCalled();
  });

  it('rejects an HTML document from a different deployment without publishing it', async () => {
    const worker = createWorker(async (input) => responseForPath(requestPath(input as RequestLike)), workerSource.replace('__INDEX_SHA256__', '0'.repeat(64)));
    await expect(worker.runInstall()).rejects.toThrow('Shell changed during install');
    expect(worker.caches.entries(SHELL_CACHE)).toEqual([]);
  });

  it('serves a cached shell immediately when a navigation network request never responds', async () => {
    const worker = createWorker(() => new Promise<Response>(() => undefined));
    const shell = await worker.caches.open(SHELL_CACHE);
    await shell.put('/', responseForPath('/', 'cached shell'));

    const response = worker.runFetch(request('/workspace', 'navigate'));
    expect(response).toBeDefined();
    expect(await (await response!).text()).toBe('cached shell');
    expect(worker.fetchMock).not.toHaveBeenCalled();
  });

  it('serves cached hashed JavaScript and standalone assets while offline', async () => {
    const worker = createWorker(() => Promise.reject(new Error('offline')));
    const shell = await worker.caches.open(SHELL_CACHE);
    await shell.put('/assets/app-abc123.js', responseForPath('/assets/app-abc123.js', 'cached module'));
    await shell.put('/standalone-mode.js', responseForPath('/standalone-mode.js', 'cached standalone'));

    const hashedAsset = worker.runFetch(request('/assets/app-abc123.js'));
    const standaloneAsset = worker.runFetch(request('/standalone-mode.js'));
    expect(await hashedAsset!.then((value) => value.text())).toBe('cached module');
    expect(await standaloneAsset!.then((value) => value.text())).toBe('cached standalone');
    expect(worker.fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing shell file', '/icons/icon.svg', new Response('missing', { status: 404 })],
    ['HTML returned for a JavaScript shell file', '/standalone-mode.js', new Response('<html>fallback</html>', { headers: { 'content-type': 'text/html' } })],
  ])('does not publish a shell when install receives %s', async (_label, invalidPath, invalidResponse) => {
    const worker = createWorker(async (input) => {
      const path = requestPath(input as RequestLike);
      if (path === invalidPath) return invalidResponse.clone();
      return responseForPath(path);
    });

    await expect(worker.runInstall()).rejects.toThrow('Cannot cache');
    expect(worker.caches.entries(SHELL_CACHE)).toEqual([]);
    expect(worker.skipWaiting).not.toHaveBeenCalled();
  });

  it('does not substitute another module when a hashed JavaScript asset is missing', async () => {
    const worker = createWorker(async () => new Response('missing', { status: 404, headers: { 'content-type': 'text/html' } }));

    const response = worker.runFetch(request('/assets/chunk-deadbeef.js'));
    expect(await response!.then((value) => value.status)).toBe(404);
    expect(worker.fetchMock).toHaveBeenCalledTimes(1);
    expect(requestPath(worker.fetchMock.mock.calls[0][0] as RequestLike)).toBe('/assets/chunk-deadbeef.js');
  });

  it('bypasses the shell for reset and API navigations', async () => {
    const worker = createWorker(async (input) => responseForPath(requestPath(input as RequestLike), 'api response'));
    const resetResponse = worker.runFetch(request('/pwa-reset', 'navigate'));
    expect(resetResponse).toBeUndefined();
    expect(worker.fetchMock).not.toHaveBeenCalled();

    const apiResponse = worker.runFetch(request('/api/home', 'navigate'));
    expect(await apiResponse!.then((value) => value.text())).toBe('api response');
    expect(worker.fetchMock).toHaveBeenCalledTimes(1);
    expect(requestPath(worker.fetchMock.mock.calls[0][0] as RequestLike)).toBe('/api/home');
  });
});
