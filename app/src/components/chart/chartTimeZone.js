// ── CHART TIME ZONE — Chart Settings → Canvas → Scale & time → Time zone (owner 11-16, was Soon) ──
//
// DISPLAY ONLY. Intraday bars reach lightweight-charts as ET wall clock written as UTC seconds ("chart time",
// barTime.toChartTime), and every rule that reads them — session breaks, pre-market, extended-hours shading, the
// RTH filter, the bar buckets — stays New York. This module only re-reads ONE chart time in another zone, for the
// time-axis tick labels and the crosshair time label:
//
//   chart time (ET wall)  →  the instant (barTime.fromChartTime, DST-correct)  →  that zone's wall clock,
//   returned again as "wall clock written as UTC seconds", so the existing formatters (getUTC*) print it unchanged.
//
// The zone's offset comes from Intl.DateTimeFormat at that instant, so both zones' DST rules apply per bar (the US
// and Europe switch on different Sundays; Sydney's summer is the northern winter).

import { fromChartTime } from './barTime'
import { TIME_ZONES } from './chartViewOptions'

const _IANA = new Map(TIME_ZONES.map(([id, , iana]) => [id, iana]))

/** The browser's own IANA zone ('UTC' when it cannot be read). */
export function browserTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' }
}

/** The IANA zone a TIME_ZONES id names, or null for 'exchange' / unknown (= the chart time as it is). */
export function ianaZoneFor(id) {
  if (!id || id === 'exchange' || !_IANA.has(id)) return null
  return id === 'local' ? browserTimeZone() : _IANA.get(id)
}

const _fmtByZone = new Map()
function _fmt(tz) {
  let f = _fmtByZone.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    _fmtByZone.set(tz, f)
  }
  return f
}

/** Wall clock of unix second `unixSec` in IANA zone `tz`, written as UTC seconds. */
export function wallSecIn(unixSec, tz) {
  const p = {}
  for (const x of _fmt(tz).formatToParts(new Date(unixSec * 1000))) {
    if (x.type !== 'literal') p[x.type] = Number(x.value)
  }
  return Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second) / 1000
}

/**
 * A chart time (ET wall clock as UTC seconds) re-read in IANA zone `tz` — the same shape, so a formatter reading
 * getUTC* prints that zone's wall clock. `tz` null / 'America/New_York' returns `chartSec` itself (today's labels).
 */
export function chartTimeInZone(chartSec, tz) {
  if (!tz || tz === 'America/New_York' || typeof chartSec !== 'number' || !Number.isFinite(chartSec)) return chartSec
  try {
    const unix = fromChartTime(chartSec)
    if (!Number.isFinite(unix)) return chartSec
    return wallSecIn(unix, tz)
  } catch {
    return chartSec
  }
}
