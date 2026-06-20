// Watch-progress for The Desk → Videos. localStorage is the instant cache + the
// offline fallback; it write-syncs to the backend (`/api/education/progress`) so
// progress follows the user across devices. Powers "Continue watching",
// resume-on-reopen, ✓ watched checkmarks, and the per-card progress bar.
//
// Shape: { [youtube_id]: { t: secondsWatched, d: durationSeconds, at: epochMs, done: bool } }
const KEY = 'desk_video_progress'
const DONE_RATIO = 0.92 // ≥92% watched ⇒ counts as finished
const MIN_RESUME = 8 // don't bother resuming a video watched <8s
const SYNC_DEBOUNCE = 2500 // ms; coalesce rapid position updates per video

let cache = null
let listeners = new Set()
let syncTimers = {} // youtube_id → debounce timer (write-behind to backend)

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') || {}
  } catch {
    return {}
  }
}

function ensureCache() {
  if (cache === null) cache = read()
  return cache
}

function commit(next) {
  cache = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* quota / private mode — keep in-memory copy */
  }
  listeners.forEach((cb) => cb())
}

// Write-behind to the backend (debounced per video). Best-effort: unauth (402)
// or offline just leaves the localStorage copy in place.
function queueSync(youtubeId, immediate = false) {
  if (typeof fetch === 'undefined') return
  clearTimeout(syncTimers[youtubeId])
  const send = () => {
    const e = ensureCache()[youtubeId]
    if (!e) return
    fetch('/api/education/progress', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        youtube_id: youtubeId,
        position: e.t || 0,
        duration: e.d || 0,
        done: !!e.done,
      }),
    }).catch(() => {})
  }
  if (immediate) send()
  else syncTimers[youtubeId] = setTimeout(send, SYNC_DEBOUNCE)
}

// ── Writes ──────────────────────────────────────────────────────────────────
export function recordProgress(youtubeId, t, d) {
  if (!youtubeId) return
  const secs = Math.max(0, Math.floor(Number(t) || 0))
  const dur = Math.max(0, Math.floor(Number(d) || 0))
  const prev = ensureCache()[youtubeId]
  const done = dur > 0 ? secs / dur >= DONE_RATIO : prev?.done || false
  commit({
    ...ensureCache(),
    [youtubeId]: { t: secs, d: dur, at: Date.now(), done },
  })
  queueSync(youtubeId)
}

export function markWatched(youtubeId) {
  if (!youtubeId) return
  const prev = ensureCache()[youtubeId] || {}
  commit({ ...ensureCache(), [youtubeId]: { ...prev, done: true, at: Date.now() } })
  queueSync(youtubeId, true) // flush completion right away
}

export function clearProgress(youtubeId) {
  const next = { ...ensureCache() }
  delete next[youtubeId]
  commit(next)
}

// ── Reads ───────────────────────────────────────────────────────────────────
export function getEntry(youtubeId) {
  return ensureCache()[youtubeId] || null
}

// Seconds to resume from (0 = start). Skips finished or barely-started videos.
export function resumeSeconds(youtubeId) {
  const e = ensureCache()[youtubeId]
  if (!e || e.done || !e.t || e.t < MIN_RESUME) return 0
  if (e.d && e.t / e.d >= DONE_RATIO) return 0
  return e.t
}

// In-progress videos (started, not finished), newest first.
export function inProgressIds() {
  const map = ensureCache()
  return Object.entries(map)
    .filter(([, e]) => e && !e.done && e.t >= MIN_RESUME)
    .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
    .map(([id]) => id)
}

// ── Subscription (for useSyncExternalStore) ─────────────────────────────────
export function subscribe(cb) {
  listeners.add(cb)
  const onStorage = (e) => {
    if (e.key === KEY) {
      cache = read()
      cb()
    }
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('storage', onStorage)
  }
}

export function getSnapshot() {
  return ensureCache()
}

// Pull cross-device progress from the backend once on load and merge it in
// (newest `at`/updated_at wins per video). Best-effort; no-ops if unauth/offline.
export async function hydrateFromServer() {
  if (typeof fetch === 'undefined') return
  let rows
  try {
    const r = await fetch('/api/education/progress', { credentials: 'include' })
    if (!r.ok) return
    rows = (await r.json())?.progress
  } catch {
    return
  }
  if (!Array.isArray(rows) || !rows.length) return
  const next = { ...ensureCache() }
  let changed = false
  for (const s of rows) {
    if (!s?.youtube_id) continue
    const local = next[s.youtube_id]
    if (!local || (s.at || 0) > (local.at || 0)) {
      next[s.youtube_id] = { t: s.t || 0, d: s.d || 0, at: s.at || 0, done: !!s.done }
      changed = true
    }
  }
  if (changed) commit(next) // merged from server — don't echo back via queueSync
}

// Test helper.
export function __reset() {
  cache = null
  listeners = new Set()
  Object.values(syncTimers).forEach(clearTimeout)
  syncTimers = {}
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}
