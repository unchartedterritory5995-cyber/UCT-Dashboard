/**
 * Which pop-out windows are open right now, as a count nobody else can corrupt.
 *
 * Scope is PORTAL windows only (charts/popout/PopoutWindow) - the only ones a
 * reload of this tab closes. Terminal windows are independent pages and their
 * handles are lost on route change, so they are deliberately not registered.
 */
let open = 0
const listeners = new Set()

function setOpen(next) {
  const crossed = (open > 0) !== (next > 0)
  open = next
  // Subscribers read a yes/no, so only a change of that answer is worth a re-render.
  if (crossed) listeners.forEach((fn) => fn())
}

/** Register one open window. The returned release is idempotent. */
export function registerPopout() {
  setOpen(open + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    setOpen(open - 1)
  }
}

export function hasOpenPopouts() {
  return open > 0
}

/** For useSyncExternalStore: fn runs when hasOpenPopouts() changes. Returns the unsubscribe. */
export function subscribePopouts(fn) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
