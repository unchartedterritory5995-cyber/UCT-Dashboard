// The website's one door to the desktop shell. In a normal browser window.uctDesktop does not
// exist and everything here answers "no" or does nothing, and a shell that is older, newer or
// half-built degrades the same way: no caller has to guard, and none of these throw.
//
// The surface is the shell's contract/bridge.json, vendored at tests/fixtures/desktop_bridge.json;
// tests/test_desktop_contract.py fails if this file uses anything that contract does not carry.

const FEATURE_METHODS = {
  'window-state': ['onWindowState'],
  'desk-visibility': ['onDeskVisibility'],
  'before-quit': ['onBeforeQuit', 'ackBeforeQuit'],
}

const noop = () => {}

function getBridge() {
  try {
    const b = typeof window !== 'undefined' ? window.uctDesktop : null
    return b && typeof b === 'object' ? b : null
  } catch {
    return null
  }
}

/** True inside the desktop app's main window, whatever features this shell has. */
export function isDesktopApp() {
  const b = getBridge()
  return !!b && Number.isFinite(b.bridgeVersion) && Array.isArray(b.capabilities)
}

/** True only when the shell lists the capability and has every method behind it. */
export function hasDesktopFeature(name) {
  const b = getBridge()
  const methods = Object.hasOwn(FEATURE_METHODS, name) ? FEATURE_METHODS[name] : null
  if (!b || !methods || !isDesktopApp() || !b.capabilities.includes(name)) return false
  return methods.every((m) => typeof b[m] === 'function')
}

function subscribe(feature, call) {
  if (!hasDesktopFeature(feature)) return noop
  let off
  try {
    off = call(getBridge())
  } catch {
    return noop
  }
  if (typeof off !== 'function') return noop
  return () => {
    try { off() } catch { /* the shell is going away */ }
  }
}

export function onWindowState(cb) { return subscribe('window-state', (b) => b.onWindowState(cb)) }
/** 'visible' | 'hidden' for the WHOLE desk: hidden only when every app window is hidden or minimized. */
export function onDeskVisibility(cb) { return subscribe('desk-visibility', (b) => b.onDeskVisibility(cb)) }

export function onBeforeQuit(cb) { return subscribe('before-quit', (b) => b.onBeforeQuit(cb)) }

export function ackBeforeQuit() {
  if (!hasDesktopFeature('before-quit')) return
  try { getBridge().ackBeforeQuit() } catch { /* the shell closes on its own timer */ }
}

/** { appVersion, platform }, or null outside the app or if the shell cannot answer. */
export async function getDesktopInfo() {
  const b = getBridge()
  if (!b || typeof b.getInfo !== 'function') return null
  try {
    return (await b.getInfo()) ?? null
  } catch {
    return null
  }
}
