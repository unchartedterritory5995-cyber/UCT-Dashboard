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
import { lastCandlePos } from './rightMargin'

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
 * ⭐ (review of #2922, F3) THE SHADOW PROVES WHAT IT SHOWS: its chart REPORTS every pass it committed (chart/layerPaint.js:
 * the symbol, its resolved timeframe and session, and the very bars array it handed the library), and the flip asks the
 * store what that array would be NOW. Nothing is inferred from when a render happened.
 * @param {{sym, tf, ext, settings, replay}} want  what the front would show now: the symbol pressed to; the front chart's
 *   OWN last report's timeframe and session (its resolved values); the pane's stored settings (identity: the board hands
 *   both layers the same object); a replay cutoff (no flip while one is set: F6)
 * @param {{sym, tf, ext, bars, settings}|null} report  the shadow chart's last committed pass (`settings`: the widget's
 *   settings when it reported)
 * @param {(report) => any} barsNow  the bars array the store's base snapshot of that key gives NOW (null: none)
 * @param {() => string} view  'ok', or why the two charts' views differ (F1: viewParity)
 * @returns {{flip: boolean, why: string}}
 */
export function flipDecision(want, report, barsNow, view) {
  if (!want) return { flip: false, why: 'no-front' }
  if (want.replay) return { flip: false, why: 'replay' }
  if (!report) return { flip: false, why: 'no-shadow' }
  if (report.sym !== want.sym) return { flip: false, why: 'sym' }
  if (want.tf == null || report.tf !== want.tf) return { flip: false, why: 'tf' }
  if (!!report.ext !== !!want.ext) return { flip: false, why: 'session' }
  if (report.settings !== want.settings) return { flip: false, why: 'settings' }
  let now = null
  try { now = barsNow ? barsNow(report) : null } catch { now = null }
  if (!report.bars || now !== report.bars) return { flip: false, why: 'stale' }
  let v = 'view-unknown'
  try { v = view ? view() : 'ok' } catch { v = 'view-unknown' }
  if (v !== 'ok') return { flip: false, why: v }
  return { flip: true, why: 'flip' }
}

// ─── the view (review of #2922, F1; the typed-Enter dry run, 2026-11-27) ─────────────────────────────────────────
// The normal switch on /charts keeps the zoom WIDTH and pins the new symbol's newest bar at the right margin (StockChart
// `keepPresentOnSymbolChange` -> chart/rightMargin.js `pinNewestRange`: to = lastIdx + reserve + width x gap, the gap a
// fraction of the plot that depends only on its pixel width, `reserve` the new SYMBOL's own developing-period slot), from
// ANY outgoing frame: a front panned into history still switches to present. So what a flip must match is the WIDTH; the
// right edge is the hidden chart's own pin for its own symbol (its own switch, or the mirror below, set it), and the
// front's right edge says nothing about the frame the switch would make.
// ⚰️ The first rule also compared the two right edges: but the margin scales with the width, so two widths always had two
// right edges, and the mirror (which kept the hidden chart's right edge) never ran -> after the first width change every
// press refused 'view-offset' (1m+15m typed dry run: 4 of 14).
const near = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 0.5
const spanOf = (f) => f.fromRight - f.toRight
function viewBlocked(m) {
  if (!m || !m.frame || !Number.isFinite(m.frame.fromRight) || !Number.isFinite(m.frame.toRight)) return 'view-unknown'
  if (m.activeRange != null) return 'view-range'
  if (m.frame.locked) return 'view-locked'
  if (m.priceAuto === false) return 'view-price'
  if (m.replay && m.replay.on) return 'replay'
  return null
}
/** 'ok' when the normal switch from the front's view would frame the symbol as the hidden chart shows it: the same
 *  width, nothing that overrides the pin (a range, a lock, a hand-set price scale, replay) on either. */
