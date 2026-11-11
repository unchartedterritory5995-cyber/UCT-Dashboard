// Polite reloads: never close a member's popped-out windows without telling them first.
//
// A reload of the opener closes every portal pop-out, and a Terminal pop-out child is a page of its
// own that must never reload itself. While either is true, an automatic reload is deferred and the
// member is shown the "new version ready" toast instead (components/UpdateReadyToast.jsx).
import { hasOpenPopouts } from './popoutRegistry'
import { markAppClosing, clearAppClosing } from './appClosing'

export const UPDATE_REQUIRED_EVENT = 'uct:update-required'
const STAY_CHECK_MS = 5000

// Two sources. A stale chunk that could not load (forced) needs the Reload, so it is never
// dismissible. A newer build seen by the watcher (buildId) is a courtesy: the member can say Later,
// and that is remembered here, in module state, so it survives remounts of Layout.
let forced = false
let buildId = ''
let dismissedId = ''

/** True on the Terminal pop-out child page: /terminal with a ?popout= token. */
export function isTerminalPopoutChild(loc = typeof window !== 'undefined' ? window.location : null) {
  try {
    if (!loc || !/^\/terminal(\/|$)/i.test(loc.pathname || '')) return false
    return !!new URLSearchParams(loc.search || '').get('popout')
  } catch {
    return false
  }
}

/** True when a reload would close a window the member is using. */
export function shouldDeferReload() {
  return hasOpenPopouts() || isTerminalPopoutChild()
}

/** Tell the toast an update is waiting. Idempotent. */
function notify() {
  try { window.dispatchEvent(new Event(UPDATE_REQUIRED_EVENT)) } catch { /* no window */ }
}

/** A route could not load (stale chunk): the Reload is needed, so the toast is not dismissible. */
export function announceUpdateRequired() {
  forced = true
  notify()
}

/** The build watcher saw a newer server build. Shows again only for an id not yet dismissed. */
export function announceNewBuild(id) {
  buildId = id || 'unknown'
  notify()
}

/** The server id returned to the client's own id (rollback): withdraw the courtesy toast. */
export function clearNewBuild() {
  buildId = ''
  dismissedId = ''
  notify()
}

/** The member's Later. Remembers the build id so only a different one brings the toast back. */
export function dismissUpdate() {
  if (forced || !buildId) return
  dismissedId = buildId
  notify()
}

export function isUpdateAnnounced() { return forced || !!buildId }

/** 'hidden' | 'dismissible' | 'forced' (a primitive, for useSyncExternalStore). */
export function getUpdateMode() {
  if (forced) return 'forced'
  if (buildId && buildId !== dismissedId) return 'dismissible'
  return 'hidden'
}

/** For useSyncExternalStore. */
export function subscribeUpdateRequired(fn) {
  window.addEventListener(UPDATE_REQUIRED_EVENT, fn)
  return () => window.removeEventListener(UPDATE_REQUIRED_EVENT, fn)
}

/** Tests only. */
export function __resetReloadGuardForTests() { forced = false; buildId = ''; dismissedId = '' }

/**
 * The member's Reload button. Marks the app closing so the pop-outs closing with it do not dock
 * their boards, then reloads. If the page is still alive STAY_CHECK_MS later (the member answered
 * Stay on a Leave site prompt) the flag is cleared so closing a window docks its board again.
 */
export function reloadNow({
  reload = () => window.location.reload(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
} = {}) {
  markAppClosing()
  setTimer(clearAppClosing, STAY_CHECK_MS)
  reload()
}
