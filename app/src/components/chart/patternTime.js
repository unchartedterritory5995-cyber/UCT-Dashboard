// app/src/components/chart/patternTime.js — engine anchor time -> the chart's bar time.
//
// ⛔ THE BUG THIS EXISTS FOR (verified 2026-10-16). PatternOverlay handed the
// engine's anchor `t` straight to `timeScale().timeToCoordinate`. The engine is
// fed `bars_sqlite.get_bars(sym, tf, N)`, whose `ts` is a YYYYMMDD int for
// D/W/M and UTC epoch seconds intraday — while the chart's candle series is
// keyed 'YYYY-MM-DD' on D/W/M and ET-shifted epoch seconds intraday
// (StockChart `adjustTime`). So on a daily chart every anchor (20261015)
// was read as a 1970 timestamp, `timeToCoordinate` answered null, and every
// shape silently drew nothing; intraday anchors landed ET_OFFSET seconds off
// any bar and resolved null the same way.
//
// ONE conversion, then ONE snap onto a bar the series actually holds, because
// `timeToCoordinate` answers only for a time the series has.
import { ET_OFFSET } from './barTime'

const DATE_TFS = new Set(['D', 'W', 'M'])

export function isDateTf(tf) {
  return DATE_TFS.has(String(tf || 'D'))
}

// A YYYYMMDD int (or its string form) — the daily store's spelling.
function isYmdInt(t) {
  const n = Number(t)
  return Number.isInteger(n) && n >= 19000101 && n <= 29991231
}

function ymdIntToIso(t) {
  const s = String(Math.trunc(Number(t)))
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

function epochToEtIso(sec) {
  return new Date(sec * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

// 09:30 ET on an ISO date, as UTC epoch seconds (DST-correct via the offset in
// force at that instant).
function isoToEtOpenEpoch(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const guess = Date.UTC(y, m - 1, d, 13, 30) / 1000 // 09:30 EDT
  const etHour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', hour12: false,
  }).format(new Date(guess * 1000)))
  return etHour === 9 ? guess : guess + 3600 // EST: 14:30 UTC
}

/**
 * Engine anchor `t` -> the chart's time format for `tf`.
 *   D/W/M    -> 'YYYY-MM-DD' (ET calendar date)
 *   intraday -> epoch seconds + ET_OFFSET (StockChart's adjustTime)
 * Accepts YYYYMMDD ints, 'YYYY-MM-DD' strings and UTC epoch seconds.
 * Returns null for anything unrecognisable — never a guess.
 */
export function toChartTime(t, tf, etOffset = ET_OFFSET) {
  if (t == null || t === '') return null
  const dateTf = isDateTf(tf)
  if (typeof t === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t)) {
    return dateTf ? t : isoToEtOpenEpoch(t) + etOffset
  }
  if (isYmdInt(t)) {
    const iso = ymdIntToIso(t)
    return dateTf ? iso : isoToEtOpenEpoch(iso) + etOffset
  }
  const n = Number(t)
  if (!Number.isFinite(n) || n <= 0) return null
  return dateTf ? epochToEtIso(n) : n + etOffset
}

/**
 * Snap a chart time onto a bar the series holds (sorted ascending).
 *   W        -> the first bar ON OR AFTER (weekly bars are dated by the week's
 *               Friday close, so a Monday falls inside the NEXT key)
 *   D/M/intra-> the last bar ON OR BEFORE (daily exact; monthly dated by the
 *               1st; intraday dated by the bucket start)
 * Returns null when the time is outside the loaded bars (off-screen history /
 * not yet loaded) — callers treat null as "skip this shape".
 */
export function snapToBar(chartT, barTimes, tf) {
  if (chartT == null || !barTimes || !barTimes.length) return null
  const ceil = String(tf) === 'W'
  let lo = 0
  let hi = barTimes.length - 1
  if (ceil) {
    if (chartT > barTimes[hi]) return null
    let ans = null
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (barTimes[mid] >= chartT) { ans = barTimes[mid]; hi = mid - 1 } else lo = mid + 1
    }
    return ans
  }
  if (chartT < barTimes[0]) return null
  let ans = null
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (barTimes[mid] <= chartT) { ans = barTimes[mid]; lo = mid + 1 } else hi = mid - 1
  }
  return ans
}

/** Convert + snap in one call; when no bar list is known, the converted time. */
export function anchorToBarTime(t, tf, barTimes, etOffset = ET_OFFSET) {
  const c = toChartTime(t, tf, etOffset)
  if (c == null) return null
  if (!barTimes || !barTimes.length) return c
  return snapToBar(c, barTimes, tf)
}
