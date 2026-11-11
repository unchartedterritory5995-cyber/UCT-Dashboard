// Where a bare first open of the Focus layout lands (owner decision, 2026-11-10): the member's
// last-used screen, or the first pinned screen for a first-timer. Never waits on any count.

// The screen the member last chose from the Screens menu, per member (the key carries the user id,
// because a saved screen is that member's own). No user id, no entry.
export const LAST_SCREEN_KEY = 'uct.screener.lastScreen'
export const lastScreenKey = uid => (uid == null || uid === '' ? null : `${LAST_SCREEN_KEY}:${uid}`)

// The pinned screens (with their specs) as the server last answered them, so the next open can
// start counting and scanning before the saved screens and preferences have answered (Perf 3).
// Kept PER MEMBER (the key carries the user id): a pinned saved screen is that member's own, and
// a shared browser must never open on another member's screen. No user id, no seed.
export const LANDING_SEED_KEY = 'uct.screener.landingSeed'
export const landingSeedKey = uid => (uid == null || uid === '' ? null : `${LANDING_SEED_KEY}:${uid}`)
const SEED_MAX = 12

// The default landing: the first pinned screen, or null when nothing is pinned.
export const defaultLanding = items => (items?.length ? items[0] : null)

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

export function readLastScreen(uid) {
  const key = lastScreenKey(uid)
  if (!key) return null
  try {
    const it = JSON.parse(localStorage.getItem(key) || 'null')
    return it && it.id != null && typeof it.name === 'string' && it.spec && typeof it.spec === 'object' ? it : null
  } catch { return null }
}

export function writeLastScreen(uid, item) {
  const key = lastScreenKey(uid)
  if (!key || !item || item.id == null) return
  try {
    localStorage.setItem(key, JSON.stringify({ id: item.id, name: item.name, kind: item.kind, spec: item.spec || { filters: [] } }))
  } catch { /* private mode or full: the next open lands on the default */ }
}
