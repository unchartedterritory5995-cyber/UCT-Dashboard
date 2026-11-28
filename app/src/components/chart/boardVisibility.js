// The board keep-alive's visibility handle (2026-11-27, Stage 1: the chart's side; behind the workspace's flag).
//
// The workspace keeps the previous board mounted but hidden (React <Activity mode="hidden">, which runs every effect
// cleanup of the hidden tree). A cleanup cannot tell a hide from an unmount by itself, so each kept board hands its
// widgets ONE stable object through BoardVisibilityContext and sets its `state` BEFORE the commit that hides, shows or
// disposes the board: a cleanup running in that commit reads the board's fate. 'hidden' keeps a chart instance (no
// remove, no latch reset); 'visible' and 'disposed' let it go as before.
//
// ⛔ AND A KEPT CHART'S TEARDOWN LIVES ON THE HANDLE (review of #2880). <Activity> runs every cleanup at the HIDE; when the
// hidden board is deleted later, React runs none again, so a chart kept at the hide would never be removed. The chart
// registers its full teardown with `onDispose` when it keeps itself (the show takes it back), and the workspace calls
// `dispose()` on every path that drops a kept board: each registered teardown runs once.
//
// ⭐ THE LAYER MODE (2026-11-27, `uct.boardKeepAlive` = '2'; a handle made with `{ layer: true }`). The kept board stays
// mounted AND laid out (absolute, inset 0, visibility hidden, inert): no effect of it is cleaned up at the hide or re-run
// at the show, and no canvas changes size. Its work PAUSES instead, each piece reading the handle:
//   - `forwardWhileShown(vis, notify)`: a feed the board keeps (the bar store's keys and developing bars, the price and
//     bar streams) stays SUBSCRIBED, so its data stays current and nothing is evicted, but its React notifications are
//     MUTED while hidden; the show catches up SYNCHRONOUSLY in its own task (review of #2901, M2: never a stale frame),
//     and a reader whose value did not move is not re-rendered at either end;
//   - `whileBoardShown(vis, start)`: what costs work or network while hidden (the shared price poll's registration,
//     the legacy per-hook stream, a chart's membership of its group's switch decisions) stops at the hide and starts
//     again in the show's task;
//   - `boardHiddenNow(vis)` (read when it fires): intervals, polls, clocks and key shortcuts;
//   - `boardLoopGate(vis)`: the adaptive frame loops (parked while hidden, back on the next frame at the show);
//   - `useBoardHidden()` (reactive, re-renders its reader): only where a render must change (a chart leaving the
//     group decisions, ChartWidget).
// A layer handle never keeps a chart through a cleanup (`boardIsHiding` is false for it): a hidden board's unmount is a
// plain unmount.
//
// ⭐ FOR THE DOUBLE-BUFFERED NEXT ROW (2026-11-27), three more things a handle can be:
//   - CURRENT (`createBoardVisibility({ layer: true, current: true })`): hidden, everything above stays paused, except
//     the bar store's BASE feed, which `forwardWhileCurrent` keeps forwarding while hidden, each re-render in an idle
//     task (never in a key or input task): a slot shown next must already hold the current bars;
//   - QUIET (`vis.set(next, { quiet: true })`, or `vis.flip(next)`): the feeds' catch-ups and the loop gates run in
//     the flip's own task as ever; `useBoardHidden()` readers re-render after the next paint, so the flip's task
//     re-renders nothing;
//   - NESTED (`createBoardVisibility({ layer: true, parent })`, or `useNestedBoardVisibility()` under a board's
//     provider): a chart slot inside a board is hidden whenever ITS layer or the BOARD is not shown, and is told of
//     both. The layer CSS primitive is `boardLayerProps` (boardLayer.js), one definition for board and slot.
//
// ⭐ A KEPT BOARD IS CURRENT TOO (2026-11-28, Lane G): the workspace makes its LAYER board handles `current` and `kept`, so the
// bar store's base feed of what sits directly under a kept board stays forwarded (above), and a feed that opts in with
// `forwardWhileShown(vis, notify, catchUp, { idle: true })` (the chart's developing bar) is caught up in an idle task
// at most once per KEPT_IDLE_CATCHUP_MS while the board is kept (`keptCurrentNow`): a show then has (almost) nothing
// left to catch up, and what arrived since the last idle pass is still caught up in the show's own task (never a stale
// frame). A chart SLOT hidden in its own right (the double buffer's shadow) is not kept-current: as before.
//
// No provider (today, and with the flag off): the context is null and every chart behaves exactly as before.
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react'

