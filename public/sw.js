const SHELL_CACHE = 'wrong-rules-shell-v5';
const PUBLIC_CACHE = 'wrong-rules-public-v5';
const SHELL = ['/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png'];

const expectedAssetType = (url) => {
  if (url.pathname.endsWith('.js')) return 'javascript';
  if (url.pathname.endsWith('.css')) return 'text/css';
  return '';
};

const isValidAsset = (response, expectedType) =>
  response?.ok && (response.headers.get('content-type') || '').toLowerCase().includes(expectedType);

const recoverCurrentAsset = async (request, expectedType) => {
  const indexResponse = await fetch('/', { cache: 'no-store' });
  if (!indexResponse.ok) return undefined;
  const html = await indexResponse.text();
  const extension = expectedType === 'javascript' ? 'js' : 'css';
  const match = html.match(new RegExp(`(?:src|href)=["']([^"']+\\.${extension})["']`));
  if (!match) return undefined;
  const currentUrl = new URL(match[1], self.location.origin);
  const response = await fetch(currentUrl, { cache: 'no-store' });
  return isValidAsset(response, expectedType) ? response : undefined;
};

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL);
    const indexResponse = await fetch('/', { cache: 'reload' });
    if (indexResponse.ok) await cache.put('/', indexResponse);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => ![SHELL_CACHE, PUBLIC_CACHE].includes(key))
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
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

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const expectedType = expectedAssetType(url);
      const cached = await cache.match(request);
      if (isValidAsset(cached, expectedType)) return cached;
      if (cached) await cache.delete(request);

      const response = await fetch(request);
      if (isValidAsset(response, expectedType)) {
        await cache.put(request, response.clone());
        return response;
      }

      const recovered = await recoverCurrentAsset(request, expectedType);
      if (recovered) {
        await cache.put(request, recovered.clone());
        return recovered;
      }
      return response;
    })());
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: 'no-store' });
        if (response.ok) void (await caches.open(SHELL_CACHE)).put('/', response.clone());
        return response;
      } catch {
        return (await caches.match('/')) || Response.error();
      }
    })());
  }
});
