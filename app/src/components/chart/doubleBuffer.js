// app/src/components/chart/doubleBuffer.js
//
// ─── ⭐⭐ THE NEXT ROW, DOUBLE-BUFFERED (2026-11-27, owner bar: arrow down -> both charts drawn in <= 40 ms) ───────────
//
// A chart linked to a list keeps a SECOND, hidden pane (the SHADOW) set to the row the next press lands on and already
// painted. A press to that row SHOWS the shadow (two class flips, the layers' handles swapped) instead of switching the
// pane in front: no setData, no library paint, no pane or chart render, and the chrome (header, legend, watermark) is
// the shadow's own, already right. Any other press, or a shadow that is not exactly what the front would show now, is
// the NORMAL switch, unchanged. After a flip the hidden pane (the old front) is set, in idle time, to the next row.
//
// Bench (C:/uct-runs/keytask/flipbench, lightweight-charts 5.2, two linked charts, untraced, 2 x 40 presses a mode):
// the library-only switch 11.7 / 14.7 ms frame-complete (1m+15m / D+30m), the flip 1.3 / 1.6 ms, every capture
// byte-identical; at a 250 ms cadence 26 % of presses found the shadow not yet set and switched normally.
//
// This module is the pure half: the switch, the touch-tier refusal, the board's shadow budget, the shadow's row, and
// THE FLIP RULE. ChartWidget owns the two layers (chart/useDoubleBuffer.js).
//
// ⛔ A FLIP SHOWS EXACTLY WHAT THE NORMAL SWITCH WOULD. The shadow is shown only when it was set to the very symbol,
// timeframe, session and settings the front would now show, AND its bars are the store's base snapshot of that key AS
// IT IS NOW (identity: a base change after the shadow was set, a deeper load, a seal, a status change, is a different
// snapshot, which refuses the flip). Its feeds are muted while hidden (the layer handle, boardVisibility.js), so the
// identity test is what stands between a flip and a stale picture.

import { chartSpeedKilled } from '../../lib/chartSpeed'
import { scanNeighborsFor } from './neighborFrames'

export const DOUBLE_BUFFER_KEY = 'uct.doubleBuffer'
/** The touch tier: one chart, a phone's memory. No shadow there (owner ruling, 2026-11-27). */
export const TOUCH_TIER_QUERY = '(max-width: 1024px), (pointer: coarse)'
/** The most shadows a board holds (each one a second chart's canvases, ~25-40 MB at DPR 2). */
export const MAX_SHADOWS = 2

let _flag = null
/** Is the double buffer on for this page load? Off on the touch tier, under the server's chart-speed kill, or with
 *  localStorage `uct.doubleBuffer` = '0'. ON otherwise (owner ruling 2026-11-27: no members, ship it on). */
export function doubleBufferOn() {
  if (_flag !== null) return _flag
  if (chartSpeedKilled()) return (_flag = false)
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(DOUBLE_BUFFER_KEY) === '0') return (_flag = false)
  } catch { /* storage refused: the default */ }
  try {
    if (typeof matchMedia === 'function' && matchMedia(TOUCH_TIER_QUERY).matches) return (_flag = false)
  } catch { /* no media queries: the default */ }
  return (_flag = true)
}
/** Tests: force the switch (null re-reads it). */
export function __setDoubleBufferForTests(v) { _flag = v === null || v === undefined ? null : !!v }

// ─── the board's shadow budget ─────────────────────────────────────────────────────────────────────────────────
const _held = new WeakMap()   // scope (an object: the board's group store) -> Set of owners holding a shadow
const _NO_SCOPE = {}
/** Take one of the board's MAX_SHADOWS shadows for `owner`. Returns the release, or null when the board has none
 *  left (that chart stays single-buffered). Taking it again for the same owner returns a release too. */
export function acquireShadow(scope, owner) {
  const s = scope && typeof scope === 'object' ? scope : _NO_SCOPE
  let set = _held.get(s)
  if (!set) { set = new Set(); _held.set(s, set) }
  if (!set.has(owner) && set.size >= MAX_SHADOWS) return null
  set.add(owner)
  return () => { set.delete(owner) }
}
/** Shadows the board holds now (tests, diagnostics). */
export function shadowsHeld(scope) {
  const set = _held.get(scope && typeof scope === 'object' ? scope : _NO_SCOPE)
  return set ? set.size : 0
}

/** The row a chart on `sym` shows next: the first row the list (or a typed ticker) names after it, in the direction
 *  of travel (neighborFrames.publishScanNeighbors orders ahead before behind). null when no list is centred on it. */
export function nextShadowSym(sym) {
  if (!sym) return null
  const order = scanNeighborsFor(sym)
  return order.length ? order[0] : null
}

// ─── the flip rule ──────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Show the shadow, or switch the front as today?
 * @param {{sym, tf, showExtended, settings}} want   what the front would show now (`settings`: the pane's stored
 *   settings object, compared by identity: the board hands both layers the same object)
 * @param {{sym, tf, showExtended, settings, snap, set}|null} shadow  what the shadow was set to (`set`: it committed
 *   that render; `snap`: the base snapshot its bars came from)
 * @param {(sym) => object|null} snapNow  the store's base snapshot of the key the shadow reads, NOW
 * @returns {{flip: boolean, why: string}}
 */
export function flipDecision(want, shadow, snapNow) {
  if (!shadow) return { flip: false, why: 'no-shadow' }
  if (!shadow.set) return { flip: false, why: 'not-set' }
  if (!want || shadow.sym !== want.sym) return { flip: false, why: 'sym' }
  if (shadow.tf !== want.tf) return { flip: false, why: 'tf' }
  if (!!shadow.showExtended !== !!want.showExtended) return { flip: false, why: 'session' }
  if (shadow.settings !== want.settings) return { flip: false, why: 'settings' }
  let now = null
  try { now = snapNow ? snapNow(shadow) : null } catch { now = null }
  if (!shadow.snap || now !== shadow.snap) return { flip: false, why: 'stale' }
  return { flip: true, why: 'flip' }
}

// ─── what happened (diagnostics: window.__uctDoubleBuffer, the flip proof's peek) ────────────────────────────────
const _stats = { flips: 0, switches: 0, why: {}, retargets: 0, last: [] }
export function doubleBufferStats() { return _stats }
export function noteDecision(d, sym) {
  if (d.flip) _stats.flips += 1
  else _stats.switches += 1
  _stats.why[d.why] = (_stats.why[d.why] || 0) + 1
  _stats.last.push(`${sym}:${d.why}`)
  if (_stats.last.length > 32) _stats.last.splice(0, _stats.last.length - 32)
  try { if (typeof window !== 'undefined') window.__uctDoubleBuffer = _stats } catch { /* no window */ }
}
export function noteRetarget() { _stats.retargets += 1 }
export function __resetDoubleBufferStatsForTests() {
  _stats.flips = 0; _stats.switches = 0; _stats.why = {}; _stats.retargets = 0; _stats.last.length = 0
}
