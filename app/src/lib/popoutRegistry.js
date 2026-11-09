/**
 * Which pop-out windows are open right now, as a count nobody else can corrupt.
 *
 * Scope is PORTAL windows only (charts/popout/PopoutWindow) - the only ones a
 * reload of this tab closes. Terminal windows are independent pages and their
 * handles are lost on route change, so they are deliberately not registered.
 */
let open = 0

/** Register one open window. The returned release is idempotent. */
export function registerPopout() {
  open += 1
  let released = false
  return () => {
    if (released) return
    released = true
    open -= 1
  }
}

export function hasOpenPopouts() {
  return open > 0
}
