// app/src/components/chart/useDoubleBuffer.js
//
// ─── ⭐⭐ THE CHART WIDGET'S TWO LAYERS (2026-11-27, the double-buffered next row; rules in doubleBuffer.js) ──────────
//
// A list-linked chart widget renders its pane TWICE, stacked: the FRONT (shown) and the SHADOW (laid out under it,
// visibility hidden, inert), each under its own layer handle (boardVisibility.js `{ layer: true }`), so the shadow's
// loops, keys, intervals, crosshair, debug handle and manifest slot are paused exactly like a hidden layer board's, and
// its bar-store feeds are muted (it reads the store when it RENDERS, and the flip rule checks that what it read is
// still the store's base snapshot). The two panes get the SAME props except `sym`.
//
//   • A press whose symbol the shadow was set to, at the front's timeframe, session and settings, with its bars still
//     the store's base snapshot: the FLIP. The layers swap roles in the press's render (`front` is state), the
//     handles swap in the commit (the shown one's muted feeds catch up there: the live developing bar, synchronously),
//     and the flip records the group member's paint for the switch-speed instrument. Nothing renders the panes:
//     their props did not change.
//   • Any other press: the NORMAL switch of the front pane, exactly today's path.
//   • After every commit that changed the front's symbol: the hidden pane is set, in idle time (a transition), to the
//     row ahead in the direction of travel (doubleBuffer.nextShadowSym), and marked SET once that render committed
//     with the store still at the snapshot it read.
//
// ⛔ A WIDGET THE BOARD CANNOT GIVE A SHADOW (MAX_SHADOWS taken), a host with no group scope, the <Activity> keep-alive
// (its handle is no layer), the store off, the touch tier: never double-buffered (`eligible` false), one pane as before.

import { startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createBoardVisibility } from './boardVisibility'
import { getBarStore } from '../../data/barStore/index'
import { BARSTORE } from './barStoreSwitch'
import { chartKeyFor } from './useBarSnapshotBars'
import { subscribeScanNeighbors } from './neighborFrames'
import { recordPaint } from './paintLog'
import { afterPaint } from '../../utils/afterPaint'
import { doubleBufferOn, acquireShadow, nextShadowSym, flipDecision, noteDecision, noteRetarget } from './doubleBuffer'

/** The store's base snapshot of the key a layer set to `info` reads, NOW (null: no store, no key, not held). Never
 *  creates a registry entry. */
export function shadowSnapNow(info) {
  if (!info || !info.sym || !_storeOn()) return null
  const key = chartKeyFor({ sym: info.sym, resolvedTf: info.tf, showExtended: !!info.showExtended, replayCutoff: null, hasOverride: false })
  if (!key) return null
  return _snapOf(key)
}
const _storeSnap = (key) => {
  const store = getBarStore()
  return store.registry.has(key) ? store.getBaseSnapshot(key) : null
}
let _snapOf = _storeSnap
let _storeOn = () => !!BARSTORE
/** Tests: the bar store's switch as this module reads it (null restores BARSTORE). */
export function __setDoubleBufferStoreForTests(v) { _storeOn = v === null || v === undefined ? () => !!BARSTORE : () => !!v }
/** Tests: where a key's base snapshot is read (null restores the bar store). */
export function __setDoubleBufferSnapSourceForTests(fn) { _snapOf = typeof fn === 'function' ? fn : _storeSnap }

/** Can this widget be double-buffered at all (the page's switch, the store, a deciding board, a layer or no parent)? */
export function doubleBufferEligible({ scope, color, parentVis }) {
  return doubleBufferOn() && _storeOn() && !!scope && !!color && (!parentVis || !!parentVis.layer)
}

const _ric = (fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 1000 }) : setTimeout(fn, 50))
const _cic = (h) => { try { if (typeof cancelIdleCallback === 'function') cancelIdleCallback(h); else clearTimeout(h) } catch { /* gone */ } }

/**
 * @param {object} o
 * @param {boolean} o.eligible        doubleBufferEligible(...) for this widget (stable for its life)
 * @param {string} o.sym              the symbol the widget shows now (useSymbolHandoff's)
 * @param {string} o.tf               the pane's timeframe
 * @param {{current: boolean}} o.extRef  the pane's session (a ref ChartWidget keeps), read when asked
 * @param {object|null} o.settings    the pane's stored settings (identity)
 * @param {object} o.scope            the board's group store (the shadow budget's scope)
 * @param {object|null} o.member      the identity the widget's chart paints under (PaintMemberContext)
 * @param {object|null} o.parentVis   the board's layer handle, or null
 * @returns {{on: boolean, syms: (string|null)[], front: number, handles: object[]}}
 */
