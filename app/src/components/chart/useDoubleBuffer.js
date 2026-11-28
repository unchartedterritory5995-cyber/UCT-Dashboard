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
import { chartKeyFor } from './useBarSnapshotBars'
import { subscribeScanNeighbors, typedNextFor } from './neighborFrames'
import { recordPaint, viewNeed } from './paintLog'
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
  const key = chartKeyFor({ sym: report.sym, resolvedTf: report.tf, showExtended: !!report.ext, replayCutoff: report.cutoff || null, hasOverride: false })
  if (!key) return null
  return _barsOf(key, report)
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
 * @param {string|null} o.tf          (lane C, PR 2.1) the widget's timeframe now: a change of it alone is a TIMEFRAME press,
 *                                    which flips when the hidden layer holds this symbol at that timeframe
 * @param {string[]|null} o.tfBar     the codes on the chart's timeframe bar (the habitual timeframe is one of them)
 * @param {2|3} o.layers              (plan 2.4) the widget's layer count for its life: 3 = two hidden panes (thirdLayerOn)
 * @param {object|null} o.settings    the pane's stored settings (identity)
 * @param {string|null} o.cutoff     the widget's replay cutoff (change-date mode), or null: a flip needs a hidden chart that
 *                                    drew under the same one
 * @param {object} o.scope            the board's group store (the shadow budget's scope when there is no board handle)
 * @param {object|null} o.member      the identity the widget's chart paints under (PaintMemberContext)
 * @param {object|null} o.parentVis   the board's layer handle, or null
 * @param {() => object[]} o.panes    each layer's pane instance (ChartPane's imperative handle: getDateMeta, viewDo, focus)
 * @param {() => Element[]} o.layerEls each layer's wrapper element
 * @returns {{on: boolean, syms: (string|null)[], tfs: (string|null)[], front: number, handles: object[], reporters: Function[], viewChanged: Function, focusFront: Function}}
 */
