// The board keep-alive's visibility handle (2026-11-27, Stage 1: the chart's side; behind the workspace's flag).
//
// The workspace keeps the previous board mounted but hidden (React <Activity mode="hidden">, which runs every effect
// cleanup of the hidden tree). A cleanup cannot tell a hide from an unmount by itself, so each kept board hands its
// widgets ONE stable object through BoardVisibilityContext and sets its `state` BEFORE the commit that hides, shows or
// disposes the board: a cleanup running in that commit reads the board's fate. 'hidden' keeps a chart instance (no
// remove, no latch reset); 'visible' and 'disposed' let it go as before.
//
// No provider (today, and with the flag off): the context is null and every chart behaves exactly as before.
import { createContext } from 'react'

export const BoardVisibilityContext = createContext(null)

/** A kept board's handle: `state` is 'visible' | 'hidden' | 'disposed', written by the workspace only. */
export function createBoardVisibility() {
  return { state: 'visible' }
}

/** Is the board this handle names being hidden (kept), not unmounted? */
export function boardIsHiding(vis) {
  return !!vis && vis.state === 'hidden'
}
