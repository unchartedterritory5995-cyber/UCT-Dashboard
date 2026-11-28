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

/**
 * ⭐ (lane C, zero-network PR 2.1) WHAT THE HIDDEN LAYER HOLDS: `{sym, tf}`. The row ahead at the front's timeframe when a
 * list (or a typed ticker) names one; with none, the front's OWN symbol at the member's habitual next timeframe
 * (`habitTf`, tfHabit.js), so a timeframe press flips. null: nothing to hold.
 */
export function shadowTargetFor(frontSym, frontTf, habitTf) {
  if (!frontSym) return null
  const next = nextShadowSym(frontSym)
  if (next && next !== frontSym) return { sym: next, tf: frontTf }
  if (habitTf && frontTf && String(habitTf) !== String(frontTf)) return { sym: frontSym, tf: String(habitTf) }
  return null
}

/** (PR 2.1) The view check of a TIMEFRAME press: a timeframe switch keeps the outgoing zoom WIDTH in bars and pins the
 *  newest bar at the right margin (StockChart pendingTfReframeRef / settlingFrameOf), exactly the pin the hidden chart is
 *  held at; a view lock or a replay view lock frames a timeframe switch by rules not proved here: refused. */
export function tfViewParity(front, shadow, ctx = {}) {
  if (front && front.frame && (lockOf(front) || front.replayLock)) return 'view-lock'
  if (shadow && shadow.frame && (lockOf(shadow) || shadow.replayLock)) return 'view-lock'
  return viewParity(front, shadow, ctx)
}

// ─── the flip rule ──────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Show the shadow, or switch the front as today?
 * ⭐ (review of #2922, F3) THE SHADOW PROVES WHAT IT SHOWS: its chart REPORTS every pass it committed (chart/layerPaint.js:
 * the symbol, its resolved timeframe and session, and the very bars array it handed the library), and the flip asks the
 * store what that array would be NOW. Nothing is inferred from when a render happened.
 * @param {{sym, tf, ext, settings, cutoff}} want  what the front would show now: the symbol pressed to; the front chart's
 *   OWN last report's timeframe and session (its resolved values); the pane's stored settings (identity: the board hands
 *   both layers the same object); the widget's replay cutoff (change-date mode), or null
 * @param {{sym, tf, ext, bars, settings, cutoff}|null} report  the shadow chart's last committed pass (`settings`: the
 *   widget's settings when it reported; `cutoff`: the replay cutoff it drew under)
 * @param {(report) => any} barsNow  the bars array the store's base snapshot of that key gives NOW (null: none)
 * @param {() => string} view  'ok', or why the two charts' views differ (F1: viewParity)
 * @returns {{flip: boolean, why: string}}
 */
