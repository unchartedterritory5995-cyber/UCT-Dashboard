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

/** The cookie's name. api/routers/auth.py CHART_SPEED_COOKIE is the other half; tests/test_chart_speed_kill.py
 *  reads both files and pins them equal. */
export const CHART_SPEED_COOKIE = 'uct_chart_speed'

/** Does this cookie string carry the kill (`uct_chart_speed=0`)? Pure; anything else is "not killed". */
export function cookieKillsChartSpeed(jar) {
  for (const part of String(jar || '').split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === CHART_SPEED_COOKIE) return part.slice(eq + 1).trim() === '0'
  }
  return false
}

let _killed = null

/** Has the server killed the chart speed switches for this page load? Never throws: no document (a
 *  worker) or an unreadable jar reads as "not killed". */
export function chartSpeedKilled() {
  if (_killed !== null) return _killed
  try { _killed = typeof document !== 'undefined' && cookieKillsChartSpeed(document.cookie) } catch { _killed = false }
  return _killed
}

/** Tests: forget this page load's answer. */
export function __resetChartSpeedForTests() { _killed = null }