export function viewParity(front, shadow) {
  const b = viewBlocked(front) || viewBlocked(shadow)
  if (b) return b
  if (!near(spanOf(front.frame), spanOf(shadow.frame))) return 'view-zoom'
  return 'ok'
}
/** The right-margin fraction of a plot `plotWidthPx` wide (chart/rightMargin.js lastCandlePos), or null. */
function gapFracOf(plotWidthPx) {
  if (!Number.isFinite(plotWidthPx) || plotWidthPx <= 0) return null
  return 1 - lastCandlePos(plotWidthPx)
}
/**
 * The frame that gives the hidden chart the front's WIDTH, pinned as the switch pins it (StockChart restoreView), or null
 * when nothing needs moving or nothing may be (a range, a lock, a hand-set price scale, replay). The hidden chart's own
 * developing slot (`reserve`) is the one its chart says a switch would use now (`pinReserve`, StockChart getDateMeta), or
 * else is read back from its current pin: its right edge minus its width's margin.
 * (review of #2932) The widths alike, the hidden chart is still re-pinned when its right edge is more than half a bar off
 * that pin: the widget was resized while it was hidden (a new plot width, a new margin), or a D/W/M chart got today's
 * first bar while pinned (its reserve went, the library moved the range). Only with its own plot width and pinReserve:
 * without them the pin is not known.
 */
export function mirrorFrameFor(front, shadow) {
  if (viewBlocked(front) || viewBlocked(shadow)) return null
  const w = spanOf(front.frame)
  const ws = spanOf(shadow.frame)
  if (!(w > 0)) return null
  const own = Number.isFinite(shadow.pinReserve) ? Math.max(0, shadow.pinReserve) : null
  if (near(w, ws)) {
    const g = gapFracOf(shadow.plotWidthPx)
    if (g == null || own == null) return null
    const pin = -(own + ws * g)
    if (Math.abs(shadow.frame.toRight - pin) <= 0.5) return null
    return { fromRight: pin + ws, toRight: pin, activeRange: null, locked: false, lock: null }
  }
  const gf = gapFracOf(shadow.plotWidthPx) ?? gapFracOf(front.plotWidthPx)
  // without a plot width, the margin is read from the hidden chart itself (its whole right edge, no reserve)
  const gap = gf != null ? gf : (ws > 0 ? Math.max(0, -shadow.frame.toRight) / ws : 0)
  const reserve = gf == null ? 0 : own != null ? own : Math.max(0, Math.round(-shadow.frame.toRight - ws * gap))
  const toRight = -(reserve + w * gap)
  return { fromRight: toRight + w, toRight, activeRange: null, locked: false, lock: null }
}

// ─── what happened (diagnostics: window.__uctDoubleBuffer, the flip proof's peek) ────────────────────────────────
const _stats = { flips: 0, switches: 0, why: {}, retargets: 0, last: [], log: [] }
export function doubleBufferStats() { return _stats }
/** One press's decision: `extra.sinceSet` / `extra.sinceReport`: ms since the hidden pane was set to its row / since its
 *  chart last reported (null: never), so a live A/B can tell a slow retarget from a slow chart. */
export function noteDecision(d, sym, extra = {}) {
  if (d.flip) _stats.flips += 1
  else _stats.switches += 1
  _stats.why[d.why] = (_stats.why[d.why] || 0) + 1
  _stats.last.push(`${sym}:${d.why}`)
  if (_stats.last.length > 32) _stats.last.splice(0, _stats.last.length - 32)
  _stats.log.push({ sym, why: d.why, sinceSet: extra.sinceSet ?? null, sinceReport: extra.sinceReport ?? null })
  if (_stats.log.length > 64) _stats.log.splice(0, _stats.log.length - 64)
  try { if (typeof window !== 'undefined') window.__uctDoubleBuffer = _stats } catch { /* no window */ }
}
export function noteRetarget() { _stats.retargets += 1 }
export function __resetDoubleBufferStatsForTests() {
  _stats.flips = 0; _stats.switches = 0; _stats.why = {}; _stats.retargets = 0; _stats.last.length = 0; _stats.log.length = 0
}