export function flipDecision(want, report, barsNow, view) {
  if (!want) return { flip: false, why: 'no-front' }
  if (!report) return { flip: false, why: 'no-shadow' }
  // ⭐ (lane C, zero-network PR 2.1) THE TIMEFRAME-PRESS FORM (`want.press === 'tf'`): the same symbol at the timeframe
  // pressed (`want.tf`: the code the bar pressed, which a plain ticker's chart resolves to itself; any other resolution
  // refuses on 'tf' below). Not in change-date mode: an intraday replay reads a window per timeframe, its switch has its
  // own warm (prefetchReplayTimeframes), and a hidden chart is never proved against it here.
  if (want.press === 'tf' && want.cutoff) return { flip: false, why: 'tf-replay' }
  // (owner, 2026-11-27; it was F6's refusal of any replay) change-date mode: the hidden chart drew under the front's
  // cutoff, or it shows other bars than the switch would (StockChart cuts every bar after it; intraday reads its window)
  if ((want.cutoff || null) !== (report.cutoff || null)) return { flip: false, why: 'cutoff' }
  // (owner, 2026-11-27) the date the member went to (the date box's anchor, `date|width`): drawn under the same one
  if ((want.anchor || null) !== (report.anchor || null)) return { flip: false, why: 'anchor' }
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

// ─── the view (review of #2922, F1; the typed-Enter dry run, 2026-11-27; the view mode, 2026-11-27) ─────────────
// What frames the NEXT symbol on a normal switch on /charts (StockChart's symbol-switch branch, in this order):
//   1. a REPLAY VIEW LOCK (a pan or zoom in change-date mode; replay only): `to = rows - barsFromRight`, its width;
//   2. a VIEW LOCK (a range button writes one, as a pan or a zoom does; tf-tagged): the newest bar at `anchorFrac` of
//      `width` (`from = lastIdx - anchorFrac x width`); one with the newest bar past the right edge (`anchorFrac > 1`)
//      is refused by the switch's back-in-time guard, which frames the default instead;
//   3. otherwise the PIN (`keepPresentOnSymbolChange` -> chart/rightMargin.js `pinNewestRange`): the zoom WIDTH kept,
//      the newest bar at the right margin (to = lastIdx + reserve + width x gap, the gap a fraction of the plot that
//      depends only on its pixel width, `reserve` the new SYMBOL's own developing-period slot), from ANY outgoing frame:
//      a front panned into history still switches to present.
// So the hidden chart is alike when it holds the SAME locks as the front (they frame every later switch too, once it
// is shown) and sits where they, or the pin, put its own symbol. A range button's read-back (`activeRange`) frames
// nothing by itself: the switch reads the lock the button wrote.
// ⚰️ The first rule also compared the two right edges: but the margin scales with the width, so two widths always had two
// right edges, and the mirror (which kept the hidden chart's right edge) never ran -> after the first width change every
// press refused 'view-offset' (1m+15m typed dry run: 4 of 14).
// ⚰️ (owner, 2026-11-27) Until the view mode, a range, a lock and replay were refused outright: zoomed out (2014-2026) or
// in change-date mode (a 2006 cutoff) every press was the normal switch.
const near = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 0.5
const spanOf = (f) => f.fromRight - f.toRight
const _same = (a, b) => (a == null && b == null) || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-6)
function viewBlocked(m) {
  if (!m || !m.frame || !Number.isFinite(m.frame.fromRight) || !Number.isFinite(m.frame.toRight)) return 'view-unknown'
  if (m.priceAuto === false) return 'view-price'
  if (m.replay && (m.replay.on || m.replay.mode)) return 'replay'   // a bar-by-bar replay is running on that chart
  return null
}
/** The view lock a chart holds (StockChart userLockedViewRef, as getDateMeta reads it back), or null. */
const lockOf = (m) => (m.frame.locked && m.frame.lock ? m.frame.lock : null)
const sameLock = (a, b) => (!a && !b) || (!!a && !!b && _same(a.anchorFrac ?? null, b.anchorFrac ?? null) && _same(a.width ?? null, b.width ?? null)
  && (a.tf ?? null) === (b.tf ?? null) && _same(a.top ?? null, b.top ?? null) && _same(a.bottom ?? null, b.bottom ?? null))
const sameReplayLock = (a, b) => (!a && !b) || (!!a && !!b && _same(a.barsFromRight, b.barsFromRight) && _same(a.width, b.width))
const sameLocks = (front, shadow) => !!lockOf(front) === !!lockOf(shadow) && sameLock(lockOf(front), lockOf(shadow))
  && sameReplayLock(front.replayLock ?? null, shadow.replayLock ?? null)
/**
 * The frame the switch gives the next symbol under the front's locks ({fromRight, toRight}), `{refuse}` when the switch
 * would frame what cannot be proved here (a lock past the newest bar: its default view), or null: no lock frames it (the
 * pin does).
 */
function lockFrameFor(front, tf) {
  const rl = front.replayLock
  if (rl && Number.isFinite(rl.barsFromRight) && rl.width > 0) return { fromRight: rl.barsFromRight - 1 + rl.width, toRight: rl.barsFromRight - 1 }
  const l = lockOf(front)
  if (l && Number.isFinite(l.anchorFrac) && l.width > 0 && (l.tf == null || l.tf === tf)) {
    const toRight = (l.anchorFrac - 1) * l.width
    if (toRight > 0.5) return { refuse: 'view-locked-past' }
    return { fromRight: l.anchorFrac * l.width, toRight }
  }
  return null
}
const sameAnchor = (a, b) => (!a && !b) || (!!a && !!b && a.date === b.date && _same(a.width, b.width))
/** The hidden chart's history does not reach its frame's left edge (the switch would wait for the rows that cover it). */
const shortOf = (m) => Number.isFinite(m.rows) && m.frame.fromRight > m.rows - 1 + 0.5
/** 'ok' when the normal switch from the front's view would frame the symbol as the hidden chart shows it: the same
 *  locks, at the frame they give it (or, with none framing it, the same width), its history covering that frame; nothing
 *  that overrides the frame on either (a hand-set price scale, a running replay). `ctx.tf`: the front chart's timeframe. */
