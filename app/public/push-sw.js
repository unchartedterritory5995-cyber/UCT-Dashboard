// push-sw.js — BRK-04 Web Push worker. PUSH + NOTIFICATIONCLICK ONLY.
//
// ⛔⛔ THIS IS NOT A CACHING SERVICE WORKER AND MUST NEVER BECOME ONE.
// The app ships no caching worker by charter: a cache-first worker serves a
// stale bundle straight through a revert (CLAUDE.md, "THERE IS NO SERVICE
// WORKER"). `/sw.js` is a self-uninstalling kill switch for the legacy one and
// this file never touches it.
//   • registered with scope `/push/` — a path no page lives under, so it
//     controls no page even in principle;
//   • NO fetch listener, NO Cache Storage. A rail
//     (app/src/utils/webPush.test.js) reads this file with comments stripped
//     and fails on either.
//
// The payload is the JSON `api/services/web_push.build_payload` encrypts:
// { title, body, url, tag? }. `url` is always a same-origin path.

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch (_) { data = {} }
  const title = typeof data.title === 'string' && data.title ? data.title : 'UCT alert'
  const options = {
    body: typeof data.body === 'string' ? data.body : '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//') ? data.url : '/' },
  }
  if (typeof data.tag === 'string' && data.tag) {
    options.tag = data.tag
    options.renotify = true
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const path = (event.notification.data && event.notification.data.url) || '/'
  const target = new URL(path, self.location.origin).href
  // Always a fresh window: this worker controls no page (scope /push/), and
  // WindowClient.navigate() refuses a client its worker does not control.
  event.waitUntil(self.clients.openWindow(target))
})
