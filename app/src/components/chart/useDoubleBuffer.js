// app/src/components/chart/useDoubleBuffer.js
//
// ─── ⭐⭐ THE CHART WIDGET'S TWO LAYERS (2026-11-27, the double-buffered next row; rules in doubleBuffer.js) ──────────
//
// A list-linked chart widget renders its pane TWICE, stacked: the FRONT (shown) and the SHADOW (laid out under it,
// visibility hidden, inert), each under its own layer handle: NESTED in the board's (hidden whenever the board is) and
// CURRENT (a hidden layer keeps its bar store BASE feed, re-rendered in idle tasks; boardVisibility.js), so the shadow's
// loops, keys, intervals, crosshair, debug handle and manifest slot are paused exactly like a hidden board's while its
// bars stay current. The two panes get the SAME props except `sym`.
//
//   • A press to the row the shadow holds, when the shadow's chart has REPORTED a pass of that symbol at the front
//     chart's timeframe, session and the widget's settings, holding the bars the store gives that key NOW (review of
//     #2922, F3), drawn under the widget's replay cutoff, with the two charts' views alike (F1: the view MODE): the
//     FLIP. The layers swap roles in the press's render (`front` is state); in its commit the handles swap QUIETLY (the
//     shown one's muted feeds catch up there, the live developing bar included), focus inside the old front moves to the
//     new one (F5), and the group member's paint is recorded as a 'flip' for the switch-speed instrument.
//   • Any other press: the NORMAL switch of the front pane, exactly today's path.
//   • After every change of the front's symbol: the hidden pane is set, in idle time (a transition), to the row ahead
//     in the direction of travel (doubleBuffer.nextShadowSym). After a change of the front's view, and after each pass
//     of the shadow, the shadow MIRRORS the front's view mode in idle time: its locks (a view lock: a range, a pan, a
//     zoom; a replay view lock) at the frame they give it, or its zoom width (doubleBuffer.mirrorFrameFor, F1). The
//     replay cutoff reaches both layers as a prop (owner, 2026-11-27: instant zoomed out and in change-date mode).
//   • (F2) The board's shadow budget is the BOARD SLOT's (its layer handle), and a widget on a board that is not shown
//     gives its shadow back (and drops the hidden pane) until the board is shown again.
//
// ⛔ A WIDGET THE BOARD CANNOT GIVE A SHADOW (MAX_SHADOWS taken), a host with no group scope, the <Activity> keep-alive
// (its handle is no layer), the store off, the touch tier: never double-buffered (`eligible` false), one pane as before.

import { startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createBoardVisibility } from './boardVisibility'
import { getBarStore } from '../../data/barStore/index'
import { legacyBars } from '../../data/barStore/adapter'
import { keyOf } from '../../data/barStore/types'
import { customSpecOf, deriveCustomTf, deriveWmFromDaily } from './customTfRows'
import { baseBarsFor } from './timeframes'
import { BARSTORE } from './barStoreSwitch'
import { chartKeyFor, viewWindowOfDate } from './useBarSnapshotBars'
import { subscribeScanNeighbors, typedNextFor } from './neighborFrames'
import { recordPaint, viewNeed } from './paintLog'
import { setFlipProbe } from './flipReady'
import { heldRows, lakePending, deepPending } from '../../data/barStore/prefetch'
import { afterPaint } from '../../utils/afterPaint'
import {
  doubleBufferOn, acquireShadow, shadowTargetsFor, flipDecision, viewParity, tfViewParity, mirrorFrameFor, mirrorStillFits, noteDecision, noteRetarget,
} from './doubleBuffer'
import { habitualTfs } from './tfHabit'

/** The bars array a chart of the reported symbol, timeframe and session hands the library NOW, by the chart's own
 *  path (useBarSnapshotBars): the base snapshot's rows (`adapter.legacyBars`, memoised per snapshot); for a CUSTOM
 *  timeframe, their filed resample (customTfRows.deriveCustomTf); for W / M whose own key is still empty, the filed
 *  resample of the held daily rows (deriveWmFromDaily) (review of #2922, N2). null: no store, no key, not held.
 *  Never creates a registry entry. */