export function viewParity(front, shadow, ctx = {}) {
  const b = viewBlocked(front) || viewBlocked(shadow)
  if (b) return b
  // (owner, 2026-11-27) THE DATE THE MEMBER WENT TO frames every switch before any lock or pin (StockChart
  // anchorOwnsFrame): each chart frames its OWN rows at it (a prop both layers get), and reads back the frame it gives
  // (`anchorFrame`). Alike when the hidden chart holds the same anchor, sits at that frame, and its rows hold the date
  // and reach the frame's left edge (a date before its loaded rows: its earliest bars, which may still be loading).
  // ⭐ (the cold-ticker measurement, 2026-11-28: 16 of 16 arrows refused for a view lock) decided BEFORE the locks: a
  // pan or zoom at the date writes the front a view lock, which frames no switch while the anchor does (StockChart's
  // lock branches run only when !anchorOwnsFrame(); the widget moves the anchor to the member's view instead), so a lock
  // only the front held refused every press at the date.
  if (!sameAnchor(front.anchor, shadow.anchor)) return 'view-anchor'
  if (front.anchor) {
    const af = shadow.anchorFrame
    if (!af || shadow.anchorEarliest) return 'view-short'
    if (!near(shadow.frame.fromRight, af.fromRight) || !near(shadow.frame.toRight, af.toRight)) return 'view-frame'
    return shortOf(shadow) ? 'view-short' : 'ok'
  }
  if (!sameLocks(front, shadow)) return 'view-lock'
  const lf = lockFrameFor(front, ctx.tf)
  if (lf && lf.refuse) return lf.refuse
  if (lf) {
    if (!near(shadow.frame.fromRight, lf.fromRight) || !near(shadow.frame.toRight, lf.toRight)) return 'view-frame'
  } else if (!near(spanOf(front.frame), spanOf(shadow.frame))) return 'view-zoom'
  if (shortOf(shadow)) return 'view-short'
  return 'ok'
}
/** The right-margin fraction of a plot `plotWidthPx` wide (chart/rightMargin.js lastCandlePos), or null. */
function gapFracOf(plotWidthPx) {
  if (!Number.isFinite(plotWidthPx) || plotWidthPx <= 0) return null
  return 1 - lastCandlePos(plotWidthPx)
}
/** The pin's frame for the hidden chart at width `w` ({fromRight, toRight}), or null when it is already there or cannot
 *  be known (see mirrorFrameFor). */
function pinFrameFor(front, shadow, w) {
  const ws = spanOf(shadow.frame)
  const own = Number.isFinite(shadow.pinReserve) ? Math.max(0, shadow.pinReserve) : null
  if (near(w, ws)) {
    const g = gapFracOf(shadow.plotWidthPx)
    if (g == null || own == null) return null
    const pin = -(own + ws * g)
    if (Math.abs(shadow.frame.toRight - pin) <= 0.5) return null
    return { fromRight: pin + ws, toRight: pin }
  }
  const gf = gapFracOf(shadow.plotWidthPx) ?? gapFracOf(front.plotWidthPx)
  // without a plot width, the margin is read from the hidden chart itself (its whole right edge, no reserve)
  const gap = gf != null ? gf : (ws > 0 ? Math.max(0, -shadow.frame.toRight) / ws : 0)
  const reserve = gf == null ? 0 : own != null ? own : Math.max(0, Math.round(-shadow.frame.toRight - ws * gap))
  const toRight = -(reserve + w * gap)
  return { fromRight: toRight + w, toRight }
}
/**
 * The frame that prepares the hidden chart in the front's view MODE (StockChart restoreView): the front's locks (view
 * lock, replay view lock) and the frame they give its symbol, or, with none framing it, the front's WIDTH pinned as the
 * switch pins it. null when it is already there, or when nothing may be mirrored (a hand-set price scale, a running
 * replay, a lock past the newest bar). The pin's `reserve` is the one the hidden chart says a switch would use now
 * (`pinReserve`, StockChart getDateMeta), or else is read back from its current pin: its right edge minus its width's
 * margin. (review of #2932) The widths alike, the hidden chart is still re-pinned when its right edge is more than half a
 * bar off that pin: the widget was resized while it was hidden (a new plot width, a new margin), or a D/W/M chart got
 * today's first bar while pinned (its reserve went, the library moved the range). Only with its own plot width and
 * pinReserve: without them the pin is not known.
 */