export const BoardVisibilityContext = createContext(null)

function afterPaint(fn) {
  if (typeof requestAnimationFrame !== 'function') { setTimeout(fn, 0); return }
  requestAnimationFrame(() => { setTimeout(fn, 0) })
}

/** A kept board's handle: `state` is 'visible' | 'hidden' | 'disposed', written by the workspace only. `layer`: the
 *  layer mode's handle (above); without it the handle is the <Activity> mode's, and nothing reads it as paused.
 *  `current`: a hidden layer whose bar BASE feed stays forwarded (forwardWhileCurrent). `parent`: the layer handle of the
 *  board a chart slot sits in: the slot's `state` is the parent's whenever the parent is not shown. */
export function createBoardVisibility({ layer = false, current = false, parent = null, kept = false } = {}) {
  const disposers = new Set()
  const listeners = new Set()   // feeds, gates, loops, nested handles: told in the change's own task
  const readers = new Set()     // useBoardHidden (React): told in the change's task, or after the paint of a QUIET one
  const nested = !!(parent && parent.layer && typeof parent.subscribe === 'function')
  let own = 'visible'
  let unParent = null
  const notify = (quiet = false) => {
    const info = { quiet }
    for (const cb of [...listeners]) { try { cb(info) } catch { /* a listener never stops the rest */ } }
    const tellReaders = () => { for (const cb of [...readers]) { try { cb() } catch { /* the same */ } } }
    if (quiet) afterPaint(tellReaders)
    else tellReaders()
  }
  // a nested handle follows its parent while anyone listens to it (a parent change it inherits is told on, as quiet as
  // the parent's was)
  const follow = () => {
    if (!nested || unParent || own === 'disposed') return
    unParent = parent.subscribe((info) => { if (own === 'visible') notify(!!info?.quiet) })
  }
  const unfollow = () => {
    if (unParent && !listeners.size && !readers.size) { const u = unParent; unParent = null; u() }
  }
  const effective = () => (nested && parent.state !== 'visible' ? parent.state : own)
  return {
    get state() { return effective() },
    /** This handle's own state, its parent's left out. */
    get ownState() { return own },
    /** The <Activity> mode (and its rails) writes the state directly: no one is told. */
    set state(v) { own = v },
    layer: !!layer || nested,
    current: !!current,
    /** (Lane G) a workspace BOARD handle (kept boards are kept current: keptCurrentNow) */
    kept: !!kept && !nested,
    parent: nested ? parent : null,
    /** Change the state AND tell every reader (`useBoardHidden`, a parked frame loop). `{ quiet: true }`: the readers
     *  (`useBoardHidden`) are told after the next paint; everything else in this task. */
    set(next, { quiet = false } = {}) {
      if (own === next) return
      const was = effective()
      own = next
      if (effective() !== was) notify(quiet)
    },
    /** A quiet show or hide (the double-buffered row's flip): `set(next, { quiet: true })`. */
    flip(next) { this.set(next, { quiet: true }) },
    /** What follows the state in the change's own task (stable per handle). */
    subscribe: (cb) => {
      follow()
      listeners.add(cb)
      return () => { listeners.delete(cb); unfollow() }
    },
    /** The React readers' subscribe (useBoardHidden): told after the paint of a quiet change. */
    subscribeReaders: (cb) => {
      follow()
      readers.add(cb)
      return () => { readers.delete(cb); unfollow() }
    },
    /** What must run if the board is disposed while hidden (a chart kept through the hide). Returns the unregister. */
    onDispose(fn) {
      disposers.add(fn)
      return () => { disposers.delete(fn) }
    },
    /** The board goes for good: every registered teardown runs, once. A NESTED handle (a chart slot) then drops its
     *  listeners and readers and stops following its board (review of #2918, LOW 2): the board outlives its slots. */
    dispose() {
      own = 'disposed'
      for (const fn of [...disposers]) {
        disposers.delete(fn)
        try { fn() } catch { /* one teardown never stops the rest */ }
      }
      notify()
      if (nested) {
        listeners.clear()
        readers.clear()
        if (unParent) { const u = unParent; unParent = null; u() }
      }
    },
  }
}

