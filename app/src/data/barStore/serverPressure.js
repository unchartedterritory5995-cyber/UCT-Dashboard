// ⭐ (2026-11-28, board pre-mount) THE SERVER'S PRESSURE, AS THIS PAGE LAST SAW IT. The bars network notes every answer that
// says the server is busy: a 429 (the rate limiter), a 503 (a warming name, a shed warm, a busy leader: X-Bars-Shed). Work
// that is only ever speculative (the workspace's background pre-mount of the member's other boards, pages/charts/
// boardPremount.js) reads it and backs off: nothing it does may add load while the origin is shedding.
let _last = 0
let _count = 0
const _now = () => Date.now()

/** A bars answer said the server is under pressure (status 429 or 503). */
export function notePressure(status) {
  if (status !== 429 && status !== 503) return
  _last = _now()
  _count++
}

/** Milliseconds since the last pressure answer (Infinity: none on this page). */
export function msSincePressure(now = _now()) {
  return _last ? Math.max(0, now - _last) : Infinity
}

export function pressureCount() { return _count }

export function __resetPressureForTests() { _last = 0; _count = 0 }