export function useDoubleBuffer({ eligible, sym, tf, extRef, settings, scope, member, parentVis }) {
  const showExtended = () => !!extRef?.current
  const [owner] = useState(() => ({}))
  const [slotOk, setSlotOk] = useState(false)
  // each layer's handle: NESTED in the board's (hidden whenever the board is) and CURRENT (a hidden layer keeps its bar
  // store BASE feed, re-rendered in idle tasks: boardVisibility.forwardWhileCurrent), made once, disposed at unmount
  const [handles] = useState(() => {
    const a = createBoardVisibility({ layer: true, current: true, parent: parentVis })
    const b = createBoardVisibility({ layer: true, current: true, parent: parentVis })
    b.state = 'hidden'   // before anything subscribes: no one to tell
    return [a, b]
  })
  useEffect(() => () => { handles[0].dispose(); handles[1].dispose() }, [handles])
  const [buf, setBuf] = useState(() => ({ syms: [sym || null, null], front: 0 }))
  const infoRef = useRef(null)    // what the shadow layer was set to: {idx, sym, tf, showExtended, settings, snap, set}
  const flipRef = useRef(null)    // a flip this render made, recorded in its commit
  const bufRef = useRef(buf)
  bufRef.current = buf

  useLayoutEffect(() => {
    if (!eligible) return undefined
    const release = acquireShadow(scope, owner)
    setSlotOk(!!release)
    return () => { if (release) release() }
  }, [eligible, scope, owner])

  // ── the press: flip, or switch the front (in render: `front` is the one thing that moves) ──
  if (eligible && sym && sym !== buf.syms[buf.front]) {
    const s = 1 - buf.front
    const info = slotOk && infoRef.current && infoRef.current.idx === s && buf.syms[s] === infoRef.current.sym ? infoRef.current : null
    const d = flipDecision({ sym, tf, showExtended: !!showExtended(), settings }, info, shadowSnapNow)
    noteDecision(d, sym)
    if (d.flip) {
      flipRef.current = { sym, tf, bars: info.snap?.bars?.length || 1 }
      infoRef.current = null   // the old front is the hidden one now, still on its old symbol
      setBuf({ syms: buf.syms, front: s })
    } else {
      const syms = buf.syms.slice()
      syms[buf.front] = sym
      setBuf({ syms, front: buf.front })
    }
  }

  // ── the commit: the handles follow `front`, QUIETLY (vis.flip: the feeds' catch-ups, the live developing bar among
  // them, and the loop gates run in this task; React readers of the handles after the paint), a flip records its paint.
  // The board's own state reaches each layer through the nesting (the shown layer is hidden while the board is). ──
  useLayoutEffect(() => {
    if (!eligible) return
    const f = buf.front
    handles[1 - f].flip('hidden')
    handles[f].flip('visible')
    const fl = flipRef.current
    if (fl) {
      flipRef.current = null
      recordPaint(fl.sym, fl.tf, fl.bars, 'flip', member)
    }
  }, [eligible, buf.front, handles, member])

  // ── the shadow's set: its render committed; still the store's snapshot? (and a props change re-set it) ──
  const ext = !!showExtended()
  useLayoutEffect(() => {
    const info = infoRef.current
    if (!info || bufRef.current.syms[info.idx] !== info.sym) return
    if (info.pending) {
      // a base change of the row, re-rendered by the hidden layer's CURRENT feed: React commits that (default-lane)
      // render before this transition's, so when the store has not moved since the change was seen, the layer shows it
      const now = shadowSnapNow(info)
      if (now === info.pending) { info.snap = now; info.set = true }
      info.pending = null
    } else if (!info.set) {
      info.set = shadowSnapNow(info) === info.snap && !!info.snap
    } else if (info.tf !== tf || info.settings !== settings || !!info.showExtended !== ext) {
      // the shadow pane got these props in this very commit (both layers get the same ones): it read the store now
      const next = { ...info, tf, settings, showExtended: ext }
      next.snap = shadowSnapNow(next)
      next.set = !!next.snap
      infoRef.current = next
    }
  })

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
      if (!next || next === f) return
      const cur = infoRef.current
      const ext2 = !!showExtended()
      if (cur && cur.idx === s && cur.sym === next && b.syms[s] === next && cur.tf === tf && cur.settings === settings && !!cur.showExtended === ext2) return
      const info = { idx: s, sym: next, tf, showExtended: ext2, settings, snap: null, set: false }
      info.snap = shadowSnapNow(info)
      infoRef.current = info
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
  }, [eligible, slotOk, frontSym, tf, settings])   // eslint-disable-line react-hooks/exhaustive-deps -- extRef is read when it runs

  // ── the shadow follows its row: a base change of the row after it was set unsets it at once (a flip now would show
  // the older bars), and once the hidden layer's current feed has re-rendered it (an idle task), a transition commit of
  // this widget re-sets it (the layout effect above) ──
  const [, bump] = useState(0)
  const shadowSym = buf.syms[1 - buf.front]
  useEffect(() => {
    const info = infoRef.current
    if (!eligible || !slotOk || !_storeOn() || !info || info.sym !== shadowSym || !handles[info.idx].current) return undefined
    const key = chartKeyFor({ sym: info.sym, resolvedTf: info.tf, showExtended: !!info.showExtended, replayCutoff: null, hasOverride: false })
    if (!key) return undefined
    const store = getBarStore()
    if (!store.registry.has(key) || typeof store.registry.subscribe !== 'function') return undefined
    let alive = true
    let idle = 0
    const off = store.registry.subscribe(key, () => {
      const cur = infoRef.current
      if (!alive || !cur || cur.sym !== info.sym) return
      cur.set = false
      if (idle) return
      idle = _ric(() => {
        idle = 0
        const now = infoRef.current
        if (!alive || !now || now.sym !== info.sym) return
        now.pending = shadowSnapNow(now)
        startTransition(() => bump((n) => n + 1))
      })
    }, { wake: 'base' })
    return () => { alive = false; if (idle) _cic(idle); try { off() } catch { /* gone */ } }
  }, [eligible, slotOk, shadowSym, handles])

  return useMemo(() => ({ on: eligible, syms: buf.syms, front: buf.front, handles }), [eligible, buf, handles])
}
