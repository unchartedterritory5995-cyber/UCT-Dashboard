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
//
// APPROACH B (2026-10-15): the same nightly also stores a per-stock curve (79 knot shares,
// one per 5-minute boundary) for liquid names with enough history. Ask the endpoint with
// `?tickers=` and it returns `ticker_knots: {SYM: [...]}`; `liveShare(payload, now, sym)`
// reads the symbol's own curve when present and the market curve otherwise — exactly what
// the screener's live tier divides by for that row.
// Design: docs/superpowers/specs/2026-10-15-screener-live-relative-volume-design.md

export const FULL_SESSION_MIN = 390
export const SUPPRESS_FIRST_MIN = 15
export const BAR_MIN = 5

/** The one tooltip every RVOL display carries, so the number reads the same everywhere. */
export const RVOL_TOOLTIP = 'Volume vs usual by this time of day'

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

/** `shareAt` for a per-ticker curve of 79 knot shares (mirror of `knot_share_at`). */
export function knotShareAt(knots, elapsed, sessionMinutes = FULL_SESSION_MIN,
  { full = FULL_SESSION_MIN, suppress = SUPPRESS_FIRST_MIN, bar = BAR_MIN } = {}) {
  if (!Array.isArray(knots) || knots.length !== Math.round(full / bar) + 1 || !(sessionMinutes > 0)) return null
  if (!Number.isFinite(elapsed) || elapsed < suppress) return null
  const m = Math.min(elapsed, sessionMinutes)
  const x = (m * full) / sessionMinutes / bar
  const last = knots.length - 1
  const i = Math.floor(x)
  const v = i >= last ? knots[last] : knots[i] + (knots[i + 1] - knots[i]) * (x - i)
  return Number.isFinite(v) && v > 0 ? v : null
}

/**
 * The share to divide by right now, from the endpoint's payload, or null. With `sym`, the
 * symbol's OWN curve (`payload.ticker_knots[SYM]`) when the payload carries one, else the
 * market curve. No market curve ⇒ blank for every symbol, the same as the screener.
 */
export function liveShare(payload, now = new Date(), sym = null) {
  const s = payload?.session
  if (!payload?.curve || !s) return null
  const { ymd, minutes } = etParts(now)
  if (s.date !== ymd) return null             // a payload from another day: blank, not stale
  const elapsed = minutes - s.open_min
  if (elapsed < 0) return null
  const opts = {
    full: payload.full_session_min || FULL_SESSION_MIN,
    suppress: payload.suppress_first_min ?? SUPPRESS_FIRST_MIN,
    bar: payload.bar_min || BAR_MIN,
  }
  const own = sym ? payload.ticker_knots?.[String(sym).toUpperCase()] : null
  if (Array.isArray(own)) return knotShareAt(own, elapsed, s.close_min - s.open_min, opts)
  return shareAt(payload.curve, elapsed, s.close_min - s.open_min, opts)
}

/** today_vol / (avg × share), 2 dp, or null when any input is missing or non-positive. */
export function rvolByNow(todayVol, avg, share) {
  if (![todayVol, avg, share].every(v => typeof v === 'number' && Number.isFinite(v) && v > 0)) return null
  return Math.round((todayVol / (avg * share)) * 100) / 100
}

/**
 * "Volume vs usual by now" for one symbol: today's volume over (its 30-session average ×
 * the share of a normal day it — or the market — has usually traded by this minute).
 * The ONE formula the chart header, the watchlist and the terminal headline all call.
 */
export function rvolForSymbol(payload, sym, todayVol, avg30, now = new Date()) {
  return rvolByNow(todayVol, avg30, liveShare(payload, now, sym))
}

/** The one display form every RVOL uses: `2.7x`; null for a blank. */
export function formatRvol(r) {
  return typeof r === 'number' && Number.isFinite(r) ? `${r.toFixed(1)}x` : null
}
