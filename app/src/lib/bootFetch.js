// The first two requests a signed-in page needs, started the moment the entry bundle runs (main.jsx)
// instead of one after the other once React has rendered (desktop speed plan, 2026-11-11).
//
// Measured on a desktop launch to /charts (page clock): /api/auth/me began ~60 ms after the entry
// script, and /api/auth/preferences only AFTER auth/me answered (+190 ms), because the board that reads
// it renders behind the sign-in gate. Started together here, the preferences answer is usually in by
// the time the board asks for it.
//
// Rules, each one load-bearing:
//  * One use. A taken answer is gone; a second caller (a refetch) makes its own request.
//  * Fresh only. An answer older than BOOT_MAX_AGE_MS is never handed out (the page may have changed
//    member or settings since); the caller just fetches.
//  * Preferences only for the SAME member. They are started only when this browser was signed in last
//    time (SIGNED_IN_HINT, written by AuthContext), and handed out only when the boot /api/auth/me
//    named a member AND that member is still the one the caller is reading for. Anything else is
//    dropped unread, so another member's settings can never land.
//  * A failed boot request is "no answer": the caller fetches as it always did.

export const BOOT_MAX_AGE_MS = 10_000
export const ME_URL = '/api/auth/me'
export const PREFS_URL = '/api/auth/preferences'
export const SIGNED_IN_HINT = 'uct.signedIn.v1'

const entries = new Map()   // url -> { at, p }
let bootUser                // undefined: boot /me not read yet; null: signed out; id: that member

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** main.jsx calls this once, before the app renders. */
export function startBootFetches({ fetchImpl = (typeof fetch === 'function' ? fetch : null), storage = safeStorage() } = {}) {
  if (!fetchImpl || entries.size) return
  const start = (url) => entries.set(url, { at: now(), p: Promise.resolve().then(() => fetchImpl(url)).catch(() => null) })
  start(ME_URL)
  let signedInLastTime = false
  try { signedInLastTime = storage?.getItem(SIGNED_IN_HINT) === '1' } catch { /* storage blocked */ }
  if (signedInLastTime) start(PREFS_URL)
}

function take(url) {
  const e = entries.get(url)
  if (!e) return null
  entries.delete(url)
  return now() - e.at > BOOT_MAX_AGE_MS ? null : e.p
}

/** AuthContext's first /api/auth/me: the boot request's Response (or null when there is none or it failed). */
export function takeBootMe() { return take(ME_URL) }

/** AuthContext, after reading the BOOT /me response (and only that one): who it named (null = signed
 *  out). Only the first call counts: a later refetch must never re-point the boot preferences at
 *  another member. */
export function noteBootUser(id) {
  if (bootUser === undefined) bootUser = id ?? null
}

/** AuthContext, on every definitive /me answer: whether to start preferences early next page load. */
export function setSignedInHint(signedIn, storage = safeStorage()) {
  try {
    if (signedIn) storage?.setItem(SIGNED_IN_HINT, '1')
    else storage?.removeItem(SIGNED_IN_HINT)
  } catch { /* storage blocked */ }
}

/** usePreferences' fetcher: the boot preferences Response, only for the member the boot /me named. */
export function takeBootPreferences(forUser) {
  const p = take(PREFS_URL)
  if (!p) return null
  if (bootUser === undefined || bootUser === null || forUser == null || forUser !== bootUser) return null
  return p
}

function safeStorage() {
  try { return typeof window !== 'undefined' ? window.localStorage : null } catch { return null }
}

/** Tests only. */
export function __resetBootFetchForTests() { entries.clear(); bootUser = undefined }
