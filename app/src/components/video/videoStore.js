// Global "now playing" state for the persistent Desk video player. Mirrors the
// useSyncExternalStore pattern of pages/desk/videoProgress.js: module-level
// state + a listener set + getSnapshot. Drives GlobalVideoLayer's mode:
//   closed → no video | docked → theater over the Desk slot | mini → floating
const POS_KEY = 'desk_video_pos'

// Last free-drag position of the mini (top-left, viewport px), or null = default.
function readPos() {
  try {
    const j = JSON.parse(localStorage.getItem(POS_KEY) || 'null')
    if (j && typeof j.x === 'number' && typeof j.y === 'number') return j
  } catch { /* ignore */ }
  return null
}

let state = {
  list: [],
  index: 0,
  mode: 'closed', // 'closed' | 'docked' | 'mini'
  pos: readPos(), // { x, y } free-drag position of the mini, or null
  dockRect: null, // { top, left, width, height } of the Desk slot, or null
  playing: false,
  selectSeq: 0, // bumps on every explicit user pick — the theater scrolls itself into view on change
}
const listeners = new Set()

// The live Desk theater slot DOM node — kept OUTSIDE `state` so it never
// triggers a re-render. GlobalVideoLayer reads it every animation frame to pin
// the fixed player to the slot's live rect (tight scroll-follow, no React lag).
let _dockEl = null
export function getDockEl() { return _dockEl }

function set(patch) {
  state = { ...state, ...patch }
  listeners.forEach((cb) => cb())
}

// ── Actions ───────────────────────────────────────────────────────────────
export function play(list, index = 0) {
  if (!Array.isArray(list) || !list.length) return
  const i = Math.max(0, Math.min(index, list.length - 1))
  set({ list, index: i, mode: 'docked', playing: true, selectSeq: state.selectSeq + 1 })
}

// Request the player seek to `sec` (used by chapter rows + ticker-moment chips).
// GlobalVideoLayer watches `seekReq.nonce` and calls player.seekTo. The nonce
// makes repeat-seeks to the same second still fire.
let _seekNonce = 0
export function seekTo(sec) {
  const s = Math.max(0, Number(sec) || 0)
  set({ seekReq: { sec: s, nonce: ++_seekNonce } })
}

// GlobalVideoLayer registers a getter for the live playhead so other surfaces
// (e.g. the "add note at current time" button) can read it without re-rendering
// on every tick. Returns 0 when nothing is playing / not yet registered.
let _timeGetter = null
export function registerTimeGetter(fn) { _timeGetter = typeof fn === 'function' ? fn : null }
export function getCurrentTime() {
  try { return _timeGetter ? Math.max(0, _timeGetter() || 0) : 0 } catch { return 0 }
}

export function playIndex(i) {
  if (i < 0 || i >= state.list.length) return
  set({ index: i, selectSeq: state.selectSeq + 1 })
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
  _dockEl = null
  set({ list: [], index: 0, mode: 'closed', dockRect: null, playing: false })
}

// Free-drag: park the mini at any { x, y } (top-left, viewport px); persisted.
export function setPos(x, y) {
  const pos = { x: Math.round(x), y: Math.round(y) }
  try { localStorage.setItem(POS_KEY, JSON.stringify(pos)) } catch { /* ignore */ }
  set({ pos })
}

export function setPlaying(b) {
  set({ playing: !!b })
}

// The Desk theater slot reported its rect → just record where to dock. Does
// NOT change mode: re-docking is an explicit user action (expand()), so a video
// the user parked in the corner stays there even while the Desk is on screen.
export function registerDockSlot(rect, el) {
  if (el !== undefined) _dockEl = el
  set({ dockRect: rect })
}

// Leaving the docked theater (navigated away OR intentionally minimized) →
// float as mini and drop the stale rect.
export function clearDockSlot() {
  _dockEl = null
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
  _dockEl = null
  state = { list: [], index: 0, mode: 'closed', pos: readPos(), dockRect: null, playing: false, selectSeq: 0 }
  listeners.clear()
}