export function useDoubleBuffer({ eligible, sym, tf = null, tfBar = null, layers = 2, settings, cutoff = null, scope, member, parentVis, panes, layerEls }) {
  const [owner] = useState(() => ({}))
  const [slotOk, setSlotOk] = useState(false)
  // (lane C, plan 2.4) the layer count is the widget's for its life: 2 (one hidden pane), or 3 (two) on a desktop that can
  // hold them (doubleBuffer.thirdLayerOn; ChartWidget decides it once)
  const [N] = useState(() => (layers === 3 ? 3 : 2))
  const IDX = useMemo(() => Array.from({ length: N }, (_, i) => i), [N])
  // each layer's handle: NESTED in the board's and CURRENT, made once, disposed at unmount
  const [handles] = useState(() => Array.from({ length: N }, (_, i) => {
    const h = createBoardVisibility({ layer: true, current: true, parent: parentVis })
    if (i > 0) h.state = 'hidden'   // before anything subscribes: no one to tell
    return h
  }))
  useEffect(() => () => { for (const h of handles) h.dispose() }, [handles])
  // (lane C, PR 2.1) each layer's own timeframe: the front's is the widget's; a hidden one's is the front's when it holds a
  // row, or the habitual next timeframe when it holds the front's own symbol (doubleBuffer.shadowTargetsFor)
  const [buf, setBuf] = useState(() => ({ syms: IDX.map((i) => (i === 0 ? sym || null : null)), tfs: IDX.map((i) => (i === 0 ? tf : null)), front: 0 }))
  const bufRef = useRef(buf)
  bufRef.current = buf
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const reportsRef = useRef(IDX.map(() => null))   // each layer's chart's last committed pass (F3)
  const pendingRef = useRef(null)           // the press's decision, applied in its commit (F8: no side effect in render)
  const mirrorRef = useRef({ timer: 0, idle: 0 })
  const heldRef = useRef(false)             // the widget holds a shadow NOW (set in the board handle's own task)
  const timesRef = useRef({ set: IDX.map(() => null), report: IDX.map(() => null) })   // when each layer was last set / reported
  const waitFrontRef = useRef(null)         // the mount's retarget, waiting for the front chart's first report (LOW-2)
  const firstRetargetRef = useRef(false)    // the widget's first retarget has been scheduled
  const hiddenOf = (b) => IDX.filter((i) => i !== b.front)

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
  const symPress = !!(eligible && sym && sym !== buf.syms[buf.front])
  // (lane C, PR 2.1) a TIMEFRAME press: the same symbol, another timeframe
  const tfMoved = tf != null && buf.tfs[buf.front] != null && String(tf) !== String(buf.tfs[buf.front])
  const tfPress = !!(eligible && sym && !symPress && tfMoved)
  if (symPress || tfPress) {
    const f = buf.front
    const fr = reportsRef.current[f]
    const holdsPress = (i) => buf.syms[i] === sym && (!tfPress || String(buf.tfs[i]) === String(tf))
    // (plan 2.4) the hidden layer that holds the press: one whose chart reported first, else any (its refusal says why)
    const hid = hiddenOf(buf)
    const s = hid.find((i) => holdsPress(i) && reportsRef.current[i]) ?? hid.find((i) => holdsPress(i)) ?? hid[0]
    // a symbol press is asked at the front chart's resolved timeframe; a timeframe press at the code pressed
    const want = !fr ? null : tfPress ? { press: 'tf', sym, tf: String(tf), ext: fr.ext, settings, cutoff: cutoff || null }
      : { sym, tf: fr.tf, ext: fr.ext, settings, cutoff: cutoff || null }
    const report = slotOk && holdsPress(s) ? reportsRef.current[s] : null
    const view = () => {
      const p = panes ? panes() : []
      return tfPress ? tfViewParity(p[f]?.getDateMeta?.(), p[s]?.getDateMeta?.(), { tf: String(tf) })
        : viewParity(p[f]?.getDateMeta?.(), p[s]?.getDateMeta?.(), { tf: fr?.tf })
    }
    // a symbol AND a timeframe change in one render (a template, the agent): the normal switch of both
    let d = symPress && tfMoved ? { flip: false, why: 'sym-and-tf' } : flipDecision(want, report, barsNowFor, view)
    // ⭐⭐ (2026-11-27, review of #2934: a typed cold ticker flipped to a shadow painted from a short page, and the deep
    // history's join then rescaled both charts at 966 ms) A SHADOW IS FLIPPABLE ONLY WHEN ITS ROWS COVER THE VIEW: the
    // same rule as the switch (paintLog viewNeed, counted in the view's session by the store's heldRows). Short, the
    // press takes the normal switch, which holds for a covering page.
    if (d.flip && BARSTORE && report) {
      // (2026-11-28) counted in the rows of the KEY the store holds: a custom timeframe's (4h, 2h) are its native base's
      // (heldRows reads that key), so the view's need is asked in base rows too (timeframes.baseBarsFor; native: unchanged)
      const need = baseBarsFor(String(report.tf), viewNeed(member))
      let rows = 0
      try { rows = heldRows(report.sym, report.tf, { showExtended: !!report.ext, upTo: need }) || 0 } catch { rows = 0 }
      // ...unless nothing more is coming for it (review of #2934, L3: the switch's own exemption, paintsWholeNow /
      // dailyHoldNeeded): a young listing's whole history is shorter than any view, and refusing it sent every press to
      // the normal switch for no gain
      if (rows && rows < need && !shadowWhole(report)) d = { flip: false, why: 'shadow-short' }
    }
    // (2026-11-27, the live dry run) WHICH 'no-shadow': no budget, no hidden pane, the hidden pane on ANOTHER row (the
    // list's next row moved, the member reversed), or on this row with no committed pass yet (its chart still loading)
    if (d.why === 'no-shadow') {
      d = { flip: false, why: !slotOk ? 'no-slot' : hid.every((i) => buf.syms[i] == null) ? 'no-shadow'
        : !hid.some((i) => buf.syms[i] === sym) ? 'shadow-other-row'
          : tfPress && !hid.some((i) => holdsPress(i)) ? 'shadow-other-tf' : 'shadow-unreported' }
    }
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
      // (the hidden layers follow in the retarget the front's new timeframe schedules: a row at the new timeframe; their
      // charts' reports name their own timeframe, so none of them can be flipped to at the old one meanwhile)
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

  // ── (F1) every hidden layer mirrors the front's zoom, in idle time, debounced ──
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
        for (const i of IDX) {
          if (i === b.front) continue
          const shadow = p[i]
          if (!shadow || !b.syms[i]) continue
          let frame = null
          try { frame = mirrorFrameFor(front.getDateMeta?.(), shadow.getDateMeta?.(), { tf: reportsRef.current[b.front]?.tf }) } catch { frame = null }
          // (N4) restoreView also writes the view lock under the pane's key, which every layer shares
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
  const [reporters] = useState(() => IDX.map((i) => (r) => {
    reportsRef.current[i] = { sym: r.sym, tf: r.tf, ext: !!r.ext, bars: r.bars, cutoff: r.cutoff || null, settings: settingsRef.current }
    timesRef.current.report[i] = _now()
    // (review of #2930, LOW-2) the mount's retarget waits for the FRONT's first pass: the shadow does not compete with
    // the board's first paint, and is still set long before the first press
    if (i === bufRef.current.front && waitFrontRef.current) { const w = waitFrontRef.current; waitFrontRef.current = null; w() }
    if (i !== bufRef.current.front) scheduleMirror()
  }))
  // each layer's view changed (its time range moved: a zoom, a pan, a range): the front's moves the shadows'
  const [viewChanged] = useState(() => (i) => { if (i === bufRef.current.front) scheduleMirror() })
  // (review of #2932) the pane shown NOW takes the focus: ChartPane's refocus after a typed Enter calls this when its own
  // pane is the inert old front (the Enter FLIPPED), so the keys go on reaching the chart (chart/layerPaint.js)
  const panesRef = useRef(panes)
  panesRef.current = panes
  const [focusFront] = useState(() => () => {
    try { panesRef.current?.()?.[bufRef.current.front]?.focus?.() } catch { /* a pane mid-unmount: nothing to focus */ }
  })

  // ── the retarget: after the front's symbol changed (or the list publishes), the hidden panes take what comes next ──
  // ⭐ (2026-11-27, the live dry run: 1 s presses found the hidden pane not on the row ahead yet) RIGHT AFTER THE FRAME,
  // not in idle time: a page busy with streams and history landing gave `requestIdleCallback` no idle period for most of
  // a second. The retarget is a transition (React yields to any press), scheduled after the paint of the frame that
  // showed the press (utils/afterPaint); at mount after the FRONT chart's first pass (review of #2930, LOW-2), so the
  // FIRST press finds it too. ONE pending schedule at a time (LOW-1): a live-sorted list republishes its neighbours often.
  // (plan 2.4) with two hidden panes: the first two of shadowTargetsFor (the typed or ahead row, then the behind row or
  // the habitual timeframe); a pane already holding one of them keeps it, the others take what is left.
  const frontSym = buf.syms[buf.front]
  const frontTf = buf.tfs[buf.front]
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
      // (lane C, PR 2.1) a row at the front's timeframe, or (no list) the front's symbol at its habitual next one
      const habit = ftf != null ? habitualTfs(String(ftf), { k: 2, available: Array.isArray(tfBarRef.current) ? tfBarRef.current : null }) : []
      const targets = shadowTargetsFor(f, ftf, habit, N - 1)
      if (!targets.length) return
      const plan = planRetarget(b, targets)
      if (!plan.length) return
      for (const [i] of plan) { reportsRef.current[i] = null; timesRef.current.report[i] = null }   // (`set` stamped at COMMIT: LOW-4)
      noteRetarget()
      const set = () => setBuf((x) => {
        if (x.front !== b.front) return x
        const p2 = planRetarget(x, targets)
        if (!p2.length) return x
        const syms = x.syms.slice()
        const tfs = x.tfs.slice()
        for (const [i, tg] of p2) { syms[i] = tg.sym; tfs[i] = tg.tf }
        return { syms, tfs, front: x.front }
      })
      // ⭐ (lane C, typed Enter: 'shadow-other-row' was most refusals with the data already in memory) a TYPED next symbol
      // retargets URGENTLY: not a transition the next keystroke's render abandons, not after another frame; the newest
      // keystroke's candidate replaces a stale one (a newer publish runs this again before the old render landed)
      if (urgent) set()
      else startTransition(set)
    }
    const schedule = () => {
      if (!alive) return
      if (pending) pending()
      pending = afterPaint(() => { pending = null; run() })
    }
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
    return () => { alive = false; if (pending) pending(); pending = null; waitFrontRef.current = null; offScan() }
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
 *  target. The free layers are the ones holding no target, empty ones first. */
export function planRetarget(b, targets) {
  const hidden = b.syms.map((_, i) => i).filter((i) => i !== b.front)
  const holds = (i, tg) => b.syms[i] === tg.sym && String(b.tfs[i]) === String(tg.tf)
  const missing = targets.filter((tg) => !hidden.some((i) => holds(i, tg)))
  const free = hidden.filter((i) => !targets.some((tg) => holds(i, tg))).sort((x, y) => (b.syms[x] == null ? 0 : 1) - (b.syms[y] == null ? 0 : 1))
  const out = []
  for (let k = 0; k < missing.length && k < free.length; k++) out.push([free[k], missing[k]])
  return out
}
