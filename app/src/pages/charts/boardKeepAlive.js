// ⭐ BOARD KEEP-ALIVE (2026-11-27, Stage 2: the workspace's side; OFF by default).
//
// A return to the board a member just left re-created every widget on it: the click task, chart 2 paced in at +320 ms,
// the list at +630 ms, everything on screen after about 650 ms (owner-board probe, 2026-11-26). With the keep-alive on,
// the board left by a member's switch stays mounted, hidden in React's <Activity mode="hidden"> (every effect of it
// disconnected: no stream, poll, timer or frame loop runs for a hidden board), and a switch back to it SHOWS it instead
// of mounting it. Its charts keep their instances through the hide (StockChart, boardVisibility.js).
//
// One board is kept. A switch to a third board disposes it; so does grid mode or the desk hiding the workspace. The kept
// board is reused only when the board asked for is the very same layout (`sameBoard`): one saved in another tab or
// window meanwhile is mounted fresh. A hidden board is never written: its grid has no-op handlers, and the attributes
// other code finds a widget by (`data-widget-id`, `data-widget-type`) are only on the board in front.
//
// Switch: localStorage `uct.boardKeepAlive` = '1', or VITE_BOARD_KEEPALIVE=1 at build time. Read once per workspace.
export const BOARD_KEEPALIVE_KEY = 'uct.boardKeepAlive'
/** A kept board is disposed once the page has been hidden this long (memory: nobody is coming back soon). */
export const KEPT_BOARD_HIDDEN_DISPOSE_MS = 10 * 60_000

export function boardKeepAliveEnabled() {
  try {
    const v = globalThis.localStorage?.getItem(BOARD_KEEPALIVE_KEY)
    if (v === '1') return true
    if (v === '0') return false
  } catch { /* storage off */ }
  return import.meta.env?.VITE_BOARD_KEEPALIVE === '1'
}

/** Is `b` the very layout `a` holds (the same widgets, places, links and options)? `serialize` is the workspace's own
 *  layout serialiser (ChartsWorkspace `serializeLayout`), so two parses of one saved board compare equal. */
export function sameBoard(a, b, serialize = JSON.stringify) {
  if (!a || !b) return false
  if (a === b) return true
  try { return serialize(a) === serialize(b) } catch { return false }
}
