const CACHE_STATIC  = 'ft-static-v4';   // app shell — versioned, replace on update
const CACHE_RUNTIME = 'ft-runtime-v1';  // CDN libs — long-lived, stale-while-revalidate

const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-152.png',
  './icon-167.png',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];

const CDN_URLS = [
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'
];

// ── INSTALL: cache app shell + pre-warm CDN libs
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    // Cache static assets
    const staticCache = await caches.open(CACHE_STATIC);
    await Promise.allSettled(
      STATIC_ASSETS.map(url => staticCache.add(url).catch(err =>
        console.warn('[SW] Static cache miss:', url, err.message)
      ))
    );
    // Pre-warm CDN libs into runtime cache
    const runtimeCache = await caches.open(CACHE_RUNTIME);
    await Promise.allSettled(
      CDN_URLS.map(url => runtimeCache.add(url).catch(err =>
        console.warn('[SW] CDN pre-warm miss:', url, err.message)
      ))
    );
    await self.skipWaiting();
  })());
});

// ── ACTIVATE: remove old static caches (keep runtime cache intact)
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k.startsWith('ft-static-') && k !== CACHE_STATIC)
        .map(k => { console.log('[SW] Removing old cache:', k); return caches.delete(k); })
    );
    await self.clients.claim();
  })());
});

// ── FETCH: tiered strategy
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;

  // CDN libraries → Cache-first, background revalidate
  if (CDN_URLS.some(u => url.includes(new URL(u).pathname))) {
    e.respondWith((async () => {
      const cached = await caches.match(e.request);
      const fetchPromise = fetch(e.request).then(resp => {
        if (resp && resp.status === 200) {
          caches.open(CACHE_RUNTIME).then(c => c.put(e.request, resp.clone()));
        }
        return resp;
      }).catch(() => null);
      return cached || await fetchPromise || new Response('Library offline', {status: 503});
    })());
    return;
  }

  // HTML documents → Network-first (always fresh)
  if (e.request.destination === 'document') {
    e.respondWith((async () => {
      try {
        const resp = await fetch(e.request);
        const cache = await caches.open(CACHE_STATIC);
        cache.put(e.request, resp.clone());
        return resp;
      } catch {
        return caches.match(e.request) || new Response('Offline', {status: 503});
      }
    })());
    return;
  }

  // Everything else → Cache-first
  e.respondWith((async () => {
    const cached = await caches.match(e.request);
    if (cached) return cached;
    try {
      const resp = await fetch(e.request);
      if (resp && resp.status === 200) {
        const cache = await caches.open(CACHE_STATIC);
        cache.put(e.request, resp.clone());
      }
      return resp;
    } catch {
      return new Response('Offline', {status: 503});
    }
  })());
});
