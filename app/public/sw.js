const CACHE_VERSION = 'uct-shell-v1';
const SHELL_ASSETS = [
  '/',
  '/dashboard',
  '/index.html',
];

// Install: pre-cache app shell
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

// Activate: purge old cache versions
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_VERSION)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Fetch strategy
self.addEventListener('fetch', (e) => {
  const { request } = e;
  const url = new URL(request.url);

  // Skip non-GET
  if (request.method !== 'GET') return;

  // API calls: network-first, no cache fallback (stale API data is worse than offline)
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(request).catch(() =>
        new Response(JSON.stringify({ error: 'offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
      )
    );
    return;
  }

  // Static assets (JS, CSS, fonts, images, SVG): cache-first
  if (/\.(js|css|woff2?|ttf|eot|png|jpe?g|gif|svg|ico|webp)(\?.*)?$/.test(url.pathname)) {
    e.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(request, clone));
            return res;
          })
      ).catch(() =>
        new Response('', { status: 503, statusText: 'Offline' })
      )
    );
    return;
  }

  // Navigation / HTML: network-first, fall back to cached shell
  e.respondWith(
    fetch(request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE_VERSION).then((c) => c.put(request, clone));
        return res;
      })
      .catch(() =>
        caches.match(request).then(
          (cached) =>
            cached ||
            caches.match('/index.html').then(
              (shell) =>
                shell ||
                new Response(
                  '<!DOCTYPE html><html><body style="background:#0e0f0d;color:#ccc;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2>UCT Intelligence</h2><p>You appear to be offline.</p><p style="opacity:.5">Reconnect and refresh to continue.</p></div></body></html>',
                  { headers: { 'Content-Type': 'text/html' } }
                )
            )
        )
      )
  );
});
