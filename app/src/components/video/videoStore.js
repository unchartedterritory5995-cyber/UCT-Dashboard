// Global "now playing" state for the persistent Desk video player. Mirrors the
// useSyncExternalStore pattern of pages/desk/videoProgress.js: module-level
// state + a listener set + getSnapshot. Drives GlobalVideoLayer's mode:
//   closed → no video | docked → theater over the Desk slot | mini → floating
const CORNER_KEY = 'desk_video_corner'
const CORNERS = ['br', 'bl', 'tr', 'tl']

function readCorner() {
  try {
    const c = localStorage.getItem(CORNER_KEY)
    return CORNERS.includes(c) ? c : 'br'
  } catch {
    return 'br'
  }
}

let state = {
  list: [],
  index: 0,
  mode: 'closed', // 'closed' | 'docked' | 'mini'
  corner: readCorner(),
  dockRect: null, // { top, left, width, height } of the Desk slot, or null
  playing: false,
}
const listeners = new Set()

function set(patch) {
  state = { ...state, ...patch }
  listeners.forEach((cb) => cb())
}

// ── Actions ───────────────────────────────────────────────────────────────
export function play(list, index = 0) {
  if (!Array.isArray(list) || !list.length) return
  const i = Math.max(0, Math.min(index, list.length - 1))
  set({ list, index: i, mode: 'docked', playing: true })
}

export function playIndex(i) {
  if (i < 0 || i >= state.list.length) return
  set({ index: i })
}

export function next() {
  if (state.index + 1 >= state.list.length) return false
  set({ index: state.index + 1 })
  return true
}

export function minimize() {
  if (state.mode === 'docked') set({ mode: 'mini' })
}

export function expand() {
  if (state.mode === 'mini') set({ mode: 'docked' })
}

export function close() {
  set({ list: [], index: 0, mode: 'closed', dockRect: null, playing: false })
}

export function setCorner(corner) {
  if (!CORNERS.includes(corner)) return
  try { localStorage.setItem(CORNER_KEY, corner) } catch { /* ignore */ }
  set({ corner })
}

export function setPlaying(b) {
  set({ playing: !!b })
}

// The Desk theater slot reported its rect → just record where to dock. Does
// NOT change mode: re-docking is an explicit user action (expand()), so a video
// the user parked in the corner stays there even while the Desk is on screen.
export function registerDockSlot(rect) {
  set({ dockRect: rect })
}

// Leaving the docked theater (navigated away OR intentionally minimized) →
// float as mini and drop the stale rect.
export function clearDockSlot() {
  const patch = { dockRect: null }
  if (state.mode === 'docked') patch.mode = 'mini'
  set(patch)
}

// ── Reads / subscription ──────────────────────────────────────────────────
export function currentVideo() {
  return state.mode !== 'closed' && state.list.length ? state.list[state.index] : null
}

export function subscribe(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function getSnapshot() {
  return state
}

export function __reset() {
  state = { list: [], index: 0, mode: 'closed', corner: readCorner(), dockRect: null, playing: false }
  listeners.clear()
}
