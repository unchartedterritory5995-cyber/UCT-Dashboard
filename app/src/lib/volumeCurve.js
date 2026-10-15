// "Volume vs usual by now" — the client half of the screener's live `rvol_live`.
//
// The server builds ONE market-wide time-of-day volume curve each night
// (api/services/screener/volume_curve.py) and serves it with today's ET session window
// at GET /api/screener/volume-curve. This file is the browser mirror of that module's
// `share_at` / `live_share` / `rvol`, so the chart header and the screener divide by the
// same number:
//
//     rvol = today_vol / (avg_volume_30d × curve(minutes since the open))
//
// ⛔ Keep the arithmetic in step with volume_curve.py: the first 15 minutes are blank,
// an early-close session is scaled to its own length, and a missing or non-positive
// input is blank (null), never a guess. volumeCurve.test.js pins the same cases the
// Python tests pin.
// Design: docs/superpowers/specs/2026-10-15-screener-live-relative-volume-design.md

export const FULL_SESSION_MIN = 390
export const SUPPRESS_FIRST_MIN = 15

const ET_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

/** The ET calendar date ('YYYY-MM-DD') and minutes past ET midnight of an instant. */
export function etParts(date) {
  const p = Object.fromEntries(ET_FMT.formatToParts(date).map(x => [x.type, x.value]))
  const hour = Number(p.hour) % 24
  return {
    ymd: `${p.year}-${p.month}-${p.day}`,
    minutes: hour * 60 + Number(p.minute) + Number(p.second) / 60,
  }
}

/** The usual share of a session's volume done `elapsed` minutes after the open. */
export function shareAt(curve, elapsed, sessionMinutes = FULL_SESSION_MIN,
  { full = FULL_SESSION_MIN, suppress = SUPPRESS_FIRST_MIN } = {}) {
  if (!Array.isArray(curve) || curve.length !== full + 1 || !(sessionMinutes > 0)) return null
  if (!Number.isFinite(elapsed) || elapsed < suppress) return null
  const m = Math.min(elapsed, sessionMinutes)
  const x = (m * full) / sessionMinutes
  const i = Math.floor(x)
  const v = i >= full ? curve[full] : curve[i] + (curve[i + 1] - curve[i]) * (x - i)
  return Number.isFinite(v) && v > 0 ? v : null
}

/** The share to divide by right now, from the endpoint's payload, or null. */
export function liveShare(payload, now = new Date()) {
  const s = payload?.session
  if (!payload?.curve || !s) return null
  const { ymd, minutes } = etParts(now)
  if (s.date !== ymd) return null             // a payload from another day: blank, not stale
  const elapsed = minutes - s.open_min
  if (elapsed < 0) return null
  return shareAt(payload.curve, elapsed, s.close_min - s.open_min, {
    full: payload.full_session_min || FULL_SESSION_MIN,
    suppress: payload.suppress_first_min ?? SUPPRESS_FIRST_MIN,
  })
}

/** today_vol / (avg × share), 2 dp, or null when any input is missing or non-positive. */
export function rvolByNow(todayVol, avg, share) {
  if (![todayVol, avg, share].every(v => typeof v === 'number' && Number.isFinite(v) && v > 0)) return null
  return Math.round((todayVol / (avg * share)) * 100) / 100
}
