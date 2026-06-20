// Per-device watch-progress for The Desk → Videos (localStorage, no backend).
// Powers "Continue watching", resume-on-reopen, ✓ watched checkmarks, and the
// per-card progress bar. Keyed by youtube_id.
//
// Shape: { [youtube_id]: { t: secondsWatched, d: durationSeconds, at: epochMs, done: bool } }
const KEY = 'desk_video_progress'
const DONE_RATIO = 0.92 // ≥92% watched ⇒ counts as finished
const MIN_RESUME = 8 // don't bother resuming a video watched <8s

let cache = null
let listeners = new Set()

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
}

export function markWatched(youtubeId) {
  if (!youtubeId) return
  const prev = ensureCache()[youtubeId] || {}
  commit({ ...ensureCache(), [youtubeId]: { ...prev, done: true, at: Date.now() } })
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

// Test helper.
export function __reset() {
  cache = null
  listeners = new Set()
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}
