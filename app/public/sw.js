// Service Worker — KILL SWITCH (2026-04-26)
//
// The previous SW used cache-first for all static assets, which meant browsers
// served stale JS/CSS bundles indefinitely after Railway redeploys — making
// "fresh" code invisible to existing users until they manually cleared site
// data. This version installs, immediately deletes every cache the old SW
// created, unregisters itself, and reloads any open clients to force a clean
// network refetch.
//
// After this rolls out, browsers fall back to their normal HTTP cache, which
// honors Cache-Control headers from the server (already set correctly).

self.addEventListener('install', () => {
  // Take control as soon as install completes — don't wait for tabs to close.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 1. Delete every cache entry the old SW created.
    try {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    } catch (_) { /* best-effort */ }

    // 2. Unregister this service worker so the browser stops calling it.
    try {
      await self.registration.unregister()
    } catch (_) { /* best-effort */ }

    // 3. Reload every open tab so it pulls fresh HTML + assets from the network.
    try {
      const clients = await self.clients.matchAll({ type: 'window' })
      for (const client of clients) {
        try { client.navigate(client.url) } catch (_) { /* navigate may be blocked; ignore */ }
      }
    } catch (_) { /* best-effort */ }
  })())
})

// Intentionally NO fetch handler. Without one, requests bypass the SW
// completely and go straight to the browser's HTTP cache + network, which
// is exactly what we want post-uninstall.
