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
//     #2922, F3), with the two charts' views alike (F1), and no replay (F6): the FLIP. The layers swap roles in the
//     press's render (`front` is state); in its commit the handles swap QUIETLY (the shown one's muted feeds catch up
//     there, the live developing bar included), focus inside the old front moves to the new one (F5), and the group
//     member's paint is recorded as a 'flip' for the switch-speed instrument.
//   • Any other press: the NORMAL switch of the front pane, exactly today's path.
//   • After every change of the front's symbol: the hidden pane is set, in idle time (a transition), to the row ahead
//     in the direction of travel (doubleBuffer.nextShadowSym). After a change of the front's view, and after each pass
//     of the shadow, the shadow MIRRORS the front's zoom in idle time (doubleBuffer.mirrorFrameFor, F1).
//   • (F2) The board's shadow budget is the BOARD SLOT's (its layer handle), and a widget on a board that is not shown
//     gives its shadow back (and drops the hidden pane) until the board is shown again.
//
// ⛔ A WIDGET THE BOARD CANNOT GIVE A SHADOW (MAX_SHADOWS taken), a host with no group scope, the <Activity> keep-alive
// (its handle is no layer), the store off, the touch tier: never double-buffered (`eligible` false), one pane as before.

import { startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createBoardVisibility } from './boardVisibility'
import { getBarStore } from '../../data/barStore/index'
import { legacyBars } from '../../data/barStore/adapter'
import { BARSTORE } from './barStoreSwitch'
import { chartKeyFor } from './useBarSnapshotBars'
import { subscribeScanNeighbors } from './neighborFrames'
import { recordPaint } from './paintLog'
import { afterPaint } from '../../utils/afterPaint'
import {
  doubleBufferOn, acquireShadow, nextShadowSym, flipDecision, viewParity, mirrorFrameFor, noteDecision, noteRetarget,
} from './doubleBuffer'

/** The bars array the store's base snapshot of the key a chart reported gives NOW: the array a chart of that key
 *  hands the library (`adapter.legacyBars`, memoised per snapshot), or null (no store, no key, not held). Never creates
 *  a registry entry. */
export function barsNowFor(report) {
  if (!report || !report.sym || !_storeOn()) return null
  const key = chartKeyFor({ sym: report.sym, resolvedTf: report.tf, showExtended: !!report.ext, replayCutoff: null, hasOverride: false })
  if (!key) return null
  return _barsOf(key)
}
const _storeBars = (key) => {
  const store = getBarStore()
  if (!store.registry.has(key)) return null
  const snap = store.getBaseSnapshot(key)
  return snap ? legacyBars(snap) : null
}
let _barsOf = _storeBars
let _storeOn = () => !!BARSTORE
/** Tests: the bar store's switch as this module reads it (null restores BARSTORE). */
export function __setDoubleBufferStoreForTests(v) { _storeOn = v === null || v === undefined ? () => !!BARSTORE : () => !!v }
/** Tests: what a key's bars are NOW (null restores the bar store). */
export function __setDoubleBufferBarsSourceForTests(fn) { _barsOf = typeof fn === 'function' ? fn : _storeBars }

/** Can this widget be double-buffered at all (the page's switch, the store, a deciding board, a layer or no parent)? */
export function doubleBufferEligible({ scope, color, parentVis }) {
  return doubleBufferOn() && _storeOn() && !!scope && !!color && (!parentVis || !!parentVis.layer)
}

const _ric = (fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 1000 }) : setTimeout(fn, 50))
const _cic = (h) => { try { if (typeof cancelIdleCallback === 'function') cancelIdleCallback(h); else clearTimeout(h) } catch { /* gone */ } }
const MIRROR_DEBOUNCE_MS = 120

/**
 * @param {object} o
 * @param {boolean} o.eligible        doubleBufferEligible(...) for this widget (stable for its life)
 * @param {string} o.sym              the symbol the widget shows now (useSymbolHandoff's)
 * @param {object|null} o.settings    the pane's stored settings (identity)
 * @param {boolean} o.replay          a replay cutoff is set on the widget (no flip: F6)
 * @param {object} o.scope            the board's group store (the shadow budget's scope when there is no board handle)
 * @param {object|null} o.member      the identity the widget's chart paints under (PaintMemberContext)
 * @param {object|null} o.parentVis   the board's layer handle, or null
 * @param {() => object[]} o.panes    each layer's pane instance (ChartPane's imperative handle: getDateMeta, viewDo, focus)
 * @param {() => Element[]} o.layerEls each layer's wrapper element
 * @returns {{on: boolean, syms: (string|null)[], front: number, handles: object[], reporters: Function[], viewChanged: Function}}
 */
