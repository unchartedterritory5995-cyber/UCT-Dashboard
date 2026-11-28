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
import { subscribeScanNeighbors } from './neighborFrames'
import { recordPaint, viewNeed } from './paintLog'
import { setFlipProbe } from './flipReady'
import { heldRows, lakePending, deepPending } from '../../data/barStore/prefetch'
import { afterPaint } from '../../utils/afterPaint'
import {
  doubleBufferOn, acquireShadow, nextShadowSym, flipDecision, viewParity, viewDetail, mirrorFrameFor, mirrorStillFits, noteDecision, noteRetarget,
} from './doubleBuffer'

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
const _now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now())

/**
 * @param {object} o
 * @param {boolean} o.eligible        doubleBufferEligible(...) for this widget (stable for its life)
 * @param {string} o.sym              the symbol the widget shows now (useSymbolHandoff's)
 * @param {object|null} o.settings    the pane's stored settings (identity)
 * @param {string|null} o.cutoff     the widget's replay cutoff (change-date mode), or null: a flip needs a hidden chart that
 *                                    drew under the same one
 * @param {string|null} o.anchor     the date the member went to (the date box, `date|width`), or null: likewise
 * @param {object} o.scope            the board's group store (the shadow budget's scope when there is no board handle)
 * @param {object|null} o.member      the identity the widget's chart paints under (PaintMemberContext)
 * @param {object|null} o.parentVis   the board's layer handle, or null
 * @param {() => object[]} o.panes    each layer's pane instance (ChartPane's imperative handle: getDateMeta, viewDo, focus)
 * @param {() => Element[]} o.layerEls each layer's wrapper element
 * @returns {{on: boolean, syms: (string|null)[], front: number, handles: object[], reporters: Function[], viewChanged: Function, focusFront: Function}}
 */