export function barsNowFor(report) {
  if (!report || !report.sym || !_storeOn()) return null
  // (owner, 2026-11-27) under the cutoff the chart drew at: an intraday replay reads its own window (chartKeyFor)
  // (owner, 2026-11-27) and under the date box's anchor (`date|width`): an intraday chart's window at that date
  const key = chartKeyFor({ sym: report.sym, resolvedTf: report.tf, showExtended: !!report.ext, replayCutoff: report.cutoff || null, hasOverride: false, viewWindow: reportWindow(report) })
  if (!key) return null
  return _barsOf(key, report)
}
/** The window the reported chart read ({to}): an INTRADAY chart under a replay cutoff, or anchored at a date by the date
 *  box, reads the window ending at that date (chartKeyFor, the replay's own first); null on D/W/M, a custom timeframe, or
 *  at the present. */
export function reportWindow(report) {
  if (!report) return null
  if (report.cutoff) return viewWindowOfDate(report.cutoff, report.tf)
  return report.anchor ? viewWindowOfDate(String(report.anchor).split('|')[0], report.tf) : null
}
const _storeBars = (key, report) => {
  const store = getBarStore()
  const snap = store.registry.has(key) ? store.getBaseSnapshot(key) : null
  const all = snap ? legacyBars(snap) : null
  const tf = String(report?.tf ?? '')
  const spec = report ? customSpecOf(tf, !!report.ext) : null
  if (spec) return all?.length ? deriveCustomTf(all, spec) : null
  if ((tf === 'W' || tf === 'M') && !all?.length) {
    const d = store.peek ? store.peek(keyOf({ sym: report.sym, tf: 'D' })) : null
    const daily = d ? legacyBars(d) : null
    return daily?.length ? deriveWmFromDaily(daily, tf) : null
  }
  return all
}
let _barsOf = _storeBars
let _storeOn = () => !!BARSTORE
/** Tests: the bar store's switch as this module reads it (null restores BARSTORE). */
export function __setDoubleBufferStoreForTests(v) { _storeOn = v === null || v === undefined ? () => !!BARSTORE : () => !!v }
/** Tests: what a key's bars are NOW (null restores the bar store). */
export function __setDoubleBufferBarsSourceForTests(fn) { _barsOf = typeof fn === 'function' ? fn : _storeBars }

/** ⭐ (review of #2934, L3) Is NOTHING MORE COMING for the reported key: D/W/M with no deep history due, intraday with no
 *  lake depth due and the server's answer of this life held? The switch's exemption for a set shorter than the view
 *  (useSymbolHandoff paintsWholeNow / dailyHoldNeeded): such a set is the whole chart. Unknown reads as false. */
export function shadowWhole(report) {
  try {
    if (!report || !report.sym) return false
    const tf = String(report.tf)
    const sess = { showExtended: !!report.ext }
    if (tf === 'D' || tf === 'W' || tf === 'M') return !deepPending(report.sym, tf, sess)
    // (owner, 2026-11-27: charts at any date) an intraday chart at a past date drew the WINDOW ending there: the lake
    // never joins a window (historyFeed lakeSeriesOfKey), so it is whole once the server answered it in this life
    const viewWindow = reportWindow(report)
    if (viewWindow) return (heldRows(report.sym, tf, { ...sess, viewWindow, answered: true, upTo: 1 }) || 0) > 0
    return !lakePending(report.sym, tf, sess) && (heldRows(report.sym, tf, { ...sess, answered: true, upTo: 1 }) || 0) > 0
  } catch { return false }
}

/** Can this widget be double-buffered at all (the page's switch, the store, a deciding board, a layer or no parent)? */
export function doubleBufferEligible({ scope, color, parentVis }) {
  return doubleBufferOn() && _storeOn() && !!scope && !!color && (!parentVis || !!parentVis.layer)
}

const _ric = (fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 1000 }) : setTimeout(fn, 50))
const _cic = (h) => { try { if (typeof cancelIdleCallback === 'function') cancelIdleCallback(h); else clearTimeout(h) } catch { /* gone */ } }
const MIRROR_DEBOUNCE_MS = 120
/** (lane C) How long after a retarget the hidden layer's feed re-renders in its own task, not idle time
 *  (boardVisibility.forwardWhileCurrent `promptUntil`), unless its chart reports first. */
export const RETARGET_PROMPT_MS = 1500
/** (plan 2.4, the #2997 cloud A/B: zoomed-out 4h+2h typed p100 276 -> 1143 ms with three layers) the THIRD layer steps
 *  aside while the front shows more than this many bars across, or a custom timeframe (4h / 2h / 45m: a resample of
 *  thousands of base rows per pane): a second hidden pane there competed with the front's own paint. Two layers then. */
