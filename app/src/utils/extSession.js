// Extended-hours session state for the D/W/M "Include pre/post-market" toggle.
//
// The post-market session that just closed stays SHOWN (button + data) all the
// way from 4:00pm ET through 4:00am ET the next day — through the 8pm end of
// post-market and the whole overnight gap — then flips to pre-market at 4:00am.
// Weekends/holidays keep showing the last trading day's post-market.
//
//   pre : weekday 4:00–9:30am ET             → today's pre-market
//   rth : trading-day 9:30am–close ET        → regular session (toggle inactive)
//   post: close ET → 4:00am ET (+ weekend/holiday) → the just-closed post-market
//
// anchorDate = the ET trading day whose extended-hours data to show (YYYY-MM-DD).
//
// Seam 6 (Chart Session / Extended-Hours Temporal Convergence, 2026-09-07): S11
// already owns the NYSE holiday/early-close calendar (nyseCalendar.js); the two
// helpers below now consume its `holidayOn`/`earlyCloseOn`/`hasCoverage` exports
// instead of a weekend-only, hardcoded-16:00-close guess — mirrors marketSession.
// js's own already-accepted convergence exactly (that file's equivalent helpers
// are private/unexported, so this is a second small instance of the same
// pattern on the same shared primitives, not a reimplementation of calendar
// truth). Two confirmed, member-visible defects this closes: (1) a full NYSE
// holiday during would-be regular hours read as `rth` (wrong session — the
// market is fully closed); (2) the extended-hours anchorDate on a holiday
// evening, and — most severely — in the pre-4am window the day AFTER a
// holiday, pointed AT the holiday itself instead of the last real trading day
// (StockChart.jsx feeds this anchorDate into a real bars fetch + the bar-time
// the synthesized candle attaches to — a wrong-data-request bug, not cosmetic).
// A real early-close day (1:00pm ET close) also no longer reads as `rth` for
// the ~3 hours until the old hardcoded 4:00pm threshold. Outside
// `hasCoverage`'s covered years this degrades EXACTLY to the prior
// weekday-only/16:00 behavior — never a guess, never a throw. All 3 consumers
// (ChartPane.jsx, GridChartCell.jsx, StockChart.jsx) read `getExtSession`'s
// result by reference and inherit this fix automatically — none needed a
// direct edit.
import { hasCoverage, holidayOn, earlyCloseOn } from '../lib/marketClock/nyseCalendar'

const _pad = (n) => String(n).padStart(2, '0')
const _etDateOf = (etDate) => `${etDate.getFullYear()}-${_pad(etDate.getMonth() + 1)}-${_pad(etDate.getDate())}`

// True when the ET calendar date `d` is not a trading day at all — weekend,
// or a real NYSE full-holiday closure (silently skipped outside coverage).
function _isNonTradingDayET(d) {
  const day = d.getDay()
  if (day === 0 || day === 6) return true
  return hasCoverage(d.getFullYear()) && !!holidayOn(_etDateOf(d))
}

// The effective regular-session close, in minutes-since-midnight ET, for the
// ET calendar date `d` — 13:00 (780) on a real NYSE early-close day, else the
// ordinary 16:00 (960) close. Falls back to 960 outside calendar coverage.
function _effectiveCloseMinutesET(d) {
  if (!hasCoverage(d.getFullYear())) return 960
  const earlyClose = earlyCloseOn(_etDateOf(d))
  return earlyClose ? earlyClose.closeHour * 60 + earlyClose.closeMinute : 960
}

function _prevTradingDay(etDate) {
  const x = new Date(etDate)
  do { x.setDate(x.getDate() - 1) } while (_isNonTradingDayET(x))
  return x
}

export function getExtSession(now = new Date()) {
  // `et` holds ET wall-clock values in local fields (getHours/getDay/getDate = ET).
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const min = et.getHours() * 60 + et.getMinutes()
  const isTradingDay = !_isNonTradingDayET(et)
  const closeMin = _effectiveCloseMinutesET(et)
  const today = _etDateOf(et)

  if (isTradingDay && min >= 570 && min < closeMin) return { session: 'rth', anchorDate: today }
  if (isTradingDay && min >= 240 && min < 570) return { session: 'pre', anchorDate: today }
  // Post-market (incl. overnight + weekend/holiday): weekday evening at/after
  // today's close anchors to today; overnight and non-trading-days anchor to
  // the previous real trading day.
  const anchor = (isTradingDay && min >= closeMin) ? et : _prevTradingDay(et)
  return { session: 'post', anchorDate: _etDateOf(anchor) }
}

// Render-path variant of getExtSession(). Two things it adds:
//
//  1. A 5s TTL. getExtSession() costs a `toLocaleString` + a Date reparse (+ a
//     weekend walk-back), and the render paths that call it — StockChart and
//     ChartWidget — re-render on every crosshair move and every live tick, so it
//     was running hundreds of times a second during a drag for a value that can
//     only change on a minute boundary.
//  2. A STABLE object identity while the session is unchanged, so callers can put
//     the result in a memo/effect dependency list without churning it. A fresh
//     object per call is what makes "recompute cheaply" turn into "re-run the
//     expensive thing downstream anyway".
//
// Boundary crossings (e.g. 9:30 rth) are picked up within the TTL on the next
// render; the 60s useMarketOpen tick guarantees a render arrives.
let _cacheAt = 0
let _cacheVal = null
export function getExtSessionCached() {
  const t = Date.now()
  // Math.abs, not a plain subtraction: a clock that moves BACKWARD (an NTP
  // correction, a VM resume, a test setting a past system time) makes the delta
  // negative, which a `< TTL` check reads as "still fresh" — and the cache never
  // expires again for as long as the tab lives. Treating any large jump in either
  // direction as expiry is the only version that can't wedge.
  if (_cacheVal && Math.abs(t - _cacheAt) < 5000) return _cacheVal
  const v = getExtSession()
  _cacheAt = t
  if (!_cacheVal || _cacheVal.session !== v.session || _cacheVal.anchorDate !== v.anchorDate) {
    _cacheVal = v
  }
  return _cacheVal
}

// Unix seconds at ~noon ET of the anchor date — a safe input to computeBarTime so
// the D/W/M bar key lands on the right trading day/week/month regardless of DST.
export function anchorNoonSec(anchorDate) {
  return Math.floor(Date.parse(`${anchorDate}T16:00:00Z`) / 1000)  // 16:00 UTC ≈ noon ET
}
