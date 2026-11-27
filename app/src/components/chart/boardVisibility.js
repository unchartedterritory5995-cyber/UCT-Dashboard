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
//   - `useBoardHidden()` (reactive): the bar store's subscriptions, live prices, the developing-bar paint;
//   - `boardHiddenNow(vis)` (read when it fires): intervals and document key shortcuts;
//   - `boardLoopGate(vis)`: the adaptive frame loops (parked while hidden, back on the next frame at the show).
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

/** Is the board this handle names a hidden LAYER now (its work paused)? Read when an interval or a key fires. */
export function boardHiddenNow(vis) {
  return !!vis && !!vis.layer && vis.state === 'hidden'
}

/** The pause gate of an adaptive frame loop on this board (adaptiveFrameLoop.js `gate`), or null (no layer handle). */
export function boardLoopGate(vis) {
  if (!vis || !vis.layer || typeof vis.subscribe !== 'function') return null
  return { paused: () => boardHiddenNow(vis), subscribe: vis.subscribe }
}

const NO_SUBSCRIBE = () => () => {}
/** Is the board this component sits on a hidden layer? False with no board handle (everywhere else) and in the
 *  <Activity> mode. A change re-renders the reader. */
export function useBoardHidden() {
  const vis = useContext(BoardVisibilityContext)
  const layer = !!vis && !!vis.layer
  return useSyncExternalStore(layer ? vis.subscribe : NO_SUBSCRIBE, () => layer && vis.state === 'hidden', () => false)
}