export const THIRD_LAYER_MAX_SPAN = 1000
/** Is the front heavy enough that the third layer steps aside? (its view's span, its timeframe) */
export function frontTooHeavyForThird(frontMeta, frontTf) {
  if (frontTf != null && customSpecOf(String(frontTf), false)) return true
  const fr = frontMeta && frontMeta.frame
  const span = fr && Number.isFinite(fr.fromRight) && Number.isFinite(fr.toRight) ? fr.fromRight - fr.toRight : null
  return span != null && span > THIRD_LAYER_MAX_SPAN
}
const _now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now())

/**
 * @param {object} o
 * @param {boolean} o.eligible        doubleBufferEligible(...) for this widget (stable for its life)
 * @param {string} o.sym              the symbol the widget shows now (useSymbolHandoff's)
 * @param {string|null} o.tf          (lane C, PR 2.1) the widget's timeframe now: a change of it alone is a TIMEFRAME press,
 *                                    which flips when the hidden layer holds this symbol at that timeframe
 * @param {string[]|null} o.tfBar     the codes on the chart's timeframe bar (the habitual timeframe is one of them)
 * @param {2|3} o.layers              (plan 2.4) the widget's layer count for its life: 3 = two hidden panes (thirdLayerOn)
 * @param {object|null} o.settings    the pane's stored settings (identity)
 * @param {string|null} o.cutoff     the widget's replay cutoff (change-date mode), or null: a flip needs a hidden chart that
 *                                    drew under the same one
 * @param {string|null} o.anchor     the date the member went to (the date box, `date|width`), or null: likewise
 * @param {object} o.scope            the board's group store (the shadow budget's scope when there is no board handle)
 * @param {object|null} o.member      the identity the widget's chart paints under (PaintMemberContext)
 * @param {object|null} o.parentVis   the board's layer handle, or null
 * @param {() => object[]} o.panes    each layer's pane instance (ChartPane's imperative handle: getDateMeta, viewDo, focus)
 * @param {() => Element[]} o.layerEls each layer's wrapper element
 * @returns {{on: boolean, syms: (string|null)[], tfs: (string|null)[], front: number, handles: object[], reporters: Function[], viewChanged: Function, focusFront: Function}}
 */
