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

// Unix seconds at ~noon ET of the anchor date — a safe input to computeBarTime so
// the D/W/M bar key lands on the right trading day/week/month regardless of DST.
export function anchorNoonSec(anchorDate) {
  return Math.floor(Date.parse(`${anchorDate}T16:00:00Z`) / 1000)  // 16:00 UTC ≈ noon ET
}
