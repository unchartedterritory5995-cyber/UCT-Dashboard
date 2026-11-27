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
//
// ⭐ '2' (or VITE_BOARD_KEEPALIVE=2) is the LAYER mode (2026-11-27): the kept board is not in an <Activity>; it stays
// mounted and laid out under the board in front (absolute, inset 0, visibility hidden, inert), every effect of it alive
// and its work paused through its visibility handle (components/chart/boardVisibility.js). A switch back flips its
// visibility: no effect re-runs, no canvas is re-allocated. Disposing it is a plain unmount.
export const BOARD_KEEPALIVE_KEY = 'uct.boardKeepAlive'
/** A kept board is disposed once the page has been hidden this long (memory: nobody is coming back soon). */
export const KEPT_BOARD_HIDDEN_DISPOSE_MS = 10 * 60_000
/** ...and once it has not been shown for this long, page visible or not: a kept board's store keys and live feed stay
 *  subscribed while it is hidden (review of #2901, D3), so a board nobody returns to stops costing after this. */
export const KEPT_BOARD_MAX_HIDDEN_MS = 30 * 60_000

// ⭐ DEFAULT ON (owner directive 2026-11-27: the keep-alive ends up on by default for everyone once proven). With no
// choice made (no `uct.boardKeepAlive` in storage, no VITE_BOARD_KEEPALIVE in the build) the default is the LAYER mode
// wherever the device can afford a second board; '0' in storage stays the opt-out.
export const KEEPALIVE_DEFAULT_MODE = 'layer'
/** Below this much device memory (navigator.deviceMemory, GB, Chromium only) no board is kept. ⚠️ PROVISIONAL until the
 *  per-board memory is measured on a clean machine (the 2026-11-27 measurements ran under a paging disk). */
export const KEEPALIVE_MIN_DEVICE_GB = 4
/** The touch tier (<= 1024 px: tablets; phones use the mobile shell, which keeps no board) keeps one only when the
 *  device REPORTS enough memory: Safari reports none, and an iPad's tab is the first thing memory pressure reloads. */
export function deviceCanKeepBoard(nav = globalThis.navigator, matchMedia = globalThis.matchMedia) {
  const gb = typeof nav?.deviceMemory === 'number' ? nav.deviceMemory : null
  if (gb != null) return gb >= KEEPALIVE_MIN_DEVICE_GB
  let narrow = false
  try { narrow = !!(typeof matchMedia === 'function' && matchMedia('(max-width: 1024px)').matches) } catch { narrow = false }
  return !narrow
}

/** 'off' | 'activity' ('1') | 'layer' ('2'): storage first, then the build's default, then the device's default. */
export function boardKeepAliveMode() {
  const of = (v) => (v === '2' ? 'layer' : v === '1' ? 'activity' : v === '0' ? 'off' : null)
  try {
    const m = of(globalThis.localStorage?.getItem(BOARD_KEEPALIVE_KEY))
    if (m) return m
  } catch { /* storage off */ }
  const built = of(import.meta.env?.VITE_BOARD_KEEPALIVE)
  if (built) return built
  return deviceCanKeepBoard() ? KEEPALIVE_DEFAULT_MODE : 'off'
}

export function boardKeepAliveEnabled() {
  return boardKeepAliveMode() !== 'off'
}

/** Is `b` the very layout `a` holds (the same widgets, places, links and options)? `serialize` is the workspace's own
 *  layout serialiser (ChartsWorkspace `serializeLayout`), so two parses of one saved board compare equal. */
export function sameBoard(a, b, serialize = JSON.stringify) {
  if (!a || !b) return false
  if (a === b) return true
  try { return serialize(a) === serialize(b) } catch { return false }
}