/** Is the board this handle names being hidden by an <Activity> (its cleanups running now), not unmounted? */
export function boardIsHiding(vis) {
  return !!vis && !vis.layer && vis.state === 'hidden'
}

/** Is the board this handle names a LAYER that is not shown now (hidden, or disposed and about to unmount: its work
 *  paused)? Read when an interval, a poll or a key fires. */
export function boardHiddenNow(vis) {
  return !!vis && !!vis.layer && vis.state !== 'visible'
}

/** The pause gate of an adaptive frame loop on this board (adaptiveFrameLoop.js `gate`), or null (no layer handle). */
export function boardLoopGate(vis) {
  if (!vis || !vis.layer || typeof vis.subscribe !== 'function') return null
  return { paused: () => boardHiddenNow(vis), subscribe: vis.subscribe }
}

/** The LAYER handle of the board this component sits on, or null (no handle, or the <Activity> mode's). Stable per
 *  board: reading it never re-renders. */
export function useLayerBoard() {
  const vis = useContext(BoardVisibilityContext)
  return vis && vis.layer ? vis : null
}

/** Run `start` (it returns its own stop) while the layer board `vis` is shown: stopped at a hide, started again in the
 *  show's own task. No layer handle: started once, exactly as before. Returns the stop of it all. */
export function whileBoardShown(vis, start) {
  if (!vis) return start()
  let stop = null
  let done = false
  const halt = () => {
    if (stop) { const s = stop; stop = null; try { s() } catch { /* gone */ } }
  }
  const sync = () => {
    if (done) return
    if (boardHiddenNow(vis)) halt()
    else if (!stop) stop = start()
  }
  if (!boardHiddenNow(vis)) stop = start()
  const unVis = vis.subscribe(sync)
  return () => { done = true; unVis(); halt() }
}

function idleTask(fn) {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(fn, { timeout: 500 })
    return () => { try { cancelIdleCallback(id) } catch { /* gone */ } }
  }
  const t = setTimeout(fn, 0)
  return () => clearTimeout(t)
}

/** The bar store's BASE feed on a CURRENT layer (the double-buffered row): forwarded while the board is shown, as ever;
 *  while it is hidden forwarded TOO, coalesced into one call in an idle task (never in a key or input task), so the
 *  slot holds the current bars when it is flipped in; the show flushes a pending call in its own task. Any other handle:
 *  `forwardWhileShown`. Returns { cb, stop } like it. */
export function forwardWhileCurrent(vis, notify, catchUp = () => notify()) {
  if (!vis || !vis.current) return forwardWhileShown(vis, notify, catchUp)
  let cancel = null
  const cb = (...args) => {
    // (review of #2918, LOW 1) a disposed slot (still mounted, about to go) schedules no idle re-render
    if (vis.state === 'disposed') return
    if (!boardHiddenNow(vis)) { notify(...args); return }
    if (cancel) return
    cancel = idleTask(() => { cancel = null; if (vis.state !== 'disposed') notify() })
  }
  const unVis = vis.subscribe(() => {
    if (!cancel) return
    if (vis.state === 'disposed') { cancel(); cancel = null; return }
    if (vis.state !== 'visible') return
    cancel(); cancel = null
    catchUp()
  })
  return { cb, stop: () => { unVis(); if (cancel) { cancel(); cancel = null } } }
}

