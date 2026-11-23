// app/src/lib/chartSpeed.js — the SERVER's kill switch over the chart speed switches (2026-11-20).
//
// One server setting, CHART_SPEED_ENABLED on web (api/routers/auth.py, read per request), turns BOTH
// chart speed switches off in every browser, over a member's own local '1':
//   • `uct.neighborframes` (components/chart/neighborFrames.js, ON by default since #2202)
//   • `uct.deviceStore`    (data/deviceStore/switch.js)
// Each asks `chartSpeedKilled()` before it reads its own local value.
//
// ⭐ THE BROWSER'S COPY IS A COOKIE THE SERVER WRITES: `uct_chart_speed=0`, set beside every auth payload
// (/me, login, the second factor, signup, smoke-login) while the switch is off, and cleared by the next one
// after it is back on. So it is already in the jar when a page load starts, before that load's /me answers;
// an unanswered /me (5xx, network, a pod down) or a 401 changes nothing, so an outage cannot turn speed off
// by itself (fail open) and a kill once seen holds until an auth response clears it.
//
// ⛔ WHY A SERVER-WRITTEN COOKIE AND NOT A CLIENT WRITER: a writer has to sit in AuthContext, which is on
// the Notebook's first-open closure; measured 135 B against a 97 B headroom. This module is read only by
// lazy chart and device-store code, so the kill costs first open nothing. Keep it that way: never import
// this from AuthContext, the entry, or anything the Notebook route reaches statically.
//
// Read ONCE per page load, like the switches it governs, so the two always agree within one load.
//
// ⭐ THE DEVICE STORE'S OWN KILL (review of #2537, M9), through the same channel: DEVICE_STORE_ENABLED on web writes
// `uct_device_store=0` beside the same auth payloads (api/routers/auth.py). It turns `uct.deviceStore` off alone,
// over a member's '1', and nothing else (neighbor frames keep the member's own choice). Off, the store also deletes a
// seed this browser downloaded (deviceStore/source.js). `deviceStoreKilled` is latched per page load like the speed
// kill; `deviceStoreKilledNow` reads the jar FRESH, for a page left open (deviceStore/client.js reads it on a visible
// beat: AuthContext re-checks /api/auth/me when a tab becomes visible, and that answer refreshes the cookie).

/** The cookie's name. api/routers/auth.py CHART_SPEED_COOKIE is the other half; tests/test_chart_speed_kill.py
 *  reads both files and pins them equal. */
export const CHART_SPEED_COOKIE = 'uct_chart_speed'
/** The device store's own kill cookie. api/routers/auth.py DEVICE_STORE_COOKIE is the other half;
 *  tests/test_device_store_kill.py reads both files and pins them equal. */
export const DEVICE_STORE_COOKIE = 'uct_device_store'

/** Does this cookie string set `name` to exactly '0'? Pure; anything else is "not killed". */
function _zero(jar, name) {
  for (const part of String(jar || '').split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() === '0'
  }
  return false
}

/** Does this cookie string carry the kill (`uct_chart_speed=0`)? Pure; anything else is "not killed". */
export function cookieKillsChartSpeed(jar) { return _zero(jar, CHART_SPEED_COOKIE) }

/** Does this cookie string carry the device store's own kill (`uct_device_store=0`)? Pure. */
export function cookieKillsDeviceStore(jar) { return _zero(jar, DEVICE_STORE_COOKIE) }

let _killed = null
let _deviceKilled = null

/** Has the server killed the chart speed switches for this page load? Never throws: no document (a
 *  worker) or an unreadable jar reads as "not killed". */
export function chartSpeedKilled() {
  if (_killed !== null) return _killed
  try { _killed = typeof document !== 'undefined' && cookieKillsChartSpeed(document.cookie) } catch { _killed = false }
  return _killed
}

/** Has the server killed the device store ALONE for this page load? Latched like chartSpeedKilled. Never throws. */
export function deviceStoreKilled() {
  if (_deviceKilled !== null) return _deviceKilled
  try { _deviceKilled = typeof document !== 'undefined' && cookieKillsDeviceStore(document.cookie) } catch { _deviceKilled = false }
  return _deviceKilled
}

/** Is the device store killed NOW, by either kill? Read FRESH from the jar (not latched): a page left open asks it on
 *  a visible beat and stops its worker. No document (a worker) or an unreadable jar: not killed. */
export function deviceStoreKilledNow() {
  try {
    if (typeof document === 'undefined') return false
    const jar = document.cookie
    return cookieKillsChartSpeed(jar) || cookieKillsDeviceStore(jar)
  } catch { return false }
}

/** Tests: forget this page load's answers. */
export function __resetChartSpeedForTests() { _killed = null; _deviceKilled = null }
