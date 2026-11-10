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
// Whether the workspace already finished. The leaf that asks is a lazy chunk and can land after
// it, and a request nobody will ever answer must not hold the desk forever.
let launchSettled = false
let launchBlocked = false

function notifyLaunch(change) {
  if (change()) listeners.forEach((fn) => fn())
}

function setLaunchPending(next) {
  notifyLaunch(() => {
    if (launchPending === next) return false
    launchPending = next
    return true
  })
}

export function requestDeskLaunch() { if (!launchSettled) setLaunchPending(true) }

/** The workspace is done with this launch's records. */
export function finishDeskLaunch() {
  launchSettled = true
  setLaunchPending(false)
}

/** The member changed or signed out: the next member's launch starts from nothing. */
export function withdrawDeskLaunch() {
  launchSettled = false
  setLaunchPending(false)
  notifyLaunch(() => {
    const changed = launchBlocked
    launchBlocked = false
    return changed
  })
}

export function isDeskLaunchPending() { return launchPending }

/** A launch re-pop was refused while the board was hidden, so its notice cannot reach the member. */
export function announceDeskLaunchBlocked() { notifyLaunch(() => { const was = launchBlocked; launchBlocked = true; return !was }) }
export function dismissDeskLaunchBlocked() { notifyLaunch(() => { const was = launchBlocked; launchBlocked = false; return was }) }
export function isDeskLaunchBlocked() { return launchBlocked }

export function hasOpenPopouts() {
  return open > 0
}

/** For useSyncExternalStore: fn runs when hasOpenPopouts() changes. Returns the unsubscribe. */
export function subscribePopouts(fn) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
