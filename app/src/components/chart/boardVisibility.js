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
// No provider (today, and with the flag off): the context is null and every chart behaves exactly as before.
import { createContext } from 'react'

export const BoardVisibilityContext = createContext(null)

/** A kept board's handle: `state` is 'visible' | 'hidden' | 'disposed', written by the workspace only. */
export function createBoardVisibility() {
  const disposers = new Set()
  return {
    state: 'visible',
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
    },
  }
}

/** Is the board this handle names being hidden (kept), not unmounted? */
export function boardIsHiding(vis) {
  return !!vis && vis.state === 'hidden'
}