export function useDoubleBuffer({ eligible, sym, tf = null, tfBar = null, layers = 2, settings, cutoff = null, anchor = null, scope, member, parentVis, panes, layerEls }) {
  const [owner] = useState(() => ({}))
  const [slotOk, setSlotOk] = useState(false)
  // each layer's handle: NESTED in the board's and CURRENT, made once, disposed at unmount
  // (lane C, plan 2.4) the layer count is the widget's for its life: 2 (one hidden pane) or 3 (two) on a desktop that can
  // hold them (doubleBuffer.thirdLayerOn; ChartWidget decides it once)
  const [N] = useState(() => (layers === 3 ? 3 : 2))
  const [IDX] = useState(() => Array.from({ length: N }, (_, i) => i))
  const hiddenOf = (b) => IDX.filter((i) => i !== b.front)
  const [handles] = useState(() => IDX.map((i) => {
    const h = createBoardVisibility({ layer: true, current: true, parent: parentVis })
    if (i > 0) h.state = 'hidden'   // before anything subscribes: no one to tell
    return h
  }))
  useEffect(() => () => { for (const h of handles) h.dispose() }, [handles])
  // (lane C, PR 2.1) each layer's own timeframe: the front's is the widget's; the hidden one's is the front's when it holds
  // the row ahead, or the habitual next timeframe when it holds the front's own symbol (doubleBuffer.shadowTargetFor)
  const [buf, setBuf] = useState(() => ({ syms: IDX.map((i) => (i ? null : sym || null)), tfs: IDX.map((i) => (i ? null : tf)), front: 0 }))
  const bufRef = useRef(buf)
  bufRef.current = buf
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const reportsRef = useRef(IDX.map(() => null))   // each layer's chart's last committed pass (F3)
  const pendingRef = useRef(null)           // the press's decision, applied in its commit (F8: no side effect in render)
  const mirrorRef = useRef({ timer: 0, idle: 0 })
  const heldRef = useRef(false)             // the widget holds a shadow NOW (set in the board handle's own task)
  const timesRef = useRef({ set: IDX.map(() => null), report: IDX.map(() => null) })   // when each layer was last set to a row / last reported
  const waitFrontRef = useRef(null)         // the mount's retarget, waiting for the front chart's first report (LOW-2)
  const firstRetargetRef = useRef(false)    // the widget's first retarget has been scheduled

  // ── (F2) the budget: the board SLOT's, given back while the board is not shown ──
  // ⛔ (delta review of #2922, N1) A BOARD SWITCH RE-RENDERS NOTHING HERE. The workspace hides and shows boards in its
  // click handler, which tells this handle's subscribers synchronously: the budget moves there (a Set, nothing else),
  // and the widget's own state follows in a TRANSITION (never the click's commit); the hidden pane itself goes in idle
  // time (below), so the switch's commit unmounts no chart and renders no pane (#2901: a hide or a show re-renders
  // nothing).
  useLayoutEffect(() => {
    if (!eligible) return undefined
    const key = parentVis || scope
    let release = null
    const sync = (initial = false) => {
      // (delta 2, D2-1) the budget's truth at once, for the idle drop below (the state follows in a transition)
      const shown = !parentVis || parentVis.state === 'visible'
      let next = null
      if (shown && !release) {
        release = acquireShadow(key, owner)
        next = !!release
      } else if (!shown && release) {
        release(); release = null
        next = false
      }
      if (next === null) return
      heldRef.current = next
      if (initial) setSlotOk(next)
      else startTransition(() => setSlotOk(next))
    }
    sync(true)
    const off = parentVis && typeof parentVis.subscribe === 'function' ? parentVis.subscribe(() => sync(false)) : null
    return () => { if (off) off(); if (release) release(); heldRef.current = false }
  }, [eligible, scope, owner, parentVis])
  // a widget without a shadow holds no hidden pane (its canvases go): in idle time, as a transition
  useEffect(() => {
    if (!eligible || slotOk) return undefined
    const idle = _ric(() => {
      if (heldRef.current) return   // (D2-1) the board was shown again and took the shadow back: keep the pane
      const b = bufRef.current
      if (hiddenOf(b).every((i) => b.syms[i] == null)) return
      for (const i of hiddenOf(b)) reportsRef.current[i] = null
      startTransition(() => setBuf((x) => {
        if (hiddenOf(x).every((i) => x.syms[i] == null)) return x
        const syms = x.syms.map((v, i) => (i === x.front ? v : null))
        return { syms, tfs: x.tfs, front: x.front }
      }))
    })
    return () => _cic(idle)
  }, [eligible, slotOk])   // eslint-disable-line react-hooks/exhaustive-deps -- hiddenOf reads the fixed layer count

  // ── the press: flip, or switch the front. Decided in render (`front` is the one thing that moves); its side
  // effects (stats, the paint record, the focus) wait for the commit ──
  // ONE DECISION, ASKED TWICE: here at the press, and EARLIER by the handoff (flipReady.js), which shows at once a row the
  // shadow can flip to instead of holding it (the two can never disagree: the same function, the same refs)
  // (the panes accessor through a ref of its own, declared here: `decide` also runs from the probe, after this render)
  const panesNowRef = useRef(panes)
  panesNowRef.current = panes
  // (lane C, PR 2.1) `wantTf`: a TIMEFRAME press (the same symbol at the code pressed); null: a symbol press, asked at the
  // front chart's resolved timeframe. Both carry the date the member went to (#2947's anchor).
  const decide = (want_sym, b, okSlot, set, cut, anch, wantTf = null) => {
    const f = b.front
    const fr = reportsRef.current[f]
    const tfPress = wantTf != null
    // (plan 2.4) the hidden layer that holds the press: one whose chart reported first, else any (its refusal says why)
    const holdsAt = (i) => b.syms[i] === want_sym && (!tfPress || String(b.tfs[i]) === String(wantTf))
    const hid = hiddenOf(b)
    const s = hid.find((i) => holdsAt(i) && reportsRef.current[i]) ?? hid.find((i) => holdsAt(i)) ?? hid[0]
    const want = !fr ? null : tfPress ? { press: 'tf', sym: want_sym, tf: String(wantTf), ext: fr.ext, settings: set, cutoff: cut || null, anchor: anch || null }
      : { sym: want_sym, tf: fr.tf, ext: fr.ext, settings: set, cutoff: cut || null, anchor: anch || null }
    const report = okSlot && holdsAt(s) ? reportsRef.current[s] : null
    const view = () => {
      const p = panesNowRef.current ? panesNowRef.current() : []
      return tfPress ? tfViewParity(p[f]?.getDateMeta?.(), p[s]?.getDateMeta?.(), { tf: String(wantTf) })
        : viewParity(p[f]?.getDateMeta?.(), p[s]?.getDateMeta?.(), { tf: fr?.tf })
    }
    let d = flipDecision(want, report, barsNowFor, view)
    // ⭐⭐ (2026-11-27, review of #2934: a typed cold ticker flipped to a shadow painted from a short page, and the deep
    // history's join then rescaled both charts at 966 ms) A SHADOW IS FLIPPABLE ONLY WHEN ITS ROWS COVER THE VIEW: the
    // same rule as the switch (paintLog viewNeed, counted in the view's session by the store's heldRows). Short, the
    // press takes the normal switch, which holds for a covering page.
    // (owner, 2026-11-27: charts at any date) counted on the key the hidden chart DREW (reportWindow): an intraday chart
    // at a past date (the date box, a replay cutoff) reads the window ending there, and the plain key's newest rows are
    // another set (short of the view, a flip refused that was ready; covering, a short window let through)
    if (d.flip && BARSTORE && report) {
      // (2026-11-28) counted in the rows of the KEY the store holds: a custom timeframe's (4h, 2h) are its native base's
      // (heldRows reads that key), so the view's need is asked in base rows too (timeframes.baseBarsFor; native: unchanged)
      const need = baseBarsFor(String(report.tf), viewNeed(member))
      let rows = 0
      try { rows = heldRows(report.sym, report.tf, { showExtended: !!report.ext, viewWindow: reportWindow(report), upTo: need }) || 0 } catch { rows = 0 }
      // ...unless nothing more is coming for it (review of #2934, L3: the switch's own exemption, paintsWholeNow /
      // dailyHoldNeeded): a young listing's whole history is shorter than any view, and refusing it sent every press to
      // the normal switch for no gain
      if (rows && rows < need && !shadowWhole(report)) d = { flip: false, why: 'shadow-short' }
    }
    // (2026-11-27, the live dry run) WHICH 'no-shadow': no budget, no hidden pane, the hidden pane on ANOTHER row (the
    // list's next row moved, the member reversed), or on this row with no committed pass yet (its chart still loading)
    if (d.why === 'no-shadow') {
      d = { flip: false, why: !okSlot ? 'no-slot' : hid.every((i) => b.syms[i] == null) ? 'no-shadow'
        : !hid.some((i) => b.syms[i] === want_sym) ? 'shadow-other-row'
          : tfPress && !hid.some((i) => holdsAt(i)) ? 'shadow-other-tf' : 'shadow-unreported' }
    }
    return { d, report, s }
  }
  const slotOkRef = useRef(slotOk)
  slotOkRef.current = slotOk
  const cutoffRef = useRef(cutoff)
  cutoffRef.current = cutoff
  const anchorRef = useRef(anchor)
  anchorRef.current = anchor
  const eligibleRef = useRef(eligible)
  eligibleRef.current = eligible
  const decideRef = useRef(decide)
  decideRef.current = decide   // the probe asks THIS render's decision (its `member` and refs; never a stale closure)
  // the handoff's early question (flipReady.js): would a press to `s` flip now? (read off the refs of the last render)
  useLayoutEffect(() => {
    if (!member) return undefined
    setFlipProbe(member, (s) => {
      const b = bufRef.current
      if (!eligibleRef.current || !s || s === b.syms[b.front]) return false
      try { return decideRef.current(s, b, slotOkRef.current, settingsRef.current, cutoffRef.current, anchorRef.current).d.flip === true } catch { return false }
    })
    return () => setFlipProbe(member, null)
  }, [member])   // eslint-disable-line react-hooks/exhaustive-deps -- decide reads refs only
  const symPress = !!(eligible && sym && sym !== buf.syms[buf.front])
  // (lane C, PR 2.1) a TIMEFRAME press: the same symbol, another timeframe
  const tfMoved = tf != null && buf.tfs[buf.front] != null && String(tf) !== String(buf.tfs[buf.front])
  const tfPress = !!(eligible && sym && !symPress && tfMoved)
  if (symPress || tfPress) {
    const f = buf.front
    // a symbol AND a timeframe change in one render (a template, the agent): the normal switch of both
    const { d, report, s } = symPress && tfMoved ? { d: { flip: false, why: 'sym-and-tf' }, report: null, s: hiddenOf(buf)[0] }
      : decide(sym, buf, slotOk, settings, cutoff, anchor, tfPress ? String(tf) : null)
    const now = _now()
    const t = timesRef.current
    pendingRef.current = {
      d, sym, from: f, tf: report?.tf ?? (tfPress ? String(tf) : undefined), bars: report?.bars?.length || 1, press: tfPress ? 'tf' : 'sym',
      sinceSet: t.set[s] != null ? Math.round(now - t.set[s]) : null, sinceReport: t.report[s] != null ? Math.round(now - t.report[s]) : null,
    }
    if (d.flip) {
      setBuf({ syms: buf.syms, tfs: buf.tfs, front: s })
    } else {
      const syms = buf.syms.slice()
      const tfs = buf.tfs.slice()
      syms[f] = sym
      tfs[f] = tf
      reportsRef.current[f] = null   // the front's next pass reports the new symbol / timeframe
      // (the hidden layer follows in the retarget the front's new timeframe schedules; its chart's report names its own
      // timeframe, so it cannot be flipped to at the old one meanwhile)
      setBuf({ syms, tfs, front: f })
    }
  }

  // ── the commit: the handles follow `front` QUIETLY; a flip records its paint and carries the focus (F5) ──
  useLayoutEffect(() => {
    if (!eligible) return
    const f = buf.front
    for (const i of IDX) if (i !== f) handles[i].flip('hidden')
    handles[f].flip('visible')
    const p = pendingRef.current
    if (!p) return
    pendingRef.current = null
    noteDecision(p.d, p.press === 'tf' ? `${p.sym}@${p.tf ?? '?'}` : p.sym, { sinceSet: p.sinceSet, sinceReport: p.sinceReport, press: p.press })
    if (!p.d.flip) return
    recordPaint(p.sym, p.tf, p.bars, 'flip', member)
    try {
      const els = layerEls ? layerEls() : []
      const was = els[p.from]
      const active = typeof document !== 'undefined' ? document.activeElement : null
      if (was && active && was.contains(active)) panes?.()?.[f]?.focus?.()
    } catch { /* focus is best effort */ }
  }, [eligible, buf, handles, member])   // eslint-disable-line react-hooks/exhaustive-deps -- panes / layerEls / IDX are read when it runs

  // ── (F1) the shadow mirrors the front's zoom, in idle time, debounced ──
  const scheduleMirror = () => {
    const m = mirrorRef.current
    if (m.timer) clearTimeout(m.timer)
    m.timer = setTimeout(() => {
      m.timer = 0
      if (m.idle) return
      m.idle = _ric(() => {
        m.idle = 0
        const b = bufRef.current
        const p = panes ? panes() : []
        const front = p[b.front]
        if (!front) return
        for (const i of IDX) {   // (plan 2.4) every hidden pane
          const shadow = p[i]
          if (i === b.front || !shadow || !b.syms[i]) continue
          let frame = null
          // (review of #3008, F5) a hidden chart at ANOTHER timeframe takes only the pin (the front's width): a view lock or
          // a replay view lock counts bars of the front's timeframe, which mean nothing at another one
          const fm = front.getDateMeta?.()
          if (String(b.tfs[i]) !== String(b.tfs[b.front]) && fm && ((fm.frame && fm.frame.locked && fm.frame.lock) || fm.replayLock)) continue
          try { frame = mirrorFrameFor(fm, shadow.getDateMeta?.(), { tf: reportsRef.current[b.front]?.tf }) } catch { frame = null }
        // (N4) restoreView also writes the view lock under the pane's key, which both layers share
        // (`uct.charts.viewLock.<chartId>`): the frame carries the FRONT's locks, so the write stores the lock the front
        // holds; read again here, at the write, so a lock the member changed in between is never overwritten
          let fits = false
          try { fits = mirrorStillFits(frame, front.getDateMeta?.()) } catch { fits = false }
          if (frame && fits) { try { shadow.viewDo?.('restoreView', frame) } catch { /* a mirror is best effort */ } }
        }
      })
    }, MIRROR_DEBOUNCE_MS)
  }
  useEffect(() => () => {
    const m = mirrorRef.current
    if (m.timer) clearTimeout(m.timer)
    if (m.idle) _cic(m.idle)
  }, [])

  // each layer's chart reports its passes here (LayerPaintContext), with the widget's settings at that commit
  const retargetKickRef = useRef(null)   // (plan 2.4) a hidden pane reported: the others take what is left
  const [reporters] = useState(() => IDX.map((i) => (r) => {
    reportsRef.current[i] = { sym: r.sym, tf: r.tf, ext: !!r.ext, bars: r.bars, cutoff: r.cutoff || null, anchor: r.anchor || null, settings: settingsRef.current }
    timesRef.current.report[i] = _now()
    handles[i].promptUntil = 0   // (lane C) its first pass of the row is drawn: later updates go back to idle time
    // (review of #2930, LOW-2) the mount's retarget waits for the FRONT's first pass: the shadow does not compete with
    // the board's first paint, and is still set long before the first press
    if (i === bufRef.current.front && waitFrontRef.current) { const w = waitFrontRef.current; waitFrontRef.current = null; w() }
    if (i !== bufRef.current.front) { scheduleMirror(); if (N > 2) retargetKickRef.current?.() }
  }))
  // each layer's view changed (its time range moved: a zoom, a pan, a range): the front's moves the shadow's
  const [viewChanged] = useState(() => (i) => { if (i === bufRef.current.front) { scheduleMirror(); if (N > 2) retargetKickRef.current?.() } })
  // (review of #2932) the pane shown NOW takes the focus: ChartPane's refocus after a typed Enter calls this when its own
  // pane is the inert old front (the Enter FLIPPED), so the keys go on reaching the chart (chart/layerPaint.js)
  const panesRef = useRef(panes)
  panesRef.current = panes
  const [focusFront] = useState(() => () => {
    try { panesRef.current?.()?.[bufRef.current.front]?.focus?.() } catch { /* a pane mid-unmount: nothing to focus */ }
  })

  // ── the retarget: after the front's symbol changed (or the list publishes), the hidden pane takes the next row ──
  // ⭐ (2026-11-27, the live dry run: 1 s presses found the hidden pane not on the row ahead yet) RIGHT AFTER THE FRAME,
  // not in idle time: a page busy with streams and history landing gave `requestIdleCallback` no idle period for most of
  // a second. The retarget is a transition (React yields to any press), scheduled after the paint of the frame that
  // showed the press (utils/afterPaint); at mount after the FRONT chart's first pass (review of #2930, LOW-2), so the
  // FIRST press finds it too. ONE pending schedule at a time (LOW-1): a live-sorted list republishes its neighbours often.
  const frontSym = buf.syms[buf.front]
  const frontTf = buf.tfs[buf.front]
  const lastTypedRef = useRef(null)   // (plan 2.4) the last typed candidate a pane was moved to
  const tfBarRef = useRef(tfBar)
  tfBarRef.current = tfBar
  useEffect(() => {
    if (!eligible || !slotOk || !frontSym) return undefined
    let alive = true
    let pending = null
    const run = (urgent = false) => {
      if (!alive) return
      const b = bufRef.current
      const f = b.syms[b.front]
      const ftf = b.tfs[b.front]
      // (lane C, PR 2.1) the row ahead at the front's timeframe, or (no list) the front's symbol at its habitual next one
      // (review of #3008, F4) never in change-date mode: a timeframe press there never flips ('tf-replay')
      const habit = ftf != null && !cutoffRef.current ? habitualTfs(String(ftf), { k: 2, available: Array.isArray(tfBarRef.current) ? tfBarRef.current : null }) : []
      // (plan 2.4) the first N-1 targets; a TYPED retarget (urgent) moves ONE pane, and with three layers never the pane
      // holding the previous candidate: kept until the new one reports (its report kicks the full retarget)
      // (plan 2.4) a heavy front (zoomed out, a custom timeframe): ONE hidden pane, the third one dropped
      let heavy = false
      if (N > 2) { try { heavy = frontTooHeavyForThird((panes ? panes() : [])[b.front]?.getDateMeta?.(), ftf) } catch { heavy = false } }
      const n = heavy ? 1 : N - 1
      const full = shadowTargetsFor(f, ftf, habit, n)
      if (heavy) {
        // keep the pane holding the one target (or the first holding anything); every other hidden pane goes
        const hid = hiddenOf(b)
        const holdsT = (i) => full[0] && b.syms[i] === full[0].sym && String(b.tfs[i]) === String(full[0].tf)
        const keep = hid.find(holdsT) ?? hid.find((i) => b.syms[i] != null)
        const drop = hid.filter((i) => b.syms[i] != null && i !== keep)
        if (drop.length) {
          for (const i of drop) reportsRef.current[i] = null
          startTransition(() => setBuf((x) => {
            if (x.front !== b.front) return x
            const syms = x.syms.slice()
            for (const i of drop) syms[i] = null
            return { syms, tfs: x.tfs, front: x.front }
          }))
        }
      }
      const targets = urgent ? full.slice(0, 1) : full
      if (!targets.length) return
      const avoid = urgent && N > 2 ? lastTypedRef.current : null
      const plan = planRetarget(b, targets, avoid, full)
      if (!plan.length) return
      if (urgent) lastTypedRef.current = targets[0].sym
      for (const [i] of plan) {
        reportsRef.current[i] = null
        timesRef.current.report[i] = null   // (its `set` time is stamped when the retarget COMMITS: LOW-4, below)
        // (lane C) the layer's FIRST pass of its new row is rendered in its own task, not left for idle time
        handles[i].promptUntil = _now() + RETARGET_PROMPT_MS
      }
      noteRetarget()
      const set = () => setBuf((x) => {
        if (x.front !== b.front) return x
        const p2 = planRetarget(x, targets, avoid, full)
        if (!p2.length) return x
        const syms = x.syms.slice()
        const tfs = x.tfs.slice()
        for (const [i, tg] of p2) { syms[i] = tg.sym; tfs[i] = tg.tf }
        return { syms, tfs, front: x.front }
      })
      // ⭐ (lane C, typed Enter: 'shadow-other-row' was most refusals with the data already in memory) a TYPED next symbol
      // retargets URGENTLY: not a transition the next keystroke's render abandons, not after another frame. The same
      // candidate published again holds already (no restart); only a new candidate moves the layer.
      if (urgent) set()
      else startTransition(set)
    }
    const schedule = () => {
      if (!alive) return
      if (pending) pending()
      pending = afterPaint(() => { pending = null; run() })
    }
    retargetKickRef.current = schedule
    if (!firstRetargetRef.current && !reportsRef.current[bufRef.current.front]) waitFrontRef.current = schedule
    else schedule()
    firstRetargetRef.current = true
    const offScan = subscribeScanNeighbors((c) => {
      if (c !== String(frontSym).toUpperCase()) return
      // a typed next symbol (publishTypedNext, each keystroke's top candidate): at once, in this task; a list's rows:
      // after the frame, in a transition, as before
      if (typedNextFor(c) && firstRetargetRef.current && reportsRef.current[bufRef.current.front]) {
        if (pending) pending()
        pending = null
        run(true)
      } else schedule()
    })
    return () => { alive = false; if (pending) pending(); pending = null; waitFrontRef.current = null; retargetKickRef.current = null; offScan() }
  }, [eligible, slotOk, frontSym, frontTf, N])

  // (review of #2930, LOW-4) a layer's `set` time is when its new row COMMITS (the retarget's transition), not when the
  // retarget asked for it
  const prevSymsRef = useRef(buf.syms)
  const prevTfsRef = useRef(buf.tfs)
  useLayoutEffect(() => {
    const was = prevSymsRef.current
    prevSymsRef.current = buf.syms
    const wasTfs = prevTfsRef.current
    prevTfsRef.current = buf.tfs
    for (const i of IDX) {
      if (i !== buf.front && buf.syms[i] != null && (buf.syms[i] !== was[i] || buf.tfs[i] !== wasTfs[i])) timesRef.current.set[i] = _now()
    }
  }, [buf])   // eslint-disable-line react-hooks/exhaustive-deps -- IDX is fixed for the widget's life

  return useMemo(() => ({ on: eligible, syms: buf.syms, tfs: buf.tfs, front: buf.front, layers: N, handles, reporters, viewChanged, focusFront }),
    [eligible, buf, N, handles, reporters, viewChanged, focusFront])
}

/** (plan 2.4) Which hidden layers take which targets: `[[layer, target], ...]`, nothing for a layer already holding a
 *  target. The free layers are those holding none of `targets`, taken in this order: empty; holding nothing wanted; holding
 *  a lower-priority target of `full` (the whole list) before a higher one; holding `avoid` (the previous typed candidate,
 *  kept until the new one reports) last. */
export function planRetarget(b, targets, avoid = null, full = targets) {
  const hidden = b.syms.map((_, i) => i).filter((i) => i !== b.front)
  const holds = (i, tg) => b.syms[i] === tg.sym && String(b.tfs[i]) === String(tg.tf)
  const missing = targets.filter((tg) => !hidden.some((i) => holds(i, tg)))
  const rank = (i) => {
    if (b.syms[i] == null) return 0
    if (avoid && b.syms[i] === avoid) return 1000
    const k = full.findIndex((tg) => holds(i, tg))
    return k < 0 ? 1 : 10 + (full.length - k)
  }
  const free = hidden.filter((i) => !targets.some((tg) => holds(i, tg))).sort((x, y) => rank(x) - rank(y))
  const out = []
  for (let k = 0; k < missing.length && k < free.length; k++) out.push([free[k], missing[k]])
  return out
}