export function useDoubleBuffer({ eligible, sym, settings, replay = false, scope, member, parentVis, panes, layerEls }) {
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

  // ── (F2) the budget: the board SLOT's, given back while the board is not shown ──
  useLayoutEffect(() => {
    if (!eligible) return undefined
    const key = parentVis || scope
    let release = null
    const sync = () => {
      const shown = !parentVis || parentVis.state === 'visible'
      if (shown && !release) {
        release = acquireShadow(key, owner)
        setSlotOk(!!release)
      } else if (!shown && release) {
        release(); release = null
        setSlotOk(false)
      }
    }
    sync()
    const off = parentVis && typeof parentVis.subscribe === 'function' ? parentVis.subscribe(sync) : null
    return () => { if (off) off(); if (release) release() }
  }, [eligible, scope, owner, parentVis])
  // a widget without a shadow holds no hidden pane (its canvases go)
  useLayoutEffect(() => {
    if (!eligible || slotOk) return
    if (bufRef.current.syms[1 - bufRef.current.front] != null) {
      setBuf((x) => { const syms = x.syms.slice(); syms[1 - x.front] = null; return { syms, front: x.front } })
      reportsRef.current[1 - bufRef.current.front] = null
    }
  }, [eligible, slotOk])

  // ── the press: flip, or switch the front. Decided in render (`front` is the one thing that moves); its side
  // effects (stats, the paint record, the focus) wait for the commit ──
  if (eligible && sym && sym !== buf.syms[buf.front]) {
    const f = buf.front
    const s = 1 - f
    const fr = reportsRef.current[f]
    const want = fr ? { sym, tf: fr.tf, ext: fr.ext, settings, replay } : null
    const report = slotOk && buf.syms[s] === sym ? reportsRef.current[s] : null
    const view = () => {
      const p = panes ? panes() : []
      return viewParity(p[f]?.getDateMeta?.(), p[s]?.getDateMeta?.())
    }
    const d = flipDecision(want, report, barsNowFor, view)
    pendingRef.current = { d, sym, from: f, tf: report?.tf, bars: report?.bars?.length || 1 }
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
    noteDecision(p.d, p.sym)
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
        try { frame = mirrorFrameFor(front.getDateMeta?.(), shadow.getDateMeta?.()) } catch { frame = null }
        if (frame) { try { shadow.viewDo?.('restoreView', frame) } catch { /* a mirror is best effort */ } }
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
    reportsRef.current[i] = { sym: r.sym, tf: r.tf, ext: !!r.ext, bars: r.bars, settings: settingsRef.current }
    if (i !== bufRef.current.front) scheduleMirror()
  }))
  // each layer's view changed (its time range moved: a zoom, a pan, a range): the front's moves the shadow's
  const [viewChanged] = useState(() => (i) => { if (i === bufRef.current.front) scheduleMirror() })

  // ── the retarget: after the front's symbol changed (or the list publishes), the hidden pane takes the next row ──
  const frontSym = buf.syms[buf.front]
  useEffect(() => {
    if (!eligible || !slotOk || !frontSym) return undefined
    let alive = true
    let idle = 0
    const run = () => {
      idle = 0
      if (!alive) return
      const b = bufRef.current
      const f = b.syms[b.front]
      const next = nextShadowSym(f)
      const s = 1 - b.front
      if (!next || next === f || b.syms[s] === next) return
      reportsRef.current[s] = null
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
    const schedule = () => { if (alive && !idle) idle = _ric(run) }
    const cancelPaint = afterPaint(schedule)
    const offScan = subscribeScanNeighbors((c) => { if (c === String(frontSym).toUpperCase()) schedule() })
    return () => { alive = false; cancelPaint(); if (idle) _cic(idle); offScan() }
  }, [eligible, slotOk, frontSym])

  return useMemo(() => ({ on: eligible, syms: buf.syms, front: buf.front, handles, reporters, viewChanged }),
    [eligible, buf, handles, reporters, viewChanged])
}
