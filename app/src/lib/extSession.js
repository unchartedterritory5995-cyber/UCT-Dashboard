// Extended-session clock (owner 11-14, the Watchlist's RTH · EXT switch). Mirrors the
// backend's api/routers/live_prices.py::_ext_session_start: pre-market began today 04:00 ET;
// after-hours began 16:00 ET on the last weekday (today after the bell, the previous weekday
// overnight, Friday over a weekend). Seconds since the epoch; null in the regular session.
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
// ONE formatter for the module (2026-11-20): constructing an `Intl.DateTimeFormat` is the expensive part, and
// this ran per call (measured: 10.7 ms of one symbol switch in extended hours). Its output is unchanged.
let _ET = null
const etFormatter = () => (_ET || (_ET = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hourCycle: 'h23', weekday: 'short',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
})))
function etParts(d) {
  const o = {}
  for (const p of etFormatter().formatToParts(d)) o[p.type] = p.value
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, s: +o.second, wd: WD.indexOf(o.weekday) }
}
// Epoch seconds of `hour`:00 ET on the ET calendar day `daysBack` before `now`.
function etWallSec(now, daysBack, hour) {
  const p = etParts(now)
  const offsetMs = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(now.getTime() / 1000) * 1000
  return (Date.UTC(p.y, p.m - 1, p.d - daysBack, hour, 0, 0) - offsetMs) / 1000
}
export function extSessionStartSec(marketSession, now = new Date()) {
  if (marketSession === 'pre_market') return etWallSec(now, 0, 4)
  if (marketSession !== 'post_market') return null
  const { h, wd } = etParts(now)
  if (wd >= 1 && wd <= 5 && h >= 16) return etWallSec(now, 0, 16)
  let back = 1
  let day = (wd + 6) % 7
  while (day === 0 || day === 6) { back += 1; day = (day + 6) % 7 }
  return etWallSec(now, back, 16)
}
