// Where a bare first open of the Focus layout lands (owner decision 1): the first pinned screen
// with at least LANDING_MIN_MATCHES matches, else the first pinned screen.

export const LANDING_MIN_MATCHES = 10
// The pinned screens (with their specs) as the server last answered them, so the next open can
// start counting and scanning before the saved screens and preferences have answered (Perf 3).
// Kept PER MEMBER (the key carries the user id): a pinned saved screen is that member's own, and
// a shared browser must never open on another member's screen. No user id, no seed.
export const LANDING_SEED_KEY = 'uct.screener.landingSeed'
export const landingSeedKey = uid => (uid == null || uid === '' ? null : `${LANDING_SEED_KEY}:${uid}`)
const SEED_MAX = 12

// items: the pinned screens in pinned order. countOf(id): undefined = not answered yet, null = the
// count failed, a number = the matches the member would see. The first screen with enough matches
// wins as soon as every screen before it has answered; an unanswered or failed count is never
// "enough". Once the wait is over, unanswered counts stop being waited on.
// Returns { done: false } (still waiting) or { done: true, hit } (hit null: nothing pinned).
export function pickLanding(items, countOf, waitOver = false) {
  if (!items?.length) return { done: true, hit: null }
  for (const it of items) {
    const n = countOf(it.id)
    if (n === undefined && !waitOver) return { done: false }
    if (typeof n === 'number' && n >= LANDING_MIN_MATCHES) return { done: true, hit: it }
  }
  return { done: true, hit: items[0] }
}

// The same screen: same id and the same spec.
export const sameScreen = (a, b) => !!a && !!b && String(a.id) === String(b.id) && JSON.stringify(a.spec || null) === JSON.stringify(b.spec || null)

export function readLandingSeed(uid) {
  const key = landingSeedKey(uid)
  if (!key) return null
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null')
    if (!Array.isArray(v)) return null
    const items = v.filter(it => it && it.id != null && typeof it.name === 'string' && it.spec && typeof it.spec === 'object')
    return items.length ? items : null
  } catch { return null }
}

export function writeLandingSeed(uid, items) {
  const key = landingSeedKey(uid)
  if (!key) return
  try {
    const out = (items || []).slice(0, SEED_MAX).map(({ id, name, kind, spec }) => ({ id, name, kind, spec: spec || { filters: [] } }))
    localStorage.setItem(key, JSON.stringify(out))
  } catch { /* private mode or full: the next open waits for the server, as before */ }
}
