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
  'site-events': ['reportEvent'],
  'app-update': ['getAppUpdate', 'onAppUpdate', 'restartToUpdate'],
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

/**
 * Tell the shell about an event only the website can see, for its enum-only telemetry (plan 5.1):
 * 'signed_in' (the shell sends first_signin once per install) or 'desk_restored' (a saved desk came
 * back at launch). The shell drops any other name. A no-op outside the app or on an older shell.
 */
export function reportDesktopEvent(name) {
  if (!hasDesktopFeature('site-events')) return
  try { getBridge().reportEvent(name) } catch { /* telemetry never breaks the page */ }
}

const asUpdate = (u) => (u && typeof u.version === 'string' && /^\d+\.\d+\.\d+$/.test(u.version) ? { version: u.version } : null)

/** The desktop app update downloaded and waiting to install ({ version }), or null. */
export async function getAppUpdate() {
  if (!hasDesktopFeature('app-update')) return null
  try {
    return asUpdate(await getBridge().getAppUpdate())
  } catch {
    return null
  }
}

/** Called with { version } when an app update is ready, and null when it is withdrawn. */
export function onAppUpdate(cb) { return subscribe('app-update', (b) => b.onAppUpdate((u) => cb(asUpdate(u)))) }

/** "Restart to update": the shell runs its normal quit (unsaved-text prompt included), installs, reopens. */
export function restartToUpdate() {
  if (!hasDesktopFeature('app-update')) return
  try { getBridge().restartToUpdate() } catch { /* the shell installs on the next quit anyway */ }
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