export function mirrorFrameFor(front, shadow, ctx = {}) {
  if (viewBlocked(front) || viewBlocked(shadow)) return null
  // (owner, 2026-11-27) never over a date anchor: each chart frames its own symbol at it (the prop both layers get)
  if (front.anchor || shadow.anchor) return null
  const locksAlike = sameLocks(front, shadow)
  const l = lockOf(front)
  const modeOf = (f) => ({ fromRight: f.fromRight, toRight: f.toRight, activeRange: null, locked: !!l, lock: l ? { ...l } : null,
    replayLock: front.replayLock ? { ...front.replayLock } : null })
  const lf = lockFrameFor(front, ctx.tf)
  if (lf && lf.refuse) return null
  if (lf) {
    if (locksAlike && near(shadow.frame.fromRight, lf.fromRight) && near(shadow.frame.toRight, lf.toRight)) return null
    return modeOf(lf)
  }
  const w = spanOf(front.frame)
  if (!(w > 0)) return null
  const pin = pinFrameFor(front, shadow, w)
  if (pin) return modeOf(pin)
  return locksAlike ? null : modeOf(shadow.frame)
}
/**
 * (2026-11-28, sweep 2 COV-zo-h4h2-arrows: 24 of 24 refused 'view-frame', 24 flips the sweep before) WHAT A VIEW REFUSAL
 * COMPARED: both charts' frames (counted from the newest bar), their locks, rows, plot widths and pins, and the frame the
 * front's lock gives the next symbol. Diagnostics only: logged with the decision (doubleBufferStats().log[].view).
 */
export function viewDetail(front, shadow, ctx = {}) {
  const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : v ?? null)
  const of = (m) => (!m ? null : {
    fromRight: r1(m.frame?.fromRight), toRight: r1(m.frame?.toRight), locked: !!m.frame?.locked,
    lock: m.frame?.lock ? { anchorFrac: r1(m.frame.lock.anchorFrac), width: r1(m.frame.lock.width), tf: m.frame.lock.tf ?? null } : null,
    replayLock: m.replayLock || null, rows: m.rows ?? null, plotWidthPx: r1(m.plotWidthPx), pinReserve: m.pinReserve ?? null,
    anchor: m.anchor || null, priceAuto: m.priceAuto ?? null,
  })
  let lf = null
  try { lf = front && front.frame ? lockFrameFor(front, ctx.tf) : null } catch { lf = null }
  return { front: of(front), shadow: of(shadow), lockFrame: lf ? { fromRight: r1(lf.fromRight), toRight: r1(lf.toRight), refuse: lf.refuse ?? null } : null, tf: ctx.tf ?? null }
}

/** (N4) Is the mirror's frame still the front's mode at the write? restoreView writes the hidden chart's view lock under
 *  the pane's key, which both layers share (`uct.charts.viewLock.<chartId>`): only the lock the front holds may go there. */
export function mirrorStillFits(frame, front) {
  if (!frame || !front || !front.frame) return false
  return sameLock(frame.locked ? frame.lock : null, lockOf(front)) && sameReplayLock(frame.replayLock ?? null, front.replayLock ?? null)
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
  _stats.log.push({ sym, why: d.why, sinceSet: extra.sinceSet ?? null, sinceReport: extra.sinceReport ?? null, press: extra.press ?? 'sym', ...(extra.view ? { view: extra.view } : {}) })
  if (_stats.log.length > 64) _stats.log.splice(0, _stats.log.length - 64)
  try { if (typeof window !== 'undefined') window.__uctDoubleBuffer = _stats } catch { /* no window */ }
}
export function noteRetarget() { _stats.retargets += 1 }
export function __resetDoubleBufferStatsForTests() {
  _stats.flips = 0; _stats.switches = 0; _stats.why = {}; _stats.retargets = 0; _stats.last.length = 0; _stats.log.length = 0
}
