// BRK-04 — the push worker's rails and the browser helpers.
//
// ⛔ THE RAIL THAT MATTERS MOST: app/public/push-sw.js must never become a
// caching service worker (CLAUDE.md: "THERE IS NO SERVICE WORKER" — a
// cache-first worker serves a stale bundle straight through a revert). It is
// read with COMMENTS AND STRINGS STRIPPED so its own warning prose can neither
// satisfy nor trip the hunt.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import {
  PUSH_SW_URL, PUSH_SW_SCOPE, isPushRegistration, legacyRegistrations, pushSupport,
  urlBase64ToUint8Array, enablePush, fetchPushConfig,
} from './webPush'

const ROOT = path.resolve(__dirname, '..', '..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** Source with // and /* *\/ comments removed, and string/template literals
 *  blanked to "" unless keepStrings. A real scanner, not a regex: `'//'`
 *  inside a string is not a comment. */
function codeOnly(src, { keepStrings = false } = {}) {
  let out = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2); i = i < 0 ? src.length : i + 2; continue }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; const start = i; i++
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++ }
      const lit = src.slice(start, i + 1)
      i++; out += keepStrings ? lit : '""'; continue
    }
    out += c; i++
  }
  return out
}

describe('push-sw.js is a push worker and nothing else', () => {
  const code = codeOnly(read('public/push-sw.js'))

  it('has no fetch listener', () => {
    expect(code).not.toMatch(/\bonfetch\b/)
    // Event names are string literals (stripped to "" above), so the listener
    // roster is read from the source with only COMMENTS removed.
    const noComments = codeOnly(read('public/push-sw.js'), { keepStrings: true })
    const events = [...noComments.matchAll(/addEventListener\(\s*['"`](\w+)['"`]/g)].map(m => m[1])
    expect(events.sort()).toEqual(['notificationclick', 'push'])
    expect(noComments).not.toMatch(/['"`]fetch['"`]/)
  })

  it('never uses Cache Storage', () => {
    expect(code).not.toMatch(/\bcaches\s*\./)
    expect(code).not.toMatch(/\bcaches\b/)
  })

  it('never touches /sw.js or claims pages', () => {
    const noComments = codeOnly(read('public/push-sw.js'), { keepStrings: true })
    expect(noComments).not.toMatch(/sw\.js/)
    expect(code).not.toMatch(/clients\s*\.\s*claim/)
    expect(code).not.toMatch(/skipWaiting/)
  })

  it('the stripper ignores prose (control)', () => {
    const src = "// caches.open('x') and addEventListener('fetch')\n/* caches. */\nconst a = 'caches.match'\nself.x = 1\n"
    expect(codeOnly(src)).not.toMatch(/caches/)
    expect(codeOnly("caches.open('v1')")).toMatch(/\bcaches\s*\./)
  })
})

describe('main.jsx kill switch ignores the push worker', () => {
  it('main.jsx gates /sw.js on legacyRegistrations, not on every registration', () => {
    const src = read('src/main.jsx')
    expect(src).toMatch(/legacyRegistrations\(regs\)\.length\s*>\s*0/)
    expect(src).not.toMatch(/regs\.length\s*>\s*0/)
  })

  const reg = (scope, script) => ({
    scope: `https://uctintelligence.com${scope}`,
    active: script ? { scriptURL: `https://uctintelligence.com${script}` } : null,
  })

  it('a push-only browser has no legacy registration', () => {
    expect(legacyRegistrations([reg(PUSH_SW_SCOPE, PUSH_SW_URL)])).toEqual([])
  })

  it('a legacy worker beside the push worker is still found', () => {
    const legacy = reg('/', '/sw.js')
    expect(legacyRegistrations([reg(PUSH_SW_SCOPE, PUSH_SW_URL), legacy])).toEqual([legacy])
    expect(isPushRegistration(legacy)).toBe(false)
  })

  it('identifies the push worker by script even mid-install', () => {
    expect(isPushRegistration({ scope: 'not a url', installing: { scriptURL: 'https://x/push-sw.js' } })).toBe(true)
  })
})

describe('pushSupport — secure context is checked, never inferred', () => {
  const full = (over = {}) => ({
    isSecureContext: true, navigator: { serviceWorker: {} }, PushManager: function () {},
    Notification: function () {}, ...over,
  })
  it('insecure context is refused first', () => {
    expect(pushSupport(full({ isSecureContext: false }))).toEqual({ ok: false, reason: 'insecure' })
    expect(pushSupport(full({ isSecureContext: undefined })).reason).toBe('insecure')
  })
  it('missing APIs name the reason', () => {
    expect(pushSupport(full({ navigator: {} })).reason).toBe('no-service-worker')
    const noPush = full(); delete noPush.PushManager
    expect(pushSupport(noPush).reason).toBe('no-push')
  })
  it('a full browser is supported', () => {
    expect(pushSupport(full())).toEqual({ ok: true, reason: null })
  })
})

describe('enablePush', () => {
  const sub = { toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'p', auth: 'a' } }), unsubscribe: vi.fn() }
  const win = (perm) => {
    const pushManager = { getSubscription: vi.fn(async () => null), subscribe: vi.fn(async () => sub) }
    const register = vi.fn(async () => ({ active: {}, pushManager }))
    return {
      w: {
        isSecureContext: true, PushManager: function () {},
        Notification: { requestPermission: vi.fn(async () => perm) },
        navigator: { serviceWorker: { register } },
      },
      register, pushManager,
    }
  }

  it('denied permission registers nothing', async () => {
    const { w, register } = win('denied')
    expect(await enablePush('BKey', w, vi.fn())).toEqual({ ok: false, reason: 'denied' })
    expect(register).not.toHaveBeenCalled()
  })

  it('granted registers /push-sw.js at /push/ — never /sw.js — and posts the subscription', async () => {
    const { w, register, pushManager } = win('granted')
    const fetchImpl = vi.fn(async () => ({ ok: true }))
    expect(await enablePush('AQAB', w, fetchImpl)).toEqual({ ok: true })
    expect(register).toHaveBeenCalledWith('/push-sw.js', { scope: '/push/' })
    expect(pushManager.subscribe.mock.calls[0][0].userVisibleOnly).toBe(true)
    expect(fetchImpl).toHaveBeenCalledWith('/api/push/subscribe', expect.objectContaining({ method: 'POST' }))
  })

  it('urlBase64ToUint8Array decodes base64url', () => {
    expect(Array.from(urlBase64ToUint8Array('AQID_-8'))).toEqual([1, 2, 3, 255, 239])
  })
})

describe('fetchPushConfig', () => {
  it('a dark (404) or unpaid (402) channel is null', async () => {
    expect(await fetchPushConfig(async () => ({ ok: false, status: 404 }))).toBeNull()
    expect(await fetchPushConfig(async () => ({ ok: false, status: 402 }))).toBeNull()
  })
  it('unconfigured keys are null', async () => {
    expect(await fetchPushConfig(async () => ({ ok: true, json: async () => ({ configured: false, public_key: null }) }))).toBeNull()
  })
})