export function useDoubleBuffer({ eligible, sym, settings, cutoff = null, anchor = null, scope, member, parentVis, panes, layerEls }) {
  const [owner] = useState(() => ({}))
  const [slotOk, setSlotOk] = useState(false)
  // each layer's handle: NESTED in the board's and CURRENT, made once, disposed at unmount
  const [handles] = useState(() => {
    const a = createBoardVisibility({ layer: true, current: true, parent: parentVis })
    const b = createBoardVisibility({ layer: true, current: true, parent: parentVis })
    b.state = 'hidden'   // before anything subscribes: no one to tell
    return [a, b]
  })
  useEffect(() => () => { handles[0].dispose(); handles[1].dispose() }, [handles])
  const [buf, setBuf] = useState(() => ({ syms: [sym || null, null], front: 0 }))
  const bufRef = useRef(buf)
  bufRef.current = buf
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const reportsRef = useRef([null, null])   // each layer's chart's last committed pass (F3)
  const pendingRef = useRef(null)           // the press's decision, applied in its commit (F8: no side effect in render)
  const mirrorRef = useRef({ timer: 0, idle: 0 })
  const heldRef = useRef(false)             // the widget holds a shadow NOW (set in the board handle's own task)
  const timesRef = useRef({ set: [null, null], report: [null, null] })   // when each layer was last set to a row / last reported
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
      if (b.syms[1 - b.front] == null) return
      reportsRef.current[1 - b.front] = null
      startTransition(() => setBuf((x) => {
        if (x.syms[1 - x.front] == null) return x
        const syms = x.syms.slice(); syms[1 - x.front] = null
        return { syms, front: x.front }
      }))
    })
    return () => _cic(idle)
  }, [eligible, slotOk])

  // ── the press: flip, or switch the front. Decided in render (`front` is the one thing that moves); its side
  // effects (stats, the paint record, the focus) wait for the commit ──
  // ONE DECISION, ASKED TWICE: here at the press, and EARLIER by the handoff (flipReady.js), which shows at once a row the
  // shadow can flip to instead of holding it (the two can never disagree: the same function, the same refs)
  // (the panes accessor through a ref of its own, declared here: `decide` also runs from the probe, after this render)
  const panesNowRef = useRef(panes)
  panesNowRef.current = panes
  const decide = (want_sym, b, okSlot, set, cut, anch) => {
    const f = b.front
    const s = 1 - f
    const fr = reportsRef.current[f]
    const want = fr ? { sym: want_sym, tf: fr.tf, ext: fr.ext, settings: set, cutoff: cut || null, anchor: anch || null } : null
    const report = okSlot && b.syms[s] === want_sym ? reportsRef.current[s] : null
    let detail = null
    const view = () => {
      const p = panesNowRef.current ? panesNowRef.current() : []
      const fm = p[f]?.getDateMeta?.(), sm = p[s]?.getDateMeta?.()
      const v = viewParity(fm, sm, { tf: fr?.tf })
      // (diagnostics, 2026-11-28) a view refusal logs what it compared (doubleBufferStats().log[].view)
      if (v !== 'ok') { try { detail = viewDetail(fm, sm, { tf: fr?.tf }) } catch { detail = null } }
      return v
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
      d = { flip: false, why: !okSlot ? 'no-slot' : b.syms[s] == null ? 'no-shadow' : b.syms[s] !== want_sym ? 'shadow-other-row' : 'shadow-unreported' }
    }
    return { d, report, view: detail }
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
  if (eligible && sym && sym !== buf.syms[buf.front]) {
    const f = buf.front
    const s = 1 - f
    const { d, report, view: viewSeen } = decide(sym, buf, slotOk, settings, cutoff, anchor)
    const now = _now()
    const t = timesRef.current
    pendingRef.current = {
      d, sym, from: f, tf: report?.tf, bars: report?.bars?.length || 1, view: String(d.why).startsWith('view') ? viewSeen : null,
      sinceSet: t.set[s] != null ? Math.round(now - t.set[s]) : null, sinceReport: t.report[s] != null ? Math.round(now - t.report[s]) : null,
    }
    if (d.flip) {
      setBuf({ syms: buf.syms, front: s })
    } else {
      const syms = buf.syms.slice()
      syms[f] = sym
      reportsRef.current[f] = null   // the front's next pass reports the new symbol
      setBuf({ syms, front: f })
    }
  }

  // ── the commit: the handles follow `front` QUIETLY; a flip records its paint and carries the focus (F5) ──
  useLayoutEffect(() => {
    if (!eligible) return
    const f = buf.front
    handles[1 - f].flip('hidden')
    handles[f].flip('visible')
    const p = pendingRef.current
    if (!p) return
    pendingRef.current = null
    noteDecision(p.d, p.sym, { sinceSet: p.sinceSet, sinceReport: p.sinceReport, view: p.view })
    if (!p.d.flip) return
    recordPaint(p.sym, p.tf, p.bars, 'flip', member)
    try {
      const els = layerEls ? layerEls() : []
      const was = els[p.from]
      const active = typeof document !== 'undefined' ? document.activeElement : null
      if (was && active && was.contains(active)) panes?.()?.[f]?.focus?.()
    } catch { /* focus is best effort */ }
  }, [eligible, buf, handles, member])   // eslint-disable-line react-hooks/exhaustive-deps -- panes / layerEls are read when it runs

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
        const front = p[b.front], shadow = p[1 - b.front]
        if (!front || !shadow || !b.syms[1 - b.front]) return
        let frame = null
        try { frame = mirrorFrameFor(front.getDateMeta?.(), shadow.getDateMeta?.(), { tf: reportsRef.current[b.front]?.tf }) } catch { frame = null }
        // (N4) restoreView also writes the view lock under the pane's key, which both layers share
        // (`uct.charts.viewLock.<chartId>`): the frame carries the FRONT's locks, so the write stores the lock the front
        // holds; read again here, at the write, so a lock the member changed in between is never overwritten
        let fits = false
        try { fits = mirrorStillFits(frame, front.getDateMeta?.()) } catch { fits = false }
        if (frame && fits) { try { shadow.viewDo?.('restoreView', frame) } catch { /* a mirror is best effort */ } }
      })
    }, MIRROR_DEBOUNCE_MS)
  }
  useEffect(() => () => {
    const m = mirrorRef.current
    if (m.timer) clearTimeout(m.timer)
    if (m.idle) _cic(m.idle)
  }, [])

  // each layer's chart reports its passes here (LayerPaintContext), with the widget's settings at that commit
  const [reporters] = useState(() => [0, 1].map((i) => (r) => {
    reportsRef.current[i] = { sym: r.sym, tf: r.tf, ext: !!r.ext, bars: r.bars, cutoff: r.cutoff || null, anchor: r.anchor || null, settings: settingsRef.current }
    timesRef.current.report[i] = _now()
    // (review of #2930, LOW-2) the mount's retarget waits for the FRONT's first pass: the shadow does not compete with
    // the board's first paint, and is still set long before the first press
    if (i === bufRef.current.front && waitFrontRef.current) { const w = waitFrontRef.current; waitFrontRef.current = null; w() }
    if (i !== bufRef.current.front) scheduleMirror()
  }))
  // each layer's view changed (its time range moved: a zoom, a pan, a range): the front's moves the shadow's
  const [viewChanged] = useState(() => (i) => { if (i === bufRef.current.front) scheduleMirror() })
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
  useEffect(() => {
    if (!eligible || !slotOk || !frontSym) return undefined
    let alive = true
    let pending = null
    const run = () => {
      if (!alive) return
      const b = bufRef.current
      const f = b.syms[b.front]
      const next = nextShadowSym(f)
      const s = 1 - b.front
      if (!next || next === f || b.syms[s] === next) return
      reportsRef.current[s] = null
      timesRef.current.report[s] = null   // (its `set` time is stamped when the retarget COMMITS: LOW-4, below)
      noteRetarget()
      startTransition(() => {
        setBuf((x) => {
          if (x.front !== b.front || x.syms[s] === next) return x
          const syms = x.syms.slice()
          syms[s] = next
          return { syms, front: x.front }
        })
      })
    }
    const schedule = () => {
      if (!alive) return
      if (pending) pending()
      pending = afterPaint(() => { pending = null; run() })
    }
    if (!firstRetargetRef.current && !reportsRef.current[bufRef.current.front]) waitFrontRef.current = schedule
    else schedule()
    firstRetargetRef.current = true
    const offScan = subscribeScanNeighbors((c) => { if (c === String(frontSym).toUpperCase()) schedule() })
    return () => { alive = false; if (pending) pending(); pending = null; waitFrontRef.current = null; offScan() }
  }, [eligible, slotOk, frontSym])

  // (review of #2930, LOW-4) a layer's `set` time is when its new row COMMITS (the retarget's transition), not when the
  // retarget asked for it
  const prevSymsRef = useRef(buf.syms)
  useLayoutEffect(() => {
    const was = prevSymsRef.current
    prevSymsRef.current = buf.syms
    for (const i of [0, 1]) {
      if (i !== buf.front && buf.syms[i] != null && buf.syms[i] !== was[i]) timesRef.current.set[i] = _now()
    }
  }, [buf])

  return useMemo(() => ({ on: eligible, syms: buf.syms, front: buf.front, handles, reporters, viewChanged, focusFront }),
    [eligible, buf, handles, reporters, viewChanged, focusFront])
}
