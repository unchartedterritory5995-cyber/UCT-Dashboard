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
// No provider (today, and with the flag off): the context is null and every chart behaves exactly as before.
import { createContext, useContext, useSyncExternalStore } from 'react'

export const BoardVisibilityContext = createContext(null)

/** A kept board's handle: `state` is 'visible' | 'hidden' | 'disposed', written by the workspace only. `layer`: the
 *  layer mode's handle (above); without it the handle is the <Activity> mode's, and nothing reads it as paused. */
export function createBoardVisibility({ layer = false } = {}) {
  const disposers = new Set()
  const listeners = new Set()
  const notify = () => { for (const cb of [...listeners]) { try { cb() } catch { /* a listener never stops the rest */ } } }
  return {
    state: 'visible',
    layer: !!layer,
    /** Change the state AND tell every reader (`useBoardHidden`, a parked frame loop). */
    set(next) {
      if (this.state === next) return
      this.state = next
      notify()
    },
    /** Readers of the state (stable per handle: useSyncExternalStore's subscribe). */
    subscribe: (cb) => {
      listeners.add(cb)
      return () => { listeners.delete(cb) }
    },
    /** What must run if the board is disposed while hidden (a chart kept through the hide). Returns the unregister. */
    onDispose(fn) {
      disposers.add(fn)
      return () => { disposers.delete(fn) }
    },
    /** The board goes for good: every registered teardown runs, once. */
    dispose() {
      this.state = 'disposed'
      for (const fn of [...disposers]) {
        disposers.delete(fn)
        try { fn() } catch { /* one teardown never stops the rest */ }
      }
      notify()
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

/** A feed's callback for a component on the layer board `vis`: forwarded while the board is shown; while it is hidden
 *  (or disposed) the feed stays subscribed and the call is only NOTED, and the show runs `catchUp` (default: `notify`
 *  with no argument) once, synchronously in its own task, when anything was noted. No layer handle: `notify` itself.
 *  Returns { cb, stop }: subscribe the feed with `cb`, and call `stop` with the feed's own unsubscribe. */
export function forwardWhileShown(vis, notify, catchUp = () => notify()) {
  if (!vis) return { cb: notify, stop: () => {} }
  let missed = false
  const cb = (...args) => {
    if (boardHiddenNow(vis)) { missed = true; return }
    notify(...args)
  }
  const stop = vis.subscribe(() => {
    if (!missed || vis.state !== 'visible') return
    missed = false
    catchUp()
  })
  return { cb, stop }
}

const NO_SUBSCRIBE = () => () => {}
/** Is the board this component sits on a hidden layer? False with no board handle (everywhere else) and in the
 *  <Activity> mode. A change re-renders the reader. */
export function useBoardHidden() {
  const vis = useContext(BoardVisibilityContext)
  const layer = !!vis && !!vis.layer
  return useSyncExternalStore(layer ? vis.subscribe : NO_SUBSCRIBE, () => layer && vis.state !== 'visible', () => false)
}
