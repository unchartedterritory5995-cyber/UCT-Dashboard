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

// The desktop app's launch restore. A leaf outside the workspace knows there are records to bring
// back; the workspace owns restoring them and says when it is done. The host holds the workspace
// mounted across that gap, reading this primitive like hasOpenPopouts.
let launchPending = false

function setLaunchPending(next) {
  if (launchPending === next) return
  launchPending = next
  listeners.forEach((fn) => fn())
}

export function requestDeskLaunch() { setLaunchPending(true) }
export function finishDeskLaunch() { setLaunchPending(false) }
export function isDeskLaunchPending() { return launchPending }

export function hasOpenPopouts() {
  return open > 0
}

/** For useSyncExternalStore: fn runs when hasOpenPopouts() changes. Returns the unsubscribe. */
export function subscribePopouts(fn) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
