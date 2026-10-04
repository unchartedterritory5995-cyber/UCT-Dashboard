// BRK-04 — Web Push on this device. The browser half of api/services/web_push.py.
//
// ⛔ PERMISSION IS ASKED ONLY FROM `enablePush`, which only the Settings toggle
// calls, on the member's click. Nothing here runs on load.
//
// ⛔ The worker is `/push-sw.js` at scope `/push/` — never `/sw.js`, which is
// the self-uninstalling kill switch for the legacy caching worker.

export const PUSH_SW_URL = '/push-sw.js'
export const PUSH_SW_SCOPE = '/push/'

/** Is this registration the push worker (and therefore NOT the legacy caching one)? */
export function isPushRegistration(reg) {
  if (!reg) return false
  try {
    if (new URL(reg.scope).pathname === PUSH_SW_SCOPE) return true
  } catch { /* fall through to the script check */ }
  return [reg.active, reg.waiting, reg.installing]
    .some(w => w && typeof w.scriptURL === 'string' && w.scriptURL.endsWith(PUSH_SW_URL))
}

/**
 * The registrations main.jsx's kill switch is for: every one EXCEPT the push
 * worker. Without this filter, one push registration would make every page
 * load re-register `/sw.js` (the kill switch), forever.
 */
export function legacyRegistrations(regs) {
  return (regs || []).filter(r => !isPushRegistration(r))
}

/**
 * What this browser can do, with the reason when it cannot. Web Push needs a
 * secure context (the repo's recorded lesson: check `isSecureContext`, never
 * infer it), a service worker, the Push API and the Notification API.
 */
export function pushSupport(win = globalThis) {
  if (!win || win.isSecureContext !== true) return { ok: false, reason: 'insecure' }
  const nav = win.navigator
  if (!nav || !('serviceWorker' in nav)) return { ok: false, reason: 'no-service-worker' }
  if (!('PushManager' in win)) return { ok: false, reason: 'no-push' }
  if (!('Notification' in win)) return { ok: false, reason: 'no-notification' }
  return { ok: true, reason: null }
}

export function urlBase64ToUint8Array(b64) {
  const padded = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** GET /api/push/config → `{configured, public_key}`, or null when the channel is off/unavailable to this member. */
export async function fetchPushConfig(fetchImpl = fetch) {
  try {
    const r = await fetchImpl('/api/push/config', { credentials: 'same-origin' })
    if (!r.ok) return null
    const body = await r.json()
    return body && body.configured && body.public_key ? body : null
  } catch {
    return null
  }
}

async function pushRegistration(nav) {
  return nav.serviceWorker.getRegistration(PUSH_SW_SCOPE)
}

/** Is THIS device currently subscribed? */
export async function currentSubscription(win = globalThis) {
  if (!pushSupport(win).ok) return null
  try {
    const reg = await pushRegistration(win.navigator)
    if (!reg || !isPushRegistration(reg)) return null
    return await reg.pushManager.getSubscription()
  } catch {
    return null
  }
}

function waitForActive(reg) {
  if (reg.active) return Promise.resolve(reg)
  const w = reg.installing || reg.waiting
  if (!w) return Promise.resolve(reg)
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('service worker did not activate')), 15000)
    w.addEventListener('statechange', () => {
      if (w.state === 'activated') { clearTimeout(t); resolve(reg) }
      if (w.state === 'redundant') { clearTimeout(t); reject(new Error('service worker became redundant')) }
    })
  })
}

/**
 * The toggle's ON. Asks permission (this is the ONLY call site), registers the
 * push worker, subscribes, and stores the subscription server-side.
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function enablePush(publicKey, win = globalThis, fetchImpl = fetch) {
  const support = pushSupport(win)
  if (!support.ok) return { ok: false, reason: support.reason }
  const perm = await win.Notification.requestPermission()
  if (perm !== 'granted') return { ok: false, reason: perm === 'denied' ? 'denied' : 'dismissed' }
  try {
    const reg = await waitForActive(
      await win.navigator.serviceWorker.register(PUSH_SW_URL, { scope: PUSH_SW_SCOPE }))
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })
    }
    const r = await fetchImpl('/api/push/subscribe', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub.toJSON()),
    })
    if (!r.ok) {
      try { await sub.unsubscribe() } catch { /* best effort */ }
      return { ok: false, reason: 'server' }
    }
    return { ok: true }
  } catch {
    return { ok: false, reason: 'subscribe-failed' }
  }
}

/** The toggle's OFF: unsubscribe this device, tell the server, drop the worker. */
export async function disablePush(win = globalThis, fetchImpl = fetch) {
  try {
    const reg = await pushRegistration(win.navigator)
    const sub = reg && isPushRegistration(reg) ? await reg.pushManager.getSubscription() : null
    if (sub) {
      const endpoint = sub.endpoint
      try { await sub.unsubscribe() } catch { /* still tell the server */ }
      await fetchImpl('/api/push/unsubscribe', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      }).catch(() => {})
    }
    if (reg && isPushRegistration(reg)) await reg.unregister()
    return { ok: true }
  } catch {
    return { ok: false }
  }
}
