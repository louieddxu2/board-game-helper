const SHELL_CACHE = 'wrong-rules-shell-__BUILD_ID__';
const PUBLIC_CACHE = 'wrong-rules-public-v6';
const BUILD_ASSETS = /* BUILD_ASSETS */ [];
const INDEX_SHA256 = '__INDEX_SHA256__';
const SHELL = ['/', '/standalone-mode.js', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png', ...BUILD_ASSETS];
const SHELL_PREFIX = 'wrong-rules-shell-';
// Which shell each open tab runs, kept in a cache so it survives worker restarts and updates.
const CLIENT_SHELLS = 'wrong-rules-client-shells';
const CLIENT_SHELL_PATH = '/__client-shell/';

const shellCacheNames = async () => (await caches.keys()).filter((key) => key.startsWith(SHELL_PREFIX));

// A tab still running a previous build loads its lazy chunks from that build's shell.
const matchAnyShell = async (request) => {
  const older = (await shellCacheNames()).filter((name) => name !== SHELL_CACHE);
  for (const name of [SHELL_CACHE, ...older]) {
    const cached = await (await caches.open(name)).match(request);
    if (cached) return cached;
  }
  return undefined;
};

const recordClientShell = async (clientId, entry) => {
  let owner = '';
  for (const name of await shellCacheNames()) {
    if (!await (await caches.open(name)).match(entry)) continue;
    owner = name;
    if (name === SHELL_CACHE) break;
  }
  await (await caches.open(CLIENT_SHELLS)).put(CLIENT_SHELL_PATH + encodeURIComponent(clientId), new Response(owner));
};

// Deletes each previous shell once no open tab runs it; a tab that has not reported its build keeps them all.
const pruneShells = async () => {
  const registry = await caches.open(CLIENT_SHELLS);
  const open = new Set((await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).map((client) => client.id));
  const reported = new Set();
  const inUse = new Set([SHELL_CACHE]);
  for (const key of await registry.keys()) {
    const id = decodeURIComponent(new URL(key.url, self.location.origin).pathname.slice(CLIENT_SHELL_PATH.length));
    if (!open.has(id)) {
      await registry.delete(key);
      continue;
    }
    reported.add(id);
    inUse.add(await (await registry.match(key)).text());
  }
  if ([...open].some((id) => !reported.has(id))) return;
  await Promise.all((await shellCacheNames()).filter((name) => !inUse.has(name)).map((name) => caches.delete(name)));
};

const expectedAssetType = (url) => {
  if (url.pathname.endsWith('.js')) return 'javascript';
  if (url.pathname.endsWith('.css')) return 'text/css';
  return '';
};

const isValidAsset = (response, expectedType) =>
  response?.ok && (response.headers.get('content-type') || '').toLowerCase().includes(expectedType);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // Validate before publishing: SPA fallback HTML must never be cached as a JS chunk.
    const responses = await Promise.all(SHELL.map(async (path) => {
      const response = await fetch(new Request(new URL(path, self.location.origin), { cache: 'reload' }));
      const expectedType = expectedAssetType(new URL(path, self.location.origin));
      if (!response.ok || (expectedType && !isValidAsset(response, expectedType))) throw new Error(`Cannot cache ${path}`);
      // Consume each body immediately: install-time fetches have a small concurrency
      // limit, so holding every response open until Promise.all can stall the queue.
      const body = await response.arrayBuffer();
      if (path === '/' && /^[a-f0-9]{64}$/.test(INDEX_SHA256)) {
        const digest = await crypto.subtle.digest('SHA-256', body);
        const actual = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
        if (actual !== INDEX_SHA256) throw new Error('Shell changed during install; retry with the matching build');
      }
      const headers = new Headers(response.headers);
      headers.delete('content-encoding');
      headers.delete('content-length');
      return [path, new Response(body, { status: response.status, headers })];
    }));
    await Promise.all(responses.map(([path, response]) => cache.put(path, response)));
    // The next page load gets this build; open tabs keep running theirs from its retained shell.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    await pruneShells();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'shell-in-use' || typeof event.data.entry !== 'string' || !event.source?.id) return;
  event.waitUntil(recordClientShell(event.source.id, event.data.entry).then(pruneShells));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/home')) {
    event.respondWith(caches.open(PUBLIC_CACHE).then(async (cache) =>
      fetch(request).then((response) => {
        if (response.ok) void cache.put(request, response.clone());
        return response;
      }).catch(() => cache.match(request).then((cached) => {
        if (!cached) return Response.error();
        const headers = new Headers(cached.headers);
        headers.set('X-Offline-Fallback', '1');
        return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
      }))));
    return;
  }

  if (/^\/api\/games\/[^/]+$/.test(url.pathname)) {
    event.respondWith(fetch(request).then(async (response) => {
      if (response.ok) void (await caches.open(PUBLIC_CACHE)).put(request, response.clone());
      return response;
    }).catch(async () => {
      const cached = await caches.match(request);
      if (!cached) return Response.error();
      const headers = new Headers(cached.headers);
      headers.set('X-Offline-Fallback', '1');
      return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
    }));
    return;
  }

  if (url.pathname.startsWith('/assets/') || SHELL.includes(url.pathname) && url.pathname !== '/') {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const expectedType = expectedAssetType(url);
      const cached = await matchAnyShell(request);
      if (cached?.ok && (!expectedType || isValidAsset(cached, expectedType))) return cached;
      if (cached) await cache.delete(request);

      const response = await fetch(request);
      if (response.ok && (!expectedType || isValidAsset(response, expectedType))) {
        await cache.put(request, response.clone());
        return response;
      }

      // Never substitute a different module for a missing hashed chunk.
      return response;
    })());
    return;
  }

  if (request.mode === 'navigate' && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/pwa-reset')) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match('/');
      if (cached) return cached;
      return fetch(request);
    })());
  }
});