/** The longest a kept-current board's opted-in feed waits for its idle catch-up (about once a second). */
export const KEPT_IDLE_CATCHUP_MS = 1000

/** Is this layer hidden ONLY because it is (on) a kept CURRENT board: a current board handle that is hidden, or a
 *  nested slot shown in its own right whose board is one? */
export function keptCurrentNow(vis) {
  if (!vis || !vis.layer) return false
  if (vis.parent) return vis.ownState === 'visible' && keptCurrentNow(vis.parent)
  return !!vis.kept && !!vis.current && vis.state === 'hidden'
}

/** A chart slot's own layer handle inside the board this component sits on (nested: hidden whenever the board is),
 *  made once; `{ current }` as createBoardVisibility. Provide it with BoardVisibilityContext.Provider. */
export function useNestedBoardVisibility({ current = false } = {}) {
  const parent = useContext(BoardVisibilityContext)
  const [vis] = useState(() => createBoardVisibility({ layer: true, current, parent }))
  useEffect(() => () => { vis.dispose() }, [vis])
  return vis
}

/** A feed's callback for a component on the layer board `vis`: forwarded while the board is shown; while it is hidden
 *  (or disposed) the feed stays subscribed and the call is only NOTED, and the show runs `catchUp` (default: `notify`
 *  with no argument) once, synchronously in its own task, when anything was noted. No layer handle: `notify` itself.
 *  Returns { cb, stop }: subscribe the feed with `cb`, and call `stop` with the feed's own unsubscribe. */
export function forwardWhileShown(vis, notify, catchUp = () => notify(), { idle = false } = {}) {
  if (!vis) return { cb: notify, stop: () => {} }
  let missed = false
  let cancel = null
  let lastIdle = 0
  // (Lane G) `idle`: on a kept current board the catch-up runs in an idle task, at most once per KEPT_IDLE_CATCHUP_MS
  const idleCatchUp = () => {
    if (cancel) return
    const wait = Math.max(0, lastIdle + KEPT_IDLE_CATCHUP_MS - Date.now())
    let t = null
    let cancelIdle = null
    const run = () => {
      cancel = null
      lastIdle = Date.now()
      if (!missed || !keptCurrentNow(vis)) return
      missed = false
      catchUp()
    }
    t = setTimeout(() => { t = null; cancelIdle = idleTask(run) }, wait)
    cancel = () => { if (t != null) clearTimeout(t); if (cancelIdle) cancelIdle(); cancel = null }
  }
  const cb = (...args) => {
    if (boardHiddenNow(vis)) {
      missed = true
      if (idle && keptCurrentNow(vis)) idleCatchUp()
      return
    }
    notify(...args)
  }
  const unVis = vis.subscribe(() => {
    if (vis.state !== 'visible') return
    if (cancel) cancel()
    if (!missed) return
    missed = false
    catchUp()
  })
  return { cb, stop: () => { unVis(); if (cancel) cancel() } }
}

const NO_SUBSCRIBE = () => () => {}
/** Is the board this component sits on a hidden layer? False with no board handle (everywhere else) and in the
 *  <Activity> mode. A change re-renders the reader. */
export function useBoardHidden() {
  const vis = useContext(BoardVisibilityContext)
  const layer = !!vis && !!vis.layer
  const sub = layer ? (vis.subscribeReaders || vis.subscribe) : NO_SUBSCRIBE
  return useSyncExternalStore(sub, () => layer && vis.state !== 'visible', () => false)
}
