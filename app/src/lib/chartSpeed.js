// app/src/lib/chartSpeed.js — the SERVER's kill switch over the chart speed switches (2026-11-20).
//
// One server setting, CHART_SPEED_ENABLED on web (api/routers/auth.py, read per request), turns the
// chart speed switches off in every browser, over a member's own local '1':
//   • `uct.neighborframes` (components/chart/neighborFrames.js, ON by default since #2202)
//   • `uct.deviceStore`    (data/deviceStore/switch.js)
//   • `uct.minuteFeed`     (data/barStore/minuteFeedSwitch.js, 2026-11-23: the minute feed into the bar store's
//                          registry; a page left open reads the cookie fresh before each of its polls and stops)
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
// `uct_device_store` beside the same auth payloads (api/routers/auth.py). It turns `uct.deviceStore` off alone, over a
// member's '1', and nothing else (neighbor frames keep the member's own choice). TWO VALUES (review of #2563, MEDIUM-2):
//   `uct_device_store=0`      the store OFF, its packs KEPT (lifting the kill costs nobody a download)
//   `uct_device_store=purge`  the store OFF, and each browser DELETES the packs it holds (deviceStore/source.js)
// The chart-speed kill never deletes anything (it is a lever for incidents in other features).
// ONE document.cookie read per page load latches both kills (`_latch`). `deviceStoreKilledNow` reads the jar FRESH,
// for a page left open (deviceStore/client.js reads it on a visible beat: AuthContext re-checks /api/auth/me when a tab
// becomes visible, and that answer refreshes the cookie).

/** The cookie's name. api/routers/auth.py CHART_SPEED_COOKIE is the other half; tests/test_chart_speed_kill.py
 *  reads both files and pins them equal. */
export const CHART_SPEED_COOKIE = 'uct_chart_speed'
/** The device store's own kill cookie. api/routers/auth.py DEVICE_STORE_COOKIE is the other half;
 *  tests/test_device_store_kill.py reads both files and pins them equal. */
export const DEVICE_STORE_COOKIE = 'uct_device_store'
/** The device kill's value that also deletes the packs (api/routers/auth.py DEVICE_STORE_PURGE, pinned equal). */
export const DEVICE_STORE_PURGE = 'purge'

/** The value of cookie `name` in this cookie string (trimmed), or null. Pure. */
function _value(jar, name) {
  for (const part of String(jar || '').split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return null
}

/** Does this cookie string carry the kill (`uct_chart_speed=0`)? Pure; anything else is "not killed". */
export function cookieKillsChartSpeed(jar) { return _value(jar, CHART_SPEED_COOKIE) === '0' }

/** The device store's own kill in this cookie string: 'off' (`=0`), 'purge' (`=purge`), or null (anything else). Pure. */
export function cookieDeviceStoreKill(jar) {
  const v = _value(jar, DEVICE_STORE_COOKIE)
  return v === '0' ? 'off' : v === DEVICE_STORE_PURGE ? 'purge' : null
}

/** Does this cookie string carry the device store's own kill (either value)? Pure. */
export function cookieKillsDeviceStore(jar) { return cookieDeviceStoreKill(jar) !== null }

let _killed = null          // this page load's chart-speed kill (null: not read yet)
let _deviceKill = null      // ...and its device kill: 'off' | 'purge' | null (read with it)

/** Read both kills from ONE document.cookie read, once per page load. No document (a worker) or an unreadable jar:
 *  not killed. */
function _latch() {
  if (_killed !== null) return
  try {
    const jar = typeof document !== 'undefined' ? document.cookie : ''
    _deviceKill = cookieDeviceStoreKill(jar)
    _killed = cookieKillsChartSpeed(jar)
  } catch { _killed = false; _deviceKill = null }
}

/** Has the server killed the chart speed switches for this page load? Never throws. */
export function chartSpeedKilled() { _latch(); return _killed }

/** The server's device kill for this page load: 'off' | 'purge' | null. Latched. Never throws. */
export function deviceStoreKill() { _latch(); return _deviceKill }

/** Has the server killed the device store ALONE for this page load (either value)? */
export function deviceStoreKilled() { return deviceStoreKill() !== null }

/** ...and told every browser to delete its packs (`purge`)? */
export function deviceStorePurge() { return deviceStoreKill() === 'purge' }

let _killSeen = false       // a fresh read below has seen a kill on this page (never cleared: the client stopped for good)
const _killWatchers = new Set()

/** Is the device store killed NOW, by either kill (either device value)? Read FRESH from the jar (not latched): a page
 *  left open asks it on a visible beat and stops its worker. No document (a worker) or an unreadable jar: not killed.
 *  ⭐ A kill it sees is REMEMBERED for the page (deviceStoreKillSeen) and told ONCE to the watchers (onDeviceStoreKill):
 *  review of #2565, P6-L2. */
export function deviceStoreKilledNow() {
  try {
    if (typeof document === 'undefined') return false
    const jar = document.cookie
    const k = cookieKillsChartSpeed(jar) || cookieKillsDeviceStore(jar)
    if (k && !_killSeen) {
      _killSeen = true
      for (const fn of [..._killWatchers]) { try { fn() } catch { /* one watcher never stops the rest */ } }
    }
    return k
  } catch { return false }
}

/**
 * ⭐ HAS THIS PAGE SEEN A KILL (review of #2565, P6-L2)? A plain boolean: no cookie is read here. It turns true the moment
 * the fresh read above sees a kill (the device client's visible beat: deviceStore/client.js, every VISIBLE_HEARTBEAT_MS
 * while visible and on becoming visible), and stays true: that client has stopped for good. The bar store's device rule
 * asks it on every switch (barStore/prefetch deviceRefusalOf 'killed'), so device rows the page already holds stop
 * painting with the worker, not at the next reload.
 */
export function deviceStoreKillSeen() { return _killSeen }

/** Call `fn` once, when the fresh read first sees a kill on this page (the bar store re-asks the keys it holds device rows
 *  for). Returns the unsubscribe. */
export function onDeviceStoreKill(fn) {
  _killWatchers.add(fn)
  return () => { _killWatchers.delete(fn) }
}

/** Tests: forget this page load's answers. */
export function __resetChartSpeedForTests() { _killed = null; _deviceKill = null; _killSeen = false; _killWatchers.clear() }
