// Extended-hours session state for the D/W/M "Include pre/post-market" toggle.
//
// The post-market session that just closed stays SHOWN (button + data) all the
// way from 4:00pm ET through 4:00am ET the next day — through the 8pm end of
// post-market and the whole overnight gap — then flips to pre-market at 4:00am.
// Weekends/holidays keep showing the last trading day's post-market.
//
//   pre : weekday 4:00–9:30am ET        → today's pre-market
//   rth : weekday 9:30am–4:00pm ET      → regular session (toggle inactive)
//   post: 4:00pm ET → 4:00am ET (+ weekend) → the just-closed post-market
//
// anchorDate = the ET trading day whose extended-hours data to show (YYYY-MM-DD).

const _pad = (n) => String(n).padStart(2, '0')
const _etDateOf = (etDate) => `${etDate.getFullYear()}-${_pad(etDate.getMonth() + 1)}-${_pad(etDate.getDate())}`

function _prevTradingDay(etDate) {
  const x = new Date(etDate)
  do { x.setDate(x.getDate() - 1) } while (x.getDay() === 0 || x.getDay() === 6)
  return x
}

export function getExtSession(now = new Date()) {
  // `et` holds ET wall-clock values in local fields (getHours/getDay/getDate = ET).
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const day = et.getDay()            // 0=Sun .. 6=Sat
  const min = et.getHours() * 60 + et.getMinutes()
  const isWeekday = day >= 1 && day <= 5
  const today = _etDateOf(et)

  if (isWeekday && min >= 570 && min < 960) return { session: 'rth', anchorDate: today }
  if (isWeekday && min >= 240 && min < 570) return { session: 'pre', anchorDate: today }
  // Post-market (incl. overnight + weekend): weekday evening (>=4pm) anchors to
  // today; overnight (<4am) and non-weekdays anchor to the previous trading day.
  const anchor = (isWeekday && min >= 960) ? et : _prevTradingDay(et)
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
