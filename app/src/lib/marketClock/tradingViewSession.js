// app/src/lib/marketClock/tradingViewSession.js
//
// ⭐ THE CLOCK LAYER, NOT A SECOND CALENDAR (2026-09-28, the C8 `time_close`
// lane). The real NYSE dates have ONE authority, `market_calendar.json`, read
// here through `sessionCalendar.js`. What this module adds is four MEASURED facts
// about TradingView -- which of those dates its session does not honour -- and
// the view DERIVED from the two. It is kept out of `nyseCalendar.js` (which types
// no date, railed) because it is not a fact about the NYSE; its Python twin is
// `api/services/tradingview_session.py`. Reader: `indicators.js` (the C8 clock
// columns and a date-keyed D/W/M bar's opening instant).

import { EARLY_CLOSE_ROWS, HOLIDAY_ROWS } from './sessionCalendar.js'

function _closeParts(hhmm) {
  const [hh, mm] = hhmm.split(':').map(Number)
  return { closeHour: hh, closeMinute: mm }
}

// ── WHAT TRADINGVIEW'S SESSION APPLIES (2026-09-28) ─────────────────────────
// Mirrors `api/services/nyse_calendar.py`'s `TRADINGVIEW_*` block value for
// value (read that one for the measurements); `tests/test_nyse_calendar_parity.py`
// holds the two together (and `api/services/tradingview_session.py`). Standing owner rule: the chart draws exactly what
// TradingView draws, so the C8 clock columns read THIS view, derived from the
// real NYSE dates above (`market_calendar.json`) and the four measured facts:
//   * no closure before 2000 is in the vendor's session (a weekly bar reads
//     Monday 09:30 / Friday 16:00 on every week before 2000), nor September 11
//     2001 nor Hurricane Sandy 2012;
//   * no half-day before 2019 is, nor 2020-11-27 / 2020-12-24.
export const TRADINGVIEW_CLOSURES_FROM = '2000-01-01'
export const TRADINGVIEW_EARLY_CLOSES_FROM = '2019-01-01'
export const TRADINGVIEW_UNAPPLIED_CLOSURES = Object.freeze([
  { date: '2001-09-11', name: 'September 11' },
  { date: '2001-09-12', name: 'September 11' },
  { date: '2001-09-13', name: 'September 11' },
  { date: '2001-09-14', name: 'September 11' },
  { date: '2012-10-29', name: 'Hurricane Sandy' },
  { date: '2012-10-30', name: 'Hurricane Sandy' },
])
export const TRADINGVIEW_UNAPPLIED_EARLY_CLOSES = Object.freeze([
  { date: '2020-11-27', name: 'Day after Thanksgiving' },
  { date: '2020-12-24', name: 'Christmas Eve' },
])

const _ymd = (iso) => Number(iso.replace(/-/g, ''))
const _TV_UNAPPLIED_CLOSURES = new Set(TRADINGVIEW_UNAPPLIED_CLOSURES.map((e) => _ymd(e.date)))
const _TV_UNAPPLIED_EARLY = new Set(TRADINGVIEW_UNAPPLIED_EARLY_CLOSES.map((e) => _ymd(e.date)))
const _TV_CLOSURES_FROM = _ymd(TRADINGVIEW_CLOSURES_FROM)
const _TV_EARLY_FROM = _ymd(TRADINGVIEW_EARLY_CLOSES_FROM)
/** ⭐ DERIVED, NEVER TYPED: the vendor's view, as `YYYYMMDD` numbers so a
 *  per-bar lookup is one `Set.has`. */
const _TV_CLOSURES = new Set(HOLIDAY_ROWS.map((h) => _ymd(h.date))
  .filter((k) => k >= _TV_CLOSURES_FROM && !_TV_UNAPPLIED_CLOSURES.has(k)))
const _TV_EARLY = new Map(EARLY_CLOSE_ROWS
  .filter((e) => _ymd(e.date) >= _TV_EARLY_FROM && !_TV_UNAPPLIED_EARLY.has(_ymd(e.date)))
  .map((e) => { const c = _closeParts(e.close); return [_ymd(e.date), c.closeHour * 60 + c.closeMinute] }))

/** The regular session in New York, minutes after midnight. */
export const SESSION_OPEN_MINUTE = 9 * 60 + 30
export const SESSION_CLOSE_MINUTE = 16 * 60

/** The vendor's regular-session close on `ymd` (a `YYYYMMDD` number), in
 *  minutes after midnight New York -- 780 on a half-day it applies, else 960 --
 *  or `null` when its session holds no trading that day: a Saturday, a Sunday,
 *  or a closure it applies. Mirrors `nyse_calendar.tradingview_close_minute`. */
export function tradingViewCloseMinute(ymd) {
  const y = Math.floor(ymd / 10000)
  const m = Math.floor(ymd / 100) % 100
  const d = ymd % 100
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  if (dow === 0 || dow === 6 || _TV_CLOSURES.has(ymd)) return null
  return _TV_EARLY.has(ymd) ? _TV_EARLY.get(ymd) : SESSION_CLOSE_MINUTE
}
